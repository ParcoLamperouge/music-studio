import assert from "node:assert/strict";
import { Practice } from "./arrange.ts";
import { accuracy, hardZones, tally, wrongAt, type Bars } from "./zones.ts";

// compases de 2 s; dos notas por compás en los 6 primeros
const notes = Array.from({ length: 12 }, (_, i) => ({ t: i, p: 60 + (i % 5), hand: "rh" as const }));
const barAt = (t: number) => Math.floor(t / 2);
const bars: Bars = {};
const pr = new Practice(notes);
// se aciertan todas menos las del compás 2 (t 4 y 5); una nota de más en el 3
for (const n of notes) if (barAt(n.t) !== 2) pr.press(n.p, n.t + 0.05);
wrongAt(bars, 3);
tally(bars, pr.targets, 4.1, pr.tol, barAt);
assert.equal(bars[2]?.tries, undefined, "la del instante 4 aún se puede tocar: no cuenta");
tally(bars, pr.targets, 20, pr.tol, barAt);
assert.deepEqual([bars[0].tries, bars[0].hits, bars[2].hits, bars[3].wrong], [2, 2, 0, 1]);
assert.ok(Math.abs(bars[0].err - 0.1) < 1e-9);
tally(bars, pr.targets, 20, pr.tol, barAt);
assert.equal(bars[0].tries, 2, "cada nota cuenta una vez por pasada");
pr.reset(0);
for (const n of notes) pr.press(n.p, n.t);
tally(bars, pr.targets, 20, pr.tol, barAt);
assert.equal(bars[0].tries, 4, "otra pasada, otra vez");
assert.equal(accuracy(bars[3]), 4 / 5);
assert.equal(accuracy(undefined), null);

// zonas: los compases malos se juntan con sus vecinos (uno bueno en medio no corta) y van de peor a mejor
const z: Bars = {
  1: { tries: 10, hits: 9, err: 0, wrong: 0 }, 4: { tries: 10, hits: 5, err: 0, wrong: 0 }, 5: { tries: 10, hits: 9, err: 0, wrong: 0 },
  6: { tries: 10, hits: 6, err: 0, wrong: 0 }, 12: { tries: 8, hits: 2, err: 0, wrong: 2 }, 20: { tries: 2, hits: 0, err: 0, wrong: 0 },
};
const zones = hardZones(z);
assert.deepEqual(zones.map((x) => [x.from, x.to]), [[12, 12], [4, 6]], "el 20 tiene pocos datos; 4-6 juntos");
assert.equal(zones[0].acc, 0.2);
assert.equal(zones[1].acc, 20 / 30);
console.log("zonas ok");
