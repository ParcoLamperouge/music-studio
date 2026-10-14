/** Entrenador de oído: qué preguntar (sintético o con trozos de las canciones de la biblioteca), con qué sonido, y qué
 * toca repasar (cajas de Leitner por pregunta; nivel por tipo). Lógica pura: el sonido se describe aquí y suena en
 * EarView. */

import { degree, tonesOf, type Chord, type Key, type Note } from "./harmony.ts";

/** Trozo de canción: la mezcla, la voz o el instrumento armónico («acorde»: piano, guitarra… o la mezcla, según elija
 * quien escucha). */
export type Clip = { src: "mix" | "voz" | "acorde"; t: number; dur: number };
/** Notas sintetizadas (segundos desde 0) y, a `at` segundos, un trozo de canción. */
export type Sound = { notes: Note[]; clip?: Clip; at?: number };
export type Question = {
  kind: Kind;
  item: string; // lo que se repasa (la respuesta, o el nivel en el dictado)
  prompt: string;
  options: string[];
  answer: string;
  sound: Sound;
  extra?: string; // se enseña al contestar
  seq?: number[]; // dictado: las notas (MIDI) que hay que tocar
  tonic?: number; // dictado: la tónica (MIDI), donde empieza el teclado
  from?: { song: string; title: string; artist: string; t: number; key: Key; chord?: Chord; context: Clip };
};

export const KINDS = {
  intervalo: { title: "Intervalos", song: false },
  acorde: { title: "Tipos de acorde", song: false },
  grado: { title: "Grados tras una cadencia", song: false },
  progresion: { title: "Progresiones", song: false },
  dictado: { title: "Dictado melódico", song: false },
  "cancion-calidad": { title: "¿Mayor o menor? · canciones", song: true },
  "cancion-grado": { title: "Grado del acorde · canciones", song: true },
  "cancion-nota": { title: "Nota de la voz · canciones", song: true },
  "cancion-intervalo": { title: "Intervalo de la voz · canciones", song: true },
} as const;
export type Kind = keyof typeof KINDS;

export const INTERVALS = ["Unísono", "2.ª m", "2.ª M", "3.ª m", "3.ª M", "4.ª", "Tritono", "5.ª", "6.ª m", "6.ª M", "7.ª m", "7.ª M", "8.ª"];
export const CHORDS: [string, number[]][] = [
  ["Mayor", [0, 4, 7]], ["Menor", [0, 3, 7]], ["Disminuido", [0, 3, 6]], ["Aumentado", [0, 4, 8]], ["sus2", [0, 2, 7]], ["sus4", [0, 5, 7]],
  ["maj7", [0, 4, 7, 11]], ["7", [0, 4, 7, 10]], ["m7", [0, 3, 7, 10]], ["m7(b5)", [0, 3, 6, 10]], ["dim7", [0, 3, 6, 9]],
];
const PROGS = ["I–IV–V–I", "I–V–vi–IV", "ii–V–I", "I–vi–IV–V", "vi–IV–I–V", "I–IV–vi–V", "I–iii–IV–V"];
const ROMAN: Record<string, [number, number[]]> = { I: [0, [0, 4, 7]], ii: [2, [0, 3, 7]], iii: [4, [0, 3, 7]], IV: [5, [0, 4, 7]], V: [7, [0, 4, 7]], vi: [9, [0, 3, 7]] };
const DICTADO = ["3 notas por grados", "3 notas con saltos", "4 notas por grados", "4 notas con saltos"];
const MAJOR = [0, 2, 4, 5, 7, 9, 11], MINOR = [0, 2, 3, 5, 7, 8, 10];
const DEG = ["1", "2", "3", "4", "5", "6", "7"];
const ivs = (...ns: number[]) => ns.map((n) => INTERVALS[n]);
const ALL = Array.from({ length: 12 }, (_, i) => i + 1);

/** Opciones de cada tipo por nivel (1, 2…): se empieza con pocas y muy distintas. */
const POOLS: Record<Kind, (minor: boolean) => string[][]> = {
  intervalo: () => [ivs(4, 7, 12), ivs(2, 3, 4, 5, 7, 12), ivs(1, 2, 3, 4, 5, 7, 8, 9, 10, 12), ivs(...ALL)],
  acorde: () => [2, 4, 6, 9, 11].map((n) => CHORDS.slice(0, n).map((c) => c[0])),
  grado: () => [["1", "3", "5"], ["1", "2", "3", "4", "5"], DEG, DEG], // el 4, también en menor
  progresion: () => [2, 4, 7].map((n) => PROGS.slice(0, n)),
  dictado: () => DICTADO.map((d) => [d]),
  "cancion-calidad": () => [["Mayor", "Menor"]],
  "cancion-grado": (minor) =>
    minor
      ? [["i", "iv", "V", "VI", "VII"], ["i", "ii°", "III", "iv", "v", "V", "VI", "VII"], ["i", "ii°", "III", "iv", "v", "V", "VI", "VII", "I", "IV", "bII", "vii°"]]
      : [["I", "IV", "V", "vi"], ["I", "ii", "iii", "IV", "V", "vi", "vii°"], ["I", "ii", "iii", "IV", "V", "vi", "vii°", "bIII", "bVI", "bVII", "II", "III"]],
  "cancion-nota": () => [["1", "3", "5"], DEG],
  "cancion-intervalo": () => [ivs(1, 2, 3, 4, 5), ivs(...ALL)],
};
export const maxLevel = (kind: Kind) => POOLS[kind](false).length;
export const pool = (kind: Kind, level: number, minor = false) => {
  const ls = POOLS[kind](minor);
  return ls[Math.max(1, Math.min(level, ls.length)) - 1];
};

const pick = <T>(xs: readonly T[], rand: () => number) => xs[Math.floor(rand() * xs.length)];
const n = (s: number, e: number, p: number, v = 0.7): Note => [s, e, p, v];
const chordAt = (ps: number[], s: number, e: number) => ps.map((p) => n(s, e, p, 0.6));
/** La tónica cerca del Do central (Fa#3…Fa4). */
export const home = (tonic: number) => 54 + ((((tonic - 54) % 12) + 12) % 12);

/** I–IV–V–I (i–iv–V–i en menor) sobre la tónica `t` (MIDI), para fijar la tonalidad antes de preguntar. */
export function cadence(t: number, minor: boolean) {
  const third = minor ? 3 : 4;
  const chords = [[t - 12, t, t + third, t + 7], [t - 7, t, t + 5, t + (minor ? 8 : 9)], [t - 5, t - 1, t + 2, t + 7], [t - 12, t, t + third, t + 7]];
  return { notes: chords.flatMap((c, i) => chordAt(c, i * 0.75, i * 0.75 + (i === 3 ? 1.2 : 0.7))), end: 3 * 0.75 + 1.2 };
}

/** Tríadas en posición cerrada sobre la tónica (cada nota en [t, t+12), así se enlazan solas) con la fundamental abajo. */
function progression(label: string, t: number) {
  return label.split("–").flatMap((r, i) => {
    const [iv, tones] = ROMAN[r];
    const ps = tones.map((x) => t + ((iv + x) % 12)).sort((a, b) => a - b);
    return chordAt([t - 12 + iv, ...ps], i * 0.9, i * 0.9 + 0.85);
  });
}

/** Una melodía de `len` notas como grados (0 = tónica, 7 = su octava): por grados conjuntos o con saltos de hasta una 5.ª. */
export function melody(level: number, rand = Math.random) {
  const len = level <= 2 ? 3 : 4, leaps = level % 2 === 0, top = level === 1 ? 4 : 7;
  const seq = [Math.floor(rand() * (top + 1))];
  for (let guard = 0; seq.length < len && guard < 200; guard++) {
    const step = leaps ? pick([-4, -3, -2, -1, 1, 2, 3, 4], rand) : pick([-1, 1], rand);
    const d = seq[seq.length - 1] + step;
    if (d >= 0 && d <= top) seq.push(d);
  }
  return seq;
}
const scaleMidi = (t: number, d: number, minor = false) => t + 12 * Math.floor(d / 7) + (minor ? MINOR : MAJOR)[d % 7];

/** Pregunta sintética de `kind` cuya respuesta es `item`, en una tonalidad o nota al azar. */
export function synthQuestion(kind: Kind, item: string, level: number, rand = Math.random): Question {
  const root = 55 + Math.floor(rand() * 12);
  const base = { kind, item, answer: item, options: pool(kind, level) };
  if (kind === "intervalo") {
    const k = INTERVALS.indexOf(item);
    const mode = pick(level <= 2 ? ["sube"] : level === 3 ? ["sube", "baja"] : ["sube", "baja", "junto"], rand);
    const [a, b] = mode === "baja" ? [root + k, root] : [root, root + k];
    const notes = mode === "junto" ? [n(0, 1.6, a), n(0, 1.6, b)] : [n(0, 0.6, a), n(0.6, 1.5, b)];
    return { ...base, prompt: `¿Qué intervalo es? (${mode === "sube" ? "subiendo" : mode === "baja" ? "bajando" : "a la vez"})`, sound: { notes } };
  }
  if (kind === "acorde") {
    const ps = CHORDS.find((c) => c[0] === item)![1].map((i) => root + i);
    return { ...base, prompt: "¿Qué acorde es?", sound: { notes: [...chordAt(ps, 0, 1.4), ...ps.map((p, i) => n(1.6 + i * 0.35, 1.6 + i * 0.35 + 0.33, p))] } };
  }
  if (kind === "grado") {
    const minor = level >= 4 && rand() < 0.5;
    const cad = cadence(root, minor);
    const p = scaleMidi(root, +item - 1, minor);
    return { ...base, prompt: `¿Qué grado de la escala ${minor ? "menor" : "mayor"} es la nota?`, sound: { notes: [...cad.notes, n(cad.end + 0.5, cad.end + 1.9, p, 0.75)] } };
  }
  if (kind === "progresion") return { ...base, prompt: "¿Qué progresión es?", sound: { notes: progression(item, home(root)) } };
  // dictado: el acorde de tónica de referencia y la melodía
  const t = home(root);
  const seq = melody(level, rand).map((d) => scaleMidi(t, d));
  return {
    ...base, options: [], prompt: "Toca la melodía en el teclado (empieza tras el acorde de tónica)", seq, tonic: t,
    sound: { notes: [...chordAt([t - 12, t, t + 4, t + 7], 0, 1), ...seq.map((p, i) => n(1.5 + i * 0.65, 1.5 + i * 0.65 + 0.6, p))] },
  };
}

// ---------------------------------------------------------------- canciones

export type SongData = { key: string; title: string; artist: string; tonality: Key; chords: Chord[]; beats: number[]; vocals: Note[] };

/** Lo que dura un pulso (la mediana entre pulsos; medio segundo si no hay). */
export function beatLen(beats: number[]) {
  const d = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
  return d.length ? d[d.length >> 1] : 0.5;
}

/** El trozo de un acorde que se oye: del primer pulso dentro de él hasta el último antes de su final (o de 6 s). */
export function chordClip(c: Chord, beats: number[]) {
  const inside = beats.filter((b) => b >= c.t - 0.05 && b <= c.end + 0.05);
  const t = inside[0] ?? c.t;
  const last = inside.filter((b) => b <= Math.min(c.end, t + 6) + 0.05).pop();
  const end = last != null && last - t >= 1 ? last : Math.min(c.end, t + 6);
  return { t, dur: end - t };
}

/** La tríada de un tipo de acorde ("", "m", "dim", "aug"), o null si no tiene tercera (sus, quintas). */
export function triad(kind: string) {
  const ts = tonesOf(kind);
  if (ts.includes(4)) return ts.includes(8) && !ts.includes(7) ? "aug" : "";
  if (ts.includes(3)) return ts.includes(6) && !ts.includes(7) ? "dim" : "m";
  return null;
}

/** Todas las preguntas de `kind` que salen de una canción en el nivel `level` (las respuestas, dentro de sus opciones).
 * Acordes: solo los que se mantienen al menos un pulso (y 1,5 s), cortados por pulsos. Voz: notas de 0,3 s o más. */
export function songQuestions(kind: Kind, s: SongData, level: number): Question[] {
  const k = s.tonality, options = pool(kind, level, k.minor);
  const from = (t: number, dur: number, chord?: Chord) => ({
    song: s.key, title: s.title, artist: s.artist, t, key: k, chord, context: { src: "mix" as const, t: Math.max(0, t - 4), dur: dur + 8 },
  });
  const cad = cadence(home(k.tonic), k.minor);
  const out: Question[] = [];
  const add = (answer: string, prompt: string, clip: Clip, withCadence: boolean, f: Question["from"], extra?: string) => {
    if (options.includes(answer)) out.push({ kind, item: answer, prompt, options, answer, extra, from: f, sound: withCadence ? { notes: cad.notes, at: cad.end + 0.5, clip } : { notes: [], clip } });
  };
  if (kind === "cancion-calidad" || kind === "cancion-grado") {
    const min = Math.max(beatLen(s.beats), 1.5);
    for (const c of s.chords) {
      const tr = triad(c.kind);
      if (!(c.root >= 0 && c.root < 12) || c.end - c.t < min || tr == null) continue;
      const clip = { src: "acorde" as const, ...chordClip(c, s.beats) };
      if (kind === "cancion-calidad") add(tr === "m" ? "Menor" : "Mayor", "¿Mayor o menor?", clip, false, from(clip.t, clip.dur, c));
      else add(degree({ ...c, kind: tr }, k), "¿Qué grado es este acorde? (antes, la cadencia de su tonalidad)", clip, true, from(clip.t, clip.dur, c));
    }
  } else if (kind === "cancion-nota") {
    const scale = k.minor ? MINOR : MAJOR;
    for (const [st, en, p] of s.vocals) {
      const d = scale.indexOf((((p - k.tonic) % 12) + 12) % 12);
      if (en - st < 0.3 || d < 0) continue;
      const clip = { src: "voz" as const, t: st, dur: Math.min(en - st, 1.5) };
      add(String(d + 1), "¿Qué grado de la escala canta la voz? (antes, la cadencia)", clip, true, from(st, clip.dur));
    }
  } else if (kind === "cancion-intervalo") {
    const vs = [...s.vocals].sort((a, b) => a[0] - b[0]);
    for (let i = 0; i + 1 < vs.length; i++) {
      const [a, b] = [vs[i], vs[i + 1]];
      const iv = Math.abs(b[2] - a[2]);
      if (b[0] - a[1] > 0.25 || a[1] - a[0] < 0.2 || b[1] - b[0] < 0.2 || b[1] - a[0] > 3 || iv < 1 || iv > 12) continue;
      const clip = { src: "voz" as const, t: a[0], dur: b[1] - a[0] };
      add(INTERVALS[iv], "¿Qué intervalo hay entre estas dos notas de la voz?", clip, false, from(a[0], clip.dur), b[2] > a[2] ? "subiendo" : "bajando");
    }
  }
  return out;
}

// ---------------------------------------------------------------- repaso

export type ItemStat = { box: number; due: number; seen: number; right: number; last: number };
export type KindStat = { level: number; recent: number[] }; // recent: las últimas 20 (1 acierto, 0 fallo)
export type EarState = { items: Record<string, ItemStat>; kinds: Partial<Record<Kind, KindStat>> };

/** Espera de cada caja de Leitner (ms): fallar vuelve a la 0 (ya), acertar sube una (1 min, 10 min, 1 día, 3, 7). */
const WAIT = [0, 6e4, 6e5, 864e5, 3 * 864e5, 7 * 864e5];
export const WINDOW = 20, UP = 0.85, DOWN = 0.6;
export const itemKey = (kind: Kind, item: string) => `${kind}:${item}`;
export const levelOf = (s: EarState, kind: Kind) => s.kinds[kind]?.level ?? 1;
export const accuracy = (s: EarState, kind: Kind) => {
  const r = s.kinds[kind]?.recent ?? [];
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
};

/** Apunta una respuesta: la caja de la pregunta y, con 20 respuestas del tipo, sube de nivel desde el 85 % o baja por
 * debajo del 60 %. Devuelve el cambio de nivel. */
export function grade(s: EarState, kind: Kind, item: string, ok: boolean, now: number): "sube" | "baja" | null {
  const k = itemKey(kind, item);
  s.items[k] ??= { box: 0, due: 0, seen: 0, right: 0, last: 0 };
  const it = s.items[k]; // releído: con $state, lo asignado se envuelve en un proxy
  it.box = ok ? Math.min(it.box + 1, WAIT.length - 1) : 0;
  Object.assign(it, { due: now + WAIT[it.box], seen: it.seen + 1, right: it.right + +ok, last: now });
  s.kinds[kind] ??= { level: 1, recent: [] };
  const ks = s.kinds[kind]!;
  ks.recent = [...ks.recent, +ok].slice(-WINDOW);
  if (ks.recent.length < WINDOW) return null;
  const acc = accuracy(s, kind)!;
  if (acc >= UP && ks.level < maxLevel(kind)) return (ks.level++, (ks.recent = []), "sube");
  if (acc < DOWN && ks.level > 1) return (ks.level--, (ks.recent = []), "baja");
  return null;
}

function weighted<T>(xs: T[], w: number[], rand: () => number) {
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < xs.length; i++) if ((r -= w[i]) < 0) return xs[i];
  return xs[xs.length - 1];
}

/** Qué preguntar: lo que ya toca repasar pesa el triple, y cuanto más baja su caja, más. Sin repetir `avoid` si hay más. */
export function pickItem(s: EarState, kind: Kind, items: string[], now: number, rand = Math.random, avoid?: string) {
  const xs = items.length > 1 ? items.filter((i) => i !== avoid) : items;
  return weighted(xs, xs.map((i) => {
    const it = s.items[itemKey(kind, i)];
    return ((it?.due ?? 0) <= now ? 3 : 1) / 2 ** (it?.box ?? 0);
  }), rand);
}

/** El tipo de la siguiente pregunta en una sesión mezclada: los que peor van salen más. */
export function pickKind(s: EarState, kinds: Kind[], rand = Math.random, avoid?: Kind) {
  const xs = kinds.length > 1 ? kinds.filter((k) => k !== avoid) : kinds;
  return weighted(xs, xs.map((k) => 1.5 - (accuracy(s, k) ?? 0.5)), rand);
}
