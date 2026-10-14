import assert from "node:assert/strict";
import { midiOf, parseLine, SONGS, songPiece } from "./songs.ts";

assert.deepEqual([midiOf("Do4"), midiOf("La4"), midiOf("Sol#4"), midiOf("Sib3"), midiOf("Do-1")], [60, 69, 68, 58, 0]);
assert.throws(() => midiOf("H4"));
assert.deepEqual(parseLine("Do4 Re4:2 | -:1 Do3+Mi3+Sol3:4", "rh").map((n) => [n.b, n.d, n.p]), [[0, 1, 60], [1, 2, 62], [4, 4, 48], [4, 4, 52], [4, 4, 55]]);
assert.throws(() => parseLine("Do4:x", "rh"));
// cada canción: la izquierda dura lo mismo que la derecha, todo en el piano y en su compás
for (const s of SONGS) {
  const rh = parseLine(s.rh, "rh"), lh = s.lh ? parseLine(s.lh, "lh") : [];
  const end = (ns: { b: number; d: number }[]) => Math.max(...ns.map((n) => n.b + n.d));
  if (lh.length) assert.equal(end(lh), end(rh), `${s.id}: las dos manos acaban a la vez`);
  assert.ok(end(rh) % s.meter === 0 || s.id === "cumple", `${s.id}: compases completos (${end(rh)} / ${s.meter})`);
  const pc = songPiece(s);
  assert.ok(pc.notes.every((n) => n.p >= 36 && n.p <= 96));
  assert.ok(pc.id.startsWith("cancion-"));
}
assert.equal(new Set(SONGS.map((s) => s.id)).size, SONGS.length);
console.log("canciones ok");
