/** Cantar: lo que se canta (tono del micro, en notas MIDI con decimales) contra la voz original (vocals.notes.json).
 * Sin octavas: un hombre que canta una canción de mujer una octava por debajo está en tono. */

import type { Lyrics } from "./engine";
import type { Note } from "./harmony";

export type Grade = "ok" | "partial" | "bad";
/** Un instante cantado: tiempo de la canción y nota MIDI (69.3 = La un poco alto). */
export type Frame = { t: number; midi: number };
export type Scored = Frame & { ref: number | null; err: number; grade: Grade | null };
export type Phrase = { t: number; end: number; text: string };

export const HIT = 50; // cents
export const NEAR = 100;
export const TOL = 0.15; // s de margen con la nota de referencia (latencia, entradas algo tarde)

export const hz2midi = (hz: number) => 69 + 12 * Math.log2(hz / 440);

/** Error en cents, plegado a ±600: la octava no cuenta. */
export const fold = (cents: number) => ((((cents + 600) % 1200) + 1200) % 1200) - 600;

export const gradeOf = (err: number): Grade => (Math.abs(err) <= HIT ? "ok" : Math.abs(err) <= NEAR ? "partial" : "bad");

export function median(xs: number[]) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Notas de referencia que suenan en [t - tol, t + tol] (ordenadas por inicio; búsqueda binaria + margen). */
export function around(ref: Note[], t: number, tol = TOL) {
  let [lo, hi] = [0, ref.length];
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (ref[m][0] < t - tol - 10) lo = m + 1; // ponytail: asume notas de < 10 s (voz), si no se escapan
    else hi = m;
  }
  const out: Note[] = [];
  for (let i = lo; i < ref.length && ref[i][0] <= t + tol; i++) if (ref[i][1] >= t - tol) out.push(ref[i]);
  return out;
}

/** Puntúa un instante: contra la nota de al lado que mejor encaja (con `shift` semitonos ya restados).
 * Sin referencia cerca (la voz original calla) no puntúa. */
export function scoreFrame(ref: Note[], f: Frame, shift = 0, tol = TOL): Scored {
  let best: Note | null = null, err = Infinity;
  for (const n of around(ref, f.t, tol)) {
    const e = fold((f.midi - n[2] - shift) * 100);
    if (Math.abs(e) < Math.abs(err)) [best, err] = [n, e];
  }
  return best ? { ...f, ref: best[2], err, grade: gradeOf(err) } : { ...f, ref: null, err: NaN, grade: null };
}

/** Diferencia cantado − original en semitonos, plegada a [-6, 6), contra la nota que suena justo en `t`. */
export function offsetAt(ref: Note[], f: Frame) {
  const n = around(ref, f.t, 0)[0];
  return n ? fold((f.midi - n[2]) * 100) / 100 : null;
}

/** Transposición: el número entero de semitonos que mejor explica las diferencias (mediana circular: la que deja menos
 * error total, así ±6 no se parte en dos). null si hay pocos datos. */
export function transposition(offsets: number[], min = 20) {
  if (offsets.length < min) return null;
  let best = 0, cost = Infinity;
  for (let s = -5; s <= 6; s++) {
    const c = offsets.reduce((a, d) => a + Math.abs(fold((d - s) * 100)), 0);
    if (c < cost) [best, cost] = [s, c];
  }
  return best;
}

export const shiftLabel = (s: number | null) =>
  s == null ? "—" : s === 0 ? "en tono" : `${s > 0 ? "+" : "−"}${Math.abs(s)} st · ${Math.abs(s)} ${Math.abs(s) === 1 ? "semitono" : "semitonos"} por ${s > 0 ? "encima" : "debajo"}`;

/** Frases: las líneas de la letra (en tiempo del audio, como letras_words de hub.py) o, sin letra sincronizada,
 * los tramos de la voz separados por silencios de más de `gap` s. */
export function phrases(ref: Note[], doc: Lyrics | null, gap = 1): Phrase[] {
  if (doc && !doc.instrumental) {
    const off = doc.offset ?? 0, woff = off + (doc.word_offset ?? 0);
    const ls = doc.lines.flatMap((l) => {
      const w = l.words ?? [];
      const t = w.length ? w[0].t + woff : l.t != null ? l.t + off : null;
      if (t == null || !l.text.trim()) return [];
      const last = w[w.length - 1];
      return [{ t, end: last ? (last.end ?? last.t + 0.3) + woff : l.end != null ? l.end + off : NaN, text: l.text }];
    });
    ls.forEach((l, i) => Number.isNaN(l.end) && (l.end = ls[i + 1]?.t ?? l.t + 4));
    if (ls.length) return ls;
  }
  const out: Phrase[] = [];
  for (const n of ref) {
    const p = out[out.length - 1];
    if (p && n[0] - p.end <= gap) p.end = Math.max(p.end, n[1]);
    else out.push({ t: n[0], end: n[1], text: "" });
  }
  return out;
}

const POINTS: Record<Grade, number> = { ok: 1, partial: 0.5, bad: 0 };
/** 0-100: acierto 1, cerca ½, fallo 0; sobre los instantes que puntúan. null si no hay ninguno. */
export function score(frames: Scored[]) {
  const s = frames.filter((f) => f.grade);
  return s.length ? Math.round((100 * s.reduce((a, f) => a + POINTS[f.grade!], 0)) / s.length) : null;
}

export const phraseScores = (ps: Phrase[], frames: Scored[]) =>
  ps.map((p) => score(frames.filter((f) => f.t >= p.t - TOL && f.t <= p.end + TOL)));
