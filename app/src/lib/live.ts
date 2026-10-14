/** Modo Tocar: lo que llega del teclado MIDI (notas y pedal) se convierte en notas con su duración real, el acorde
 * que suena (sin IA, con las plantillas de harmony.ts) y, al guardar, un .mid reproducible y un .json para la IA. */

import { bestChord, chordName, degree, findKey, keyFromChords, keyName, noteName, tonesOf, type Chord, type Key, type Note } from "./harmony.ts";

type Open = { t: number; v: number; held: boolean }; // held: la tecla sigue abajo (si no, la sostiene el pedal)

export class Live {
  t0 = -1; // performance.now()/1000 de la primera nota
  events: [t: number, msg: number[]][] = []; // mensajes tal cual, para el .mid
  notes: Note[] = []; // [inicio, fin, nota, velocidad 0-1]
  sounding = new Map<number, Open>();
  pedal = false;
  pedals: [number, number][] = [];
  chords: Chord[] = [];
  chord: Chord | null = null; // el que suena
  channel = 0; // el del teclado, para mandarle el volumen
  private pedalAt = 0;

  /** Segundos desde la primera nota (0 antes de tocar nada). */
  time(now: number) {
    return this.t0 < 0 ? 0 : now - this.t0;
  }

  /** Un mensaje MIDI recibido en `now` (segundos). Devuelve si cambió algo. */
  midi(msg: number[], now: number) {
    const [st, a, b] = msg;
    const kind = st & 0xf0;
    if (kind < 0x80 || kind > 0xe0) return false; // reloj, active sensing, sysex
    if (kind === 0x90 && b > 0 && this.t0 < 0) this.t0 = now;
    const t = this.time(now);
    this.channel = st & 0x0f;
    if (this.t0 >= 0) this.events.push([t, msg]);
    if (kind === 0x90 && b > 0) {
      this.close(a, t); // la misma tecla otra vez con el pedal pisado
      this.sounding.set(a, { t, v: b / 127, held: true });
    } else if (kind === 0x80 || kind === 0x90) {
      const n = this.sounding.get(a);
      if (n && this.pedal) n.held = false;
      else this.close(a, t);
    } else if (kind === 0xb0 && a === 64) {
      const down = b >= 64;
      if (down === this.pedal) return false;
      this.pedal = down;
      if (down) this.pedalAt = t;
      else {
        this.pedals.push([this.pedalAt, t]);
        for (const [p, n] of this.sounding) if (!n.held) this.close(p, t);
      }
    } else return true;
    this.updateChord(t);
    return true;
  }

  private close(p: number, t: number) {
    const n = this.sounding.get(p);
    if (!n) return;
    this.sounding.delete(p);
    this.notes.push([n.t, Math.max(t, n.t + 0.01), p, n.v]);
  }

  /** Acorde de lo que suena: con 3 notas distintas o más; la más grave hace de bajo. Aquí las notas son exactas (no
   * transcritas), así que se exige que suenen la fundamental y la tercera y nada de fuera, salvo un color (novena…) sobre
   * el acorde completo: Re-Mi-Fa es un racimo, no Rem, y Re-Fa-Sol no es Sol7. */
  private updateChord(t: number) {
    const pcs = new Set([...this.sounding.keys()].map((p) => p % 12));
    let c: Chord | null = null;
    if (pcs.size >= 3) {
      const pc = new Array(12).fill(0);
      for (const p of pcs) pc[p] = 1;
      const b = bestChord(pc, Math.min(...this.sounding.keys()) % 12);
      const tones = b ? tonesOf(b.kind).map((i) => (b.root + i) % 12) : [];
      const outside = [...pcs].filter((p) => !tones.includes(p)).length;
      const real = b && pcs.has(tones[0]) && pcs.has(tones[1]) && (outside === 0 || (outside === 1 && pcs.has(tones[2])));
      c = real ? { ...b, t, end: t } : null;
    }
    const cur = this.chord;
    if (cur && c && cur.root === c.root && cur.kind === c.kind && cur.bass === c.bass) return;
    // lo que dura menos que un arpegio rápido es el paso de un acorde a otro, no un acorde
    if (cur && t - cur.t >= 0.15) this.chords.push({ ...cur, end: t });
    this.chord = c;
  }

  /** Tonalidad de lo tocado (por duración), con unas cuantas notas ya. */
  key(now: number): Key | null {
    const t = this.time(now);
    const all = [...this.notes, ...[...this.sounding].map(([p, n]) => [n.t, t, p, n.v] as Note)];
    if (all.length < 12) return null;
    // con unos cuantos acordes, como un músico (tónica, dominante, cadencias; la mano izquierda hace de bajo)
    if (this.chords.length >= 4) return keyFromChords(this.chords, all.filter((n) => n[2] < 55));
    const pc = new Array(12).fill(0);
    for (const [s, e, p] of all) pc[p % 12] += e - s;
    return findKey(pc);
  }

  /** Para guardar a mitad de sesión: lo que suena se corta en `t` sin tocar el estado. */
  snapshot(now: number, device: string, started: Date, latin = true) {
    const t = this.time(now);
    const notes = [...this.notes, ...[...this.sounding].map(([p, n]) => [n.t, t, p, n.v] as Note)].sort((x, y) => x[0] - y[0]);
    const chords = this.chord && t - this.chord.t >= 0.15 ? [...this.chords, { ...this.chord, end: t }] : this.chords;
    const k = this.key(now) ?? { tonic: 0, minor: false };
    const r = (x: number) => Math.round(x * 1000) / 1000;
    const json = {
      app: "Estudio",
      kind: "sesion-teclado",
      device,
      started: started.toISOString(),
      duration: r(t),
      key: this.key(now) ? keyName(k, latin) : null,
      format:
        "notes: [inicio s, fin s (con pedal), nota MIDI (60 = Do central), velocidad 0-1]; " +
        "chords: acordes sin IA de lo que sonaba (≥3 notas), con su grado en la tonalidad; pedal: [pisado s, soltado s]",
      notes: notes.map(([s, e, p, v]) => [r(s), r(e), p, r(v)]),
      noteNames: notes.map(([, , p]) => noteName(p % 12, k, latin) + (Math.floor(p / 12) - 1)),
      chords: chords.map((c) => ({ t: r(c.t), end: r(c.end), name: chordName(c, k, { latin, simple: false }), deg: degree(c, k) })),
      pedal: this.pedals.map(([a, b]) => [r(a), r(b)]),
    };
    // en el .mid, lo que sigue sonando se suelta al final
    const off = [...this.sounding.keys()].map((p) => [t, [0x80 | this.channel, p, 0]] as [number, number[]]);
    const pedalUp = this.pedal ? [[t, [0xb0 | this.channel, 64, 0]] as [number, number[]]] : [];
    return { json, mid: toMidi([...this.events, ...off, ...pedalUp]) };
  }
}

/** MIDI estándar (tipo 0, 480 pulsos por negra; a 120 bpm, 960 por segundo) con los mensajes en su segundo. */
export function toMidi(events: [number, number[]][], bpm = 120): Uint8Array {
  const vlq = (n: number) => {
    const out = [n & 0x7f];
    while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80);
    return out;
  };
  const us = Math.round(60e6 / bpm); // µs por negra
  const body = [0, 0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255];
  const perSec = (480 * bpm) / 60;
  let last = 0;
  for (const [t, msg] of events) {
    const tick = Math.max(last, Math.round(t * perSec));
    body.push(...vlq(tick - last), ...msg);
    last = tick;
  }
  body.push(0, 0xff, 0x2f, 0);
  const u32 = (n: number) => [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255];
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  return new Uint8Array([...ascii("MThd"), ...u32(6), 0, 0, 0, 1, 0x01, 0xe0, ...ascii("MTrk"), ...u32(body.length), ...body]);
}

/** Trozos de un texto con los tiempos («0:21», «2:38.4») aparte, en segundos, para poder saltar a ellos. */
export function stamps(text: string): { text: string; t?: number }[] {
  const out: { text: string; t?: number }[] = [];
  let last = 0;
  for (const m of text.matchAll(/(?<![\d:.,])(\d{1,2}):([0-5]\d(?:[.,]\d+)?)(?![\d:])/g)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], t: +m[1] * 60 + parseFloat(m[2].replace(",", ".")) });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const noteRow = ([s, e, p, v]: Note) => ({ inicio: r3(s), fin: r3(e), nota: p, vel: r3(v) });

/** Lo que se le pasa a la IA de una canción (en TOON): notas de los instrumentos elegidos, acordes con grado y letra. */
export function songForAI(
  song: { title: string; artist: string; duration: number; key: string | null; bpm: number | null },
  tracks: { name: string; notes: Note[] }[],
  chords: { t: number; end: number; name: string; deg?: string }[],
  doc: { offset?: number; lines: { t: number | null; text: string }[] } | null,
) {
  return {
    app: "Estudio",
    kind: "cancion",
    ...song,
    duration: r3(song.duration),
    format:
      "instruments: notas transcritas del audio de cada pista separada (pueden sobrar o faltar notas): inicio y fin en s, " +
      "nota MIDI (60 = Do central), velocidad 0-1; chords: acordes sacados del audio por un modelo y revisados con las notas, con su grado en la tonalidad; " +
      "lyrics: cada verso con su inicio en s",
    instruments: Object.fromEntries(tracks.map((t) => [t.name, t.notes.map(noteRow)])),
    chords: chords.map((c) => ({ t: r3(c.t), end: r3(c.end), name: c.name, deg: c.deg ?? "" })),
    lyrics: (doc?.lines ?? []).filter((l) => l.t != null && l.text.trim()).map((l) => ({ t: r3(l.t! + (doc!.offset ?? 0)), verso: l.text })),
  };
}

/** Una sesión guardada (el .json de snapshot) como la lee la IA (en TOON): notas con su nombre y pedal en tablas. */
export function sessionForAI(s: { notes: Note[]; noteNames?: string[]; pedal?: [number, number][]; [k: string]: unknown }) {
  const { notes, noteNames, pedal = [], format: _, ...rest } = s;
  return {
    ...rest,
    format:
      "notes: inicio y fin en s (fin con el pedal), nota MIDI (60 = Do central) y su nombre, velocidad 0-1; " +
      "chords: acordes sin IA de lo que sonaba (≥3 notas), con su grado en la tonalidad; pedal: pisado y soltado en s",
    notes: notes.map((n, i) => ({ ...noteRow(n), nombre: noteNames?.[i] ?? "" })),
    pedal: pedal.map(([pisado, soltado]) => ({ pisado, soltado })),
  };
}
