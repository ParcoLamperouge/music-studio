import assert from "node:assert/strict";
import { chordClip, grade, KINDS, maxLevel, melody, pickItem, pool, songQuestions, synthQuestion, triad, type EarState, type Kind, type SongData } from "./ear.ts";

// cada pregunta sintética, en cada nivel, tiene la respuesta entre las opciones y algo que oír
for (const kind of Object.keys(KINDS) as Kind[]) {
  if (KINDS[kind].song) continue;
  for (let lv = 1; lv <= maxLevel(kind); lv++) {
    for (const item of pool(kind, lv)) {
      const q = synthQuestion(kind, item, lv);
      assert.ok(q.sound.notes.length, `${kind} ${lv} ${item}: suena`);
      if (kind === "dictado") assert.equal(q.seq!.length, lv <= 2 ? 3 : 4);
      else assert.ok(q.options.includes(q.answer), `${kind} ${lv} ${item}`);
    }
  }
  // los niveles van a más
  for (let lv = 2; lv <= maxLevel(kind); lv++) assert.ok(pool(kind, lv).length >= pool(kind, lv - 1).length, kind);
}
// el intervalo suena a la distancia que dice
const iv = synthQuestion("intervalo", "5.ª", 1);
assert.equal(Math.abs(iv.sound.notes[1][2] - iv.sound.notes[0][2]), 7);
// el dictado por grados no salta
for (let i = 0; i < 50; i++) {
  const m = melody(1);
  assert.ok(m.every((d, j) => d >= 0 && d <= 4 && (j === 0 || Math.abs(d - m[j - 1]) === 1)), String(m));
}

assert.equal(triad("m7"), "m");
assert.equal(triad("7"), "");
assert.equal(triad("m7b5"), "dim");
assert.equal(triad("sus4"), null);

// trozos de acordes por pulsos (pulso cada 0,5 s)
const beats = Array.from({ length: 40 }, (_, i) => i * 0.5);
assert.deepEqual(chordClip({ t: 0.1, end: 3.02, root: 0, kind: "", bass: 0 }, beats), { t: 0.5, dur: 2.5 });
assert.deepEqual(chordClip({ t: 0, end: 15, root: 0, kind: "", bass: 0 }, beats), { t: 0, dur: 6 });

const song: SongData = {
  key: "a/b", title: "B", artist: "A", tonality: { tonic: 0, minor: false }, beats,
  chords: [
    { t: 0, end: 2, root: 0, kind: "", bass: 0 },
    { t: 2, end: 4, root: 7, kind: "7", bass: 7 },
    { t: 4, end: 4.5, root: 9, kind: "m", bass: 9 }, // demasiado corto
    { t: 4.5, end: 7, root: 5, kind: "", bass: 5 },
    { t: 7, end: 9, root: 2, kind: "m", bass: 2 }, // ii: no está en el nivel 1
    { t: 9, end: 11, root: 10, kind: "", bass: 10 }, // bVII: solo en el 3
  ],
  vocals: [[0, 0.5, 64, 0.8], [0.55, 1, 67, 0.8], [1.1, 1.2, 62, 0.8], [2, 2.6, 66, 0.8]],
};
assert.deepEqual(songQuestions("cancion-grado", song, 1).map((q) => q.answer), ["I", "V", "IV"]);
assert.deepEqual(songQuestions("cancion-grado", song, 3).map((q) => q.answer), ["I", "V", "IV", "ii", "bVII"]);
assert.deepEqual(songQuestions("cancion-calidad", song, 1).map((q) => q.answer), ["Mayor", "Mayor", "Mayor", "Menor", "Mayor"]);
const g = songQuestions("cancion-grado", song, 1)[0];
assert.ok(g.sound.notes.length && g.sound.at! > 0 && g.sound.clip?.src === "acorde" && g.from?.chord?.root === 0);
// notas de la voz: Mi (3) y Sol (5) valen en el nivel 1; Re dura poco y Fa# no es de la escala
assert.deepEqual(songQuestions("cancion-nota", song, 1).map((q) => q.answer), ["3", "5"]);
// intervalo entre Mi y Sol, seguidas: 3.ª m subiendo
const ints = songQuestions("cancion-intervalo", song, 1);
assert.deepEqual(ints.map((q) => [q.answer, q.extra]), [["3.ª m", "subiendo"]]);

// repaso: 20 bien sube de nivel; luego, con la mitad mal, baja
const s: EarState = { items: {}, kinds: {} };
let change = null;
for (let i = 0; i < 20; i++) change = grade(s, "intervalo", "5.ª", true, i);
assert.equal(change, "sube");
assert.equal(s.kinds.intervalo!.level, 2);
assert.equal(s.items["intervalo:5.ª"].box, 5);
for (let i = 0; i < 20; i++) change = grade(s, "intervalo", "3.ª M", i % 2 === 0, 100 + i);
assert.equal(change, "baja");
assert.equal(s.kinds.intervalo!.level, 1);
// lo fallado (caja 0, ya toca) sale mucho más que lo sabido (caja 5, en una semana)
const s2: EarState = { items: {}, kinds: {} };
grade(s2, "acorde", "Mayor", true, 0);
for (let i = 0; i < 4; i++) grade(s2, "acorde", "Mayor", true, 0);
grade(s2, "acorde", "Menor", false, 0);
let menor = 0;
for (let i = 0; i < 200; i++) if (pickItem(s2, "acorde", ["Mayor", "Menor"], 1000, Math.random) === "Menor") menor++;
assert.ok(menor > 180, String(menor));
assert.equal(pickItem(s2, "acorde", ["Mayor", "Menor"], 1000, () => 0, "Menor"), "Mayor"); // no repite

console.log("ear ok");
