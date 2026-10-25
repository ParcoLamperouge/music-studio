/** Compases desde beats.json, con la MISMA regla que el motor (beautify.py): limpiar pulsos,
 * fase del primer tiempo fuerte por votación de downbeats y cola al intervalo final. Así las
 * rayas del roll, el bucle A–B → compases y la cuantización del motor dividen igual. */

export type BeatData = { beats: number[]; downbeats?: number[]; meter?: number };

/** 6 -> "6/8" (compuesto: el pulso es la corchea), 4 -> "4/4", 3 -> "3/4"… `meter` es pulsos
 * por compás, que es lo que trae beats.json. */
export function meterLabel(meter: number): string {
  const m = Math.max(1, Math.round(meter));
  return m >= 6 && m % 3 === 0 ? `${m}/8` : `${m}/4`;
}

const med = (xs: number[]): number => {
  if (!xs.length) return 0.44;
  xs.sort((a, b) => a - b);
  const mid = xs.length >> 1;
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
};

/** Quita pulsos duplicados (<120 ms) y rellena huecos al tempo local (como clean_beats). */
export function cleanBeats(raw: number[]): number[] {
  if (!raw.length) return [];
  const dedup = [raw[0]];
  for (const t of raw.slice(1)) if (t - dedup[dedup.length - 1] >= 0.12) dedup.push(t);
  const out = [dedup[0]];
  for (let i = 1; i < dedup.length; i++) {
    const gap = dedup[i] - dedup[i - 1];
    const ctx = dedup.slice(Math.max(0, i - 4), i + 4);
    const ioi = med(ctx.slice(1).map((x, j) => x - ctx[j]));
    if (gap > 1.5 * ioi) {
      const n = Math.round(gap / ioi);
      for (let k = 1; k < n; k++) out.push(dedup[i - 1] + (gap * k) / n);
    }
    out.push(dedup[i]);
  }
  return out;
}

/** Índice del pulso donde cae el primer tiempo fuerte: la fase más votada entre los downbeats
 * (el primero a secas se desvía con uno perdido o adelantado). Igual que first_downbeat_index. */
export function firstDownbeat(beats: number[], downbeats: number[] | undefined, meter: number): number {
  const idx: number[] = [];
  for (const d of downbeats ?? []) {
    let best = 0;
    for (let j = 1; j < beats.length; j++) if (Math.abs(beats[j] - d) < Math.abs(beats[best] - d)) best = j;
    if (beats.length && Math.abs(beats[best] - d) < 0.25) idx.push(best);
  }
  if (!idx.length) return 0;
  const votes = new Map<number, number>();
  for (const i of idx) votes.set(i % meter, (votes.get(i % meter) ?? 0) + 1);
  let mod = 0;
  let n = -1;
  for (const [phase, count] of votes) if (count > n) ((mod = phase), (n = count)); // empate: la primera en llegar
  return idx.find((i) => i % meter === mod) ?? 0;
}

/** Segundos donde empieza cada compás (por orden), hasta `until`: limpia los pulsos, fase por
 * votación y cola alargada al último intervalo (como extend_tail). Lo que el motor cuantizará
 * como compás N empieza exactamente aquí. */
export function barStarts(bd: BeatData, until: number): number[] {
  const beats = cleanBeats(bd.beats);
  if (beats.length < 2) return [];
  const m = Math.max(1, Math.round(bd.meter ?? 4));
  const start = firstDownbeat(beats, bd.downbeats, m);
  const bars: number[] = [];
  for (let i = start; i < beats.length; i += m) bars.push(beats[i]);
  let t = beats[beats.length - 1];
  let k = beats.length - 1;
  const ioi = med(beats.slice(-9).map((x, i, a) => (i ? x - a[i - 1] : 0)).slice(1));
  while (t < until) {
    t += ioi;
    k++;
    if ((k - start) % m === 0) bars.push(t);
  }
  return bars;
}
