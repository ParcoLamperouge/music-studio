import { catalog, finished, listJobs, nowPlaying, onChanged, onJobs, onPlayer, type Job, type Playing, type Track } from "./engine";

/** Estado compartido: catálogo y cola, al día con los eventos de Rust. */
export const store = $state({
  tracks: [] as Track[],
  jobs: [] as Job[],
  error: "",
  /** sube cada vez que cambian ficheros de una canción: la vista abierta se recarga */
  rev: {} as Record<string, number>,
  /** lo que suena en Spotify (null si nada) */
  playing: null as Playing | null,
});

let timer: ReturnType<typeof setTimeout> | undefined;
/** Catálogo otra vez, agrupando ráfagas (cada paso de la cola avisa). */
export function refresh(now = false) {
  clearTimeout(timer);
  timer = setTimeout(
    () =>
      catalog().then(
        (t) => ((store.tracks = t), (store.error = "")),
        (e) => (store.error = String(e)),
      ),
    now ? 0 : 250,
  );
}

export async function connect() {
  store.jobs = await listJobs();
  refresh(true);
  await onJobs((j) => (store.jobs = j));
  store.playing = await nowPlaying();
  await onPlayer((p) => (store.playing = p));
  await onChanged((keys) => {
    for (const k of keys) store.rev[k] = (store.rev[k] ?? 0) + 1;
    refresh();
  });
}

/** Etapa de la canción que toca cada acción (para los pilotos y los botones). */
export const STAGE: Record<string, Stage> = {
  audio: "audio", import: "audio", letra: "letra", find: "letra", sync: "letra", autosync: "letra", separate: "pistas", notes: "notas", beats: "pistas", chords: "notas", render: "edits",
};
export type Stage = "audio" | "letra" | "pistas" | "notas" | "edits";

export const live = (key: string) => store.jobs.filter((j) => j.key === key && !finished(j));

/** El trabajo pendiente (o el último que falló) de una acción en una canción. */
export function jobOf(key: string, action: string | string[], arg?: string) {
  const actions = Array.isArray(action) ? action : [action];
  const match = (j: Job) => j.key === key && actions.includes(j.action) && (arg == null || j.args[0] === arg);
  const pending = store.jobs.find((j) => match(j) && !finished(j));
  if (pending) return pending;
  // el último terminado, solo si falló (si luego salió bien, el error ya no cuenta)
  const last = store.jobs.filter((j) => match(j) && finished(j)).sort((a, b) => b.finished - a.finished)[0];
  return last?.status === "error" ? last : undefined;
}

export const stageBusy = (key: string, stage: Stage) => live(key).some((j) => STAGE[j.action] === stage);

/** Texto corto del estado de un trabajo, para botones y filas. */
export function jobText(j: Job) {
  if (j.status === "error") return j.error;
  if (j.waiting) return j.waiting;
  if (j.status === "running") return `${j.label}${j.pct != null ? ` · ${Math.round(j.pct)} %` : ""}`;
  if (j.status === "planning") return "Preparando…";
  const next = j.steps[j.cur];
  if (j.status === "ready" && next?.res === "gpu") return "Esperando la GPU";
  if (j.status === "queued" && j.after.length) return "Esperando a lo anterior";
  return "En cola";
}
