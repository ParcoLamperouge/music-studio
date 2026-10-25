import assert from "node:assert/strict";
import { barStarts, cleanBeats, firstDownbeat, meterLabel } from "./beats.ts";

// 4/4 a 120 bpm desde el segundo 1; downbeats cada 4 pulsos (2 s)
const beats = Array.from({ length: 40 }, (_, i) => 1 + i * 0.5);
const downs = Array.from({ length: 10 }, (_, i) => 1 + i * 2);

// el compuesto lleva corchea: 6/8, no 6/4
assert.equal(meterLabel(2), "2/4");
assert.equal(meterLabel(3), "3/4");
assert.equal(meterLabel(4), "4/4");
assert.equal(meterLabel(5), "5/4");
assert.equal(meterLabel(6), "6/8");
assert.equal(meterLabel(9), "9/8");
assert.equal(meterLabel(12), "12/8");

// la fase más votada entre los downbeats gana; uno suelto desviado no mueve el compás
assert.equal(firstDownbeat(beats, downs, 4), 0);
assert.equal(firstDownbeat(beats, [1.51, 5.01, 9.01], 4), 8, "un downbeat en el pulso 1 no desvía la fase 0");
assert.equal(firstDownbeat(beats, [2.01, 4.01, 6.01], 4), 2, "fase 2 constante");
assert.equal(firstDownbeat(beats, [], 4), 0, "sin downbeats, el primer pulso");

// limpiar: duplicados fuera, huecos rellenados al tempo local
assert.deepEqual(cleanBeats([1, 1.05, 1.5, 2, 2.4]), [1, 1.5, 2, 2.4]);
const gappy = [1, 1.5, 2, 2.5, 3, 5.5, 6, 6.5, 7, 7.5, 8]; // hueco de 2,5 s a 0,5 s/pulso
assert.equal(cleanBeats(gappy).length, 15, "el hueco se rellena con 4 pulsos");

// compases hasta `until`, cola extrapolada al último intervalo (extend_tail)
const bars = barStarts({ beats, downbeats: downs, meter: 4 }, 30);
assert.equal(bars[0], 1);
assert.equal(bars[1], 3);
assert.equal(bars.length, 15, "10 reales + 5 de cola (cada 2 s hasta 30)");
assert.equal(bars[14], 29, "el último de la cola cae en la rejilla");
// fase 2: el primer compás no está en el primer pulso
assert.deepEqual(barStarts({ beats, downbeats: [2.01, 4.01], meter: 4 }, 4).slice(0, 2), [2, 4]);
assert.deepEqual(barStarts({ beats: [], meter: 4 }, 30), [], "sin pulsos no hay compases");
