/** Acordes y tonalidad a partir de las notas transcritas (basic-pitch), sin IA: lo que suena en cada tramo de
 * pulsos se compara con plantillas de acordes; la tonalidad sale de los perfiles de Krumhansl-Kessler. */

export type Note = [start: number, end: number, pitch: number, velocity: number];
export type Chord = { t: number; end: number; root: number; kind: string; bass: number };
export type Key = { tonic: number; minor: boolean };
export type Harmony = { chords: Chord[]; key: Key };

// intervalos desde la fundamental; el orden desempata a favor de lo más simple
const KINDS: [string, number[]][] = [
  ["", [0, 4, 7]],
  ["m", [0, 3, 7]],
  ["7", [0, 4, 7, 10]],
  ["m7", [0, 3, 7, 10]],
  ["maj7", [0, 4, 7, 11]],
  ["sus4", [0, 5, 7]],
  ["sus2", [0, 2, 7]],
  ["dim", [0, 3, 6]],
  ["aug", [0, 4, 8]],
  ["6", [0, 4, 7, 9]],
  ["m6", [0, 3, 7, 9]],
  ["m7b5", [0, 3, 6, 10]],
  ["dim7", [0, 3, 6, 9]],
];
// la transcripción mete notas de más: lo raro tiene que ganar con claridad para salir
const EXOTIC = new Set(["sus2", "sus4", "aug", "6", "m6", "m7b5", "dim7"]);
const WEIGHT: Record<string, number> = { bass: 1.2, guitar: 1, piano: 1, other: 0.8, vocals: 0.35 };

/** Peso de cada clase de nota (0-11) entre a y b; y la más grave con peso de la pista `low` (el bajo). */
function profile(tracks: { stem: string; notes: Note[] }[], a: number, b: number, lowStem = "bass") {
  const pc = new Array(12).fill(0);
  const low = new Array(12).fill(0);
  for (const { stem, notes } of tracks) {
    const k = WEIGHT[stem] ?? 0.8;
    for (const [s, e, p, v] of notes) {
      const o = Math.min(e, b) - Math.max(s, a);
      if (o <= 0) continue;
      const w = o * (0.5 + v) * k;
      pc[p % 12] += w;
      if (stem === lowStem) low[p % 12] += w / Math.max(1, (p - 24) / 12);
    }
  }
  // sin bajo separado (o la pista sola) no se sabe qué nota va abajo (la voz no cuenta): sin barra
  const bass = low.some((x) => x > 0) ? low.indexOf(Math.max(...low)) : -1;
  return { pc, bass };
}

/** El acorde que mejor explica un perfil, o null si casi no suena nada. `scale`: notas de la tonalidad (lo que
 * encaja en ella gana en los empates que deja una transcripción con ruido). */
export function bestChord(pc: number[], bass: number, scale?: Set<number>): Omit<Chord, "t" | "end"> | null {
  const total = pc.reduce((x, y) => x + y, 0);
  if (total < 1e-3) return null;
  const w = pc.map((x) => x / total);
  let best: { score: number; root: number; kind: string } | null = null;
  for (let root = 0; root < 12; root++) {
    for (const [kind, iv] of KINDS) {
      const tones = new Set(iv.map((i) => (root + i) % 12));
      let inside = 0;
      for (let p = 0; p < 12; p++) if (tones.has(p)) inside += w[p];
      // lo que suena fuera del acorde resta; cada nota de más (séptimas…) tiene que ganarse su sitio
      const fit = scale ? [...tones].filter((t) => scale.has(t)).length / tones.size : 1;
      const score =
        inside - 0.7 * (1 - inside) - 0.15 * (iv.length - 3) - (EXOTIC.has(kind) ? 0.06 : 0) + 0.08 * fit +
        (bass === root ? 0.12 : tones.has(bass) ? 0.03 : 0) + (w[root] > 0.08 ? 0 : -0.3);
      if (!best || score > best.score + 1e-9) best = { score, root, kind };
    }
  }
  return best && { root: best.root, kind: best.kind, bass: bass >= 0 ? bass : best.root };
}

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function corr(a: number[], b: number[]) {
  const ma = a.reduce((x, y) => x + y, 0) / 12;
  const mb = b.reduce((x, y) => x + y, 0) / 12;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    n += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return n / Math.sqrt(da * db || 1);
}

// notas de cada tipo, también los que solo da el modelo de acordes (lv-chordia)
const TONES: Record<string, number[]> = {
  ...Object.fromEntries(KINDS),
  "9": [0, 4, 7, 10, 2], maj9: [0, 4, 7, 11, 2], m9: [0, 3, 7, 10, 2], "11": [0, 4, 7, 10, 5], "13": [0, 4, 7, 10, 9], "7sus4": [0, 5, 7, 10], mmaj7: [0, 3, 7, 11],
};

/** Tonalidad a partir de acordes (la fundamental pesa más), cada uno según lo que dura. */
export function keyFromChords(chords: Chord[]): Key {
  const pc = new Array(12).fill(0);
  for (const c of chords) {
    const d = c.end - c.t;
    for (const [i, iv] of (TONES[c.kind] ?? TONES[""]).entries()) pc[(c.root + iv) % 12] += d * (i === 0 ? 1.5 : 1);
  }
  return findKey(pc);
}

/** Tonalidad (Krumhansl-Kessler) de un perfil de clases de nota. */
export function findKey(pc: number[]): Key {
  let best = { r: -Infinity, tonic: 0, minor: false };
  for (let t = 0; t < 12; t++) {
    const rot = pc.map((_, i) => pc[(i + t) % 12]);
    const ma = corr(rot, MAJOR), mi = corr(rot, MINOR);
    if (ma > best.r) best = { r: ma, tonic: t, minor: false };
    if (mi > best.r) best = { r: mi, tonic: t, minor: true };
  }
  return { tonic: best.tonic, minor: best.minor };
}

/** Acordes con nombre, fusionando los seguidos que se llaman igual (al simplificar, Sibmaj7 + Sib = Sib). */
export function named(chords: Chord[], k: Key, n: Notation) {
  const out: (Chord & { name: string })[] = [];
  for (const c of chords) {
    const name = chordName(c, k, n);
    const last = out[out.length - 1];
    if (last && last.name === name && c.t - last.end < 0.01) last.end = c.end;
    else out.push({ ...c, name });
  }
  return out;
}

const same = (a: Chord | null, b: Chord | null) => !!a && !!b && a.root === b.root && a.kind === b.kind && a.bass === b.bass;

/** Acordes de la canción, un tramo de `per` pulsos cada vez (sin pulsos: tramos de 1 s). Con una sola pista, los
 * de ese instrumento (el piano solo: su mano izquierda hace de bajo). */
export function analyze(tracks: { stem: string; notes: Note[] }[], beats: number[], duration: number, per = 2): Harmony {
  const low = tracks.length === 1 && tracks[0].stem !== "vocals" ? tracks[0].stem : "bass";
  const all = profile(tracks, 0, Infinity).pc;
  const key = findKey(all);
  const scale = new Set((key.minor ? MINOR_SCALE : MAJOR_SCALE).map((i) => (key.tonic + i) % 12));
  const edges = beats.length > 4 ? beats.filter((_, i) => i % per === 0) : Array.from({ length: Math.ceil(duration) }, (_, i) => i);
  if (edges[0] > 0.5) edges.unshift(0);
  edges.push(Math.max(duration, edges[edges.length - 1] + 1));
  const raw: (Chord | null)[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const { pc, bass } = profile(tracks, edges[i], edges[i + 1], low);
    const c = bestChord(pc, bass, scale);
    raw.push(c && { ...c, t: edges[i], end: edges[i + 1] });
  }
  // un tramo suelto distinto de sus dos vecinos iguales es ruido de la transcripción
  for (let i = 1; i + 1 < raw.length; i++) {
    if (raw[i] && same(raw[i - 1], raw[i + 1]) && !same(raw[i], raw[i - 1])) raw[i] = { ...raw[i - 1]!, t: raw[i]!.t, end: raw[i]!.end };
  }
  const chords: Chord[] = [];
  for (const c of raw) {
    if (!c) continue;
    const last = chords[chords.length - 1];
    if (last && same(last, c) && c.t - last.end < 0.01) last.end = c.end;
    else chords.push({ ...c });
  }
  return { chords, key };
}

// ---------------------------------------------------------------- nombres

const LATIN = ["Do", "Do#", "Re", "Re#", "Mi", "Fa", "Fa#", "Sol", "Sol#", "La", "La#", "Si"];
const LATIN_B = ["Do", "Reb", "Re", "Mib", "Mi", "Fa", "Solb", "Sol", "Lab", "La", "Sib", "Si"];
const EN = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const EN_B = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
// tonalidades que se escriben con bemoles (mayores; las menores, por su relativa)
const FLAT_MAJORS = new Set([5, 10, 3, 8, 1, 6]);
export const usesFlats = (k: Key) => FLAT_MAJORS.has(k.minor ? (k.tonic + 3) % 12 : k.tonic);

export type Notation = { latin: boolean; simple: boolean };
export const noteName = (pc: number, k: Key, latin: boolean) => (latin ? (usesFlats(k) ? LATIN_B : LATIN) : usesFlats(k) ? EN_B : EN)[pc];

const SIMPLE: Record<string, string> = {
  "7": "", maj7: "", "6": "", "9": "", maj9: "", "11": "", "13": "", m7: "m", m6: "m", m9: "m", mmaj7: "m", m7b5: "dim", dim7: "dim", "7sus4": "sus4",
};
const SUFFIX: Record<string, string> = { m7b5: "m7(b5)", mmaj7: "m(maj7)" };

/** «Mim7», «Do/Mi», «Sib» (o «Em7», «C/E», «Bb»). */
export function chordName(c: Chord, k: Key, n: Notation) {
  const kind = n.simple ? (SIMPLE[c.kind] ?? c.kind) : c.kind;
  const slash = !n.simple && c.bass !== c.root ? `/${noteName(c.bass, k, n.latin)}` : "";
  return noteName(c.root, k, n.latin) + (SUFFIX[kind] ?? kind) + slash;
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** Grado del acorde en la tonalidad: «V7», «vi», «bVII»… (minúscula = menor). */
export function degree(c: Chord, k: Key) {
  const scale = k.minor ? MINOR_SCALE : MAJOR_SCALE;
  const iv = (c.root - k.tonic + 12) % 12;
  let d = scale.indexOf(iv);
  let acc = "";
  if (d < 0) {
    d = scale.indexOf((iv + 1) % 12);
    acc = "b";
  }
  const minorish = /^m(?!aj)|^dim/.test(c.kind);
  const r = minorish ? ROMAN[d].toLowerCase() : ROMAN[d];
  const tail = ({ dim: "°", dim7: "°7", m7b5: "ø7", aug: "+" } as Record<string, string>)[c.kind] ?? c.kind.replace(/^m(?!aj)/, "");
  return acc + r + tail;
}

export const keyName = (k: Key, latin: boolean) => `${noteName(k.tonic, k, latin)} ${latin ? (k.minor ? "menor" : "mayor") : k.minor ? "minor" : "major"}`;
export const scaleNotes = (k: Key, latin: boolean) => (k.minor ? MINOR_SCALE : MAJOR_SCALE).map((i) => noteName((k.tonic + i) % 12, k, latin));
export const relative = (k: Key): Key => (k.minor ? { tonic: (k.tonic + 3) % 12, minor: false } : { tonic: (k.tonic + 9) % 12, minor: true });

// ---------------------------------------------------------------- cancionero

type Doc = { offset?: number; word_offset?: number; lines: { t: number | null; end?: number; text: string; words?: { t: number; w: string }[] }[] } | null;
export type SheetWord<C> = { w: string; t: number; chords: C[] };
export type SheetRow<C> = { kind: "line"; words: SheetWord<C>[]; tail: C[]; t: number } | { kind: "bars"; chords: C[]; t: number; label: string };

/** Cancionero sin ritmo: cada acorde encima de la palabra en la que entra (tiempos de la letra + desfases);
 * intro, instrumentales y final en compases sueltos; sin letra, de 4 en 4. */
export function leadSheet<C extends { t: number }>(doc: Doc, chords: C[]): SheetRow<C>[] {
  const off = doc?.offset ?? 0;
  const woff = off + (doc?.word_offset ?? 0);
  const lines = (doc?.lines ?? [])
    .filter((l) => l.t != null && l.text.trim())
    .map((l) => ({
      t: l.t! + off,
      end: (l.end ?? l.t! + 4) + off,
      words: (l.words?.length ? l.words.map((w) => ({ w: w.w, t: w.t + woff })) : l.text.split(/\s+/).map((w, i) => ({ w, t: l.t! + off + i * 0.3 }))).map(
        (w) => ({ ...w, chords: [] as C[] }),
      ),
      tail: [] as C[],
    }));
  if (!lines.length) {
    const out: SheetRow<C>[] = [];
    for (let i = 0; i < chords.length; i += 4) out.push({ kind: "bars", chords: chords.slice(i, i + 4), t: chords[i].t, label: "" });
    return out;
  }
  const intro: C[] = [];
  const after = lines.map(() => [] as C[]); // compases instrumentales tras cada línea
  for (const c of chords) {
    let li = -1;
    while (li + 1 < lines.length && lines[li + 1].t - 0.25 <= c.t) li++;
    const next = lines[li + 1];
    if (next && c.t >= next.t - 1.2) next.words[0].chords.push(c); // justo antes de una línea: entra con ella
    else if (li < 0) intro.push(c);
    else if (c.t <= lines[li].end + 0.6) {
      const w = lines[li].words.find((x) => x.t >= c.t - 0.15);
      (w ? w.chords : lines[li].tail).push(c);
    } else after[li].push(c);
  }
  const out: SheetRow<C>[] = [];
  if (intro.length) out.push({ kind: "bars", chords: intro, t: intro[0].t, label: "Intro" });
  lines.forEach((l, i) => {
    out.push({ kind: "line", words: l.words, tail: l.tail, t: l.t });
    if (after[i].length) out.push({ kind: "bars", chords: after[i], t: after[i][0].t, label: i === lines.length - 1 ? "Final" : "" });
  });
  return out;
}
