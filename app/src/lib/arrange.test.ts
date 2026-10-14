import assert from "node:assert/strict";
import { arrange, easyTranspose, fifths, fromBeat, melodyLine, Practice, toBeat, toMusicXML, toSeconds } from "./arrange.ts";
import type { Chord, Note } from "./harmony.ts";

// pulsos a 120 bpm empezando en 1 s
const beats = Array.from({ length: 40 }, (_, i) => 1 + i * 0.5);
assert.equal(toBeat(beats, 1), 0);
assert.equal(toBeat(beats, 2.25), 2.5);
assert.equal(toBeat(beats, 0.5), -1, "antes del primer pulso, al mismo ritmo");
assert.equal(fromBeat(beats, toBeat(beats, 7.3)), 7.3);

// tonalidad fácil: la más cercana de Do/Sol/Fa mayor o La/Mi/Re menor
assert.equal(easyTranspose({ tonic: 2, minor: false }), -2, "Re mayor → Do");
assert.equal(easyTranspose({ tonic: 6, minor: false }), 1, "Fa# mayor → Sol");
assert.equal(easyTranspose({ tonic: 1, minor: true }), 1, "Do# menor → Re menor");
assert.equal(easyTranspose({ tonic: 9, minor: true }), 0);
assert.equal(fifths({ tonic: 7, minor: false }), 1, "Sol mayor: un sostenido");
assert.equal(fifths({ tonic: 2, minor: true }), -1, "Re menor: un bemol");
assert.equal(fifths({ tonic: 3, minor: false }), -3, "Mib mayor: tres bemoles");

// melodía: vibrato y notas fantasma fuera; cuadrada a negras (nivel 1) o corcheas (nivel 2)
const sung: Note[] = [
  [1.0, 1.95, 64, 0.8], // Mi, una negra larga y algo
  [1.3, 1.34, 70, 0.5], // fantasma de 40 ms
  [2.0, 2.24, 67, 0.8], // Sol corchea
  [2.25, 2.95, 65, 0.8], // Fa
];
const q1 = melodyLine(sung, beats, 1);
assert.deepEqual(q1.map((n) => [n.b, n.d, n.p]), [[0, 2, 64], [2, 1, 67], [3, 1, 65]]);
const q2 = melodyLine(sung, beats, 0.5);
assert.deepEqual(q2.map((n) => [n.b, n.d, n.p]), [[0, 2, 64], [2, 0.5, 67], [2.5, 1.5, 65]]);
// la misma nota cantada dos veces son dos notas, no una larga
const twice = melodyLine([[1, 1.5, 60, 0.8], [1.5, 2, 60, 0.8]], beats, 0.5);
assert.equal(twice.length, 2);

// acompañamiento: Do – Sol por compás (4/4)
const ch = (t: number, end: number, root: number, kind = ""): Chord => ({ t, end, root, kind, bass: root });
const chords = [ch(1, 3, 0), ch(3, 5, 7), ch(5, 7, 9, "m"), ch(7, 9, 5)];
const base = { chords, beats, downbeats: [1], meter: 4, key: { tonic: 0, minor: false } };
const l1 = arrange({ ...base, melody: sung, level: 1 });
assert.deepEqual(l1.lh.map((n) => [n.b, n.d, n.p % 12]), [[0, 4, 0], [4, 4, 7], [8, 4, 9], [12, 4, 5]], "nivel 1: la fundamental, un compás cada una");
assert.ok(l1.rh.every((n) => n.p >= 60 && n.p <= 79), "derecha en su rango");
const l3 = arrange({ ...base, melody: sung, level: 3 });
const triads = [0, 4, 8, 12].map((b) => l3.lh.filter((n) => n.b === b).map((n) => n.p).sort((x, y) => x - y));
assert.deepEqual(triads[0].map((p) => p % 12).sort(), [0, 4, 7]);
// enlace de voces: de Do a Sol la mano casi no se mueve (Do-Mi-Sol → Si-Re-Sol, no Sol-Si-Re una quinta arriba)
const moved = triads[1].reduce((s, p, i) => s + Math.abs(p - triads[0][i]), 0);
assert.ok(moved <= 4, `poco movimiento entre acordes (${moved})`);
const l4 = arrange({ ...base, melody: sung, level: 4 });
assert.ok(l4.lh.some((n) => n.b === 0 && n.p < 48), "nivel 4: bajo en el 1");
assert.ok(l4.lh.some((n) => n.b === 1), "y el acorde en el 2");
// sin melodía: la derecha lleva los acordes
const acc = arrange({ ...base, melody: null, level: 2 });
assert.deepEqual(acc.rh.filter((n) => n.b === 0).map((n) => n.p % 12).sort(), [0, 4, 7]);
// transporte: todo sube y la tonalidad con ello
const up = arrange({ ...base, melody: sung, level: 1, transpose: 2 });
assert.equal(up.lh[0].p, l1.lh[0].p + 2);
assert.equal(up.key.tonic, 2);
assert.deepEqual(toSeconds(l1.lh.slice(0, 1), beats), [[1, 3, l1.lh[0].p, l1.lh[0].v]]);

// partitura: compases de 4/4 que suman 16 semicorcheas en cada pentagrama, notas largas partidas con ligadura
const xml = toMusicXML(l1, "Prueba & <cosas>");
assert.ok(xml.includes("<work-title>Prueba &amp; &lt;cosas></work-title>"));
assert.ok(xml.includes("<fifths>0</fifths>") && xml.includes("<beats>4</beats>"));
for (const m of xml.split("<measure ").slice(1)) {
  for (const staff of m.split("<backup>")) {
    const durs = [...staff.matchAll(/<note>(?!<chord\/>)(?:(?!<\/note>).)*?<duration>(\d+)<\/duration>/g)].map((x) => +x[1]);
    assert.equal(durs.reduce((a, b) => a + b, 0), 16, `compás completo: ${durs}`);
  }
}
const long = toMusicXML({ ...l1, rh: [{ b: 2, d: 4, p: 72, v: 0.8 }], lh: [] }, "t");
assert.ok(long.includes('<tie type="start"/>') && long.includes('<tie type="stop"/>'), "cruza la barra: ligadura");
assert.ok(long.includes("<step>C</step><octave>5</octave>"));
// Dob se escribe una octava por encima de la tecla (Si): en Solb mayor
const gb = toMusicXML({ ...l1, key: { tonic: 6, minor: false }, rh: [{ b: 0, d: 4, p: 71, v: 1 }], lh: [] }, "t");
assert.ok(gb.includes("<step>C</step><alter>-1</alter><octave>5</octave>"), gb.slice(gb.indexOf("<pitch>"), gb.indexOf("</pitch>") + 8));

// práctica: acierto dentro del margen, fallo fuera; el modo espera se para en lo pendiente
const pr = new Practice([{ t: 1, p: 60, hand: "rh" }, { t: 1, p: 64, hand: "rh" }, { t: 2, p: 67, hand: "rh" }]);
assert.equal(pr.blocking(0.9), null);
assert.equal(pr.blocking(1.05), 1);
assert.equal(pr.press(60, 1.05), true);
assert.equal(pr.press(62, 1.05), false, "nota equivocada");
assert.equal(pr.blocking(1.3), 1, "falta el Mi del acorde");
assert.equal(pr.press(64, 1.3, 1), true, "en espera vale aunque haya pasado el margen");
assert.equal(pr.blocking(1.3), null);
const st = pr.stats(3);
assert.deepEqual([st.due, st.hits, st.wrong], [3, 2, 1]);
pr.reset(0.5);
assert.equal(pr.targets.filter((x) => x.hit).length, 0);
// saltar hacia delante: lo de antes sin tocar no frena la espera ni cuenta como fallo
const jump = new Practice([{ t: 1, p: 60, hand: "rh" }, { t: 5, p: 62, hand: "rh" }]);
jump.reset(4);
assert.equal(jump.blocking(4.5), null);
assert.equal(jump.blocking(5.1), 5);
assert.equal(jump.stats(10).due, 1);
console.log("arrange ok");
// acordes casi a la vez: al cuadrarlos no se pisan
const tight = arrange({ ...base, chords: [ch(1, 2.1, 0), ch(2.05, 3, 7)], melody: null, level: 3 });
const starts = [...new Set(tight.rh.map((n) => n.b))];
for (const b of starts) assert.equal(tight.rh.filter((n) => n.b === b).length, 3, "una tríada cada vez (sin melodía, en la derecha)");
assert.ok(tight.lh.every((n, i, all) => all.every((m) => m.b >= n.b + n.d - 1e-6 || m.b + m.d <= n.b + 1e-6 || m.b === n.b)), "la izquierda sin solapes");
console.log("solapes ok");
