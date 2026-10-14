import assert from "node:assert/strict";
import { chordFn, sectionsFromLyrics } from "./music.ts";

const C = { tonic: 0, minor: false }, Am = { tonic: 9, minor: true };
const fn = (root: number, kind: string, k = C) => chordFn({ root, kind }, k);
assert.equal(fn(0, "").fn, "tonic");
assert.equal(fn(2, "m7").fn, "sub");
assert.equal(fn(2, "m7").minor, true);
assert.equal(fn(5, "").fn, "sub");
assert.equal(fn(7, "7").fn, "dom");
assert.equal(fn(11, "dim").fn, "dom");
assert.equal(fn(9, "m").fn, "vi");
assert.equal(fn(4, "m").fn, "iii");
assert.equal(fn(10, "").fn, "other"); // bVII prestado
assert.equal(fn(10, "").borrowed, true);
assert.equal(fn(9, "m", Am).fn, "tonic");
assert.equal(fn(4, "", Am).fn, "dom"); // V de la armónica
assert.equal(fn(7, "", Am).fn, "dom"); // VII natural
assert.equal(fn(5, "", Am).fn, "vi"); // VI

const L = (t: number, text: string) => ({ t, text });
const s = sectionsFromLyrics(
  [L(8, "uno"), L(12, "dos"), L(16, "coro a"), L(20, "coro b"), L(40, "tres"), L(44, "cuatro"), L(48, "coro a"), L(52, "coro b")],
  70,
);
assert.deepEqual(s.map((x) => x.kind), ["intro", "verse", "chorus", "inst", "verse", "chorus", "outro"]);
assert.equal(s[0].end, 8);
assert.equal(s[3].t, 25);
assert.deepEqual(sectionsFromLyrics([], 100), []);
console.log("music ok");
