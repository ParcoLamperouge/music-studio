import assert from "node:assert/strict";
import { analyze, bestChord, chordName, degree, findKey, keyFromChords, keyName, leadSheet, named, scaleNotes, type Note } from "./harmony.ts";

const pc = (...ps: number[]) => {
  const w = new Array(12).fill(0);
  for (const p of ps) w[p % 12] += 1;
  return w;
};
const C = { tonic: 0, minor: false };
const name = (ps: number[], bass = ps[0], k = C, simple = false) => chordName({ ...bestChord(pc(...ps), bass % 12)!, t: 0, end: 1 }, k, { latin: true, simple });

assert.equal(name([60, 64, 67]), "Do");
assert.equal(name([57, 60, 64]), "Lam");
assert.equal(name([52, 55, 59, 62], 52, { tonic: 4, minor: true }), "Mim7");
assert.equal(name([55, 59, 62, 65]), "Sol7");
assert.equal(name([64, 60, 67], 64), "Do/Mi");
assert.equal(name([52, 55, 59, 62], 52, { tonic: 4, minor: true }, true), "Mim");
assert.equal(name([58, 62, 65], 58, { tonic: 5, minor: false }), "Sib"); // Fa mayor: bemoles
assert.equal(bestChord(new Array(12).fill(0), -1), null);

// tonalidad: escala de Do mayor con Do y Sol pesando más; La menor con La y Mi
assert.deepEqual(findKey([3, 0, 1, 0, 1.5, 1, 0, 2, 0, 1, 0, 0.8]), C);
assert.deepEqual(findKey([1, 0, 0.8, 0, 2, 1, 0, 1, 0, 3, 0, 1]), { tonic: 9, minor: true });
assert.equal(keyName({ tonic: 4, minor: true }, true), "Mi menor");
assert.deepEqual(scaleNotes({ tonic: 4, minor: true }, true), ["Mi", "Fa#", "Sol", "La", "Si", "Do", "Re"]);
assert.equal(degree({ root: 7, kind: "7", bass: 7, t: 0, end: 1 }, C), "V7");
assert.equal(degree({ root: 9, kind: "m", bass: 9, t: 0, end: 1 }, C), "vi");
assert.equal(degree({ root: 10, kind: "", bass: 10, t: 0, end: 1 }, C), "bVII");
assert.equal(degree({ root: 5, kind: "maj7", bass: 5, t: 0, end: 1 }, C), "IVmaj7");
assert.equal(degree({ root: 11, kind: "m7b5", bass: 11, t: 0, end: 1 }, C), "viiø7");

// canción: Do (2 pulsos), Sol (2), un pulso suelto de ruido dentro de Sol, Lam: sale Do · Sol · Lam
const beats = Array.from({ length: 12 }, (_, i) => i * 0.5);
const block = (a: number, b: number, ps: number[]): Note[] => ps.map((p) => [a, b, p, 0.8]);
const notes = [...block(0, 2, [48, 60, 64, 67]), ...block(2, 4, [43, 59, 62, 67]), ...block(4, 6, [45, 57, 60, 64])];
const h = analyze([{ stem: "piano", notes }], beats, 6, 2);
assert.deepEqual(h.chords.map((c) => chordName(c, h.key, { latin: true, simple: false })), ["Do", "Sol", "Lam"]);
// al simplificar, Sol7 + Sol seguidos son un solo Sol
const g = (kind: string, t: number) => ({ root: 7, kind, bass: 7, t, end: t + 1 });
assert.deepEqual(named([g("7", 0), g("", 1)], C, { latin: true, simple: true }).map((c) => [c.name, c.t, c.end]), [["Sol", 0, 2]]);
// cancionero: intro suelta, acorde sobre la palabra que entra (con desfase), anacrusa antes de la línea siguiente
const doc = { offset: 1, lines: [{ t: 2, end: 4, text: "hola que tal", words: [{ t: 2, w: "hola" }, { t: 2.6, w: "que" }, { t: 3.2, w: "tal" }] }, { t: 9, text: "adiós" }] };
const ch = (t: number, name: string) => ({ t, name });
const rows = leadSheet(doc, [ch(0, "Do"), ch(3, "Sol"), ch(4.1, "Lam"), ch(6, "Fa"), ch(9.5, "Mi")]);
assert.deepEqual(rows.map((r) => r.kind === "bars" ? `[${r.chords.map((c) => c.name)}]` : r.words.map((w) => `${w.chords.map((c) => c.name)}:${w.w}`).join(" ")),
  ["[Do]", "Sol:hola :que Lam:tal", "[Fa]", "Mi:adiós"]);
// tonalidad desde acordes del modelo: Cm Ab Eb Gm en bucle = Do menor (o su relativa Mib mayor)
const loop = ["0:m", "8:", "3:", "7:m"].flatMap((x, i) => [0, 1, 2].map((r) => ({ root: +x.split(":")[0], kind: x.split(":")[1], bass: +x.split(":")[0], t: (r * 4 + i) * 2, end: (r * 4 + i) * 2 + 2 })));
const k2 = keyFromChords(loop);
assert.ok((k2.tonic === 0 && k2.minor) || (k2.tonic === 3 && !k2.minor), JSON.stringify(k2));
assert.equal(chordName({ root: 7, kind: "7sus4", bass: 7, t: 0, end: 1 }, C, { latin: true, simple: true }), "Solsus4");
console.log("harmony ok");
