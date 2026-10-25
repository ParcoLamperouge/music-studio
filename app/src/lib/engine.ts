import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// ---------------------------------------------------------------- tipos

/** Pista de StemLab (meta.json). */
export type Stem = {
  name: string;
  file: string;
  level: number;
  present: boolean;
  score?: string;
  midi?: string;
  roll?: string;
  notes?: number;
  version?: number;
  beauty?: string; // partitura de piano legible (beautify.py): dos manos cuadradas a los pulsos
  beautyRoll?: string;
  beautyVersion?: number;
};
/** Pista midi derivada (meta.json «tracks»): una versión optimizada del roll de un stem. */
export type MidiTrack = {
  name: string; // p. ej. «piano.opt2»
  kind: string; // "midi"
  of: string; // el stem del que sale
  from?: string; // de qué pista (stem o otra midi) parte esta versión
  range?: [number, number] | null; // compases (0-based) que rehace; null: toda la pista
  roll: string;
  score?: string | null;
  version?: number;
};
/** Canción separada de StemLab (meta.json + dir). */
export type Song = { id: string; title: string; dir: string; mix: string; bpm?: number; beats?: string; stems: Stem[]; tracks?: MidiTrack[] };

export type Word = { t: number; end?: number; w: string; p?: number };
export type Line = { t: number | null; end?: number; text: string; words?: Word[] };
/** Documento de letra de Letras (lyrics/<clave>.json). */
export type Lyrics = {
  key: string;
  artist: string;
  title: string;
  source: string;
  times_from?: string;
  synced: boolean;
  synced_by?: "ia";
  ai_mode?: "whisper" | "lineas";
  instrumental: boolean;
  edited?: boolean;
  offset?: number;
  word_offset?: number;
  hidden?: boolean;
  note?: string;
  duration?: number;
  audio_checked?: boolean; // el audio local es la versión de los tiempos de la letra (comprobado con Whisper)
  audio_shift?: number; // lo que se recortó (o se le puso delante) al audio para que lo fuera
  lines: Line[];
};

export type LyricsInfo = {
  status: "words" | "lines" | "plain" | "instrumental" | "empty";
  source?: string;
  times_from?: string;
  synced_by?: string;
  ai_mode?: string;
  edited?: boolean;
  offset?: number;
  word_offset?: number;
  hidden?: boolean;
  note?: string;
  lines: number;
  doubts: number;
};
/** Una canción del catálogo unificado (hub.py catalog). */
export type Track = {
  key: string;
  artist: string;
  title: string;
  lyrics: LyricsInfo | null;
  audio: boolean;
  vocals: "stemlab" | "letras" | null;
  stems: "complete" | "repair" | "partial" | null;
  present: string[];
  notes: string[];
  bpm: number | null;
  beats: boolean;
  edits: number;
  bytes: number;
  modified: number;
  failed: boolean; // el prefetch de las playlists no pudo
};
export type Detail = Track & {
  doc: Lyrics | null;
  history: number;
  stemlab: Song | null;
  audioPath: string | null;
  drumsPath: string | null;
  beatData: { bpm: number; beats: number[]; downbeats?: number[]; meter?: number; from?: string; meterFrom?: "manual" | "beat_this" | "llm" } | null;
  chordData: { chords: { t: number; end: number; root: number; kind: string; bass: number }[]; from: string } | null;
  duration: number;
};

export type Res = "gpu" | "cpu" | "net" | "render";
export type Step = { cmd: string; args: string[]; res: Res; label: string; model?: string; status: string };
export type Job = {
  id: string;
  action: string;
  key: string;
  args: string[];
  title: string;
  status: "queued" | "planning" | "ready" | "running" | "done" | "error" | "canceled";
  steps: Step[];
  cur: number;
  after: { id: string; hard: boolean }[];
  label: string;
  pct: number | null;
  waiting: string;
  error: string;
  result: any;
  created: number;
  started: number;
  finished: number;
};

// ---------------------------------------------------------------- rutas y ficheros

export type Paths = { letras: string; stemlab: string; data: string; edits: string; port: number; token: string };
export const paths: Paths = { letras: "", stemlab: "", data: "", edits: "", port: 0, token: "" };
export async function initPaths() {
  Object.assign(paths, await invoke<Paths>("paths_cmd"));
}

/** URL del servidor de ficheros (Range, sin pasar el WAV entero por IPC). */
export const fileUrl = (path: string, v?: string | number) =>
  `http://127.0.0.1:${paths.port}/${paths.token}${path.split("/").map(encodeURIComponent).join("/")}${v != null ? `?v=${v}` : ""}`;

export async function readBytes(path: string) {
  const r = await fetch(fileUrl(path), { cache: "no-store" });
  if (!r.ok) throw new Error(`${path.split("/").pop()}: no existe`);
  return r.arrayBuffer();
}

/** JSON de las carpetas de datos; `fallback` si no existe o está roto. */
export async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    const data = JSON.parse(new TextDecoder().decode(await readBytes(path)));
    return fallback && typeof fallback === "object" && !Array.isArray(fallback) ? { ...fallback, ...data } : data;
  } catch {
    return fallback;
  }
}

export const writeBytes = (path: string, data: Uint8Array) =>
  invoke("write_file", data, { headers: { path: encodeURIComponent(path) } });
export const writeJson = (path: string, data: unknown) =>
  writeBytes(path, new TextEncoder().encode(JSON.stringify(data, null, 1))).catch((e) => log(`guardar ${path}: ${e}`));

export const settingsPath = () => `${paths.data}/settings.json`;
export const viewPath = (key: string) => `${paths.data}/views/${key.replace(/[/:]/g, "_")}.json`;
export const lyricsPath = (key: string) => `${paths.letras}/lyrics/${key}.json`;

export const log = (msg: string) => console.warn(`[estudio] ${msg}`);

// ---------------------------------------------------------------- motor y cola

export const catalog = () => invoke<Track[]>("catalog");
export const songDetail = (key: string) => invoke<Detail>("song", { key });
export const run = <T = any>(cmd: string, args: string[]) => invoke<T>("run_cmd", { cmd, args });
export const enqueue = (action: string, keys: string[], args: string[] = [], then: string[][] = []) =>
  invoke<string[]>("enqueue", { action, keys, args, then });
export const importSources = (sources: string[], then: string[][] = []) => invoke<string[]>("import", { sources, then });
export const cancel = (ids: string[]) => invoke("cancel", { ids });
export const cancelAll = () => invoke("cancel_all");
export const retry = (ids: string[]) => invoke("retry", { ids });
export const top = (ids: string[]) => invoke("top", { ids });
export const clearFinished = () => invoke("clear_finished");
export const listJobs = () => invoke<Job[]>("jobs");
export const gpuName = () => invoke<string>("gpu_name");
export const hasDirector = () => invoke<boolean>("has_director");
export const listDir = (path: string) => invoke<{ name: string; size: number; modified: number; dir: boolean }[]>("list_dir", { path });
export const removeFile = (path: string) => invoke("remove_file", { path });

export type Playing = { playing: boolean; position: number; duration: number; artist: string; title: string; album: string; art: string; at: number; key: string | null };
export const nowPlaying = () => invoke<Playing | null>("now_playing");
export const playerSeek = (secs: number) => invoke("player_seek", { secs });
export const playerToggle = () => invoke("player_toggle");
export const prefetchNow = () => invoke("prefetch_now");
export const onPlayer = (f: (p: Playing | null) => void) => listen<Playing | null>("player", (e) => f(e.payload));
/** Posición de Spotify ahora (interpolada desde la última lectura). */
export const spotifyClock = (p: Playing | null) => (p ? p.position + (p.playing ? Date.now() / 1000 - p.at : 0) : 0);

export const onJobs = (f: (jobs: Job[]) => void) => listen<Job[]>("jobs", (e) => f(e.payload));
export const onChanged = (f: (keys: string[]) => void) => listen<string[]>("changed", (e) => f(e.payload));

export const finished = (j: Job) => j.status === "done" || j.status === "error" || j.status === "canceled";

// ---------------------------------------------------------------- presentación

/** Nombre y color de cada pista. Los colores son copia de --stem-* (app.css), en hex para los canvas: cambiar los dos. */
export const STEM_INFO: Record<string, { label: string; color: string }> = {
  vocals: { label: "Voz", color: "#c26cff" },
  drums: { label: "Batería", color: "#f2d13a" },
  bass: { label: "Bajo", color: "#6ad46a" },
  guitar: { label: "Guitarra", color: "#4f9dff" },
  piano: { label: "Piano", color: "#b4b8ff" },
  other: { label: "Otros", color: "#8b8e95" },
  mix: { label: "Mezcla", color: "#d0d2d8" },
};
/** Pistas con altura de tono: la batería no se transcribe. */
export const PITCHED = ["vocals", "bass", "guitar", "piano", "other"];

export const ACTION_LABEL: Record<string, string> = {
  letra: "Letra",
  find: "Buscar letra",
  sync: "Sincronizar letra",
  separate: "Separar pistas",
  notes: "Notas",
  midi_optimize: "Optimizar MIDI",
  midi_patch: "Parche del LLM",
  beats: "Pulsos",
  audio: "Audio",
  import: "Importar",
  render: "Exportar MP4",
  chords: "Acordes",
  autosync: "Sincronizar (Spotify)",
};
export const actionLabel = (j: Pick<Job, "action" | "args">) =>
  j.action === "notes" ? `Notas${j.args[1] === "precise" ? " precisas" : ""} · ${STEM_INFO[j.args[0]]?.label ?? j.args[0]}` : j.action === "sync" && j.args[0] === "lineas" ? "Sincronizar dentro de cada línea" : j.action === "sync" && j.args[0] === "ia" ? "Sincronizar desde el audio" : (ACTION_LABEL[j.action] ?? j.action);

export const SOURCE_LABEL: Record<string, string> = {
  lrclib: "LRCLIB",
  netease: "NetEase",
  qq: "QQ Música",
  kugou: "Kugou",
  lrclib_plain: "LRCLIB",
  genius: "Genius",
  lyrics_ovh: "lyrics.ovh",
  ia: "IA",
  manual: "a mano",
};

/** Palabras que Whisper no tiene claras: lo primero que revisar en una letra transcrita. */
export const doubtful = (l: Line) => (l.words ?? []).filter((w) => w.p != null && w.p < 0.5).map((w) => w.w);

/** 83.456 -> "1:23.45" */
export const fmtTime = (s: number | null) => (s == null ? "" : `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, "0")}`);
export const fmtClock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
/** "1:23.45" o "83.4" -> segundos; null si vacío o roto. */
export function parseTime(v: string): number | null {
  const m = v.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  return m ? Math.round((+(m[1] ?? 0) * 60 + +m[2]) * 1000) / 1000 : null;
}
export const fmtBytes = (b: number) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${Math.round(b / 1e6)} MB` : b ? `${Math.round(b / 1e3)} kB` : "—");
