/** Progreso del curso (curso/progreso.json): el mejor resultado de cada práctica, las lecciones abiertas y los días en
 * que se practicó (la racha). Solo del curso: sus ejercicios, canciones y obras son fiables, a diferencia de lo
 * transcrito con IA, así que tiene sentido puntuarlos. */

import { paths, readJson, writeJson } from "./engine";
import { LESSONS, practiceSteps, stars, type Lesson } from "./course";
import { grade, type EarState, type Kind } from "./ear";

type Result = { best: number; tries: number; last: number };
export const progress = $state({
  results: {} as Record<string, Result>, // «lección#paso»
  opened: {} as Record<string, number>, // lección → cuándo se abrió por última vez
  days: [] as string[], // AAAA-MM-DD con práctica
  loaded: false,
});

const file = () => `${paths.data}/curso/progreso.json`;
const today = () => new Date().toLocaleDateString("sv"); // AAAA-MM-DD, hora local
export const stepKey = (lesson: string, step: number) => `${lesson}#${step}`;

export async function loadProgress() {
  if (progress.loaded) return;
  Object.assign(progress, await readJson(file(), { results: {}, opened: {}, days: [] }), { loaded: true });
}

const save = () => writeJson(file(), { results: progress.results, opened: progress.opened, days: progress.days });

/** Una práctica terminada con precisión `acc` (0-1). */
export async function record(lesson: string, step: number, acc: number) {
  await loadProgress();
  const k = stepKey(lesson, step), r = progress.results[k];
  progress.results[k] = { best: Math.max(r?.best ?? 0, acc), tries: (r?.tries ?? 0) + 1, last: Date.now() };
  markDay();
  await save();
}

function markDay() {
  if (progress.days.includes(today())) return false;
  progress.days = [...progress.days, today()];
  return true;
}

// ---------------------------------------------------------------- entrenador de oído (curso/oido.json)

export const ear = $state<EarState & { loaded: boolean }>({ items: {}, kinds: {}, loaded: false });
const earFile = () => `${paths.data}/curso/oido.json`;

export async function loadEar() {
  if (ear.loaded) return;
  Object.assign(ear, await readJson(earFile(), { items: {}, kinds: {} }), { loaded: true });
}

/** Una respuesta del entrenador: su repaso (Leitner y nivel) y el día de práctica. Devuelve el cambio de nivel. */
export async function recordEar(kind: Kind, item: string, ok: boolean) {
  await Promise.all([loadEar(), loadProgress()]);
  const change = grade(ear, kind, item, ok, Date.now());
  await Promise.all([writeJson(earFile(), { items: ear.items, kinds: ear.kinds }), markDay() && save()]);
  return change;
}

export async function markOpened(lesson: string) {
  await loadProgress();
  progress.opened[lesson] = Date.now();
  await save();
}

export const bestOf = (lesson: string, step: number) => progress.results[stepKey(lesson, step)]?.best;

/** Una lección está hecha cuando todas sus prácticas llegan a su objetivo (por defecto, el 85 %). */
export function lessonDone(l: Lesson) {
  return practiceSteps(l).every(([s, i]) => (bestOf(l.id, i) ?? 0) >= (s.goal ?? 0.85));
}

/** Estrellas de la lección: la media de sus prácticas (0-3). */
export function lessonStars(l: Lesson) {
  const ps = practiceSteps(l);
  return ps.length ? Math.floor(ps.reduce((n, [, i]) => n + stars(bestOf(l.id, i)), 0) / ps.length) : 0;
}

/** Días seguidos practicando hasta hoy (o hasta ayer, si hoy aún no). */
export function streak() {
  const set = new Set(progress.days);
  const d = new Date();
  if (!set.has(today())) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(d.toLocaleDateString("sv"))) (n++, d.setDate(d.getDate() - 1));
  return n;
}

/** La siguiente recomendada: la primera de la ruta sin hacer cuyos requisitos están hechos (o la primera sin hacer). */
export function nextLesson() {
  const route = [...LESSONS].sort((a, b) => a.stage - b.stage);
  const done = new Set(route.filter(lessonDone).map((l) => l.id));
  return route.find((l) => !done.has(l.id) && (l.requires ?? []).every((r) => done.has(r))) ?? route.find((l) => !done.has(l.id)) ?? null;
}

/** Cuánto del curso está hecho (0-1). */
export const courseDone = () => LESSONS.filter(lessonDone).length / LESSONS.length;
