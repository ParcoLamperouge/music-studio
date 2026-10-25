import { readBytes } from "./engine";
import { loadPiano, playNote, ready } from "./piano";

/** Nombre de la pista de clics del metrónomo dentro del reproductor. */
export const CLICK = "__click";

export class DecodeError extends Error {
  constructor(public track: string) {
    super(`${track}: no se pudo decodificar`);
  }
}

type Note = [start: number, end: number, pitch: number, velocity: number];

/** Primer índice de `notes` (ordenadas por inicio) que podría seguir sonando en `t`: como las notas duran poco, se
 * busca el inicio y se retrocede un margen. */
function firstEndingAfter(notes: Note[], t: number) {
  let [lo, hi] = [0, notes.length];
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (notes[m][0] < t - 30) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Reproduce varias pistas sincronizadas: un AudioBufferSourceNode por pista, todas arrancadas en el mismo instante. */
export class Player {
  ctx = new AudioContext();
  /** Volumen general: todas las pistas pasan por aquí. */
  private master = (() => {
    const g = this.ctx.createGain();
    g.connect(this.ctx.destination);
    return g;
  })();
  buffers = new Map<string, AudioBuffer>();
  gains = new Map<string, GainNode>();
  private sources: AudioBufferSourceNode[] = [];
  private startedAt = 0;
  private offset = 0;
  playing = false;
  duration = 0;
  /** Lo que dura como mínimo aunque aún no haya pistas (una pieza cuya guía se está sintetizando): el reloj avanza igual. */
  minDuration = 0;
  private get end() {
    return Math.max(this.duration, this.minDuration);
  }

  // pistas de notas (la guía de Aprender): se tocan en vivo con el piano de muestras, programadas un poco por delante
  // del reloj; sin sintetizar nada antes, así suenan al momento y siguen al instante cualquier cambio
  private live = new Map<string, Note[]>();
  private voices: { end: number; off: () => void }[] = []; // end: en tiempo del contexto
  private timer: ReturnType<typeof setInterval> | undefined;
  private scheduled = 0; // hasta dónde (en segundos de la canción) ya está programado

  /** Notas [inicio, fin, nota, fuerza] que suenan por la ganancia `name`; sustituye a las que hubiera. */
  setNotes(name: string, notes: Note[]) {
    this.live.set(name, [...notes].sort((a, b) => a[0] - b[0]));
    if (!this.gains.has(name)) this.gains.set(name, this.gainNode());
    if (this.playing) this.reschedule();
  }

  /** Nombres de las pistas de notas activas (la guía de Aprender, las versiones embellecidas…). */
  notesNames(): string[] {
    return [...this.live.keys()];
  }

  private reschedule() {
    this.silence();
    this.scheduled = this.time();
    this.schedule(true);
  }

  private silence() {
    for (const v of this.voices) v.off();
    this.voices = [];
  }

  /** Programa lo que empieza antes de medio segundo desde ahora (`fromHere`: también lo que ya estaba sonando). */
  private schedule(fromHere = false) {
    if (!this.playing) return;
    const samples = ready;
    if (!samples) return void loadPiano().catch(() => {});
    const now = this.time(), until = now + 0.5;
    const from = Math.max(this.scheduled, now - 0.1); // tras un parón (cargando el piano), nada atrasado de golpe
    for (const [name, notes] of this.live) {
      const dest = this.gains.get(name)!;
      for (let i = firstEndingAfter(notes, from); i < notes.length && notes[i][0] < until; i++) {
        const [s, e, p, v] = notes[i];
        if (s < from && !(fromHere && e > from + 0.1)) continue; // ya programada (o casi acabada)
        const at = Math.max(this.startedAt + s, this.ctx.currentTime);
        const end = Math.max(at + 0.05, this.startedAt + e);
        this.voices.push({ end: end + 0.7, off: playNote(this.ctx, dest, samples, p, v, at, end) });
      }
    }
    this.scheduled = until;
    this.voices = this.voices.filter((v) => v.end > this.ctx.currentTime); // las que ya se apagaron
  }

  /** Lanza DecodeError si alguna pista no se puede decodificar (se arregla convirtiéndola). */
  async load(tracks: { name: string; path: string }[]) {
    this.stop();
    this.buffers.clear();
    // descarga en paralelo (servidor local), decodificación una a una para no duplicar picos de memoria
    const all = tracks.map(({ path }) => readBytes(path));
    for (const [i, { name }] of tracks.entries()) {
      const data = await all[i];
      const buf = await this.ctx.decodeAudioData(data).catch(() => {
        throw new DecodeError(name);
      });
      this.buffers.set(name, buf);
      if (!this.gains.has(name)) this.gains.set(name, this.gainNode());
    }
    this.duration = Math.max(0, ...[...this.buffers.values()].map((b) => b.duration));
    this.offset = 0;
  }

  /** Cambia las pistas `tracks` por otras (las mismas, más lentas) sin perder el sitio: lo de ahora sigue sonando mientras
   * se decodifican, y el cambio es en el mismo punto, sonando si sonaba. El resto de pistas (guía, metrónomo) se queda. */
  async swap(tracks: { name: string; path: string }[]) {
    const fresh = new Map<string, AudioBuffer>();
    const all = tracks.map(({ path }) => readBytes(path));
    for (const [i, { name }] of tracks.entries()) {
      const buf = await this.ctx.decodeAudioData(await all[i]).catch(() => {
        throw new DecodeError(name);
      });
      fresh.set(name, buf);
    }
    const [at, was] = [this.time(), this.playing];
    this.stopSources();
    for (const [name, buf] of fresh) {
      this.buffers.set(name, buf);
      if (!this.gains.has(name)) this.gains.set(name, this.gainNode());
    }
    this.duration = Math.max(0, ...[...this.buffers.values()].map((b) => b.duration));
    this.offset = Math.min(at, this.end);
    if (was) this.play();
  }

  private gainNode() {
    const g = this.ctx.createGain();
    g.connect(this.master);
    return g;
  }

  /** Metrónomo: sintetiza una pista de clics (pulsos en segundos) y la suma como una pista más,
   * así va sincronizada con play, pausa y saltos sin hacer nada especial. */
  setClicks(beats: number[], accent: (i: number) => boolean) {
    const rate = 22050;
    const len = Math.max(1, Math.ceil(this.duration * rate));
    const buf = this.ctx.createBuffer(1, len, rate);
    const d = buf.getChannelData(0);
    const n = Math.floor(0.035 * rate);
    beats.forEach((b, i) => {
      const strong = accent(i);
      const f = strong ? 1760 : 1100;
      const amp = strong ? 0.9 : 0.5;
      const start = Math.floor(b * rate);
      for (let k = 0; k < n && start + k < len; k++) {
        d[start + k] += amp * Math.sin((2 * Math.PI * f * k) / rate) * Math.exp(-k / (rate * 0.007));
      }
    });
    this.setBuffer(CLICK, buf);
  }

  /** Una pista ya en memoria (el metrónomo, una sesión del teclado sintetizada), sin cortar lo que suena. */
  setBuffer(name: string, buf: AudioBuffer) {
    const was = this.playing;
    const t = this.time();
    this.stopSources();
    this.buffers.set(name, buf);
    if (!this.gains.has(name)) this.gains.set(name, this.gainNode());
    this.duration = Math.max(this.duration, buf.duration);
    this.offset = t;
    if (was) this.play();
  }

  setMaster(value: number) {
    this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.015);
  }

  time() {
    const t = this.playing ? this.ctx.currentTime - this.startedAt : this.offset;
    return Math.max(this.playing ? this.offset : 0, Math.min(t, this.end)); // arranca 50 ms después: sin ir hacia atrás
  }

  play() {
    if (this.playing) return;
    if (this.offset >= this.end) this.offset = 0;
    void this.ctx.resume();
    const at = this.ctx.currentTime + 0.05;
    this.sources = [...this.buffers].map(([name, buf]) => {
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.connect(this.gains.get(name)!);
      src.start(at, this.offset);
      return src;
    });
    this.startedAt = at - this.offset;
    this.playing = true;
    this.scheduled = this.offset;
    this.schedule(true);
    this.timer = setInterval(() => this.schedule(), 100);
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.time();
    this.stopSources();
  }

  stop() {
    this.stopSources();
    this.offset = 0;
  }

  seek(t: number) {
    const was = this.playing;
    this.stopSources();
    this.offset = Math.max(0, Math.min(t, this.end));
    if (was) this.play();
  }

  /** Crea el nodo si aún no existe: así el volumen fijado antes de cargar una pista (p. ej. el metrónomo) no se pierde. */
  setGain(name: string, value: number) {
    if (!this.gains.has(name)) this.gains.set(name, this.gainNode());
    this.gains.get(name)!.gain.setTargetAtTime(value, this.ctx.currentTime, 0.015);
  }

  private stopSources() {
    clearInterval(this.timer);
    this.silence();
    for (const s of this.sources) s.stop();
    this.sources = [];
    this.playing = false;
  }
}

/** Las notas como un piano (muestras del Salamander, piano.ts) en un buffer, para reproducirlas sincronizadas con el
 * resto. Si las muestras no cargan, un piano sintetizado sencillo (armónicos que se apagan, los graves más despacio).
 * notes: [inicio, fin, nota MIDI, velocidad 0-1]. */
export async function synth(notes: [number, number, number, number][], duration: number) {
  const rate = 32000; // ponytail: todo en un buffer (~8 MB por minuto); para sesiones de horas, por tramos
  const ctx = new OfflineAudioContext(1, Math.ceil((duration + 2) * rate), rate);
  const comp = ctx.createDynamicsCompressor(); // muchas notas a la vez no saturan
  comp.connect(ctx.destination);
  const out = ctx.createGain();
  out.connect(comp);
  const samples = await loadPiano().catch(() => null);
  if (samples) {
    out.gain.value = 0.55;
    for (const [s, e, p, v] of notes) playNote(ctx, out, samples, p, v, s, e);
    return ctx.startRendering();
  }
  out.gain.value = 0.3;
  const wave = ctx.createPeriodicWave(new Float32Array(6), new Float32Array([0, 1, 0.5, 0.25, 0.12, 0.06]));
  for (const [s, e, p, v] of notes) {
    const o = ctx.createOscillator();
    o.setPeriodicWave(wave);
    o.frequency.value = 440 * 2 ** ((p - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, s);
    g.gain.linearRampToValueAtTime(0.15 + 0.6 * v, s + 0.005);
    g.gain.setTargetAtTime(0, s + 0.005, 0.3 + 2.2 * Math.max(0, (108 - p) / 87));
    g.gain.setTargetAtTime(0, e, 0.06); // al soltar (o levantar el pedal)
    o.connect(g).connect(out);
    o.start(s);
    o.stop(e + 0.5);
  }
  return ctx.startRendering();
}

/** Una nota en el momento (practicar con el teclado del ordenador sin piano): devuelve con qué soltarla. Con las
 * muestras ya cargadas suena a piano; si aún no, un sonido sencillo mientras cargan. */
export function voice(ctx: AudioContext, p: number, v = 0.7) {
  if (ready) return playNote(ctx, ctx.destination, ready, p, v, ctx.currentTime, null);
  void loadPiano().catch(() => {});
  const now = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.value = 440 * 2 ** ((p - 69) / 12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(0.25 * v, now + 0.005);
  g.gain.setTargetAtTime(0, now + 0.005, 0.3 + 2.2 * Math.max(0, (108 - p) / 87));
  o.connect(g).connect(ctx.destination);
  o.start(now);
  return () => {
    const t = ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setTargetAtTime(0, t, 0.05);
    o.stop(t + 0.4);
  };
}

/** Picos por columna para dibujar la forma de onda. */
export function peaks(buf: AudioBuffer, columns: number): Float32Array {
  const out = new Float32Array(columns);
  const step = Math.floor(buf.length / columns) || 1;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const data = buf.getChannelData(ch);
    for (let c = 0; c < columns; c++) {
      let max = 0;
      for (let i = c * step, end = Math.min(i + step, data.length); i < end; i += 4) {
        const v = Math.abs(data[i]);
        if (v > max) max = v;
      }
      if (max > out[c]) out[c] = max;
    }
  }
  return out;
}
