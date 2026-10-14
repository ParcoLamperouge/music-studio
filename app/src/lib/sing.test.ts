import assert from "node:assert/strict";
import type { Note } from "./harmony.ts";
import { fold, hz2midi, median, offsetAt, phrases, phraseScores, scoreFrame, shiftLabel, transposition } from "./sing.ts";

assert.equal(Math.round(hz2midi(440)), 69);
assert.equal(fold(1200), 0); // octava: igual
assert.equal(fold(-1150), 50);
assert.equal(fold(700), -500);
assert.equal(median([3, 1, 2, 9, 4]), 3);

// Do4 Re4 Mi4, y un silencio largo antes de Sol4
const ref: Note[] = [[0, 1, 60, 1], [1, 2, 62, 1], [2, 3, 64, 1], [5, 6, 67, 1]];

assert.equal(scoreFrame(ref, { t: 0.5, midi: 60.3 }).grade, "ok");
assert.equal(scoreFrame(ref, { t: 0.5, midi: 48.2 }).grade, "ok"); // una octava abajo
assert.equal(scoreFrame(ref, { t: 0.5, midi: 60.8 }).grade, "partial");
assert.equal(scoreFrame(ref, { t: 0.5, midi: 61.5 }).grade, "bad");
assert.equal(scoreFrame(ref, { t: 4, midi: 60 }).grade, null); // la voz original calla: no cuenta
// entra 0,1 s tarde: aún vale la nota anterior
assert.equal(scoreFrame(ref, { t: 1.1, midi: 60 }).grade, "ok");
// transposición libre: 2 semitonos abajo cuenta como acierto
assert.equal(scoreFrame(ref, { t: 0.5, midi: 58 }, -2).grade, "ok");

// transposición: canta todo 2 semitonos por debajo (y alguna nota a una octava, y ruido)
const offs = Array.from({ length: 40 }, (_, i) => offsetAt(ref, { t: (i % 30) / 10, midi: (i < 10 ? 46 : 58) + [0, 2, 4][Math.floor((i % 30) / 10)] + (i % 7 === 0 ? 0.4 : 0) })!);
assert.equal(transposition(offs), -2);
assert.equal(transposition(offs.slice(0, 5)), null);
assert.equal(transposition(Array(30).fill(5.9)), 6); // ±6: el mismo tritono
assert.match(shiftLabel(-2), /2 semitonos por debajo/);
assert.equal(shiftLabel(0), "en tono");

// frases sin letra: silencios de más de 1 s
assert.deepEqual(phrases(ref, null).map((p) => [p.t, p.end]), [[0, 3], [5, 6]]);
// con letra: líneas en tiempo del audio (offset + word_offset)
const doc = { instrumental: false, offset: 1, word_offset: 0.5, lines: [{ t: 0, text: "hola", words: [{ t: 0, end: 1, w: "hola" }] }, { t: 3, text: "adiós" }, { t: null, text: "x" }] } as any;
assert.deepEqual(phrases(ref, doc), [{ t: 1.5, end: 2.5, text: "hola" }, { t: 4, end: 8, text: "adiós" }]);

const fr = [0.2, 0.4, 0.6, 5.5].map((t, i) => scoreFrame(ref, { t, midi: [60, 60.8, 70, 67][i] }));
assert.deepEqual(phraseScores(phrases(ref, null), fr), [50, 100]);
console.log("sing ok");
