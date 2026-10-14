import assert from "node:assert/strict";
import { toMusicXML } from "./arrange.ts";
import { toMidi } from "./live.ts";
import { fromMidi, fromMusicXML, fromSession, importPiece, newPiece, parseXml, pieceArrangement, pieceEvents, unzipMxl, type Piece } from "./piece.ts";

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
console.log("piezas ok");
