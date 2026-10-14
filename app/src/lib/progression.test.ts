import assert from "node:assert/strict";
import { align, chips, code, parseQuery, degreeOf, loops, normalize, parseProgression, Q, search, type Seq } from "./progression.ts";

const C = (root: number, kind = ""): { t: number; end: number; root: number; kind: string; bass: number } => ({ t: 0, end: 2, root, kind, bass: root });
const song = (roots: [number, string?][], key = { tonic: 0, minor: false }): Seq => ({
  c: roots.map(([r, k]) => code(r, k === "m" ? Q.m : Q.M)),
  t: roots.map((_, i) => i * 2),
  key,
});

// analizador: romanos, nombres ingleses y latinos
const IVviI = [code(0, Q.M), code(7, Q.M), code(9, Q.m), code(5, Q.M)];
assert.deepEqual(parseProgression("I V vi IV"), IVviI);
assert.deepEqual(parseProgression("C-G-Am-F"), IVviI);
assert.deepEqual(parseProgression("Do Sol Lam Fa"), IVviI);
assert.deepEqual(parseProgression("ii-V7-Imaj7"), [code(2, Q.m), code(7, Q.M), code(0, Q.M)]);
assert.deepEqual(parseProgression("i bVII bVI V"), [code(0, Q.m), code(10, Q.M), code(8, Q.M), code(7, Q.M)]);
assert.deepEqual(parseProgression("vii° I+"), [code(11, Q.d), code(0, Q.a)]);
assert.deepEqual(parseProgression("Bbm7 F#"), [code(10, Q.m), code(6, Q.M)]);
assert.equal(parseProgression("hola mundo"), null);
assert.equal(parseProgression("I"), null);

// normalización: séptimas fuera, repetidas fuera, cortos fuera
const n = normalize([C(0), C(0, "7"), { ...C(7), end: 0.1 }, C(9, "m7"), C(5, "maj7"), C(7, "7sus4")]);
assert.deepEqual(n.c, [code(0, Q.M), code(9, Q.m), code(5, Q.M), code(7, Q.M)]);
assert.equal(degreeOf(code(9, Q.m), { tonic: 0, minor: false }), "vi");
assert.equal(degreeOf(code(10, Q.M), { tonic: 0, minor: false }), "bVII");

// invariancia a transposición: la misma progresión en Do y en Mi
const inC = song([[0], [7], [9, "m"], [5], [0], [7], [9, "m"], [5]]);
const inE = song([[4], [11], [1, "m"], [9], [4], [11], [1, "m"], [9]]);
const other = song([[2, "m"], [7], [0], [2, "m"], [7], [0]]);
const idx = new Map([["C", inC], ["E", inE], ["otra", other]]);
const hits = search(IVviI, idx);
assert.deepEqual(hits.map((h) => h.key).sort(), ["C", "E"]);
assert.ok(hits.every((h) => h.score === 1 && h.codes.length === 4));
assert.equal(hits[0].t, 0);
assert.deepEqual(search(parseProgression("ii-V-I")!, idx).map((h) => h.key), ["otra"]);

// relativa: vi IV I V (La menor) está dentro de I V vi IV (Do mayor) rotada
const rot = parseProgression("vi IV I V")!;
const r = search(rot, new Map([["C", inC]]));
assert.equal(r.length, 1);
assert.ok(r[0].score === 1);

// parecidos: un acorde extra por medio baja la nota pero sigue encontrándose; uno distinto no
const extra = song([[0], [7], [2], [9, "m"], [5]]);
const h = align(IVviI, extra.c)!;
assert.ok(h.score > 0.7 && h.score < 1, String(h.score));
assert.ok(search(IVviI, new Map([["x", song([[1], [6], [3], [8]])]])).length === 0);
// ranking: exacta antes que aproximada
assert.deepEqual(search(IVviI, new Map([["aprox", extra], ["exacta", inC]])).map((x) => x.key), ["exacta", "aprox"]);

// bucles: el más repetido primero; sin rotaciones repetidas
const lp = loops(inC.c);
assert.equal(lp.length, 1);
assert.deepEqual(lp[0].codes, IVviI);
// villain: Bm A Bm G (Si menor) frente a I V vi IV: aproximada, se lee «vi V vi IV» en el marco de la consulta
const villain = song([[11, "m"], [9], [11, "m"], [7]], { tonic: 11, minor: true });
const vh = search(IVviI, new Map([["v", villain]]))[0];
assert.ok(vh && !vh.exact && vh.score > 0.8 && vh.score < 1);
assert.equal(vh.same, false); // Si menor ≠ Re mayor: otra escala
assert.equal(vh.tr, 2);
assert.deepEqual(vh.path.map((x) => x.kind), ["rel", "exact", "exact", "exact"]);
assert.deepEqual(chips(vh, villain.key).map((c) => c.deg), ["vi", "V", "vi", "IV"]);
assert.deepEqual(chips(vh, villain.key).map((c) => c.name), ["Bm", "A", "Bm", "G"]);
assert.equal(chips(vh, villain.key)[0].tip, "misma función que I");
// exactas: ruta solo de exactos y contigua; transposición y huecos
const eh = search(IVviI, new Map([["E", inE]]))[0];
assert.ok(eh.exact);
assert.equal(eh.tr, 4);
assert.ok(!align(IVviI, extra.c)!.exact);
assert.equal(align(IVviI, extra.c)!.path.filter((x) => x.kind === "extra").length, 1);
assert.deepEqual(search(IVviI, new Map([["v", villain], ["C", inC]])).map((x) => x.exact), [true, false]);

// misma función dentro de la tonalidad: Do Mi Fa Sol
const cefg = song([[0], [4, "m"], [5], [7]]);
const sc = (q: string) => { const p = parseQuery(q)!; return search(p.codes, new Map([["s", cefg]]), { qkey: p.key })[0]; };
assert.ok(sc("I iii IV V").exact && sc("I iii IV V").same);
for (const q of ["I I IV V", "I vi IV V"]) { const h = sc(q); assert.ok(h.same && !h.exact, q); }
assert.deepEqual(parseQuery("i bVII bVI V")!.key, { tonic: 0, minor: true });
assert.deepEqual(parseQuery("Am F C G")!.key.tonic === 9 || parseQuery("Am F C G")!.key.tonic === 0, true);

// tonalidad dudosa: Lab Mib Fam Reb (bucle del eje) → Exactas con ambas lecturas; un i VII i VI claro → otra escala
const mk = (list: [number, string, number][]) => { let t = 0; return list.map(([root, kind, d]) => ({ t, end: (t += d), root, kind, bass: root })); };
const axis = normalize(mk(Array.from({ length: 4 }, () => [[8, "", 2], [3, "", 2], [5, "m", 2], [1, "", 2]] as [number, string, number][]).flat()));
assert.ok(axis.alt, "eje: dudosa");
const ah = search(IVviI, new Map([["a", axis]]))[0];
assert.ok(ah.exact && ah.same && ah.amb, "eje: exacta en alguna lectura");
assert.deepEqual(chips(ah, ah.songKey).map((c) => c.name), ["Ab", "Eb", "Fm", "Db"]);
assert.deepEqual(ah.amb!.map((k) => k.minor).sort(), [false, true]);
const aeol = normalize(mk(Array.from({ length: 4 }, () => [[9, "m", 8], [7, "", 2], [9, "m", 8], [5, "", 2]] as [number, string, number][]).flat()));
assert.equal(aeol.alt, undefined, "Am G Am F largo: Am claro");
const eh2 = search(IVviI, new Map([["e", aeol]]))[0];
assert.ok(eh2 && !eh2.same && !eh2.amb, "otra escala");

console.log("progression ok");
