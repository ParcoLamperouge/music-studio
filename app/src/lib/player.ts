import { readBytes } from "./engine";

/** Nombre de la pista de clics del metrónomo dentro del reproductor. */
export const CLICK = "__click";

export class DecodeError extends Error {
  constructor(public track: string) {
    super(`${track}: no se pudo decodificar`);
  }
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
    return Math.min(t, this.duration);
  }

  play() {
    if (this.playing) return;
    if (this.offset >= this.duration) this.offset = 0;
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
    this.offset = Math.max(0, Math.min(t, this.duration));
    if (was) this.play();
  }

  /** Crea el nodo si aún no existe: así el volumen fijado antes de cargar una pista (p. ej. el metrónomo) no se pierde. */
  setGain(name: string, value: number) {
    if (!this.gains.has(name)) this.gains.set(name, this.gainNode());
    this.gains.get(name)!.gain.setTargetAtTime(value, this.ctx.currentTime, 0.015);
  }

  private stopSources() {
    for (const s of this.sources) s.stop();
    this.sources = [];
    this.playing = false;
  }
}

/** Un piano sencillo (armónicos que se apagan, los graves más despacio) para oír las sesiones del teclado.
 * notes: [inicio, fin, nota MIDI, velocidad 0-1]. */
export function synth(notes: [number, number, number, number][], duration: number) {
  const rate = 22050; // ponytail: todo en un buffer (~5 MB por minuto); para sesiones de horas, por tramos
  const ctx = new OfflineAudioContext(1, Math.ceil((duration + 1.5) * rate), rate);
  const wave = ctx.createPeriodicWave(new Float32Array(6), new Float32Array([0, 1, 0.5, 0.25, 0.12, 0.06]));
  const comp = ctx.createDynamicsCompressor(); // muchas notas a la vez no saturan
  comp.connect(ctx.destination);
  const out = ctx.createGain();
  out.gain.value = 0.3;
  out.connect(comp);
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

/** Una nota en el momento (practicar con el teclado del ordenador sin piano): devuelve con qué soltarla. */
export function voice(ctx: AudioContext, p: number, v = 0.7) {
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
