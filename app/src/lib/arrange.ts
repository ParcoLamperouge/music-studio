/** Modo Aprender: un arreglo para piano de una canción separada, del nivel 1 (principiante) al 5 (lo que suena).
 * Mano derecha: la melodía de una pista (la voz, o la que se elija) limpiada y cuadrada a los pulsos; sin melodía, los
 * acordes. Mano izquierda: generada a partir de los acordes (lo más fiable que hay), no copiada de pistas transcritas.
 * Todo se calcula en pulsos de la canción (los de Beat This!), así que la partitura y el piano roll cuadran. */

import { noteName, tonesOf, usesFlats, type Chord, type Key, type Note } from "./harmony.ts";

export type Level = 1 | 2 | 3 | 4 | 5;
export const LEVELS: [Level, string][] = [[1, "Principiante"], [2, "Fácil"], [3, "Intermedio"], [4, "Avanzado"], [5, "Transcripción"]];
/** Nota del arreglo: inicio y duración en pulsos, nota MIDI, velocidad 0-1. */
export type ANote = { b: number; d: number; p: number; v: number };
export type Hand = "rh" | "lh";
export type Arrangement = { rh: ANote[]; lh: ANote[]; key: Key; transpose: number; meter: number; start: number };

// ---------------------------------------------------------------- tiempo ↔ pulsos

/** Segundo → pulso (fraccionario) con los pulsos detectados; fuera de ellos sigue al ritmo del primero o del último. */
export function toBeat(beats: number[], t: number) {
  const n = beats.length;
  if (n < 2) return t * 2; // 120 bpm
  if (t <= beats[0]) return (t - beats[0]) / (beats[1] - beats[0]);
  if (t >= beats[n - 1]) return n - 1 + (t - beats[n - 1]) / (beats[n - 1] - beats[n - 2]);
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (beats[m] <= t) lo = m;
    else hi = m;
  }
  return lo + (t - beats[lo]) / (beats[hi] - beats[lo]);
}

/** Pulso → segundo, la inversa de toBeat. */
export function fromBeat(beats: number[], b: number) {
  const n = beats.length;
  if (n < 2) return b / 2;
  if (b <= 0) return beats[0] + b * (beats[1] - beats[0]);
  if (b >= n - 1) return beats[n - 1] + (b - n + 1) * (beats[n - 1] - beats[n - 2]);
  const i = Math.floor(b);
  return beats[i] + (b - i) * (beats[i + 1] - beats[i]);
}

// ---------------------------------------------------------------- transporte a una tonalidad fácil

const EASY_MAJOR = [0, 7, 5]; // Do, Sol, Fa
const EASY_MINOR = [9, 4, 2]; // La, Mi, Re menor

/** Semitonos (−5…+6) que llevan la tonalidad a la fácil más cercana (Do, Sol, Fa mayor; La, Mi, Re menor). */
export function easyTranspose(k: Key) {
  let best = 0, bestAbs = 99;
  for (const target of k.minor ? EASY_MINOR : EASY_MAJOR) {
    const t = ((target - k.tonic + 18) % 12) - 6; // −6…+5
    const s = t === -6 ? 6 : t;
    if (Math.abs(s) < bestAbs) [best, bestAbs] = [s, Math.abs(s)];
  }
  return best;
}

// ---------------------------------------------------------------- melodía

/** Cuadrícula de cada nivel (en pulsos): la melodía cuadra a negras, corcheas o semicorcheas. */
const GRID: Record<Level, number> = { 1: 1, 2: 0.5, 3: 0.25, 4: 0.25, 5: 0 };

/** Melodía limpia en pulsos: una sola voz (en cada casilla de la cuadrícula, la nota que más suena), sin notas sueltas
 * muy cortas, y las casillas seguidas de la misma nota cantada unidas en una. Con `grid` 0, tal cual (`lowest`: si se
 * pisan, la grave; para un bajo). */
export function melodyLine(notes: Note[], beats: number[], grid: number, lowest = false): ANote[] {
  const src = notes
    .filter(([s, e]) => e - s >= 0.08)
    .map(([s, e, p, v], i) => ({ b: toBeat(beats, s), e: toBeat(beats, e), p, v, i }))
    .sort((a, b) => a.b - b.b);
  if (!src.length) return [];
  if (!grid) return monophonic(src, lowest).map((n) => ({ b: n.b, d: n.e - n.b, p: n.p, v: n.v }));
  const out: (ANote & { src: number })[] = [];
  const from = Math.floor(src[0].b / grid) * grid;
  const to = Math.max(...src.map((n) => n.e));
  let j = 0;
  for (let c = from; c < to; c += grid) {
    const ce = c + grid;
    while (j < src.length && src[j].e <= c) j++;
    let best: (typeof src)[number] | null = null, bestO = 0;
    for (let k = j; k < src.length && src[k].b < ce; k++) {
      const o = Math.min(ce, src[k].e) - Math.max(c, src[k].b);
      if (o <= 0) continue;
      // la nota que más suena en la casilla, con ventaja para la que ataca al principio (es la que se oye en el pulso);
      // a igualdad, la más aguda (la melodía suele ir arriba)
      const w = o + (src[k].b >= c - 0.05 * grid && src[k].b < c + 0.25 * grid ? 0.25 * grid : 0);
      if (w > bestO + 1e-9 || (best && Math.abs(w - bestO) < 1e-9 && src[k].p > best.p)) [best, bestO] = [src[k], w];
    }
    if (!best || bestO < 0.35 * grid) continue; // casi silencio: silencio
    const last = out[out.length - 1];
    if (last && last.src === best.i && Math.abs(last.b + last.d - c) < 1e-6) last.d += grid;
    else out.push({ b: c, d: grid, p: best.p, v: best.v, src: best.i });
  }
  // al cantar, las notas salen picadas: los huecos pequeños se rellenan alargando la nota (legato), que si no la
  // partitura se llena de silencios de semicorchea
  const fill = grid >= 1 ? 1 : 0.5;
  for (let i = 0; i + 1 < out.length; i++) {
    const gap = out[i + 1].b - (out[i].b + out[i].d);
    if (gap > 1e-6 && gap <= fill + 1e-6) out[i].d += gap;
  }
  return out.map(({ src: _, ...n }) => n);
}

/** Una sola voz: si dos notas se pisan, la aguda manda (la grave, en un bajo) y la otra se corta. */
function monophonic(src: { b: number; e: number; p: number; v: number }[], lowest = false) {
  const out: { b: number; e: number; p: number; v: number }[] = [];
  for (const n of src) {
    const last = out[out.length - 1];
    if (last && n.b < last.e) {
      if (lowest ? n.p > last.p : n.p < last.p) continue;
      last.e = n.b;
      if (last.e - last.b < 0.05) out.pop();
    }
    out.push({ ...n });
  }
  return out;
}

/** Sube o baja toda la línea por octavas para centrarla, y lo que se salga del rango, a su octava más cercana dentro. */
function fold(notes: ANote[], lo: number, hi: number) {
  if (!notes.length) return notes;
  const sorted = notes.map((n) => n.p).sort((a, b) => a - b);
  const mid = sorted[sorted.length >> 1];
  const shift = Math.round(((lo + hi) / 2 - mid) / 12) * 12;
  return notes.map((n) => {
    let p = n.p + shift;
    while (p < lo) p += 12;
    while (p > hi) p -= 12;
    return { ...n, p };
  });
}

// ---------------------------------------------------------------- acompañamiento

type Seg = { b: number; e: number; c: Chord };

/** Los acordes en pulsos, cuadrados a `snap`, y partidos en cada compás (se vuelven a tocar en el 1). */
function segments(chords: Chord[], beats: number[], meter: number, start: number, snap: number): Seg[] {
  const q = (x: number) => Math.round(x / snap) * snap;
  const out: Seg[] = [];
  let last = -Infinity;
  for (const c of chords) {
    // al cuadrar, dos acordes muy juntos se pisarían: cada uno empieza donde acaba el anterior
    let b = Math.max(q(toBeat(beats, c.t)), last);
    const e = q(toBeat(beats, c.end));
    last = Math.max(last, e);
    while (b < e - 1e-6) {
      const bar = start + Math.floor((b - start) / meter + 1e-6) * meter + meter;
      const end = Math.min(e, bar);
      out.push({ b, e: end, c });
      b = end;
    }
  }
  return out;
}

const pcOf = (c: Chord, i: number) => (c.root + tonesOf(c.kind)[i]) % 12;
/** La nota de la clase `pc` dentro de [lo, lo+11]. */
const inRange = (pc: number, lo: number) => lo + ((pc - lo) % 12 + 12) % 12;

/** Tríada (fundamental, tercera, quinta) en posición cerrada con la nota más grave en [lo, lo+11], la inversión que
 * menos mueve los dedos desde el acorde anterior. */
function voicing(c: Chord, lo: number, prev: number[] | null) {
  const pcs = [0, 1, 2].map((i) => pcOf(c, i));
  let best: number[] = [], bestCost = Infinity;
  for (let inv = 0; inv < 3; inv++) {
    const order = [...pcs.slice(inv), ...pcs.slice(0, inv)];
    const notes = [inRange(order[0], lo)];
    for (const pc of order.slice(1)) {
      const prevNote = notes[notes.length - 1];
      notes.push(prevNote + ((((pc - prevNote) % 12) + 12) % 12 || 12)); // la siguiente nota del acorde, por encima
    }
    const cost = prev ? notes.reduce((s, p, i) => s + Math.abs(p - prev[i]), 0) : Math.abs(notes[0] - (lo + 4));
    if (cost < bestCost) [best, bestCost] = [notes, cost];
  }
  return best;
}

/** Mano izquierda (o el acompañamiento completo si no hay melodía) a partir de los acordes, según el nivel. */
function accompaniment(segs: Seg[], level: Level, hand: Hand): ANote[] {
  const out: ANote[] = [];
  let prev: number[] | null = null;
  const v = 0.6;
  for (const { b, e, c } of segs) {
    const d = e - b;
    const root = inRange(c.bass ?? c.root, 41); // Fa2…Mi3
    if (hand === "rh") {
      // sin melodía, la derecha lleva los acordes: en bloque hasta el nivel 2, en cada pulso desde el 3
      const vo: number[] = (prev = voicing(c, 60, prev));
      const step = level <= 2 ? d : 1;
      for (let x = b; x < e - 1e-6; x += step) for (const p of vo) out.push({ b: x, d: Math.min(step, e - x) * (level <= 2 ? 1 : 0.9), p, v });
      continue;
    }
    if (level === 1) out.push({ b, d, p: root, v });
    else if (level === 2) out.push({ b, d, p: root, v }, { b, d, p: root + 7, v });
    else if (level === 3) for (const p of (prev = voicing(c, 45, prev))) out.push({ b, d, p, v }); // La2…Mi4
    else {
      // bajo en el primer pulso del tramo y el acorde en los demás (el «bajo + acorde» del pop; en 3/4, un vals)
      out.push({ b, d: Math.min(1, d), p: root - 12 >= 36 ? root - 12 : root, v: v + 0.1 });
      const vo: number[] = (prev = voicing(c, 48, prev)); // Do3…Fa#4, por debajo de la melodía
      for (let x = b + 1; x < e - 1e-6; x += 1) for (const p of vo) out.push({ b: x, d: Math.min(1, e - x) * 0.9, p, v: v - 0.1 });
      if (d <= 1) for (const p of vo) out.push({ b, d, p, v: v - 0.1 }); // tramo de un pulso: bajo y acorde juntos
    }
  }
  return out;
}

/** Nivel 4: en los tiempos fuertes, una nota del acorde por debajo de la melodía (a 3-9 semitonos) en la derecha. */
function harmonize(mel: ANote[], segs: Seg[], meter: number, start: number): ANote[] {
  const extra: ANote[] = [];
  for (const n of mel) {
    if (Math.abs(((n.b - start) % meter + meter) % meter) > 1e-6) continue;
    const seg = segs.find((s) => s.b <= n.b + 1e-6 && n.b < s.e);
    if (!seg) continue;
    const tones = new Set(tonesOf(seg.c.kind).slice(0, 3).map((i) => (seg.c.root + i) % 12));
    for (let gap = 3; gap <= 9; gap++) {
      if (tones.has((n.p - gap + 120) % 12)) {
        extra.push({ ...n, p: n.p - gap, v: n.v * 0.8 });
        break;
      }
    }
  }
  return [...mel, ...extra];
}

// ---------------------------------------------------------------- el arreglo

export function arrange(o: {
  melody: Note[] | null; // la pista de la mano derecha; null: solo acompañamiento
  piano?: Note[]; // la pista de piano, para el nivel 5
  bass?: Note[]; // la de bajo: en el nivel 5, si no hay piano de verdad, su línea real en la izquierda
  chords: Chord[];
  beats: number[];
  downbeats?: number[];
  meter?: number;
  key: Key;
  level: Level;
  transpose?: number;
}): Arrangement {
  const { beats, level } = o;
  const meter = o.meter && o.meter >= 2 && o.meter <= 7 ? o.meter : 4;
  // el compás empieza en el primer «1» detectado; lo de antes, anacrusa
  const first = o.downbeats?.length ? Math.round(toBeat(beats, o.downbeats[0])) : 0;
  const start = first - Math.ceil(first / meter) * meter;
  const segs = segments(o.chords, beats, meter, start, level <= 2 ? 1 : 0.5);
  let rh: ANote[];
  let lh: ANote[];
  if (o.melody) {
    rh = fold(melodyLine(o.melody, beats, GRID[level]), 60, level <= 2 ? 79 : 84);
    if (level === 4) rh = harmonize(rh, segs, meter, start);
    lh = level === 5 ? transcribedLeft(o.piano ?? [], o.bass ?? [], segs, beats) : accompaniment(segs, level, "lh");
  } else {
    // solo acompañamiento: la derecha, los acordes; la izquierda, el bajo, cada vez más cerca del de la canción
    rh = accompaniment(segs, level, "rh");
    lh = level <= 2 ? accompaniment(segs, 1, "lh") : level === 3 ? accompaniment(segs, 2, "lh") : level === 4 ? bassOnBeats(segs) : (realBass(o.bass ?? [], beats) ?? bassOnBeats(segs));
  }
  const t = o.transpose ?? 0;
  const shift = (ns: ANote[]) => ns.map((n) => ({ ...n, p: n.p + t }));
  return { rh: shift(rh), lh: shift(lh), key: { tonic: (o.key.tonic + t + 12) % 12, minor: o.key.minor }, transpose: t, meter, start };
}

/** Nivel 5, izquierda: lo que toca el piano por debajo del Do central si la canción tiene piano de verdad (suena en al
 * menos el 40 % de la canción: muchas pistas «piano» son restos que el separador dejó ahí); si no, la línea real del bajo
 * (una voz, en registro de izquierda) con los acordes en los pulsos; sin bajo, el acompañamiento del nivel 4. */
function transcribedLeft(piano: Note[], bass: Note[], segs: Seg[], beats: number[]): ANote[] {
  const low = piano.filter(([s, e, p]) => p < 60 && e - s >= 0.06).map(([s, e, p, v]) => ({ b: toBeat(beats, s), d: toBeat(beats, e) - toBeat(beats, s), p, v }));
  const span = segs.reduce((n, x) => n + x.e - x.b, 0);
  if (span && covered(low) / span >= 0.4) return low;
  const line = realBass(bass, beats);
  if (!line) return accompaniment(segs, 4, "lh");
  // los acordes del nivel 4 sin su bajo (lo pone la línea real)
  return [...line, ...accompaniment(segs, 4, "lh").filter((n) => !segs.some((x) => Math.abs(x.b - n.b) < 1e-6 && n.p < 48))];
}

/** La línea real del bajo (una voz, la nota grave si se pisan) en registro de mano izquierda; null si no hay. */
function realBass(bass: Note[], beats: number[]): ANote[] | null {
  const line = melodyLine(bass, beats, 0, true).map((n) => {
    let p = n.p;
    while (p < 28) p += 12;
    while (p > 52) p -= 12;
    return { ...n, p };
  });
  return line.length ? line : null;
}

/** La fundamental (o el bajo del acorde) en cada pulso. */
function bassOnBeats(segs: Seg[]): ANote[] {
  const out: ANote[] = [];
  for (const { b, e, c } of segs) for (let x = b; x < e - 1e-6; x += 1) out.push({ b: x, d: Math.min(1, e - x) * 0.9, p: inRange(c.bass ?? c.root, 36), v: 0.65 });
  return out;
}

/** Pulsos en los que suena algo de `notes` (los solapes cuentan una vez). */
function covered(notes: ANote[]) {
  let total = 0, end = -Infinity;
  for (const n of [...notes].sort((a, b) => a.b - b.b)) {
    const s = Math.max(n.b, end), e = n.b + n.d;
    if (e > s) total += e - s;
    end = Math.max(end, e);
  }
  return total;
}

/** Notas en segundos (para el piano roll y la guía sintetizada). */
export const toSeconds = (notes: ANote[], beats: number[]): Note[] => notes.map((n) => [fromBeat(beats, n.b), fromBeat(beats, n.b + n.d), n.p, n.v]);

// ---------------------------------------------------------------- partitura (MusicXML)

const DIV = 4; // divisiones por negra: semicorcheas
const TYPES: [number, string, boolean][] = [
  [16, "whole", false], [12, "half", true], [8, "half", false], [6, "quarter", true], [4, "quarter", false], [3, "eighth", true], [2, "eighth", false], [1, "16th", false],
];
/** Una duración (en divisiones) en figuras escribibles, de mayor a menor. */
function figures(div: number) {
  const out: [number, string, boolean][] = [];
  for (const f of TYPES) while (div >= f[0]) (out.push(f), (div -= f[0]));
  return out;
}

/** Armadura (quintas: + sostenidos, − bemoles) de una tonalidad. */
export function fifths(k: Key) {
  const major = k.minor ? (k.tonic + 3) % 12 : k.tonic;
  const f = (major * 7) % 12; // Do 0, Sol 1, Re 2…
  return usesFlats({ tonic: major, minor: false }) ? f - 12 : f;
}

function pitchXml(p: number, k: Key) {
  const name = noteName(p % 12, k, false);
  const step = name[0];
  const acc = name.slice(1);
  const alter = acc === "#" ? 1 : acc === "b" ? -1 : acc === "x" ? 2 : acc === "bb" ? -2 : 0;
  let octave = Math.floor(p / 12) - 1;
  if (step === "C" && alter < 0) octave++; // Dob4 suena como Si3: se escribe en la octava de arriba
  if (step === "B" && alter > 0) octave--; // y Si#3 suena como Do4
  return `<pitch><step>${step}</step>${alter ? `<alter>${alter}</alter>` : ""}<octave>${octave}</octave></pitch>`;
}

/** MusicXML de piano (pentagrama de sol para la derecha, de fa para la izquierda) cuadrado a semicorcheas; las notas
 * que cruzan la barra se parten con ligadura. Cada mano en una voz: lo que suena a la vez va como acorde. */
export function toMusicXML(a: Arrangement, title: string) {
  const q = (x: number) => Math.round(x * DIV);
  const end = Math.max(a.start, ...[...a.rh, ...a.lh].map((n) => n.b + n.d));
  const bars = Math.max(1, Math.ceil((end - a.start) / a.meter));
  const barDiv = a.meter * DIV;
  const staffXml = (notes: ANote[], staff: 1 | 2, m: number) => {
    const m0 = q(a.start + m * a.meter);
    // notas de este compás en divisiones relativas, partidas en la barra
    const evs = new Map<number, { end: number; ps: Set<number>; tieIn: Set<number>; tieOut: Set<number> }>();
    for (const n of notes) {
      const s = q(n.b) - m0, e = Math.max(q(n.b + n.d), q(n.b) + 1) - m0;
      if (e <= 0 || s >= barDiv) continue;
      const cs = Math.max(0, s), ce = Math.min(barDiv, e);
      const ev = evs.get(cs) ?? { end: ce, ps: new Set(), tieIn: new Set(), tieOut: new Set() };
      ev.end = Math.max(ev.end, ce);
      ev.ps.add(n.p);
      if (s < 0) ev.tieIn.add(n.p);
      if (e > barDiv) ev.tieOut.add(n.p);
      evs.set(cs, ev);
    }
    const starts = [...evs.keys()].sort((x, y) => x - y);
    let xml = "";
    let pos = 0;
    const voice = staff === 1 ? 1 : 5;
    const rest = (len: number) => {
      for (const [dur, type, dot] of figures(len)) xml += `<note><rest/><duration>${dur}</duration><voice>${voice}</voice><type>${type}</type>${dot ? "<dot/>" : ""}<staff>${staff}</staff></note>`;
    };
    for (const [i, s] of starts.entries()) {
      if (s > pos) rest(s - pos);
      const ev = evs.get(s)!;
      const len = Math.max(1, Math.min(ev.end, starts[i + 1] ?? barDiv) - s);
      const figs = figures(len);
      const ps = [...ev.ps].sort((x, y) => x - y);
      const toBar = s + len === barDiv; // llega a la barra: si la nota sigue, ligadura al compás siguiente
      figs.forEach(([dur, type, dot], fi) => {
        ps.forEach((p, pi) => {
          const fromPrev = fi > 0 || ev.tieIn.has(p);
          const toNext = fi < figs.length - 1 || (toBar && ev.tieOut.has(p));
          const ties = (fromPrev ? `<tie type="stop"/>` : "") + (toNext ? `<tie type="start"/>` : "");
          const notations = fromPrev || toNext ? `<notations>${fromPrev ? `<tied type="stop"/>` : ""}${toNext ? `<tied type="start"/>` : ""}</notations>` : "";
          xml += `<note>${pi ? "<chord/>" : ""}${pitchXml(p, a.key)}<duration>${dur}</duration>${ties}<voice>${voice}</voice><type>${type}</type>${dot ? "<dot/>" : ""}<staff>${staff}</staff>${notations}</note>`;
        });
      });
      pos = s + len;
    }
    if (pos < barDiv) rest(barDiv - pos);
    return xml;
  };
  let measures = "";
  for (let m = 0; m < bars; m++) {
    const attrs = m === 0
      ? `<attributes><divisions>${DIV}</divisions><key><fifths>${fifths(a.key)}</fifths><mode>${a.key.minor ? "minor" : "major"}</mode></key><time><beats>${a.meter}</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes>`
      : "";
    measures += `<measure number="${m + 1}">${attrs}${staffXml(a.rh, 1, m)}<backup><duration>${barDiv}</duration></backup>${staffXml(a.lh, 2, m)}</measure>`;
  }
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd"><score-partwise version="4.0"><work><work-title>${esc(title)}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">${measures}</part></score-partwise>`;
}

// ---------------------------------------------------------------- práctica

/** Una nota que tocar; `v` la fuerza que pide (0-1) y `vel` la que se tocó (con teclado MIDI). */
export type Target = { t: number; p: number; v?: number; hand: Hand; hit: boolean; skipped?: boolean; err?: number; vel?: number; counted?: boolean }; // counted: ya apuntada en las zonas (zones.ts)
/** Diferencia de fuerza a partir de la que se avisa (en 0-1; unas 30 de 127). */
export const VEL_TOL = 0.25;

/** Lo que hay que tocar y lo que se va tocando. `tol`: segundos de margen antes y después de cada nota. */
export class Practice {
  targets: Target[];
  wrong = 0;
  tol: number;
  constructor(notes: { t: number; p: number; v?: number; hand: Hand }[], tol = 0.2) {
    this.tol = tol;
    this.targets = notes.map((n) => ({ ...n, hit: false })).sort((a, b) => a.t - b.t);
  }
  /** Una tecla pulsada en `now` (con fuerza `vel`, si se sabe): acierta la nota pendiente más cercana de esa altura
   * dentro del margen. En modo espera, además, las del grupo en el que se ha parado aunque haya pasado el margen.
   * Devuelve la nota acertada (para ver su fuerza) o null. */
  press(p: number, now: number, waitingAt: number | null = null, vel?: number): Target | null {
    let best: Target | null = null;
    for (const x of this.targets) {
      if (x.hit || x.skipped || x.p !== p) continue;
      const ok = Math.abs(x.t - now) <= this.tol || (waitingAt != null && Math.abs(x.t - waitingAt) < 0.03);
      if (ok && (!best || Math.abs(x.t - now) < Math.abs(best.t - now))) best = x;
      if (x.t > now + this.tol) break;
    }
    if (!best) {
      this.wrong++;
      return null;
    }
    best.hit = true;
    best.err = now - best.t;
    best.vel = vel;
    return best;
  }
  /** Modo espera: el instante del primer grupo de notas sin tocar que ya debería haber sonado (para pararse ahí). */
  blocking(now: number) {
    // lo que quedó atrás sin tocar (se tocó sin espera, o el reloj saltó) no hace volver: se da por saltado
    for (const x of this.targets) if (!x.hit && !x.skipped && x.t < now - 1) x.skipped = true;
    const x = this.targets.find((x) => !x.hit && !x.skipped);
    return x && x.t <= now ? x.t : null;
  }
  /** Se sigue desde `from` (un salto, el bucle, activar la espera): lo de después vuelve a estar pendiente y lo de antes
   * sin tocar se da por saltado (si no, la espera volvería atrás a buscarlo). */
  reset(from = 0) {
    for (const x of this.targets) {
      if (x.t >= from - 0.01) [x.hit, x.skipped, x.err, x.vel, x.counted] = [false, false, undefined, undefined, false];
      else if (!x.hit) x.skipped = true;
    }
  }
  stats(now: number) {
    const due = this.targets.filter((x) => !x.skipped && (x.t <= now - this.tol || x.hit));
    const hits = due.filter((x) => x.hit);
    const errs = hits.map((x) => x.err ?? 0);
    // fuerza: lo que se tocó menos lo que pedía, de media (+ más fuerte), y cuántas se pasaron del margen
    const dyn = hits.filter((x) => x.vel != null && x.v != null).map((x) => x.vel! - x.v!);
    return {
      due: due.length,
      hits: hits.length,
      wrong: this.wrong,
      ms: errs.length ? Math.round((1000 * errs.reduce((a, b) => a + b, 0)) / errs.length) : 0,
      force: dyn.length ? Math.round((127 * dyn.reduce((a, b) => a + b, 0)) / dyn.length) : null,
      offForce: dyn.filter((d) => Math.abs(d) > VEL_TOL).length,
    };
  }
}
