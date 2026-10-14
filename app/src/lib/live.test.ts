import assert from "node:assert/strict";
import { chordName } from "./harmony.ts";
import { Live, sessionForAI, songForAI, stamps, toMidi } from "./live.ts";
import { toToon } from "./toon.ts";

// Do mayor con el pedal: las teclas se sueltan pero suenan hasta levantarlo
const r = (x: number) => Math.round(x * 1000) / 1000;
const l = new Live();
l.midi([0xfe], 0.5); // active sensing: se ignora
l.midi([0x90, 60, 100], 1);
l.midi([0x90, 64, 100], 1.01);
l.midi([0xb0, 64, 127], 1.05);
l.midi([0x90, 67, 100], 1.02);
assert.equal(l.chord && `${l.chord.root}${l.chord.kind}`, "0");
l.midi([0x80, 60, 0], 1.5);
l.midi([0x90, 64, 0], 1.5);
assert.equal(l.sounding.size, 3, "el pedal los sostiene");
l.midi([0xb0, 64, 0], 2);
assert.equal(l.sounding.size, 1, "al levantar el pedal se cortan; el Sol sigue abajo");
assert.deepEqual(l.notes.map((n) => [r(n[0]), r(n[1]), n[2]]), [[0, 1, 60], [0.01, 1, 64]]);
assert.deepEqual(l.pedals.map((p) => p.map(r)), [[0.05, 1]]);
// Do+Sol ya no es acorde: el Do mayor duró 0.98 s y queda apuntado
assert.equal(l.chord, null);
assert.equal(l.chords.length, 1);

// guardar a mitad: el Sol que suena se corta en el .json y se suelta en el .mid, sin tocar el estado
const { json, mid } = l.snapshot(3, "Piano", new Date(0));
assert.deepEqual(json.notes.at(-1), [0.02, 2, 67, 0.787]);
assert.equal(json.chords[0].name, "Do");
assert.equal(json.noteNames[0], "Do4");
assert.equal(l.sounding.size, 1);
assert.equal(String.fromCharCode(...mid.slice(0, 4)), "MThd");
assert.deepEqual([...mid.slice(-4)], [0, 0xff, 0x2f, 0]);

// delta de 1 s = 960 pulsos = 0x87 0x40 en VLQ
const m = toMidi([[0, [0x90, 60, 100]], [1, [0x80, 60, 0]]]);
const trk = [...m.slice(22)];
assert.deepEqual(trk.slice(7), [0, 0x90, 60, 100, 0x87, 0x40, 0x80, 60, 0, 0, 0xff, 0x2f, 0]);
console.log("live ok");

// inversiones: mismas notas, mismo acorde; la de abajo sale como bajo
for (const [ps, name] of [[[59, 62, 65], "Sidim"], [[62, 65, 71], "Sidim/Re"], [[64, 67, 72], "Do/Mi"]] as const) {
  const v = new Live();
  ps.forEach((p, i) => v.midi([0x90, p, 100], 1 + i / 1000));
  assert.equal(v.chord && chordName(v.chord, { tonic: 0, minor: false }, { latin: true, simple: false }), name);
}
console.log("inversiones ok");

// tiempos del análisis: «m:ss», con décimas y en rangos; no horas ni proporciones
assert.deepEqual(stamps("Escalas (0:21–0:25) y final en 2:38.4."), [
  { text: "Escalas (" }, { text: "0:21", t: 21 }, { text: "–" }, { text: "0:25", t: 25 }, { text: ") y final en " }, { text: "2:38.4", t: 158.4 }, { text: "." },
]);
assert.deepEqual(stamps("compás 3:4, a las 12:30:00 o 1:2"), [{ text: "compás 3:4, a las 12:30:00 o 1:2" }]);
console.log("tiempos ok");

// canción para la IA: notas redondeadas por instrumento, letra con su desfase, sin versos vacíos ni sin tiempo
const song = songForAI(
  { title: "T", artist: "A", duration: 10.12345, key: "Do mayor", bpm: 90 },
  [{ name: "Piano", notes: [[1.23456, 2, 60, 0.51234]] }],
  [{ t: 0, end: 2, name: "Do", deg: "I" }],
  { offset: 0.5, lines: [{ t: 1, text: "hola" }, { t: null, text: "x" }, { t: 3, text: " " }] },
);
assert.deepEqual(song.instruments, { Piano: [{ inicio: 1.235, fin: 2, nota: 60, vel: 0.512 }] });
assert.deepEqual(song.lyrics, [{ t: 1.5, verso: "hola" }]);
assert.equal(song.duration, 10.123);
console.log("cancion ok");

// TOON: tablas para listas de objetos iguales, comillas solo cuando hacen falta
assert.equal(
  toToon({ key: "Do mayor", n: 2, x: null, tags: ["a", "b c"], chords: [{ t: 0, name: "Do/Mi", deg: "I" }, { t: 1.5, name: "Sol7", deg: "" }], lyrics: [{ t: 1, verso: "hola, adiós" }], inst: { "Batería": [] } }),
  `key: Do mayor
n: 2
x: null
tags[2]: a,b c
chords[2]{t,name,deg}:
  0,Do/Mi,I
  1.5,Sol7,""
lyrics[1]{t,verso}:
  1,"hola, adiós"
inst:
  "Batería"[0]:`,
);
assert.equal(toToon({ a: ["1", "-x", "true", ""], m: [[1, 2], { k: 1, j: [3] }] }), `a[4]: "1","-x","true",""
m[2]:
  - [2]: 1,2
  - k: 1
    j[1]: 3`);
const ses = toToon(sessionForAI(json as never));
assert.ok(ses.includes("notes[3]{inicio,fin,nota,vel,nombre}:\n  0,1,60,0.787,Do4"), ses);
console.log("toon ok");
