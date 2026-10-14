import assert from "node:assert/strict";
import { keyOf, LESSONS, practiceSteps, STAGES, stars } from "./course.ts";
import { EXERCISES } from "./exercises.ts";
import { OBRAS } from "./obras.ts";
import { midiOf, SONGS } from "./songs.ts";

const ids = new Set(LESSONS.map((l) => l.id));
assert.equal(ids.size, LESSONS.length, "ids de lección distintos");
for (const l of LESSONS) {
  assert.ok(l.stage >= 1 && l.stage <= STAGES.length, l.id);
  for (const r of [...(l.requires ?? []), ...(l.related ?? [])]) assert.ok(ids.has(r), `${l.id}: «${r}» no existe`);
  assert.ok(l.steps.some((s) => "t" in s) && practiceSteps(l).length, `${l.id}: teoría y práctica`);
  for (const s of l.steps) {
    if ("t" in s) for (const k of s.keys ?? []) midiOf(k); // las teclas se entienden
    else {
      const p = s.p;
      if (p.kind === "ejercicio") (assert.ok(EXERCISES.some((e) => e.id === p.id), `${l.id}: ejercicio ${p.id}`), keyOf(p.key));
      if (p.kind === "cancion") assert.ok(SONGS.some((x) => x.id === p.id), `${l.id}: canción ${p.id}`);
      if (p.kind === "obra") assert.ok(OBRAS.some((x) => x.id === p.id), `${l.id}: obra ${p.id}`);
    }
  }
}
// lo que se pide antes está en una etapa anterior o la misma (sin ciclos)
const stageOf = new Map(LESSONS.map((l) => [l.id, l.stage]));
for (const l of LESSONS) for (const r of l.requires ?? []) assert.ok(stageOf.get(r)! <= l.stage, `${l.id} pide ${r}, que va después`);
const seen = new Set<string>(), visiting = new Set<string>();
const visit = (id: string) => {
  assert.ok(!visiting.has(id), `ciclo en ${id}`);
  if (seen.has(id)) return;
  visiting.add(id);
  for (const r of LESSONS.find((l) => l.id === id)!.requires ?? []) visit(r);
  visiting.delete(id);
  seen.add(id);
};
LESSONS.forEach((l) => visit(l.id));
// todas las etapas tienen algo
for (let i = 1; i <= STAGES.length; i++) assert.ok(LESSONS.some((l) => l.stage === i), `etapa ${i}`);
assert.deepEqual([keyOf("Sol"), keyOf("La menor"), keyOf("Mib")], [{ tonic: 7, minor: false }, { tonic: 9, minor: true }, { tonic: 3, minor: false }]);
assert.deepEqual([stars(undefined), stars(0.5), stars(0.7), stars(0.9), stars(0.97)], [0, 0, 1, 2, 3]);
console.log(`curso ok (${LESSONS.length} lecciones, ${LESSONS.reduce((n, l) => n + practiceSteps(l).length, 0)} prácticas)`);
