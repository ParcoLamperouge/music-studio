/** Ejercicios de piano por niveles (orientativos: cualquiera se puede abrir), generados a partir de la teoría básica: sin
 * fuentes externas ni bloqueos. Cada uno sale como pieza (piece.ts) en la tonalidad y con las manos que se elijan, y se
 * practica en Aprender como cualquier otra (espera, tempo, bucle, zonas difíciles). */

import type { Hand } from "./arrange.ts";
import { keyName, type Key } from "./harmony.ts";
import type { Piece, PNote } from "./piece.ts";

export type Hands = "rh" | "lh" | "both";
export type ExLevel = 1 | 2 | 3 | 4;
export const EX_LEVELS: [ExLevel, string][] = [[1, "Inicial"], [2, "Básico"], [3, "Intermedio"], [4, "Avanzado"]];
export type Exercise = {
  id: string;
  level: ExLevel;
  concept: string;
  title: string;
  /** Qué es y cómo tocarlo, en dos o tres frases. */
  about: string;
  /** Si depende de la tonalidad elegida (y de si es mayor o menor). */
  keyed: boolean;
  /** Si se puede tocar con una mano sola; si no, siempre juntas. */
  oneHand: boolean;
  bpm: number;
  make: (k: Key, hands: Hands) => PNote[];
};

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const NATURAL = [0, 2, 3, 5, 7, 8, 10];
const HARMONIC = [0, 2, 3, 5, 7, 8, 11];
const MELODIC = [0, 2, 3, 5, 7, 9, 11]; // al subir; al bajar, la natural
const scaleOf = (k: Key) => (k.minor ? NATURAL : MAJOR);

/** Tónica de la mano derecha (Do4…Si4) y de la izquierda, una octava por debajo. */
const home = (k: Key, hand: Hand) => 60 + k.tonic - (hand === "lh" ? 12 : 0);
/** El grado `deg` (0 = tónica; puede pasar de 7 o ser negativo) de una escala desde `base`. */
const degree = (sc: number[], base: number, deg: number) => base + sc[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);

/** Una línea (alturas, todas con la misma duración `d`) para las manos pedidas; con las dos, la izquierda una octava
 * por debajo. Opcionalmente cada mano con su propia línea (`lh`). */
function line(ps: number[], d: number, hands: Hands, lh?: number[]): PNote[] {
  const out: PNote[] = [];
  const add = (seq: number[], hand: Hand, shift: number) => seq.forEach((p, i) => out.push({ b: i * d, d, p: p + shift, v: 0.7, hand }));
  if (hands !== "lh") add(ps, "rh", 0);
  if (hands !== "rh") add(lh ?? ps, "lh", lh ? 0 : -12);
  return out;
}

/** Bloques (acordes) seguidos, cada uno de `d` pulsos, en la mano `hand`. */
function blocks(chords: number[][], d: number, hand: Hand, v = 0.65): PNote[] {
  return chords.flatMap((ps, i) => ps.map((p) => ({ b: i * d, d, p, v, hand })));
}

/** Escala subiendo y bajando `oct` octavas desde la tónica (en menor melódica, natural al bajar). */
function scaleLine(k: Key, oct: number, base: number, up = scaleOf(k), down = up) {
  const ups = Array.from({ length: 7 * oct + 1 }, (_, i) => degree(up, base, i));
  const downs = Array.from({ length: 7 * oct }, (_, i) => degree(down, base, 7 * oct - 1 - i));
  return [...ups, ...downs];
}

/** Tríada del grado `deg` de la escala (posición fundamental) sobre `base`. */
const triad = (sc: number[], base: number, deg: number) => [0, 2, 4].map((i) => degree(sc, base, deg + i));
const seventh = (sc: number[], base: number, deg: number) => [0, 2, 4, 6].map((i) => degree(sc, base, deg + i));

/** Una tríada en inversión `inv` (0 fundamental, 1 primera, 2 segunda). */
const invert = (ch: number[], inv: number) => [...ch.slice(inv), ...ch.slice(0, inv).map((p) => p + 12)];

/** Enlace de voces: cada acorde en la inversión que menos se mueve desde el anterior. */
function voiceLead(chords: number[][]) {
  const out: number[][] = [];
  for (const ch of chords) {
    const prev = out[out.length - 1];
    if (!prev) {
      out.push(ch);
      continue;
    }
    const options = [0, 1, 2].flatMap((inv) => [-12, 0, 12].map((o) => invert(ch, inv).map((p) => p + o)));
    const cost = (c: number[]) => c.reduce((s, p, i) => s + Math.abs(p - prev[i]), 0);
    out.push(options.sort((a, b) => cost(a) - cost(b))[0]);
  }
  return out;
}

export const EXERCISES: Exercise[] = [
  // ---------------------------------------------------------------- 1 · Inicial
  {
    id: "cinco-dedos", level: 1, concept: "Posición", title: "Cinco dedos", keyed: true, oneHand: true, bpm: 70,
    about: "Cada dedo sobre una tecla: las cinco primeras notas de la escala (pulgar en la tónica con la derecha, meñique con la izquierda). Subir y bajar despacio, que todas suenen igual de fuertes.",
    make: (k, h) => {
      const go = (hand: Hand) => [0, 1, 2, 3, 4, 3, 2, 1, 0].map((i) => degree(scaleOf(k), home(k, hand), i));
      return line(go("rh"), 1, h, h === "both" ? go("lh") : undefined);
    },
  },
  {
    id: "cinco-dedos-ritmo", level: 1, concept: "Ritmo", title: "Negras, blancas y redondas", keyed: true, oneHand: true, bpm: 70,
    about: "Las cinco notas con figuras distintas: la negra dura un pulso, la blanca dos y la redonda cuatro. Cuenta en voz alta «1, 2, 3, 4» y suelta la tecla justo al acabar cada figura.",
    make: (k, h) => {
      const seq: [number, number][] = [[0, 1], [1, 1], [2, 2], [3, 1], [4, 1], [3, 2], [2, 1], [1, 1], [0, 2], [4, 4]];
      const out: PNote[] = [];
      for (const hand of (h === "both" ? ["rh", "lh"] : [h]) as Hand[]) {
        let b = 0;
        for (const [deg, d] of seq) (out.push({ b, d, p: degree(scaleOf(k), home(k, hand), deg), v: 0.7, hand }), (b += d));
      }
      return out;
    },
  },
  {
    id: "acordes-I-IV-V", level: 1, concept: "Acordes", title: "Los tres acordes principales (I, IV, V)", keyed: true, oneHand: true, bpm: 60,
    about: "Con tres acordes se acompañan miles de canciones: el de la tónica (I), el de la subdominante (IV) y el de la dominante (V). Cada uno se forma con notas alternas de la escala: 1-3-5.",
    make: (k, h) => {
      const hand: Hand = h === "lh" ? "lh" : "rh";
      const chords = [0, 3, 4, 0].map((d) => triad(scaleOf(k), home(k, hand), d));
      const out = blocks(chords, 2, hand);
      if (h === "both") out.push(...[0, 3, 4, 0].map((d, i) => ({ b: i * 2, d: 2, p: degree(scaleOf(k), home(k, "lh") - 12, d), v: 0.65, hand: "lh" as Hand })));
      return out;
    },
  },
  {
    id: "escala-una-octava-do", level: 1, concept: "Escalas", title: "Primera escala: una octava", keyed: true, oneHand: true, bpm: 60,
    about: "Ocho notas seguidas de tónica a tónica. Con la derecha, el pulgar pasa por debajo después del tercer dedo para seguir subiendo; con la izquierda, el tercer dedo cruza por encima del pulgar.",
    make: (k, h) => line(scaleLine(k, 1, home(k, "rh")), 1, h),
  },

  // ---------------------------------------------------------------- 2 · Básico
  {
    id: "escala-menor", level: 2, concept: "Escalas", title: "Escala menor natural, armónica y melódica", keyed: true, oneHand: true, bpm: 70,
    about: "Tres versiones de la escala menor seguidas: la natural, la armónica (séptimo grado subido: la que da el acorde mayor de dominante) y la melódica (sexto y séptimo subidos al subir, natural al bajar).",
    make: (k, h) => {
      const base = home({ ...k, minor: true }, "rh");
      const ps = [...scaleLine(k, 1, base, NATURAL), ...scaleLine(k, 1, base, HARMONIC), ...scaleLine(k, 1, base, MELODIC, NATURAL)];
      return line(ps, 0.5, h);
    },
  },
  {
    id: "triadas-tonalidad", level: 2, concept: "Acordes", title: "Las siete tríadas de la tonalidad", keyed: true, oneHand: true, bpm: 70,
    about: "Sobre cada nota de la escala hay un acorde con sus notas: en mayor salen I, ii, iii, IV, V, vi y vii° (mayúscula mayor, minúscula menor, ° disminuido). Escucha cómo cambia el color de cada uno.",
    make: (k, h) => {
      const hand: Hand = h === "lh" ? "lh" : "rh";
      return blocks([0, 1, 2, 3, 4, 5, 6, 7].map((d) => triad(scaleOf(k), home(k, hand), d)), 2, hand);
    },
  },
  {
    id: "arpegio-una-octava", level: 2, concept: "Arpegios", title: "Arpegio de la tónica, una octava", keyed: true, oneHand: true, bpm: 70,
    about: "Las notas del acorde una a una (1-3-5-8) subiendo y bajando. Con la derecha 1-2-3-5; con la izquierda 5-4-2-1. Mano relajada, sin saltar.",
    make: (k, h) => {
      const sc = scaleOf(k);
      const ps = [0, 2, 4, 7, 4, 2, 0].map((d) => degree(sc, home(k, "rh"), d));
      return line([...ps, ...ps], 0.5, h);
    },
  },
  {
    id: "progresion-I-IV-V-I", level: 2, concept: "Progresiones", title: "I–IV–V–I: bajo y acorde", keyed: true, oneHand: false, bpm: 70,
    about: "La progresión más común. La izquierda toca la nota que da nombre al acorde (el bajo) y la derecha el acorde en bloque. Así se acompaña una canción a partir de su cifrado.",
    make: (k) => {
      const sc = scaleOf(k);
      const degs = [0, 3, 4, 0];
      return [...blocks(degs.map((d) => triad(sc, home(k, "rh"), d)), 4, "rh"), ...blocks(degs.map((d) => [degree(sc, home(k, "lh") - 12, d)]), 4, "lh", 0.7)];
    },
  },
  {
    id: "corcheas", level: 2, concept: "Ritmo", title: "Corcheas: dos por pulso", keyed: true, oneHand: true, bpm: 80,
    about: "Dos notas iguales en cada pulso: cuenta «1 y 2 y 3 y 4 y». Primero sobre una nota repetida, luego subiendo por la escala. Que el «y» caiga exactamente a mitad del pulso.",
    make: (k, h) => {
      const sc = scaleOf(k), base = home(k, "rh");
      const ps = [...Array(8).fill(base), ...[0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 3, 3, 2, 2, 1, 1].map((d) => degree(sc, base, d))];
      return line(ps, 0.5, h);
    },
  },

  // ---------------------------------------------------------------- 3 · Intermedio
  {
    id: "inversiones", level: 3, concept: "Acordes", title: "Inversiones de la tríada", keyed: true, oneHand: true, bpm: 70,
    about: "Las mismas tres notas en otro orden: fundamental (1-3-5), primera inversión (3-5-1) y segunda (5-1-3). Sirven para pasar de un acorde a otro sin saltar, y cada una suena distinta.",
    make: (k, h) => {
      const hand: Hand = h === "lh" ? "lh" : "rh";
      const t = triad(scaleOf(k), home(k, hand), 0);
      const up = [0, 1, 2, 3].map((i) => (i === 3 ? t.map((p) => p + 12) : invert(t, i)));
      return blocks([...up, ...up.slice(0, 3).reverse()], 1, hand);
    },
  },
  {
    id: "progresion-enlazada", level: 3, concept: "Progresiones", title: "I–vi–IV–V con buen enlace de voces", keyed: true, oneHand: false, bpm: 80,
    about: "Cada acorde en la inversión que menos mueve los dedos desde el anterior: las notas comunes se quedan quietas y el resto se mueve lo mínimo. La izquierda hace el bajo.",
    make: (k) => {
      const sc = scaleOf(k);
      const degs = [0, 5, 3, 4, 0, 5, 3, 4, 0];
      return [...blocks(voiceLead(degs.map((d) => triad(sc, home(k, "rh"), d))), 2, "rh"), ...blocks(degs.map((d) => [degree(sc, home(k, "lh") - 12, d)]), 2, "lh", 0.7)];
    },
  },
  {
    id: "cadencias", level: 3, concept: "Progresiones", title: "Cadencias: auténtica, plagal y rota", keyed: true, oneHand: false, bpm: 70,
    about: "Cómo acaban las frases. Auténtica V–I: cierre firme. Plagal IV–I: el «amén». Rota V–vi: la dominante promete casa y da otra cosa. Escucha la diferencia de cada final.",
    make: (k) => {
      const sc = scaleOf(k);
      const degs = [4, 0, 3, 0, 4, 5];
      return [...blocks(voiceLead(degs.map((d) => triad(sc, home(k, "rh"), d))), 2, "rh"), ...blocks(degs.map((d) => [degree(sc, home(k, "lh") - 12, d)]), 2, "lh", 0.7)];
    },
  },
  {
    id: "escala-dos-octavas", level: 3, concept: "Escalas", title: "Escala de dos octavas, manos juntas", keyed: true, oneHand: true, bpm: 80,
    about: "Las dos manos a la vez, una octava de distancia, en corcheas. Los pasos del pulgar no coinciden entre manos: es lo que hay que coordinar. Empieza lento con la espera puesta.",
    make: (k, h) => line(scaleLine(k, 2, home(k, "rh")), 0.5, h),
  },
  {
    id: "arpegio-dos-octavas", level: 3, concept: "Arpegios", title: "Arpegio de dos octavas", keyed: true, oneHand: true, bpm: 80,
    about: "El arpegio sigue subiendo pasando el pulgar por debajo (derecha) o el tercer dedo por encima (izquierda), igual que en la escala pero con saltos más grandes.",
    make: (k, h) => {
      const sc = scaleOf(k);
      const up = [0, 2, 4, 7, 9, 11, 14].map((d) => degree(sc, home(k, "rh"), d));
      return line([...up, ...up.slice(0, -1).reverse()], 0.5, h);
    },
  },
  {
    id: "alberti", level: 3, concept: "Independencia", title: "Bajo Alberti y melodía", keyed: true, oneHand: false, bpm: 80,
    about: "La izquierda reparte el acorde en grave-agudo-medio-agudo (bajo Alberti, típico del clasicismo) en corcheas, mientras la derecha toca notas largas. Las manos llevan ritmos distintos.",
    make: (k) => {
      const sc = scaleOf(k);
      const degs = [0, 3, 4, 0];
      const lh: PNote[] = [];
      degs.forEach((d, bar) => {
        const t = triad(sc, home(k, "lh"), d);
        [t[0], t[2], t[1], t[2], t[0], t[2], t[1], t[2]].forEach((p, i) => lh.push({ b: bar * 4 + i * 0.5, d: 0.5, p, v: 0.55, hand: "lh" }));
      });
      const mel = [[4, 2], [2, 2], [5, 2], [3, 2], [4, 1], [3, 1], [1, 2], [2, 4]] as [number, number][];
      let b = 0;
      const rh = mel.map(([deg, d]) => {
        const n: PNote = { b, d, p: degree(sc, home(k, "rh"), deg), v: 0.75, hand: "rh" };
        b += d;
        return n;
      });
      return [...rh, ...lh];
    },
  },

  // ---------------------------------------------------------------- 4 · Avanzado
  {
    id: "septimas", level: 4, concept: "Acordes", title: "Acordes de séptima de la tonalidad", keyed: true, oneHand: true, bpm: 70,
    about: "Añadiendo otra tercera a cada tríada salen los de séptima: en mayor Imaj7, ii7, iii7, IVmaj7, V7, vi7 y viiø7. Son el color del jazz y de mucho pop.",
    make: (k, h) => {
      const hand: Hand = h === "lh" ? "lh" : "rh";
      return blocks([0, 1, 2, 3, 4, 5, 6, 7].map((d) => seventh(scaleOf(k), home(k, hand), d)), 2, hand);
    },
  },
  {
    id: "ii-V-I", level: 4, concept: "Progresiones", title: "ii–V–I con séptimas", keyed: true, oneHand: false, bpm: 80,
    about: "La progresión del jazz. La izquierda hace el bajo y la derecha los acordes de séptima sin la fundamental, enlazados: casi solo se mueve una nota cada vez (la séptima baja a la tercera del siguiente).",
    make: (k) => {
      const sc = scaleOf(k);
      const degs = [1, 4, 0, 0];
      const rh = voiceLead(degs.map((d) => seventh(sc, home(k, "rh"), d).slice(1)));
      return [...blocks(rh, 2, "rh"), ...blocks(degs.map((d) => [degree(sc, home(k, "lh") - 12, d)]), 2, "lh", 0.7)];
    },
  },
  {
    id: "escala-cuatro-octavas", level: 4, concept: "Escalas", title: "Escala de cuatro octavas en semicorcheas", keyed: true, oneHand: true, bpm: 80,
    about: "Cuatro notas por pulso, de punta a punta del teclado. La velocidad sale de la regularidad: mejor lento y parejo que rápido y desigual. Sube el tempo poco a poco.",
    make: (k, h) => line(scaleLine(k, 4, home(k, "rh") - 12), 0.25, h),
  },
  {
    id: "cromatica", level: 4, concept: "Escalas", title: "Escala cromática", keyed: false, oneHand: true, bpm: 80,
    about: "Todas las teclas, blancas y negras, de semitono en semitono. Dedos: el 3 en las negras y el pulgar en las blancas (el 2 entre Mi-Fa y Si-Do).",
    make: (_k, h) => {
      const up = Array.from({ length: 25 }, (_, i) => 60 + i);
      return line([...up, ...up.slice(0, -1).reverse()], 0.25, h);
    },
  },
  {
    id: "disminuido", level: 4, concept: "Arpegios", title: "Arpegio de séptima disminuida", keyed: true, oneHand: true, bpm: 80,
    about: "Terceras menores apiladas (cada nota a tres semitonos de la anterior): divide la octava en cuatro partes iguales. Se forma sobre la sensible y empuja con fuerza hacia la tónica.",
    make: (k, h) => {
      const base = home(k, "rh") - 1; // la sensible
      const up = Array.from({ length: 9 }, (_, i) => base + 3 * i);
      return line([...up, ...up.slice(0, -1).reverse(), home(k, "rh")], 0.5, h);
    },
  },
  {
    id: "tres-contra-dos", level: 4, concept: "Independencia", title: "Tres contra dos (polirritmia)", keyed: true, oneHand: false, bpm: 60,
    about: "En cada pulso la derecha toca tres notas iguales (tresillo) y la izquierda dos (corcheas). Coinciden solo en el pulso. Truco para contarlo: «na-ra-nja-fres-ca» al ritmo de las dos manos juntas.",
    make: (k) => {
      const sc = scaleOf(k);
      const rh: PNote[] = [], lh: PNote[] = [];
      for (let beat = 0; beat < 8; beat++) {
        const t = triad(sc, home(k, "rh"), beat < 4 ? 0 : 4);
        for (let i = 0; i < 3; i++) rh.push({ b: beat + i / 3, d: 1 / 3, p: t[i], v: 0.65, hand: "rh" });
        const bass = degree(sc, home(k, "lh") - 12, beat < 4 ? 0 : 4);
        for (let i = 0; i < 2; i++) lh.push({ b: beat + i / 2, d: 0.5, p: bass + 12 * i, v: 0.6, hand: "lh" });
      }
      return [...rh, ...lh];
    },
  },
];

/** El ejercicio como pieza que se practica en Aprender (con un id fijo: así sus zonas difíciles se recuerdan). */
export function exercisePiece(ex: Exercise, k: Key, hands: Hands, latin = true): Piece & { exercise: true } {
  const h: Hands = ex.oneHand ? hands : "both";
  const notes = ex.make(k, h).sort((a, b) => a.b - b.b || a.p - b.p);
  const where = ex.keyed ? ` · ${keyName(k, latin)}` : "";
  const who = h === "both" ? "manos juntas" : h === "rh" ? "derecha" : "izquierda";
  return {
    id: `ex-${ex.id}-${ex.keyed ? `${k.tonic}${k.minor ? "m" : ""}` : "x"}-${h}`,
    title: `${ex.title}${where} · ${who}`,
    bpm: ex.bpm,
    meter: 4,
    key: ex.keyed ? k : undefined,
    notes,
    exercise: true,
  };
}
