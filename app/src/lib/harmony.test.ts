import assert from "node:assert/strict";
import { analyze, bestChord, chordName, degree, findKey, keyFromChords, keyName, fromModel, leadSheet, named, parseKey, refineChords, scaleNotes, type Note } from "./harmony.ts";

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
// piano solo: su mano izquierda hace de bajo (Do con Mi abajo = Do/Mi)
const inv = analyze([{ stem: "piano", notes: block(0, 2, [40, 60, 64, 67]) }], [], 2);
assert.equal(chordName(inv.chords[0], C, { latin: true, simple: false }), "Do/Mi");
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

// tonalidad como un músico (canciones reales reducidas): la dominante y la relativa no ganan a la tónica
const seq = (spec: string) => {
  // "Dm:2 A:2" → acordes seguidos con su duración en compases
  const R: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, Eb: 3, E: 4, F: 5, "F#": 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };
  let t = 0;
  return spec.split(" ").map((x) => {
    const [name, d] = x.split(":");
    const [, r, kind] = name.match(/^([A-G][b#]?)(.*)$/)!;
    const c = { t, end: t + +d, root: R[r], kind: kind === "M" ? "" : kind, bass: R[r] };
    t += +d;
    return c;
  });
};
const keyOf = (spec: string, rep = 6) => keyName(keyFromChords(seq(Array(rep).fill(spec).join(" "))), true);
assert.equal(keyOf("Dm:2 A:2"), "Re menor", "Silent Movie: i–V alternando, no La mayor");
assert.equal(keyOf("Dm:2 Gm:2 Dm:2 Gm:1 D:1 Eb:1 Gm:1"), "Sol menor", "Looking at Me: v–i y V–i, no Re menor");
assert.equal(keyOf("Cm:1 Ab:1 Eb:1 Gm:1"), "Do menor", "DNA: no su relativa Mib");
assert.equal(keyOf("Am:1 D:1 G:1 Em:1"), "Sol mayor", "Primadonna: ii–V–I–vi");
assert.equal(keyOf("Cm:3 Fm:1"), "Do menor", "it's my party: i–iv, no v–i en Fa menor");
assert.equal(keyOf("Gm:3 Bb:1 Eb:3 F:1"), "Sol menor", "0 OR 100: i–III–VI–VII con Solm largo (si duran igual, también es vi–I–IV–V en Sib)");
assert.equal(keyOf("Am:2 Em:1 E:1"), "La menor", "Stay Mad: con su V mayor");

// ortografía por grados: la sensible en menor es sostenido aunque la tonalidad lleve bemoles; el bVII en Do es Sib
const Dm = { tonic: 2, minor: true };
const cd = (root: number, kind: string, bass = root) => ({ t: 0, end: 1, root, kind, bass });
assert.equal(chordName(cd(9, "7", 1), Dm, { latin: true, simple: false }), "La7/Do#");
assert.equal(chordName(cd(10, ""), Dm, { latin: true, simple: false }), "Sib");
assert.equal(degree(cd(1, "dim"), Dm), "vii°");
assert.equal(degree(cd(10, ""), Dm), "VI");
assert.equal(chordName(cd(10, ""), C, { latin: true, simple: false }), "Sib");
assert.equal(degree(cd(6, "dim"), C), "#iv°");
assert.equal(degree(cd(6, "m"), { tonic: 9, minor: true }), "#vi", "sexta dórica en La menor");
assert.deepEqual(scaleNotes(Dm, true), ["Re", "Mi", "Fa", "Sol", "La", "Sib", "Do"]);
console.log("tonalidad ok");

// acordes del modelo revisados con las notas: solo el tipo sobre la misma fundamental, y solo si las notas lo dicen claro
const rem = [{ t: 0, end: 2, root: 2, kind: "m", bass: 2 }];
const notesD7 = (third: number): Note[] => [[0, 2, 50, 0.8], [0, 2, 54 + third, 0.8], [0, 2, 57, 0.8], [0, 2, 60, 0.8]];
assert.equal(refineChords(rem, [{ stem: "piano", notes: notesD7(0) }], { tonic: 7, minor: true })[0].kind, "7", "Re-Fa#-La-Do: V7 de Sol menor, no Rem");
assert.equal(refineChords(rem, [{ stem: "piano", notes: notesD7(-1) }], { tonic: 7, minor: true })[0].kind, "m7", "con Fa natural sigue menor");
assert.equal(refineChords(rem, [{ stem: "vocals", notes: notesD7(0) }], { tonic: 7, minor: true })[0].kind, "m", "la voz no cuenta");
assert.equal(refineChords(rem, [{ stem: "piano", notes: [[0, 0.1, 54, 0.5]] }], { tonic: 7, minor: true })[0].kind, "m", "con casi nada manda el modelo");
assert.equal(refineChords(rem, [{ stem: "piano", notes: [[0, 2, 47, 0.8], [0, 2, 50, 0.8], [0, 2, 53, 0.8]] }], { tonic: 7, minor: true })[0].root, 2, "nunca cambia la fundamental");
console.log("revisión ok");
assert.deepEqual(parseKey("Sib menor"), { tonic: 10, minor: true });
assert.deepEqual(parseKey("F# major"), { tonic: 6, minor: false });
assert.equal(parseKey("Do"), null);
assert.equal(parseKey(null), null);
console.log("parseKey ok");

// huecos del modelo: si los instrumentos tocan, acordes de sus notas; la voz sola no rellena
const model = [{ t: 0, end: 4, root: 0, kind: "", bass: 0 }, { t: 10, end: 14, root: 7, kind: "", bass: 7 }];
const gNotes: Note[] = [[4, 10, 45, 0.8], [4, 10, 48, 0.8], [4, 10, 52, 0.8]]; // La menor en el hueco
const filled = fromModel(model, [{ stem: "guitar", notes: gNotes }], [], 14).chords;
assert.ok(filled.some((c) => c.t >= 4 && c.end <= 10 && c.root === 9 && c.kind === "m"), "el hueco, con Lam");
assert.equal(fromModel(model, [{ stem: "vocals", notes: gNotes }], [], 14).chords.length, 2, "la voz sola no rellena");
console.log("huecos ok");
