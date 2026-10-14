/** Búsqueda de progresiones de acordes entre canciones. Cada acorde se reduce a raíz + tríada (código `raíz*4 + calidad`,
 * absoluto): la alineación local prueba las 12 transposiciones, así que no hace falta saber la tonalidad (ni su lectura
 * relativa: vi–IV–I–V coincide igual en Do mayor que en La menor). */
import { chordName, degree, keyScores, relative, type Chord, type Key } from "./harmony.ts";

export const Q = { M: 0, m: 1, d: 2, a: 3 } as const;
const QKIND = ["", "m", "dim", "aug"];
export const code = (root: number, q: number) => (((root % 12) + 12) % 12) * 4 + q;
const rootOf = (c: number) => c >> 2;
const qualOf = (c: number) => c & 3;
export const shift = (c: number, t: number) => code(rootOf(c) + t, qualOf(c));

export type Seq = { c: number[]; t: number[]; key: Key; alt?: Key }; // alt: la relativa, si la tonalidad es dudosa

const quality = (kind: string) => (/^dim|^m7b5/.test(kind) ? Q.d : /aug/.test(kind) ? Q.a : /^m(?!aj)/.test(kind) ? Q.m : Q.M);

/** Tonalidad y, si dudamos entre ella y su relativa, la relativa. ponytail: umbral 0.6 sobre la diferencia de puntuación
 * (keyScores) mirado en 19 canciones reales (márgenes 0.2–1.7; Villain, claramente Si menor, 1.5); sin más señales
 * (inicio/fin, tiempo en cada tónica ya entran en la puntuación). Sube el umbral para dudar más. */
export const AMBIGUOUS = 0.6;
function detectKey(chords: Chord[]): { key: Key; alt?: Key } {
  const sc = keyScores(chords);
  if (!sc.length) return { key: { tonic: 0, minor: false } };
  const best = sc.reduce((a, x) => (x.score > a.score + 1e-9 ? x : a));
  const key = { tonic: best.tonic, minor: best.minor }, rel = relative(key);
  const r = sc.find((x) => x.tonic === rel.tonic && x.minor === rel.minor)!;
  return best.score - r.score < AMBIGUOUS ? { key, alt: rel } : { key };
}

/** Acordes de una canción → secuencia simplificada: sin séptimas ni bajos, sin los más cortos que ~1 tiempo
 * (0,4 s sin tiempos) y sin repeticiones seguidas. */
export function normalize(chords: Chord[], beats: number[] = []): Seq {
  const gaps = beats.slice(1).map((b, i) => b - beats[i]).sort((a, b) => a - b);
  const min = gaps.length ? gaps[gaps.length >> 1] * 0.8 : 0.4;
  const c: number[] = [], t: number[] = [];
  for (const x of chords) {
    if (x.end - x.t < min) continue;
    const k = code(x.root, quality(x.kind));
    if (c[c.length - 1] === k) continue;
    c.push(k);
    t.push(Math.round(x.t * 10) / 10);
  }
  const { key, alt } = detectKey(chords);
  return alt ? { c, t, key, alt } : { c, t, key };
}

/** El código como nombre de acorde en una tonalidad (Am, F…). */
export const nameOf = (c: number, key: Key) => chordName({ t: 0, end: 0, root: rootOf(c), kind: QKIND[qualOf(c)], bass: rootOf(c) }, key, { latin: false, simple: true });

/** El código como grado en una tonalidad: «vi», «bVII», «V»… */
export const degreeOf = (c: number, key: Key) =>
  degree({ t: 0, end: 0, root: rootOf(c), kind: QKIND[qualOf(c)], bass: rootOf(c) }, key);

// ---------------------------------------------------------------- lo que escribe el usuario

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NUMERALS = ["i", "ii", "iii", "iv", "v", "vi", "vii"];
const ROMAN = /^([b#♭♯]?)(vii|vi|v|iv|iii|ii|i)(°|o|dim|\+|aug)?(?:.*)$/i;
const LATIN = /^(do|re|mi|fa|sol|la|si)([#b♯♭]?)(.*)$/i;
const ENGLISH = /^([A-G])([#b♯♭]?)(.*)$/;
const NOTE: Record<string, number> = { do: 0, re: 2, mi: 4, fa: 5, sol: 7, la: 9, si: 11, C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const acc = (a: string) => (a === "#" || a === "♯" ? 1 : a ? -1 : 0);

function chordQuality(rest: string) {
  if (/^(dim|°|o|m7b5|ø)/.test(rest)) return Q.d;
  if (/^(aug|\+)/.test(rest)) return Q.a;
  return /^(m(?!aj)|min|-)/.test(rest) ? Q.m : Q.M;
}

/** «I V vi IV», «ii-V-I», «bVII», «Am F C G», «Lam Fa Do Sol» → códigos (en grados, como si la tónica fuera Do).
 * Los grados se leen sobre la escala mayor: en menor, «i bVII bVI V». null si no se entiende o hay menos de 2. */
export function parseProgression(text: string): number[] | null {
  const toks = text.trim().split(/[\s\-–—,|>→]+/).filter(Boolean);
  if (toks.length < 2) return null;
  const roman = toks.map((s) => ROMAN.exec(s));
  if (roman.every(Boolean)) {
    return roman.map((m) => {
      const [, a, num, mark] = m!;
      const n = NUMERALS.indexOf(num.toLowerCase());
      const lower = num === num.toLowerCase();
      const q = mark ? (/\+|aug/i.test(mark) ? Q.a : Q.d) : lower ? Q.m : Q.M;
      return code(MAJOR[n] + acc(a), q);
    });
  }
  const out: number[] = [];
  for (const s of toks) {
    const m = LATIN.exec(s) ?? ENGLISH.exec(s);
    if (!m) return null;
    const base = NOTE[m[1].toLowerCase()] ?? NOTE[m[1]];
    out.push(code(base + acc(m[2]), chordQuality(m[3])));
  }
  return out;
}

// ---------------------------------------------------------------- alineación

const GAP = -0.7, FAR = -1, SAME = 2, SAME_ROOT = 0.4, RELATIVE = 0.7;
// funciones dentro de una tonalidad (códigos relativos a la tónica): tónica I·iii·vi, subdominante ii·IV, dominante V·vii°·iii
const FAMILIES = [[code(0, 0), code(4, 1), code(9, 1)], [code(2, 1), code(5, 0)], [code(7, 0), code(11, 2), code(4, 1)]];
/** Parecido de dos acordes (ya en la tonalidad de `tr`): igual > misma raíz con otra tríada > misma función (I↔iii↔vi, ii↔IV, V↔vii°) > nada que ver. */
function sub(a: number, b: number, tr: number) {
  if (a === b) return SAME;
  if (rootOf(a) === rootOf(b)) return SAME_ROOT;
  const x = shift(a, -tr), y = shift(b, -tr);
  return FAMILIES.some((f) => f.includes(x) && f.includes(y)) ? RELATIVE : FAR;
}

/** Un paso de la alineación: acorde de la consulta (`qc`, como se escribió) ↔ acorde de la canción (`sc`, absoluto). */
export type Step = { kind: "exact" | "same" | "rel" | "far" | "extra" | "miss"; qc: number; sc: number; si: number };
export type Hit = { score: number; from: number; to: number; tr: number; path: Step[]; exact: boolean };

const stepKind = (qt: number, sc: number, tr: number): Step["kind"] => {
  const v = sub(qt, sc, tr);
  return v === SAME ? "exact" : v === SAME_ROOT ? "same" : v === RELATIVE ? "rel" : "far";
};

/** Mejor tramo de `s` parecido a `q` (Smith-Waterman, las 12 transposiciones). score 0–1: 1 = idéntico.
 * `tr`: semitonos que se suben los acordes de `q` para coincidir con la canción (la tónica de `q` es `tr`). */
export function align(q: number[], s: number[]): Hit | null {
  const m = q.length, n = s.length;
  if (!m || !n) return null;
  const W = n + 1;
  let best = { v: 0, tr: 0, i: 0, j: 0 };
  const fill = (tr: number, track: boolean) => {
    const H = new Float64Array((m + 1) * W);
    for (let i = 1; i <= m; i++) {
      const qc = shift(q[i - 1], tr);
      for (let j = 1; j <= n; j++) {
        const v = Math.max(0, H[(i - 1) * W + j - 1] + sub(qc, s[j - 1], tr), H[(i - 1) * W + j] + GAP, H[i * W + j - 1] + GAP);
        H[i * W + j] = v;
        if (track && v > best.v + 1e-9) best = { v, tr, i, j };
      }
    }
    return H;
  };
  for (let tr = 0; tr < 12; tr++) fill(tr, true);
  if (best.v <= 0) return null;
  const H = fill(best.tr, false);
  const path: Step[] = [];
  let { i, j } = best;
  while (i > 0 && j > 0 && H[i * W + j] > 0) {
    const qt = shift(q[i - 1], best.tr), h = H[i * W + j];
    if (Math.abs(h - (H[(i - 1) * W + j - 1] + sub(qt, s[j - 1], best.tr))) < 1e-9) {
      path.push({ kind: stepKind(qt, s[j - 1], best.tr), qc: q[i - 1], sc: s[j - 1], si: j - 1 });
      i--, j--;
    } else if (Math.abs(h - (H[(i - 1) * W + j] + GAP)) < 1e-9) {
      path.push({ kind: "miss", qc: q[i - 1], sc: -1, si: -1 });
      i--;
    } else {
      path.push({ kind: "extra", qc: -1, sc: s[j - 1], si: j - 1 });
      j--;
    }
  }
  path.reverse();
  const solid = path.filter((x) => x.si >= 0);
  return {
    score: Math.min(1, best.v / (SAME * m)), tr: best.tr, path, from: solid[0].si, to: solid[solid.length - 1].si,
    exact: path.length === m && path.every((x) => x.kind === "exact"),
  };
}

/** Lo que se enseña de cada acorde casado: nombre en la canción, grado en el marco de la consulta (su tónica = tr) y cuánto encaja. */
export type Chip = { name: string; deg: string; own: string; kind: Step["kind"]; tip: string };
export function chips(h: Pick<SongHit, "tr" | "path" | "qkey">, songKey: Key): Chip[] {
  const qk = { tonic: 0, minor: h.qkey.minor };
  return h.path.filter((x) => x.si >= 0).map((x) => {
    const deg = degreeOf(shift(x.sc, -h.tr - h.qkey.tonic), qk);
    const want = x.qc >= 0 ? degreeOf(shift(x.qc, -h.qkey.tonic), qk) : "";
    const tip = x.kind === "exact" ? "igual" : x.kind === "rel" ? `misma función que ${want}` : x.kind === "same" ? `misma raíz que ${want}, otra tríada` : x.kind === "far" ? `distinto de ${want}` : "acorde de más";
    return { name: nameOf(x.sc, songKey), deg, own: degreeOf(x.sc, songKey), kind: x.kind, tip };
  });
}

/** Tonalidad en la que se escribió la consulta: los grados (I V vi IV) tienen la tónica en Do y son menores si empiezan por «i»;
 * con nombres (Am F C G) se deduce de los propios acordes. */
export function parseQuery(text: string): { codes: number[]; key: Key } | null {
  const codes = parseProgression(text);
  if (!codes) return null;
  const roman = text.trim().split(/[\s\-–—,|>→]+/).every((t) => ROMAN.test(t));
  const key = roman ? { tonic: 0, minor: codes[0] === code(0, Q.m) } : detectKey(codes.map((c, i) => ({ t: i, end: i + 1, root: rootOf(c), kind: QKIND[qualOf(c)], bass: rootOf(c) }))).key;
  return { codes, key };
}

/** «I · V · vi · IV  =  C · G · Am · F»: cómo se ha entendido lo escrito (mayúscula = mayor, minúscula = menor). */
export const describe = (codes: number[], key: Key = { tonic: 0, minor: false }) =>
  codes.map((c) => degreeOf(shift(c, -key.tonic), { tonic: 0, minor: key.minor })).join(" · ") + "  =  " + codes.map((c) => nameOf(c, key)).join(" · ") + ` (${key.minor ? "menor" : "mayor"})`;

export type SongHit = Hit & { qkey: Key; same: boolean; amb: Key[] | null; key: string; t: number; end: number; ts: number[]; codes: number[]; songKey: Key };
export const MIN_SCORE = 0.7;

/** Canciones del índice que contienen algo parecido a `q`, de más a menos parecida. */
export function search(q: number[], index: Map<string, Seq>, opts: { skip?: string; min?: number; qkey?: Key } = {}): SongHit[] {
  const out: SongHit[] = [], qkey = opts.qkey ?? { tonic: 0, minor: false };
  for (const [key, s] of index) {
    if (key === opts.skip) continue;
    const h = align(q, s.c);
    const tonic = h ? (qkey.tonic + h.tr) % 12 : 0;
    const reading = [s.key, s.alt].find((k) => k && k.tonic === tonic && k.minor === qkey.minor);
    if (h && h.score >= (opts.min ?? MIN_SCORE)) out.push({ ...h, qkey, same: !!reading, amb: s.alt ? [s.key, s.alt] : null, key, t: s.t[h.from] ?? 0, end: s.t[h.to + 1] ?? (s.t[h.to] ?? 0) + 3, ts: s.t.slice(h.from, h.to + 1), codes: s.c.slice(h.from, h.to + 1), songKey: reading ?? s.key });
  }
  return out.sort((a, b) => +b.same - +a.same || +b.exact - +a.exact || b.score - a.score);
}

/** Las progresiones de 4 acordes que más se repiten en una canción (sin contar rotaciones de otra ya elegida). */
export function loops(c: number[], max = 2, len = 4): { codes: number[]; n: number }[] {
  const n = Math.min(len, c.length);
  if (n < 3) return [];
  const count = new Map<string, number>();
  for (let i = 0; i + n <= c.length; i++) {
    const g = c.slice(i, i + n);
    if (new Set(g).size < 2) continue;
    count.set(g.join(), (count.get(g.join()) ?? 0) + 1);
  }
  const chosen: { codes: number[]; n: number }[] = [];
  for (const [g, k] of [...count].sort((a, b) => b[1] - a[1])) {
    const codes = g.split(",").map(Number);
    const rot = (x: number[]) => x.length === codes.length && ("," + x.concat(x).join() + ",").includes("," + codes.join() + ",");
    if (chosen.some((x) => rot(x.codes))) continue;
    chosen.push({ codes, n: k });
    if (chosen.length >= max) break;
  }
  return chosen;
}
