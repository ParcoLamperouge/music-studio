/** Canciones de inicio del curso: melodías populares de dominio público, escritas a mano en una notación corta. Cada
 * nota es «NotaOctava[:negras]» (Do4 = el Do central; «#» y «b» detrás de la letra), un silencio «-:negras» y un
 * acorde varias notas unidas con «+» («Do3+Mi3+Sol3:4»); «|» separa compases y no cuenta. Sin duración, una negra. */

import type { Hand } from "./arrange.ts";
import type { Key } from "./harmony.ts";
import type { Piece, PNote } from "./piece.ts";

const STEPS: Record<string, number> = { Do: 0, Re: 2, Mi: 4, Fa: 5, Sol: 7, La: 9, Si: 11 };

/** «Sol#4» → 68. */
export function midiOf(name: string): number {
  const m = name.match(/^(Do|Re|Mi|Fa|Sol|La|Si)(#|b)?(-?\d)$/);
  if (!m) throw new Error(`nota que no se entiende: «${name}»`);
  return 12 * (+m[3] + 1) + STEPS[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0);
}

/** Una línea de la notación como notas de una mano. */
export function parseLine(src: string, hand: Hand, v = 0.7): PNote[] {
  const out: PNote[] = [];
  let b = 0;
  for (const tok of src.split(/\s+/).filter((t) => t && t !== "|")) {
    const [notes, dur] = tok.split(":");
    const d = dur ? +dur : 1;
    if (!(d > 0)) throw new Error(`duración que no se entiende: «${tok}»`);
    if (notes !== "-") for (const n of notes.split("+")) out.push({ b, d, p: midiOf(n), v, hand });
    b += d;
  }
  return out;
}

export type Song = { id: string; title: string; about: string; bpm: number; meter: number; key: Key; rh: string; lh?: string };

const C: Key = { tonic: 0, minor: false };
const G: Key = { tonic: 7, minor: false };

export const SONGS: Song[] = [
  {
    id: "panecillos", title: "Panecillos calientes (Hot Cross Buns)", key: C, bpm: 80, meter: 4,
    about: "Tres notas: Mi, Re y Do con los dedos 3, 2 y 1 de la derecha. La canción más sencilla para empezar.",
    rh: "Mi4 Re4 Do4:2 | Mi4 Re4 Do4:2 | Do4:0.5 Do4:0.5 Do4:0.5 Do4:0.5 Re4:0.5 Re4:0.5 Re4:0.5 Re4:0.5 | Mi4 Re4 Do4:2",
  },
  {
    id: "maria", title: "María tenía un corderito", key: C, bpm: 90, meter: 4,
    about: "Cuatro notas (Do, Re, Mi, Sol) con la mano en posición de Do. Fíjate en las notas repetidas: misma tecla, sin levantar la mano.",
    rh: "Mi4 Re4 Do4 Re4 | Mi4 Mi4 Mi4:2 | Re4 Re4 Re4:2 | Mi4 Sol4 Sol4:2 | Mi4 Re4 Do4 Re4 | Mi4 Mi4 Mi4 Mi4 | Re4 Re4 Mi4 Re4 | Do4:4",
    lh: "Do3:4 | Do3:4 | Sol2:4 | Do3:4 | Do3:4 | Do3:4 | Sol2:4 | Do3:4",
  },
  {
    id: "estrellita", title: "Estrellita, ¿dónde estás?", key: C, bpm: 90, meter: 4,
    about: "La melodía que Mozart usó para sus variaciones. Salta del Do al Sol (una quinta): estira la mano sin moverla, el meñique llega al Sol... ¡y uno más al La!",
    rh: "Do4 Do4 Sol4 Sol4 | La4 La4 Sol4:2 | Fa4 Fa4 Mi4 Mi4 | Re4 Re4 Do4:2 | Sol4 Sol4 Fa4 Fa4 | Mi4 Mi4 Re4:2 | Sol4 Sol4 Fa4 Fa4 | Mi4 Mi4 Re4:2 | Do4 Do4 Sol4 Sol4 | La4 La4 Sol4:2 | Fa4 Fa4 Mi4 Mi4 | Re4 Re4 Do4:2",
    lh: "Do3:4 | Fa3:2 Do3:2 | Fa3:2 Do3:2 | Sol2:2 Do3:2 | Do3:2 Fa3:2 | Do3:2 Sol2:2 | Do3:2 Fa3:2 | Do3:2 Sol2:2 | Do3:4 | Fa3:2 Do3:2 | Fa3:2 Do3:2 | Sol2:2 Do3:2",
  },
  {
    id: "frere", title: "Frère Jacques (Martinillo)", key: C, bpm: 100, meter: 4,
    about: "Un canon: cada frase se repite. Aparecen corcheas (dos por pulso) en «ding, dang, dong»: cuenta «1 y 2 y».",
    rh: "Do4 Re4 Mi4 Do4 | Do4 Re4 Mi4 Do4 | Mi4 Fa4 Sol4:2 | Mi4 Fa4 Sol4:2 | Sol4:0.5 La4:0.5 Sol4:0.5 Fa4:0.5 Mi4 Do4 | Sol4:0.5 La4:0.5 Sol4:0.5 Fa4:0.5 Mi4 Do4 | Do4 Sol3 Do4:2 | Do4 Sol3 Do4:2",
    lh: "Do3:4 | Do3:4 | Do3:4 | Do3:4 | Do3:4 | Do3:4 | Do3:2 Sol2:2 | Do3:4",
  },
  {
    id: "alegria", title: "Oda a la alegría (Beethoven)", key: C, bpm: 100, meter: 4,
    about: "El tema de la Novena Sinfonía. Casi todo por grados conjuntos (notas vecinas). Ojo al final de cada frase: negra con puntillo y corchea.",
    rh: "Mi4 Mi4 Fa4 Sol4 | Sol4 Fa4 Mi4 Re4 | Do4 Do4 Re4 Mi4 | Mi4:1.5 Re4:0.5 Re4:2 | Mi4 Mi4 Fa4 Sol4 | Sol4 Fa4 Mi4 Re4 | Do4 Do4 Re4 Mi4 | Re4:1.5 Do4:0.5 Do4:2",
    lh: "Do3:4 | Sol2:4 | Do3:4 | Sol2:4 | Do3:4 | Sol2:4 | Do3:4 | Sol2:2 Do3:2",
  },
  {
    id: "luna", title: "Au clair de la lune (A la luz de la luna)", key: C, bpm: 90, meter: 4,
    about: "Canción francesa antigua. La parte de en medio sube al La y baja hasta el Sol de abajo: la mano se mueve, y luego vuelve a su sitio.",
    rh: "Do4 Do4 Do4 Re4 | Mi4:2 Re4:2 | Do4 Mi4 Re4 Re4 | Do4:4 | Do4 Do4 Do4 Re4 | Mi4:2 Re4:2 | Do4 Mi4 Re4 Re4 | Do4:4 | Re4 Re4 Re4 Re4 | La3:2 La3:2 | Re4 Do4 Si3 La3 | Sol3:4 | Do4 Do4 Do4 Re4 | Mi4:2 Re4:2 | Do4 Mi4 Re4 Re4 | Do4:4",
    lh: "Do3:4 | Do3:2 Sol2:2 | Do3:2 Sol2:2 | Do3:4 | Do3:4 | Do3:2 Sol2:2 | Do3:2 Sol2:2 | Do3:4 | Re3:4 | Fa2:4 | Re3:2 Re2:2 | Sol2:4 | Do3:4 | Do3:2 Sol2:2 | Do3:2 Sol2:2 | Do3:4",
  },
  {
    id: "puente", title: "El puente de Londres", key: C, bpm: 100, meter: 4,
    about: "Melodía que baja y sube por la escala. Dedos: el pulgar en el Do, el meñique en el Sol; el La lo pilla el 5 estirando.",
    rh: "Sol4 La4 Sol4 Fa4 | Mi4 Fa4 Sol4:2 | Re4 Mi4 Fa4:2 | Mi4 Fa4 Sol4:2 | Sol4 La4 Sol4 Fa4 | Mi4 Fa4 Sol4:2 | Re4:2 Sol4:2 | Mi4 Do4:3",
    lh: "Do3:4 | Do3:4 | Sol2:4 | Do3:4 | Do3:4 | Do3:4 | Sol2:4 | Do3:4",
  },
  {
    id: "cumple", title: "Cumpleaños feliz", key: C, bpm: 100, meter: 3,
    about: "En compás de tres (como un vals): cuenta «1, 2, 3». Empieza con dos notas cortas (anacrusa) y tiene un salto grande al Do de arriba.",
    rh: "Sol4:0.75 Sol4:0.25 | La4 Sol4 Do5 | Si4:2 Sol4:0.75 Sol4:0.25 | La4 Sol4 Re5 | Do5:2 Sol4:0.75 Sol4:0.25 | Sol5 Mi5 Do5 | Si4 La4 Fa5:0.75 Fa5:0.25 | Mi5 Do5 Re5 | Do5:3",
    lh: "-:1 | Do3:3 | Sol2:3 | Sol2:3 | Do3:3 | Do3:3 | Fa2:3 | Do3:1 Sol2:2 | Do3:3",
  },
  {
    id: "remar", title: "Rema, rema, tu barquito (Row your boat)", key: C, bpm: 90, meter: 3,
    about: "En 6/8: dos pulsos por compás, cada uno de tres corcheas (aquí se escribe en 3/4, que dura lo mismo). Se canta balanceándose, «uno-dos-tres, cuatro-cinco-seis».",
    rh: "Do4:1.5 Do4:1.5 | Do4:1 Re4:0.5 Mi4:1.5 | Mi4:1 Re4:0.5 Mi4:1 Fa4:0.5 | Sol4:3 | Do5:0.5 Do5:0.5 Do5:0.5 Sol4:0.5 Sol4:0.5 Sol4:0.5 | Mi4:0.5 Mi4:0.5 Mi4:0.5 Do4:0.5 Do4:0.5 Do4:0.5 | Sol4:1 Fa4:0.5 Mi4:1 Re4:0.5 | Do4:3",
    lh: "Do3:3 | Do3:3 | Do3:3 | Do3:3 | Do3:3 | Do3:3 | Sol2:3 | Do3:3",
  },
  {
    id: "cascabeles", title: "Jingle Bells (estribillo)", key: C, bpm: 120, meter: 4,
    about: "Ritmo con puntillo: «Mi, Sol, Do-o, Re» la tercera nota es larga y la cuarta corta. Mucha nota repetida: deja la mano quieta.",
    rh: "Mi4 Mi4 Mi4:2 | Mi4 Mi4 Mi4:2 | Mi4 Sol4 Do4:1.5 Re4:0.5 | Mi4:4 | Fa4 Fa4 Fa4:1.5 Fa4:0.5 | Fa4 Mi4 Mi4 Mi4:0.5 Mi4:0.5 | Mi4 Re4 Re4 Mi4 | Re4:2 Sol4:2 | Mi4 Mi4 Mi4:2 | Mi4 Mi4 Mi4:2 | Mi4 Sol4 Do4:1.5 Re4:0.5 | Mi4:4 | Fa4 Fa4 Fa4:1.5 Fa4:0.5 | Fa4 Mi4 Mi4 Mi4:0.5 Mi4:0.5 | Sol4 Sol4 Fa4 Re4 | Do4:4",
    lh: "Do3:4 | Do3:4 | Do3:4 | Do3:4 | Fa2:4 | Do3:4 | Re3:4 | Sol2:4 | Do3:4 | Do3:4 | Do3:4 | Do3:4 | Fa2:4 | Do3:4 | Sol2:4 | Do3:4",
  },
  {
    id: "alegria-acordes", title: "Oda a la alegría con acordes", key: C, bpm: 90, meter: 4,
    about: "La misma melodía, ahora con la izquierda tocando el acorde entero (Do-Mi-Sol y Si-Re-Sol, una inversión: casi no se mueve la mano).",
    rh: "Mi4 Mi4 Fa4 Sol4 | Sol4 Fa4 Mi4 Re4 | Do4 Do4 Re4 Mi4 | Mi4:1.5 Re4:0.5 Re4:2 | Mi4 Mi4 Fa4 Sol4 | Sol4 Fa4 Mi4 Re4 | Do4 Do4 Re4 Mi4 | Re4:1.5 Do4:0.5 Do4:2",
    lh: "Do3+Mi3+Sol3:4 | Si2+Re3+Sol3:4 | Do3+Mi3+Sol3:4 | Si2+Re3+Sol3:4 | Do3+Mi3+Sol3:4 | Si2+Re3+Sol3:4 | Do3+Mi3+Sol3:4 | Si2+Re3+Sol3:2 Do3+Mi3+Sol3:2",
  },
  {
    id: "estrellita-sol", title: "Estrellita en Sol mayor", key: G, bpm: 90, meter: 4,
    about: "La misma canción empezando en Sol: suena igual, pero más aguda. Una melodía se puede tocar desde cualquier nota (transportar); la escala de Sol tiene Fa#, aunque esta melodía no llega a usarlo.",
    rh: "Sol4 Sol4 Re5 Re5 | Mi5 Mi5 Re5:2 | Do5 Do5 Si4 Si4 | La4 La4 Sol4:2 | Re5 Re5 Do5 Do5 | Si4 Si4 La4:2 | Re5 Re5 Do5 Do5 | Si4 Si4 La4:2 | Sol4 Sol4 Re5 Re5 | Mi5 Mi5 Re5:2 | Do5 Do5 Si4 Si4 | La4 La4 Sol4:2",
    lh: "Sol2:4 | Do3:2 Sol2:2 | Do3:2 Sol2:2 | Re3:2 Sol2:2 | Sol2:2 Do3:2 | Sol2:2 Re3:2 | Sol2:2 Do3:2 | Sol2:2 Re3:2 | Sol2:4 | Do3:2 Sol2:2 | Do3:2 Sol2:2 | Re3:2 Sol2:2",
  },
];

/** La canción como pieza (con id fijo: sus zonas y su progreso se recuerdan). */
export function songPiece(s: Song): Piece {
  const notes = [...parseLine(s.rh, "rh", 0.75), ...(s.lh ? parseLine(s.lh, "lh", 0.55) : [])].sort((a, b) => a.b - b.b || a.p - b.p);
  return { id: `cancion-${s.id}`, title: s.title, bpm: s.bpm, meter: s.meter, key: s.key, notes };
}
