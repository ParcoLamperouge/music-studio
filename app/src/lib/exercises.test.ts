import assert from "node:assert/strict";
import { EXERCISES, exercisePiece } from "./exercises.ts";

const C = { tonic: 0, minor: false }, D = { tonic: 2, minor: false }, Am = { tonic: 9, minor: true };
const ex = (id: string) => EXERCISES.find((e) => e.id === id)!;
const ps = (id: string, k = C, h: "rh" | "lh" | "both" = "rh") => exercisePiece(ex(id), k, h).notes.filter((n) => n.hand === (h === "lh" ? "lh" : "rh")).map((n) => n.p);

// escala de una octava: Do4…Do5…Do4; en Re mayor con Fa# y Do#
assert.deepEqual(ps("escala-una-octava-do"), [60, 62, 64, 65, 67, 69, 71, 72, 71, 69, 67, 65, 64, 62, 60]);
assert.ok(ps("escala-una-octava-do", D).includes(66) && ps("escala-una-octava-do", D).includes(73));
// manos juntas: la izquierda igual una octava por debajo, a la vez
const both = exercisePiece(ex("escala-una-octava-do"), C, "both").notes;
const rh = both.filter((n) => n.hand === "rh"), lh = both.filter((n) => n.hand === "lh");
assert.deepEqual(lh.map((n) => [n.b, n.p + 12]), rh.map((n) => [n.b, n.p]));
assert.deepEqual(ps("escala-una-octava-do", C, "lh").slice(0, 2), [48, 50], "izquierda sola, una octava abajo");
// menor: natural, armónica (Sol#) y melódica (Fa# y Sol# al subir)
const minor = ps("escala-menor", Am);
assert.ok(minor.includes(80) && minor.includes(78) && minor.includes(79), "La menor desde La4: Sol natural, Sol# (armónica) y Fa# (melódica)");
// tríadas de la tonalidad: I = Do-Mi-Sol, vii° = Si-Re-Fa
const tri = exercisePiece(ex("triadas-tonalidad"), C, "rh").notes;
assert.deepEqual(tri.filter((n) => n.b === 0).map((n) => n.p), [60, 64, 67]);
assert.deepEqual(tri.filter((n) => n.b === 12).map((n) => n.p), [71, 74, 77]);
// inversiones: Do-Mi-Sol, Mi-Sol-Do, Sol-Do-Mi
const inv = exercisePiece(ex("inversiones"), C, "rh").notes;
assert.deepEqual([0, 1, 2].map((b) => inv.filter((n) => n.b === b).map((n) => n.p)), [[60, 64, 67], [64, 67, 72], [67, 72, 76]]);
// enlace de voces: entre acordes seguidos la mano se mueve poco
const lead = exercisePiece(ex("progresion-enlazada"), C, "both").notes.filter((n) => n.hand === "rh");
const chordsAt = [...new Set(lead.map((n) => n.b))].map((b) => lead.filter((n) => n.b === b).map((n) => n.p).sort((x, y) => x - y));
for (let i = 1; i < chordsAt.length; i++) assert.ok(chordsAt[i].reduce((s, p, j) => s + Math.abs(p - chordsAt[i - 1][j]), 0) <= 6, `poco movimiento (IV→V, sin notas comunes, ya mueve 6) ${chordsAt[i - 1]} → ${chordsAt[i]}`);
// ejercicios de dos manos: siempre juntas aunque se pida una
assert.ok(exercisePiece(ex("alberti"), C, "rh").notes.some((n) => n.hand === "lh"));
// tres contra dos: por pulso, tres en la derecha y dos en la izquierda
const poly = exercisePiece(ex("tres-contra-dos"), C, "both").notes;
assert.equal(poly.filter((n) => n.hand === "rh" && n.b < 1).length, 3);
assert.equal(poly.filter((n) => n.hand === "lh" && n.b < 1).length, 2);
// todos, en las 24 tonalidades y con cada mano: notas dentro del piano, duraciones positivas, ids distintos
const ids = new Set<string>();
for (const e of EXERCISES) for (let t = 0; t < 12; t++) for (const minor of [false, true]) for (const h of ["rh", "lh", "both"] as const) {
  const pc = exercisePiece(e, { tonic: t, minor }, h);
  assert.ok(pc.notes.length > 0, e.id);
  for (const n of pc.notes) assert.ok(n.p >= 21 && n.p <= 108 && n.d > 0 && Number.isFinite(n.b), `${e.id} ${t} ${h}: ${JSON.stringify(n)}`);
  ids.add(pc.id);
}
assert.ok(ids.size > EXERCISES.length * 12, "un id por ejercicio, tonalidad y manos");
assert.equal(new Set(EXERCISES.map((e) => e.id)).size, EXERCISES.length);
// mayor y menor: la del medio baja un semitono
const mm = exercisePiece(ex("mayor-menor"), C, "rh").notes;
assert.deepEqual([0, 2].map((b) => mm.filter((n) => n.b === b).map((n) => n.p)), [[60, 64, 67], [60, 63, 67]]);
// matices: la misma frase suave y luego fuerte
const dyn = exercisePiece(ex("dinamicas"), C, "rh").notes;
assert.ok(dyn[0].v < 0.4 && dyn[8].v > 0.8);
// movimiento contrario: la derecha sube cuando la izquierda baja
const ct = exercisePiece(ex("contrario"), C, "both").notes;
assert.deepEqual([ct.find((n) => n.b === 1 && n.hand === "rh")!.p, ct.find((n) => n.b === 1 && n.hand === "lh")!.p], [62, 47]);
// blues: doce compases
assert.equal(Math.max(...exercisePiece(ex("blues"), C, "both").notes.map((n) => n.b + n.d)), 48);
// modos desde Do: dórico con Mib y Sib, lidio con Fa#, mixolidio con Sib
const modeNotes = (id: string) => new Set(ps(id, C).map((p) => p % 12));
assert.deepEqual([...modeNotes("modo-dorico")].sort((a, b) => a - b), [0, 2, 3, 5, 7, 9, 10]);
assert.deepEqual([...modeNotes("modo-lidio")].sort((a, b) => a - b), [0, 2, 4, 6, 7, 9, 11]);
assert.deepEqual([...modeNotes("modo-mixolidio")].sort((a, b) => a - b), [0, 2, 4, 5, 7, 9, 10]);
assert.deepEqual([...modeNotes("modo-frigio")].sort((a, b) => a - b), [0, 1, 3, 5, 7, 8, 10]);
assert.deepEqual([...modeNotes("modo-locrio")].sort((a, b) => a - b), [0, 1, 3, 5, 6, 8, 10]);
assert.deepEqual([...modeNotes("escala-blues")].sort((a, b) => a - b), [0, 3, 5, 6, 7, 10]);
assert.deepEqual([...modeNotes("tonos-enteros")].sort((a, b) => a - b), [0, 2, 4, 6, 8, 10]);
// las doce mayores: 12 escalas de 15 notas, y la de Sol con su Fa#
const all12 = ps("escalas-mayores-todas");
assert.equal(all12.length, 12 * 15);
assert.ok(all12.slice(15, 30).some((p) => p % 12 === 6));
console.log("ejercicios ok");
