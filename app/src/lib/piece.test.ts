import assert from "node:assert/strict";
import { arrange, toMusicXML, type ANote } from "./arrange.ts";
import { analyze, tonesOf } from "./harmony.ts";
import { readFileSync } from "node:fs";
import { toMidi } from "./live.ts";
import { beatToSec, fromMidi, fromMusicXML, fromSession, pieceBeats, pieceDuration, pieceSeconds, secToBeat, playOrder, type Bar, importPiece, newPiece, parseXml, pieceArrangement, pieceEvents, unzipMxl, type Piece } from "./piece.ts";

const pc: Piece = { ...newPiece("Prueba"), bpm: 100, notes: [
  { b: 0, d: 1, p: 72, v: 0.8, hand: "rh" }, { b: 1, d: 0.5, p: 74, v: 0.8, hand: "rh" }, { b: 1.5, d: 0.5, p: 74, v: 0.8, hand: "rh" },
  { b: 0, d: 2, p: 48, v: 0.6, hand: "lh" }, { b: 0, d: 2, p: 55, v: 0.6, hand: "lh" },
] };
const round = (ns: { b: number; d: number; p: number }[]) => ns.map((n) => [Math.round(n.b * 100) / 100, Math.round(n.d * 100) / 100, n.p]).sort((a, b) => a[0] - b[0] || a[2] - b[2]);

// MIDI: ida y vuelta con su tempo; la nota repetida (Re-Re) sigue siendo dos
const mid = fromMidi(toMidi(pieceEvents(pc), pc.bpm));
assert.equal(mid.bpm, 100);
assert.deepEqual(round(mid.notes), round(pc.notes));
assert.deepEqual(mid.notes.filter((n) => n.p < 60).map((n) => n.hand), ["lh", "lh"], "una pista: se reparte en el Do central");

// MIDI tipo 1 con dos pistas: la aguda es la derecha aunque tenga notas graves
const trk = (bytes: number[]) => [..."MTrk"].map((c) => c.charCodeAt(0)).concat([0, 0, 0, bytes.length], bytes);
const two = new Uint8Array([
  ..."MThd".split("").map((c) => c.charCodeAt(0)), 0, 0, 0, 6, 0, 1, 0, 2, 0, 96,
  ...trk([0, 0x90, 72, 90, 96, 0x80, 72, 0, 0, 0x90, 55, 90, 96, 0x80, 55, 0, 0, 0xff, 0x2f, 0]),
  ...trk([0, 0x91, 40, 90, 0x60, 0x81, 40, 0, 0, 0xff, 0x2f, 0]), // 0x60 = 96: una negra
]);
const m2 = fromMidi(two);
assert.deepEqual(m2.notes.map((n) => [n.p, n.hand]), [[72, "rh"], [40, "lh"], [55, "rh"]]);

// MusicXML a mano: dos pentagramas, acorde, vuelta atrás (backup), ligadura que cruza la barra, silencio, alteración, adorno
const xml = `<?xml version="1.0"?><!DOCTYPE score-partwise><score-partwise version="4.0"><work><work-title>Nana &amp; co</work-title></work>
<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1">
<measure number="1"><attributes><divisions>2</divisions><key><fifths>-1</fifths><mode>minor</mode></key><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves></attributes>
<direction><sound tempo="72"/></direction>
<note><grace/><pitch><step>E</step><octave>5</octave></pitch><voice>1</voice><staff>1</staff></note>
<note><pitch><step>D</step><octave>5</octave></pitch><duration>2</duration><staff>1</staff></note>
<note><chord/><pitch><step>F</step><octave>5</octave></pitch><duration>2</duration><staff>1</staff></note>
<note><rest/><duration>2</duration><staff>1</staff></note>
<note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>2</duration><tie type="start"/><staff>1</staff></note>
<backup><duration>6</duration></backup>
<note><pitch><step>D</step><octave>3</octave></pitch><duration>6</duration><staff>2</staff></note>
</measure>
<measure number="2"><note><pitch><step>B</step><alter>-1</alter><octave>4</octave></pitch><duration>3</duration><tie type="stop"/><staff>1</staff></note></measure>
</part></score-partwise>`;
const x = fromMusicXML(xml);
assert.equal(x.title, "Nana & co");
assert.deepEqual([x.bpm, x.meter, x.key], [72, 3, { tonic: 2, minor: true }]);
// Re3 redonda con puntillo abajo; Re5+Fa5 negra; silencio; Sib4 ligado a la barra (1 + 1,5 negras); el adorno no cuenta
assert.deepEqual(x.notes.map((n) => [n.b, n.d, n.p, n.hand]), [[0, 3, 50, "lh"], [0, 1, 74, "rh"], [0, 1, 77, "rh"], [2, 2.5, 70, "rh"]]);
assert.deepEqual(parseXml("<a x='1'>t<b/>u</a>").kids[0], { tag: "a", attrs: { x: "1" }, kids: [{ tag: "b", attrs: {}, kids: [], text: "" }], text: "tu" });

// la partitura que escribe la app se vuelve a leer igual (ida y vuelta)
const back = fromMusicXML(toMusicXML(pieceArrangement(pc, { tonic: 0, minor: false }), "Prueba"));
assert.deepEqual(round(back.notes), round(pc.notes));
assert.deepEqual(back.notes.filter((n) => n.p < 60).map((n) => n.hand), ["lh", "lh"]);

// .mxl: zip guardado y comprimido (deflate)
const zip = async (files: Record<string, string>, deflate: boolean) => {
  const enc = new TextEncoder();
  const parts: number[] = [], central: number[] = [];
  const u16 = (n: number) => [n & 255, n >> 8], u32 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24];
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = deflate ? new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()) : raw;
    const nb = enc.encode(name), off = parts.length;
    parts.push(...u32(0x04034b50), ...u16(20), 0, 0, ...u16(deflate ? 8 : 0), 0, 0, 0, 0, ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(nb.length), 0, 0, ...nb, ...data);
    central.push(...u32(0x02014b50), ...u16(20), ...u16(20), 0, 0, ...u16(deflate ? 8 : 0), 0, 0, 0, 0, ...u32(0), ...u32(data.length), ...u32(raw.length), ...u16(nb.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(off), ...nb);
  }
  const n = Object.keys(files).length, cdOff = parts.length;
  return new Uint8Array([...parts, ...central, ...u32(0x06054b50), 0, 0, 0, 0, ...u16(n), ...u16(n), ...u32(central.length), ...u32(cdOff), 0, 0]);
};
const container = `<?xml version="1.0"?><container><rootfiles><rootfile full-path="score/main.musicxml"/></rootfiles></container>`;
for (const deflate of [false, true]) {
  const mxl = await zip({ "META-INF/container.xml": container, "score/main.musicxml": xml }, deflate);
  assert.equal(await unzipMxl(mxl), xml);
  assert.equal((await importPiece("Nana.mxl", mxl)).notes.length, x.notes.length);
}
await assert.rejects(importPiece("x.pdf", new Uint8Array()), /Formato/);
// una sesión (segundos) como pieza a 120 bpm
const fs = fromSession([[0.5, 1, 64, 0.8], [0.5, 2, 48, 0.6]], "Sesión");
assert.deepEqual(fs.notes.map((n) => [n.b, n.d, n.p, n.hand]), [[1, 1, 64, "rh"], [1, 3, 48, "lh"]]);
// repeticiones: el orden de los compases
assert.deepEqual(playOrder([{ forward: true }, { backward: 2 }, {}]), [0, 1, 0, 1, 2], "|: A B :| C");
assert.deepEqual(playOrder([{}, { forward: true }, { backward: 3 }]), [0, 1, 2, 1, 2, 1, 2], "A |: B C :| ×3");
assert.deepEqual(playOrder([{ backward: 2 }, {}]), [0, 0, 1], "sin barra de inicio: desde el principio");
assert.deepEqual(playOrder([{ forward: true }, { endings: [1], backward: 2 }, { endings: [2] }, {}]), [0, 1, 0, 2, 3], "1.ª y 2.ª casilla");
assert.deepEqual(playOrder([{ forward: true }, {}, { endings: [1, 2], backward: 3 }, { endings: [3] }]), [0, 1, 2, 0, 1, 2, 0, 1, 3], "casilla 1-2 y 3.ª");
assert.deepEqual(playOrder([{}, { fine: true }, { dacapo: true }]), [0, 1, 2, 0, 1], "D.C. al Fine");
const ds: Bar[] = [{}, { segno: true }, { tocoda: true }, { dalsegno: true }, { coda: true }];
assert.deepEqual(playOrder(ds), [0, 1, 2, 3, 1, 2, 4], "D.S. al Coda");
assert.deepEqual(playOrder([{ forward: true }, { backward: 2 }, { dacapo: true }]), [0, 1, 0, 1, 2, 0, 1, 2], "tras el D.C. no se repite otra vez");

// en el MusicXML: anacrusa, sección repetida con 1.ª y 2.ª casilla
const bar = (n: number, extra = "", note = `<note><pitch><step>C</step><octave>5</octave></pitch><duration>4</duration></note>`) =>
  `<measure number="${n}"${n === 0 ? ' implicit="yes"' : ""}>${extra}${note}</measure>`;
const rep = `<score-partwise><part-list/><part id="P1">
<measure number="0" implicit="yes"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration></note></measure>
${bar(1, '<barline location="left"><repeat direction="forward"/></barline>')}
${bar(2, '<barline location="left"><ending number="1" type="start"/></barline><barline location="right"><ending number="1" type="stop"/><repeat direction="backward"/></barline>', `<note><pitch><step>D</step><octave>5</octave></pitch><duration>4</duration></note>`)}
${bar(3, '<barline location="left"><ending number="2" type="start"/></barline><barline location="right"><ending number="2" type="discontinue"/></barline>', `<note><pitch><step>E</step><octave>5</octave></pitch><duration>4</duration></note>`)}
</part></score-partwise>`;
const r = fromMusicXML(rep);
assert.deepEqual(r.notes.map((n) => [n.b, n.p]), [[0, 67], [1, 72], [5, 74], [9, 72], [13, 76]], "anacrusa, A, 1.ª, A, 2.ª");
// cambios de tempo: 2 negras a 60 (2 s) y luego a 120 (medio segundo cada una)
const tm: Piece = { ...newPiece("t"), bpm: 60, tempos: [[0, 60], [2, 120]] };
assert.deepEqual([beatToSec(tm, 1), beatToSec(tm, 2), beatToSec(tm, 4)], [1, 2, 3]);
assert.deepEqual([secToBeat(tm, 1), secToBeat(tm, 2), secToBeat(tm, 3)], [1, 2, 4]);
console.log("piezas ok");

// obra de verdad (Kuhlau, Sonatina op. 20 n.º 1), por el camino de Aprender: los arreglos se parecen al original. La
// melodía es la voz de arriba de la derecha; el bajo Alberti (Do-Sol-Mi-Sol) es Do, no Sol (la quinta suena el doble)
{
  const pc = fromMidi(new Uint8Array(readFileSync(new URL("../../public/obras/m232.mid", import.meta.url))));
  const ns = [{ stem: "piano", notes: pieceSeconds(pc, "rh") }, { stem: "bass", notes: pieceSeconds(pc, "lh") }];
  const bs = pieceBeats(pc);
  const h = analyze(ns, bs, pieceDuration(pc));
  assert.equal(h.chords[0].bass, 0, "Do con bajo Alberti: Do, no Do/Sol");
  const top = (xs: ANote[], x: number) => Math.max(-1, ...xs.filter((n) => n.b <= x + 1e-6 && x < n.b + n.d - 1e-6).map((n) => n.p));
  const rh = pc.notes.filter((n) => n.hand === "rh"), end = Math.max(...rh.map((n) => n.b + n.d));
  for (const [level, min] of [[1, 0.65], [2, 0.9], [3, 0.9], [4, 0.9]] as const) {
    const a = arrange({ melody: ns[0].notes, piano: ns[0].notes, bass: ns[1].notes, chords: h.chords, beats: bs, downbeats: [0], meter: pc.meter, key: h.key, level, style: "clasico" });
    let n = 0, ok = 0;
    for (let x = 0; x < end; x += 0.5) {
      const o = top(rh, x), r = top(a.rh, x);
      if (o >= 0) (n++, (ok += +(r >= 0 && (r - o) % 12 === 0)));
    }
    assert.ok(ok / n >= min, `nivel ${level}: la melodía es la del original (${ok}/${n})`);
    // los tres primeros compases son Do: la izquierda, solo notas de Do (el 1, el bajo Do; el 2 nada de Sol+Re)
    const lh = a.lh.filter((x) => x.b < 12);
    if (level <= 2) assert.ok(lh.length && lh.every((x) => [0, 4, 7].includes(x.p % 12)) && lh[0].p % 12 === 0, `nivel ${level}: ${lh.map((x) => x.p)}`);
    // y en toda la obra, el bajo y su quinta son notas del acorde (con inversión, «bajo + 7» no lo es: Sol/Si daba Fa#)
    if (level === 2) for (const x of a.lh) {
      const t = beatToSec(pc, x.b), c = h.chords.find((c) => c.t <= t + 1e-6 && t < c.end)!;
      assert.ok(tonesOf(c.kind).some((i) => (c.root + i) % 12 === x.p % 12), `nivel 2: ${x.p} en el acorde de ${x.b}`);
    }
  }
  // la forma de la melodía en todos los niveles y estilos: cada nota del arreglo con la del original de la que sale
  // (misma nota, a menos de un pulso); entre dos seguidas, si el original sube el arreglo sube (las octavas por frases
  // no la rompen); y las cumbres (la más aguda en dos pulsos alrededor) siguen siendo cumbre
  const orig: ANote[] = [];
  for (const n of [...rh].sort((x, y) => x.b - y.b || y.p - x.p)) {
    const l = orig[orig.length - 1];
    if (l && (n.b - l.b < 1e-3 || (n.b < l.b + l.d - 1e-3 && n.p < l.p))) continue; // voz interior
    if (l && n.b < l.b + l.d) l.d = n.b - l.b;
    orig.push({ ...n });
  }
  const isPeak = (xs: ANote[], i: number) => xs.every((y, j) => j === i || Math.abs(y.b - xs[i].b) > 2 || y.p < xs[i].p || (y.p === xs[i].p && j > i));
  for (const style of ["clasico", "pop"] as const)
    for (const [level, minCtr, minPeak] of [[1, 0.9, 0.8], [2, 0.97, 0.97], [3, 0.97, 0.97], [4, 0.97, 0.97], [6, 0.97, 0.97], [7, 0.97, 0.97]] as const) {
      const a = arrange({ melody: ns[0].notes, chords: h.chords, beats: bs, downbeats: [0], meter: pc.meter, key: h.key, level, style });
      const byOnset = new Map<number, ANote>();
      for (const n of a.rh) if ((byOnset.get(n.b)?.p ?? -1) < n.p) byOnset.set(n.b, n); // la de arriba de cada golpe
      const tops = [...byOnset.values()].sort((x, y) => x.b - y.b);
      const src = (y: ANote) => orig.filter((x) => (x.p - y.p) % 12 === 0 && Math.abs(x.b - y.b) <= 1).sort((x, z) => Math.abs(x.b - y.b) - Math.abs(z.b - y.b))[0];
      let same = 0, steps = 0;
      for (let i = 1; i < tops.length; i++) {
        const [x1, x2] = [src(tops[i - 1]), src(tops[i])];
        if (!x1 || !x2 || x1.p === x2.p) continue;
        steps++;
        same += +(Math.sign(x2.p - x1.p) === Math.sign(tops[i].p - tops[i - 1].p));
      }
      assert.ok(same / steps >= minCtr, `${style} nivel ${level}: la melodía sube y baja como la original (${same}/${steps})`);
      const peaks = orig.filter((x, i) => x.d >= 0.25 && isPeak(orig, i));
      const kept = peaks.filter((x) => tops.some((y, j) => (y.p - x.p) % 12 === 0 && Math.abs(y.b - x.b) <= 1 && isPeak(tops, j)));
      assert.ok(kept.length / peaks.length >= minPeak, `${style} nivel ${level}: las cumbres (${kept.length}/${peaks.length})`);
      if (process.env.DEBUG) console.log(style, level, same / steps, kept.length / peaks.length);
    }
}
console.log("obra ok");
