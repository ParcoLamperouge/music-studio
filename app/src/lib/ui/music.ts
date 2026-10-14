/** Color de los datos musicales. La interfaz es gris; el color lo ponen los acordes (por su función en la tonalidad,
 * como Hookpad), las pistas, el tiempo y la afinación. Los valores viven en app.css (--fn-*, --stem-*, --early…);
 * aquí se devuelven como var(--x) para el DOM; para un canvas, cssVar("--fn-tonic"). */
import { degree, type Chord, type Key } from "../harmony.ts";

export type Fn = "tonic" | "sub" | "dom" | "vi" | "iii" | "other";
const ROMANS = ["i", "ii", "iii", "iv", "v", "vi", "vii"];
const BY_DEGREE: Fn[] = ["tonic", "sub", "iii", "sub", "dom", "vi", "dom"];
export const FN_LABEL: Record<Fn, string> = { tonic: "Tónica", sub: "Subdominante", dom: "Dominante", vi: "Relativo", iii: "Mediante", other: "Prestado" };

/** Función de un acorde en la tonalidad: grado («V7»), color, si es menor (se pinta hueco) y si es prestado o
 * cromático (gris, borde discontinuo). */
export function chordFn(c: Pick<Chord, "root" | "kind">, k: Key) {
  const label = degree(c as Chord, k);
  const m = /^([b#]?)(vii|vi|v|iv|iii|ii|i)/i.exec(label);
  const borrowed = !m || !!m[1];
  const fn: Fn = borrowed ? "other" : BY_DEGREE[ROMANS.indexOf(m[2].toLowerCase())];
  return { fn, label, color: `var(--fn-${fn})`, minor: /^m(?!aj)|^dim/.test(c.kind), borrowed };
}
export const chordColor = (c: Pick<Chord, "root" | "kind">, k: Key) => chordFn(c, k).color;

const STEMS = new Set(["vocals", "drums", "bass", "guitar", "piano", "other", "mix"]);
/** Color de una pista (voz, batería…); lo que no se conoce, gris. */
export const stemColor = (stem: string) => `var(--stem-${STEMS.has(stem) ? stem : "other"})`;

/** Color de un token para pintar en canvas: cssVar("--fn-tonic") → "#ff7f6e". */
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Tiempo de una nota tocada: adelantada (←), a tiempo, atrasada (→) o fallada (×). Color y símbolo: nunca solo color. */
export const TIMING = {
  early: { color: "var(--early)", mark: "←", label: "Adelantada" },
  ontime: { color: "var(--ontime)", mark: "•", label: "A tiempo" },
  late: { color: "var(--late)", mark: "→", label: "Atrasada" },
  miss: { color: "var(--miss)", mark: "×", label: "Fallada" },
} as const;

// ---------------------------------------------------------------- secciones

export type Section = { t: number; end: number; kind: "intro" | "verse" | "chorus" | "inst" | "outro"; label: string };
const LABEL: Record<Section["kind"], string> = { intro: "Intro", verse: "Estrofa", chorus: "Estribillo", inst: "Inst.", outro: "Final" };
const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N} ]/gu, "").replace(/\s+/g, " ").trim();

/** Secciones de una canción sacadas de su letra sincronizada (sin análisis de estructura): las líneas que se repiten
 * son estribillo y las demás estrofa; los huecos largos sin letra, instrumentales.
 * ponytail: heurística de letra; con estructura de verdad (allin1, SALAMI…) se sustituye. */
export function sectionsFromLyrics(lines: { t: number | null; end?: number; text: string }[], duration: number, offset = 0): Section[] {
  const ls = lines.filter((l) => l.t != null && fold(l.text)).map((l) => ({ t: l.t! + offset, end: l.end != null ? l.end + offset : null, key: fold(l.text) }));
  if (!ls.length || !duration) return [];
  const seen = new Map<string, number>();
  for (const l of ls) seen.set(l.key, (seen.get(l.key) ?? 0) + 1);
  const out: Section[] = [];
  const push = (kind: Section["kind"], t: number, end: number) => end - t > 0.5 && out.push({ t, end, kind, label: LABEL[kind] });
  const GAP = 6; // s sin letra que ya son un instrumental
  if (ls[0].t > 3) push("intro", 0, ls[0].t);
  let start = ls[0].t, chorus = seen.get(ls[0].key)! > 1;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i], next = ls[i + 1];
    const end = Math.min(l.end ?? l.t + 5, next ? next.t : duration); // sin fin: una línea dura como mucho 5 s
    if (!next) {
      push(chorus ? "chorus" : "verse", start, end);
      if (duration - end > 3) push("outro", end, duration);
      break;
    }
    const nextChorus = seen.get(next.key)! > 1;
    if (next.t - end > GAP) {
      push(chorus ? "chorus" : "verse", start, end);
      push("inst", end, next.t);
      [start, chorus] = [next.t, nextChorus];
    } else if (nextChorus !== chorus) {
      push(chorus ? "chorus" : "verse", start, next.t);
      [start, chorus] = [next.t, nextChorus];
    }
  }
  return out;
}
