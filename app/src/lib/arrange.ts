/** Modo Aprender: un arreglo para piano de una canción separada, del nivel 1 (principiante) al 5 (lo que suena).
 * Mano derecha: la melodía de una pista (la voz, o la que se elija) limpiada y cuadrada a los pulsos; sin melodía, los
 * acordes. Mano izquierda: generada a partir de los acordes (lo más fiable que hay), no copiada de pistas transcritas.
 * Todo se calcula en pulsos de la canción (los de Beat This!), así que la partitura y el piano roll cuadran. */

import { noteName, tonesOf, usesFlats, type Chord, type Key, type Note } from "./harmony.ts";

export type Level = 1 | 2 | 3 | 4 | 5 | 6 | 7;
/** 1-4, 6 y 7: arreglos de menos a más difícil; 5 no es un escalón más, es el original tal cual (la pieza, o lo
 * transcrito), que puede ser más fácil o más difícil que cualquiera. Se llama 5 por lo ya guardado y las lecciones. */
export const LEVELS: [Level, string][] = [
  [1, "Principiante"], [2, "Fácil"], [3, "Intermedio"], [4, "Avanzado"],
  [5, "Original: tal cual, sin arreglar (puede ser más fácil o más difícil que los arreglos)"],
  [6, "Experto: melodía armonizada en cada pulso y acordes al ritmo del original (arpegios si el original arpegia)"],
  [7, "Virtuoso: acordes y octavas en la melodía, la izquierda en semicorcheas como el original"],
];
/** Los arreglos en orden de dificultad, y cómo se llaman (el 6 y el 7 se ven como 5 y 6). */
export const ARRANGED: Level[] = [1, 2, 3, 4, 6, 7];
export const levelLabel = (l: Level) => (l === 5 ? "original" : String(l > 5 ? l - 1 : l));
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
const GRID: Record<Level, number> = { 1: 1, 2: 0.5, 3: 0.25, 4: 0.25, 5: 0, 6: 0.25, 7: 0 };

/** Melodía limpia en pulsos: una sola voz y cuadrada a la cuadrícula. Se simplifica el ritmo, no las notas: la voz de
 * arriba (lo que se oye encima de cada instante; una voz interior solo cuenta donde no suena nada más agudo), cada nota
 * a su casilla más cercana, y si dos caen en la misma se queda la que más importa (la larga, la que cae en la casilla,
 * la cumbre de la frase): las que sobran son notas de paso cortas y adornos. Sin notas sueltas muy cortas; la misma
 * nota cantada dos veces son dos. Con `grid` 0, tal cual (`lowest`: si se pisan, la grave; para un bajo). */
export function melodyLine(notes: Note[], beats: number[], grid: number, lowest = false): ANote[] {
  const src = notes
    .filter(([s, e]) => e - s >= 0.08)
    .map(([s, e, p, v]) => ({ b: toBeat(beats, s), e: toBeat(beats, e), p, v }))
    .sort((a, b) => a.b - b.b);
  if (!src.length) return [];
  if (!grid) return monophonic(src, lowest).map((n) => ({ b: n.b, d: n.e - n.b, p: n.p, v: n.v }));
  // lo que cada nota está por encima de las demás: desde cuándo (b) y cuánto rato seguido (vis); lo que asoma después
  // (una voz interior larga cuando calla la de arriba) no es otra nota de la melodía
  const vis = new Array<number>(src.length).fill(0), first = new Array<number>(src.length).fill(NaN);
  const times = [...new Set(src.flatMap((n) => [n.b, n.e]))].sort((x, y) => x - y);
  let active: number[] = [], k = 0, last = -1;
  for (let t = 0; t + 1 < times.length; t++) {
    const t0 = times[t];
    while (k < src.length && src[k].b <= t0) active.push(k++);
    active = active.filter((i) => src[i].e > t0);
    const top = active.length ? active.reduce((x, y) => (src[y].p > src[x].p ? y : x)) : -1;
    if (top >= 0 && (isNaN(first[top]) || top === last)) {
      if (isNaN(first[top])) first[top] = t0;
      vis[top] += times[t + 1] - t0;
    }
    last = top;
  }
  const cand = src.map((n, i) => ({ ...n, b: first[i], vis: vis[i] })).filter((n) => n.vis > 0).sort((x, y) => x.b - y.b);
  // cumbre: la más aguda en dos pulsos alrededor (y que dure algo: un destello agudo no lo es)
  const peak = (i: number) => {
    if (cand[i].vis < 0.25) return false;
    for (let j = i - 1; j >= 0 && cand[i].b - cand[j].b <= 2; j--) if (cand[j].p >= cand[i].p) return false;
    for (let j = i + 1; j < cand.length && cand[j].b - cand[i].b <= 2; j++) if (cand[j].p > cand[i].p) return false;
    return true;
  };
  const ranked = cand
    .map((n, i) => {
      const slot = Math.round(n.b / grid), near = 1 - Math.abs(n.b / grid - slot); // near: 1 en la casilla, 0,5 a medio camino
      return { ...n, slot, w: Math.min(n.vis, 4 * grid) + 0.25 * grid * near + (peak(i) ? 4 * grid : 0), keep: Math.min(n.vis, grid) + 0.25 * grid * near >= 0.35 * grid };
    })
    .filter((n) => n.keep) // casi nada en la casilla: silencio
    .sort((x, y) => y.w - x.w);
  // de la más importante a la menos, cada una a su casilla; las que se quedan sin ella, luego, a la de al lado si quedó
  // libre y no cambia el orden de las notas (una síncopa a la casilla anterior vacía); si no, fuera
  const slots = new Map<number, (typeof ranked)[number]>();
  const fits = (s: number, b: number) => !slots.has(s) && !((slots.get(s - 1)?.b ?? -Infinity) > b) && !((slots.get(s + 1)?.b ?? Infinity) < b);
  const left = ranked.filter((n) => (fits(n.slot, n.b) ? (slots.set(n.slot, n), false) : true));
  for (const n of left) {
    const alt = n.b / grid < n.slot ? n.slot - 1 : n.slot + 1;
    if (Math.abs(n.b / grid - alt) < 1 && fits(alt, n.b)) slots.set(alt, n);
  }
  const out = [...slots.entries()].sort((x, y) => x[0] - y[0]).map(([slot, n]) => ({ b: slot * grid, e: n.e, p: n.p, v: n.v }));
  const res: ANote[] = out.map((n, i) => {
    const next = out[i + 1]?.b ?? Infinity;
    return { b: n.b, d: Math.min(next, Math.max(n.b + grid, Math.round(n.e / grid) * grid)) - n.b, p: n.p, v: n.v };
  });
  // al cantar, las notas salen picadas: los huecos pequeños se rellenan alargando la nota (legato), que si no la
  // partitura se llena de silencios de semicorchea
  const fill = grid >= 1 ? 1 : 0.5;
  for (let i = 0; i + 1 < res.length; i++) {
    const gap = res[i + 1].b - (res[i].b + res[i].d);
    if (gap > 1e-6 && gap <= fill + 1e-6) res[i].d += gap;
  }
  return res;
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

/** Sube o baja toda la línea por octavas para centrarla; lo que se salga del rango se mueve por frases (separadas por
 * silencios de un pulso o más) a una misma octava, así la melodía no cambia de forma. Una frase que no cabe entera se
 * parte en los menos trozos posibles (cada uno lo más largo que quepa), y cada trozo va a la octava que cabe más
 * cercana a la del anterior: la forma solo se rompe en esos cortes. */
function fold(notes: ANote[], lo: number, hi: number) {
  if (!notes.length) return notes;
  // la octava en la que más notas caben dentro (a igualdad, la que menos mueve): una pieza ya en su sitio no se toca
  let shift = 0, most = -1;
  for (const k of [0, 12, -12, 24, -24, 36, -36]) {
    const n = notes.filter((x) => x.p + k >= lo && x.p + k <= hi).length;
    if (n > most) [shift, most] = [k, n];
  }
  const out = notes.map((n) => ({ ...n, p: n.p + shift }));
  let prev = 0; // octavas que se movió el trozo anterior
  // las octavas a las que se puede mover un trozo de notas entre min y max (vacío si no cabe)
  const fits = (min: number, max: number): [number, number] => [Math.ceil((lo - min) / 12), Math.floor((hi - max) / 12)];
  const move = (g: ANote[], min: number, max: number) => {
    const [kLo, kHi] = fits(min, max);
    prev = Math.min(kHi, Math.max(kLo, prev));
    for (const n of g) n.p += prev * 12;
  };
  let g: ANote[] = [], min = Infinity, max = -Infinity;
  for (const n of out) {
    const last = g[g.length - 1];
    const [kLo, kHi] = fits(Math.min(min, n.p), Math.max(max, n.p));
    if (last && n.b - (last.b + last.d) < 1 - 1e-6 && kLo <= kHi) [min, max] = [Math.min(min, n.p), Math.max(max, n.p)];
    else {
      if (g.length) move(g, min, max);
      [g, min, max] = [[], n.p, n.p];
    }
    g.push(n);
  }
  move(g, min, max);
  return out;
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
    // el bajo y la quinta del acorde por encima (con el bajo en la quinta, la fundamental): «bajo + 7» solo vale sin
    // inversión; en Do/Mi daba Si, en Sol/Si Fa#, notas fuera del acorde
    else if (level === 2) out.push({ b, d, p: root, v }, { b, d, p: inRange(pcOf(c, root % 12 === pcOf(c, 2) ? 0 : 2), root + 1), v });
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

/** Notas del acorde por debajo de la melodía en la derecha. Nivel 4: una (a 3-9 semitonos) en los tiempos fuertes;
 * 6: una en cada pulso; 7: dos en cada pulso (acorde de tres dentro de la octava) y la octava de abajo en los fuertes. */
function harmonize(mel: ANote[], segs: Seg[], meter: number, start: number, level: Level = 4): ANote[] {
  const extra: ANote[] = [];
  const unit = level === 4 ? meter : 1, voices = level === 7 ? 2 : 1, maxGap = level === 7 ? 11 : 9;
  const on = (b: number, u: number) => Math.abs((((b - start) % u) + u) % u) < 1e-6;
  for (const n of mel) {
    if (!on(n.b, unit)) continue;
    const seg = segs.find((s) => s.b <= n.b + 1e-6 && n.b < s.e);
    if (!seg) continue;
    const tones = new Set(tonesOf(seg.c.kind).slice(0, 3).map((i) => (seg.c.root + i) % 12));
    let added = 0;
    for (let gap = 3; gap <= maxGap && added < voices; gap++) {
      if (tones.has((n.p - gap + 120) % 12)) (extra.push({ ...n, p: n.p - gap, v: n.v * 0.8 }), added++);
    }
    if (level === 7 && on(n.b, meter)) extra.push({ ...n, p: n.p - 12, v: n.v * 0.85 });
  }
  return [...mel, ...extra];
}

/** Niveles 6 y 7 si el piano original arpegia: el acorde arpegiado en semicorcheas. Izquierda: abierto desde el bajo
 * (fundamental, quinta, octava, décima; en el 7 hasta la doceava y con la octava grave en cada cambio). Derecha (sin
 * melodía): la tríada y su octava. Solo sube (y vuelve a empezar), salvo que el original también baje (`down`). */
function arpeggios(segs: Seg[], level: Level, hand: Hand, down = true): ANote[] {
  const out: ANote[] = [];
  const step = 0.25;
  let prev: number[] | null = null;
  for (const { b, e, c } of segs) {
    const root = inRange(c.bass ?? c.root, 36); // Do2…Si2
    let tones: number[];
    if (hand === "lh") {
      const third = inRange(pcOf(c, 1), root + 12), fifth = inRange(pcOf(c, 2), root + 1);
      tones = level === 7 ? [root, fifth, root + 12, third, fifth + 12] : [root, fifth, root + 12, third];
      if (level === 7 && root - 12 >= 24) out.push({ b, d: Math.min(1, e - b), p: root - 12, v: 0.7 });
    } else {
      const vo: number[] = (prev = voicing(c, 60, prev));
      tones = [...vo, vo[0] + 12, ...(level === 7 ? [vo[1] + 12] : [])];
    }
    const path = down ? [...tones, ...tones.slice(1, -1).reverse()] : tones; // sube y baja, o solo sube
    let i = 0;
    for (let x = b; x < e - 1e-6; x += step) out.push({ b: x, d: Math.min(step, e - x) * 0.95, p: path[i++ % path.length], v: 0.55 });
  }
  return out;
}

/** Niveles 6 y 7 si el piano original toca acordes (o no hay piano): acordes en bloque al ritmo con el que ataca el
 * piano (`on`, en pulsos), cuadrado a corcheas (6) o semicorcheas (7); donde no ataca, en corcheas. Izquierda: el bajo
 * en el primer golpe (en el 7, en octava si cambia) y el acorde cerrado en todos; sin `chords`, solo el bajo en cada
 * golpe. Derecha (sin melodía): la tríada (en el 7, con la octava de arriba). */
function blocks(segs: Seg[], level: Level, hand: Hand, on: number[], chords = true): ANote[] {
  const out: ANote[] = [];
  const g = level === 7 ? 0.25 : 0.5;
  let prev: number[] | null = null, last = -1;
  for (const { b, e, c } of segs) {
    const mine = on.filter((x) => x >= b - g / 2 && x < e - g / 2).map((x) => Math.round(x / g) * g);
    const xs = [...new Set([b, ...(mine.length ? mine : Array.from({ length: Math.round((e - b) / 0.5) }, (_, i) => b + i * 0.5))])].sort((x, y) => x - y);
    const root = inRange(c.bass ?? c.root, 36), change = root !== last; // Do2…Si2
    last = root;
    const vo: number[] = (prev = voicing(c, hand === "rh" ? 60 : 48, prev));
    xs.forEach((x, i) => {
      const bass = i === 0 ? (level === 7 && change ? [root - 12, root] : [root]) : chords ? [] : [root];
      const ps = hand === "rh" ? (level === 7 ? [...vo, vo[0] + 12] : vo) : [...bass, ...(chords ? vo : [])];
      for (const p of ps) out.push({ b: x, d: ((xs[i + 1] ?? e) - x) * 0.9, p, v: p < 48 ? 0.65 : 0.5 });
    });
  }
  return out;
}

/** Cómo toca el piano original, si es de verdad (`realPiano`); null si no. `arp`: casi todos los ataques son notas
 * sueltas una tras otra (arpegio; `down`, también bajando por grados del acorde); si no, acordes, que atacan en `on`
 * (pulsos con dos notas o más en 40 ms). */
function texture(piano: Note[], segs: Seg[], beats: number[]) {
  if (!realPiano(piano, segs, beats)) return null;
  const groups: Note[][] = [];
  for (const n of piano.filter(([s, e]) => e - s >= 0.06).sort((x, y) => x[0] - y[0])) {
    const g = groups[groups.length - 1];
    if (g && n[0] - g[0][0] <= 0.04) g.push(n);
    else groups.push([n]);
  }
  const single = groups.filter((g) => g.length === 1).map((g) => g[0][2]);
  const downs = single.filter((p, i) => i && single[i - 1] - p > 0 && single[i - 1] - p <= 7).length; // la vuelta a la raíz de un arpegio que solo sube salta más
  return { arp: single.length > 0.6 * groups.length, down: downs > 0.25 * single.length, on: groups.filter((g) => g.length > 1).map((g) => toBeat(beats, g[0][0])) };
}

/** Estilo pop, medido en las versiones de Pianella Piano (7 canciones transcritas con basic-pitch): la izquierda casi
 * nunca arpegia arriba y abajo; llena las corcheas con raíz y quinta en las estrofas, octavas en corcheas en los
 * estribillos y en semicorcheas en el clímax, la raíz grave en Do2…Si2 y apenas terceras; cuando cambia el acorde,
 * a menudo su raíz se adelanta al «y» del 4. Cada golpe: semicorchea del compás (0-15 en 4/4; lo que no cabe en el
 * compás, fuera) y sus notas: R raíz, O su octava, 5 quinta, T décima, C el acorde cerrado (Do3…Si3). */
const S8 = [0, 2, 4, 6, 8, 10, 12, 14];
const POP: Record<string, [number, string][]> = {
  nota: [[0, "R"]],
  mitades: [[0, "R"], [8, "5"]],
  octavas2: [[0, "RO"], [8, "RO"]],
  negras: [[0, "R"], [4, "5"], [8, "R"], [12, "5"]],
  octavas4: [[0, "RO"], [4, "RO"], [8, "RO"], [12, "RO"]],
  sincopa: [[0, "RO"], [6, "5"], [12, "RO"]], // 3+3+2
  sincopaC: [[0, "RO"], [6, "C"], [12, "RO"]],
  sincopaCC: [[0, "RO"], [6, "C"], [10, "C"], [12, "RO"]],
  vaiven: S8.map((s, i) => [s, i % 2 ? "5" : "R"]), // raíz-quinta en corcheas: la estrofa típica
  sube: S8.map((s, i) => [s, "R5O"[i % 3]]), // R 5 8 | R 5 8 | R 5: sube y vuelve a empezar, nunca baja
  sube10: S8.map((s, i) => [s, "R5T"[i % 3]]),
  octavas8: S8.map((s, i) => [s, i % 2 ? "O" : "RO"]), // octava en el pulso, la de arriba en el «y»
  octavas8F: S8.map((s) => [s, "RO"]),
  octavas16: Array.from({ length: 16 }, (_, s) => [s, s % 2 ? "O" : "R"]),
};
/** El patrón de cada nivel según la energía de la frase: tranquila, media, fuerte, clímax. */
const POP_LH: Partial<Record<Level, string[]>> = {
  2: ["nota", "mitades", "octavas2", "octavas2"],
  3: ["negras", "sincopa", "octavas4", "octavas4"],
  4: ["vaiven", "sincopaC", "octavas8", "octavas8"],
  6: ["sube", "sincopaC", "octavas8", "octavas8F"],
  7: ["sube10", "sincopaCC", "octavas8F", "octavas16"],
};
/** Final de frase sin cambio de acorde (nivel 4 y más): el último pulso sube hacia el 1 siguiente. */
const FILL: Record<string, [number, string][]> = { 4: [[12, "5"], [14, "O"]], 6: [[12, "R"], [13, "5"], [14, "O"], [15, "T"]] };

/** Energía de cada compás por frases de 4: 0 tranquila, 1 media, 2 fuerte, 3 clímax (las fuertes del último 40 %).
 * Sale de la línea de la melodía: cuánto suena y lo aguda que va (los estribillos van más llenos y más arriba); las
 * frases se reparten en tercios entre la más floja y la más fuerte. Sin línea, o con una sola frase, todo media. */
function popEnergy(notes: Note[] | null | undefined, beats: number[], meter: number, start: number): number[] {
  const ph: { d: number; pd: number }[] = [];
  for (const [s, e, p] of notes ?? []) {
    const b = toBeat(beats, s), d = toBeat(beats, e) - b, i = Math.floor((b - start) / meter / 4);
    if (i < 0 || d <= 0) continue;
    const x = (ph[i] ??= { d: 0, pd: 0 });
    [x.d, x.pd] = [x.d + d, x.pd + p * d];
  }
  const n = ph.length;
  if (n < 2) return [];
  const all = Array.from({ length: n }, (_, i) => ph[i] ?? { d: 0, pd: 0 });
  const mean = all.reduce((s, x) => s + x.pd, 0) / all.reduce((s, x) => s + x.d, 0);
  const score = all.map((x) => (x.d ? x.d / (4 * meter) + (x.pd / x.d - mean) / 12 : -Infinity));
  const live = score.filter((s) => s > -Infinity), lo = Math.min(...live), hi = Math.max(...live);
  return score.flatMap((s, i) => {
    const e = s === -Infinity ? 0 : hi - lo < 1e-9 ? 1 : Math.min(2, Math.floor((3 * (s - lo)) / (hi - lo)));
    return Array(4).fill(e === 2 && i >= 0.6 * n ? 3 : e);
  });
}

/** Estilo pop. Izquierda: la fundamental (1), y desde el 2 los patrones de POP_LH según la energía de cada frase, con la
 * raíz del acorde siguiente adelantada una corchea (3 y más) y una subida al final de frase (4 y más). Derecha sin
 * melodía: acordes en el ritmo 3+3+2 (golpes en el 1, el «y» del 2 y el 4; en otros compases, cada pulso) (1-3), en
 * corcheas seguidas (4 y más). */
function pop(segs: Seg[], level: Level, hand: Hand, meter: number, start: number, energy: number[] = []): ANote[] {
  const out: ANote[] = [];
  const PATTERN = meter === 4 ? [0, 1.5, 3] : Array.from({ length: meter }, (_, i) => i);
  const pats = POP_LH[level] ?? POP_LH[4]!;
  let prev: number[] | null = null;
  const tones = (code: string, c: Chord) => {
    const root = inRange(c.bass ?? c.root, 36); // Do2…Si2
    return [...code].flatMap((t) =>
      t === "R" ? [root] : t === "O" ? [root + 12] : t === "5" ? [inRange(pcOf(c, 2), root + 1)]
        : t === "T" ? [inRange(pcOf(c, 1), root + 13)] : (prev = voicing(c, 48, prev)).filter((p) => p < 60)); // por debajo del Do central: arriba va la derecha
  };
  const bassPc = (c: Chord) => (c.bass ?? c.root) % 12;
  segs.forEach(({ b, e, c }, si) => {
    const k = Math.floor((b - start) / meter + 1e-6), bar = start + k * meter;
    const hits = [b, ...PATTERN.map((x) => bar + x).filter((x) => x > b + 1e-6 && x < e - 1e-6)];
    const len = (i: number) => (hits[i + 1] ?? e) - hits[i];
    if (hand === "rh") {
      const vo: number[] = (prev = voicing(c, 60, prev));
      const top = level >= 6 ? [vo[0] + 12] : [];
      if (level <= 3) hits.forEach((x, i) => vo.forEach((p) => out.push({ b: x, d: len(i) * 0.9, p, v: 0.55 })));
      else for (let x = b; x < e - 1e-6; x += 0.5) {
        const accent = hits.some((h) => Math.abs(h - x) < 1e-6);
        for (const p of [...vo, ...(accent ? top : [])]) out.push({ b: x, d: Math.min(0.5, e - x) * 0.85, p, v: accent ? 0.62 : 0.45 });
      }
      return;
    }
    if (level === 1) {
      const root = inRange(c.bass ?? c.root, 36);
      out.push({ b, d: e - b, p: root + 12 <= 52 ? root + 12 : root, v: 0.65 });
      return;
    }
    const en = energy[k] ?? 1;
    const at = (pat: [number, string][]) => pat.map(([s, t]) => [bar + s / 4, t] as [number, string]);
    let g = at(POP[pats[en]]).filter(([x]) => x > b - 1e-6 && x < e - 1e-6 && x < bar + meter - 1e-6);
    if (!g.length || g[0][0] > b + 1e-6) g.unshift([b, en >= 2 ? "RO" : "R"]);
    const next = segs[si + 1];
    const change = next && Math.abs(next.b - e) < 1e-6 && bassPc(next.c) !== bassPc(c);
    let ant: [number, string] | null = null;
    if (level >= 3 && change && e - b >= 1) {
      // la raíz del acorde siguiente, adelantada al último «y» (se vuelve a tocar en su 1)
      g = g.filter(([x]) => x < e - 0.5 - 1e-6);
      ant = [e - 0.5, en >= 2 ? "RO" : "R"];
    } else if (level >= 4 && meter === 4 && k % 4 === 3 && Math.abs(e - bar - meter) < 1e-6 && e - b >= 2) {
      g = [...g.filter(([x]) => x < bar + 3 - 1e-6), ...at(FILL[level >= 6 ? 6 : 4])];
    }
    const v = 0.6 + 0.04 * en;
    const all: [number, string, Chord][] = [...g.map(([x, t]) => [x, t, c] as [number, string, Chord]), ...(ant ? [[...ant, next.c] as [number, string, Chord]] : [])];
    all.forEach(([x, code, cc], i) => {
      const d = ((all[i + 1]?.[0] ?? e) - x) * 0.95;
      for (const p of tones(code, cc)) out.push({ b: x, d, p, v: p < 48 ? v + 0.05 : v - 0.1 });
    });
  });
  return out;
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
  style?: "clasico" | "pop"; // cómo acompaña: bajo-acorde clásico (en el 6 y el 7, con la textura del original), o el ritmo y las octavas del pop
  activity?: number[]; // cuánto suenan las pistas del acompañamiento en cada pulso (0-1); la izquierda calla o se aligera donde no
}): Arrangement {
  const { beats, level } = o;
  const meter = o.meter && o.meter >= 2 && o.meter <= 7 ? o.meter : 4;
  // el compás empieza en el primer «1» detectado; lo de antes, anacrusa
  const first = o.downbeats?.length ? Math.round(toBeat(beats, o.downbeats[0])) : 0;
  const start = first - Math.ceil(first / meter) * meter;
  const segs = segments(o.chords, beats, meter, start, level <= 2 ? 1 : 0.5);
  let rh: ANote[];
  let lh: ANote[];
  // 6 y 7 clásicos: con la textura del piano original; arpegios solo si el original arpegia
  const tex = level >= 6 && o.style !== "pop" ? texture(o.piano ?? [], segs, beats) : null;
  const classic = (hand: Hand) => (tex?.arp ? arpeggios(segs, level, hand, tex.down) : blocks(segs, level, hand, tex?.on ?? []));
  if (o.melody) {
    rh = fold(melodyLine(o.melody, beats, GRID[level]), level === 7 ? 64 : 60, level === 1 ? 84 : level >= 6 ? 100 : 96);
    if (level === 4 || level >= 6) rh = harmonize(rh, segs, meter, start, level);
    lh = level === 5 ? transcribedLeft(o.piano ?? [], o.bass ?? [], segs, beats)
      : o.style === "pop" ? pop(segs, level, "lh", meter, start, popEnergy(o.melody, beats, meter, start))
      : level >= 6 ? classic("lh") : accompaniment(segs, level, "lh");
  } else {
    // solo acompañamiento: la derecha, los acordes; la izquierda, el bajo, cada vez más cerca del de la canción
    if (o.style === "pop" && level !== 5) [rh, lh] = [pop(segs, level, "rh", meter, start), pop(segs, level, "lh", meter, start, popEnergy(o.piano ?? o.bass, beats, meter, start))];
    else {
      rh = level >= 6 ? classic("rh") : accompaniment(segs, level, "rh");
      lh = level >= 6 ? (tex?.arp ? arpeggios(segs, 6, "lh", tex.down).filter((n) => n.p < 52) : blocks(segs, level, "lh", tex?.on ?? [], false)) : level <= 2 ? accompaniment(segs, 1, "lh") : level === 3 ? accompaniment(segs, 2, "lh") : level === 4 ? bassOnBeats(segs) : transcribedLeft(o.piano ?? [], o.bass ?? [], segs, beats);
    }
  }
  // la izquierda sigue al acompañamiento elegido: calla donde no suena, ligera (la del 1 o el 2) donde suena poco; sin
  // melodía, la derecha igual (acordes largos). El 5 es el original: no se toca
  if (o.activity?.length && level !== 5) {
    const st = activityBars(o.activity, meter, start), lite = level <= 2 ? 1 : 2;
    lh = gate(lh, o.style === "pop" ? pop(segs, lite, "lh", meter, start) : accompaniment(segs, lite, "lh"), st, meter, start);
    if (!o.melody) rh = gate(rh, accompaniment(segs, 1, "rh"), st, meter, start);
  }
  const t = o.transpose ?? 0;
  const shift = (ns: ANote[]) => ns.map((n) => ({ ...n, p: n.p + t }));
  return { rh: shift(rh), lh: shift(lh), key: { tonic: (o.key.tonic + t + 12) % 12, minor: o.key.minor }, transpose: t, meter, start };
}

/** Nivel 5, izquierda: solo lo que suena de verdad, nada inventado. Lo que toca el «piano» (las pistas elegidas) por
 * debajo del Do central si es de verdad (suena en al menos el 40 % de la canción: muchas pistas son restos que el
 * separador dejó ahí); si no, la línea real del bajo (una voz, en registro de izquierda); sin nada, calla. */
function transcribedLeft(piano: Note[], bass: Note[], segs: Seg[], beats: number[]): ANote[] {
  return realPiano(piano, segs, beats) ?? realBass(bass, beats) ?? [];
}

/** Cuantil `q` (0-1) de `xs`. */
export const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(q * (s.length - 1))] : 0;
};

/** Cómo suena el acompañamiento en cada compás: 0 calla, 1 poco, 2 lleno. Respecto a lo que suele sonar en esta canción
 * (el 90 % de sus compases; al menos 0,2, que si todo es flojo, flojo se queda): por debajo del 15 % calla; por debajo
 * de la mitad, poco, con la media de los compases de al lado (1-2-1) para que no cambie a cada compás. */
function activityBars(act: number[], meter: number, start: number) {
  const raw: number[] = [];
  for (let b0 = start; b0 < act.length; b0 += meter) {
    const xs = act.slice(Math.max(0, b0), b0 + meter);
    raw.push(xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  }
  const ref = Math.max(quantile(raw, 0.9), 0.2);
  return raw.map((x, i) => (x / ref < 0.15 ? 0 : ((raw[i - 1] ?? x) + 2 * x + (raw[i + 1] ?? x)) / 4 / ref < 0.5 ? 1 : 2));
}

/** `full` en los compases llenos, `light` en los de poco, nada en los que callan (fuera de `st`, lleno). */
function gate(full: ANote[], light: ANote[], st: number[], meter: number, start: number) {
  const at = (n: ANote) => st[Math.floor((n.b - start) / meter + 1e-6)] ?? 2;
  return [...full.filter((n) => at(n) === 2), ...light.filter((n) => at(n) === 1)];
}

/** Lo que toca el piano por debajo del Do central, si es piano de verdad (suena en al menos el 40 % de la canción); null si no. */
function realPiano(piano: Note[], segs: Seg[], beats: number[]): ANote[] | null {
  const low = piano.filter(([s, e, p]) => p < 60 && e - s >= 0.06).map(([s, e, p, v]) => ({ b: toBeat(beats, s), d: toBeat(beats, e) - toBeat(beats, s), p, v }));
  const span = segs.reduce((n, x) => n + x.e - x.b, 0);
  return span && covered(low) / span >= 0.4 ? low : null;
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
export type Target = { t: number; e?: number; p: number; v?: number; hand: Hand; hit: boolean; skipped?: boolean; err?: number; vel?: number; counted?: boolean }; // counted: ya apuntada en las zonas (zones.ts)
/** Diferencia de fuerza a partir de la que se avisa (en 0-1; unas 30 de 127). */
export const VEL_TOL = 0.25;

/** Cómo de a tiempo: ±35 ms «a tiempo», ±75 «casi»; más allá, adelantado (err < 0) o atrasado. `err` en segundos. */
export type Timing = "ontime" | "near" | "early" | "late";
export const judge = (err: number): Timing => (Math.abs(err) <= 0.035 ? "ontime" : Math.abs(err) <= 0.075 ? "near" : err < 0 ? "early" : "late");
/** Mediana (para calibrar la latencia: aguanta algún toque despistado). */
export const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s[s.length >> 1] + s[(s.length - 1) >> 1]) / 2 : 0;
};

/** Lo que hay que tocar y lo que se va tocando. `tol`: segundos de margen antes y después de cada nota. */
export class Practice {
  targets: Target[];
  wrong = 0;
  tol: number;
  constructor(notes: { t: number; e?: number; p: number; v?: number; hand: Hand }[], tol = 0.2) {
    this.tol = tol;
    this.targets = notes.map((n) => ({ ...n, hit: false })).sort((a, b) => a.t - b.t);
  }
  /** Una tecla pulsada en `now` (con fuerza `vel`, si se sabe): acierta la nota pendiente más cercana de esa altura
   * dentro del margen. En modo espera, además, las del grupo en el que se ha parado aunque haya pasado el margen.
   * Devuelve la nota acertada (para ver su fuerza) o null. */
  press(p: number, now: number, waitingAt: number | null = null, vel?: number): Target | null {
    // vale si esa nota toca ahora (o es la que se espera), la hubiera tocado ya o no: se prefiere la pendiente más cercana
    let best: Target | null = null;
    const rank = (x: Target) => (x.hit ? 1000 : 0) + Math.abs(x.t - now);
    for (const x of this.targets) {
      if (x.p !== p) continue;
      const sounding = x.e != null && x.t <= now && now < x.e; // mientras dura también vale (volver a pulsarla)
      const ok = Math.abs(x.t - now) <= this.tol || sounding || (waitingAt != null && Math.abs(x.t - waitingAt) < 0.03);
      if (ok && (!best || rank(x) < rank(best))) best = x;
      if (x.t > now + this.tol) break;
    }
    if (!best) {
      this.wrong++;
      return null;
    }
    if (best.hit) return best; // repetida: bien, sin volver a contarla
    best.hit = true;
    best.skipped = false;
    best.err = Math.abs(now - best.t) <= this.tol ? now - best.t : undefined; // a destiempo solo cuenta en su margen
    best.vel = vel;
    return best;
  }
  /** Modo espera: el instante del primer grupo de notas sin tocar que ya debería haber sonado (para pararse ahí). */
  blocking(now: number) {
    // solo lo de ahora: lo que quedó atrás sin tocar (pasó sin espera) no hace volver
    const x = this.targets.find((x) => !x.hit && !x.skipped && x.t >= now - 1);
    return x && x.t <= now ? x.t : null;
  }
  /** Con espera, la música solo sigue mientras se mantiene lo que suena: ¿hay alguna nota tocada que debería seguir
   * pulsada en `now` y no lo está? Al final de cada nota hay margen para soltar (legato, notas repetidas). */
  released(now: number, held: (p: number) => boolean) {
    for (const x of this.targets) {
      if (x.t > now) break;
      if (!x.hit || x.skipped || x.e == null) continue;
      const grace = Math.min(0.25, (x.e - x.t) * 0.4);
      if (now < x.e - grace && !held(x.p)) return true;
    }
    return false;
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
    const errs = hits.filter((x) => x.err != null).map((x) => x.err!);
    // fuerza: lo que se tocó menos lo que pedía, de media (+ más fuerte), y cuántas se pasaron del margen
    const mean = errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0;
    const sd = errs.length ? Math.sqrt(errs.reduce((a, b) => a + (b - mean) ** 2, 0) / errs.length) : 0;
    const dyn = hits.filter((x) => x.vel != null && x.v != null).map((x) => x.vel! - x.v!);
    return {
      due: due.length,
      hits: hits.length,
      wrong: this.wrong,
      ms: Math.round(1000 * mean), // sesgo (calibración)
      sd: Math.round(1000 * sd), // dispersión (lo que se mejora)
      force: dyn.length ? Math.round((127 * dyn.reduce((a, b) => a + b, 0)) / dyn.length) : null,
      offForce: dyn.filter((d) => Math.abs(d) > VEL_TOL).length,
    };
  }
}
