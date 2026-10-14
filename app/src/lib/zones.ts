/** Zonas difíciles: cuánto sale bien cada compás de lo que se practica en Aprender (acumulado entre días, por canción o
 * pieza, nivel, melodía y manos), para ver dónde se falla y ofrecer practicar justo ahí. Sin puntos ni bloqueos. */

import type { Target } from "./arrange.ts";

/** Lo de un compás: notas que tocaba tocar, cuántas salieron, error de tiempo acumulado (s) y notas de más. */
export type BarStat = { tries: number; hits: number; err: number; wrong: number };
export type Bars = Record<number, BarStat>;
export type Zone = { from: number; to: number; acc: number; tries: number };

const empty = (): BarStat => ({ tries: 0, hits: 0, err: 0, wrong: 0 });

/** Apunta las notas que ya pasaron (cada una una vez por pasada; `reset` de la práctica las vuelve a dejar contables).
 * `barAt`: el compás (desde 0) de un instante. Devuelve si apuntó algo. */
export function tally(bars: Bars, targets: Target[], now: number, tol: number, barAt: (t: number) => number) {
  let any = false;
  for (const x of targets) {
    if (x.t > now) break;
    if (x.counted || x.skipped || (!x.hit && x.t > now - tol)) continue; // aún se puede tocar
    const b = (bars[barAt(x.t)] ??= empty());
    b.tries++;
    if (x.hit) (b.hits++, (b.err += Math.abs(x.err ?? 0)));
    x.counted = true;
    any = true;
  }
  return any;
}

/** Una nota de más (equivocada) en el compás `bar`. */
export const wrongAt = (bars: Bars, bar: number) => void ((bars[bar] ??= empty()).wrong++);

/** Lo bien que sale un compás (0-1): aciertos entre lo que tocaba más lo que sobró; null sin datos. */
export function accuracy(b?: BarStat) {
  if (!b || b.tries < 1) return null;
  return b.hits / (b.tries + b.wrong);
}

/** Las zonas que peor salen: compases por debajo de `below` con datos suficientes, unidos con sus vecinos (un compás
 * bueno en medio no corta la zona), de peor a mejor. */
export function hardZones(bars: Bars, below = 0.8, minTries = 4, max = 5): Zone[] {
  const bad = Object.keys(bars)
    .map(Number)
    .filter((i) => bars[i].tries >= minTries && (accuracy(bars[i]) ?? 1) < below)
    .sort((a, b) => a - b);
  const zones: Zone[] = [];
  for (const i of bad) {
    const last = zones[zones.length - 1];
    if (last && i - last.to <= 2) last.to = i;
    else zones.push({ from: i, to: i, acc: 0, tries: 0 });
  }
  for (const z of zones) {
    let tries = 0, hits = 0, wrong = 0;
    for (let i = z.from; i <= z.to; i++) {
      const b = bars[i];
      if (!b) continue;
      [tries, hits, wrong] = [tries + b.tries, hits + b.hits, wrong + b.wrong];
    }
    [z.tries, z.acc] = [tries, hits / Math.max(1, tries + wrong)];
  }
  return zones.sort((a, b) => a.acc - b.acc || b.tries - a.tries).slice(0, max);
}
