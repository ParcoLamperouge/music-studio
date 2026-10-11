import { invoke } from "@tauri-apps/api/core";
import { enqueue, fileUrl, listDir, paths, readJson, removeFile, songDetail, writeBytes, writeJson } from "../../lib/engine.ts";
import { ENV_HZ, fromLetras } from "../remotion/timing.ts";
import type { Line, Media, Style, TemplateId, WordEdit } from "../remotion/types.ts";

export type SongInfo = { key: string; artist: string; title: string; words: boolean; audio: boolean; stemlab: boolean };
export type Project = {
  id: string;
  name: string;
  key: string;
  start: number;
  end: number;
  rate: number;
  style: Style;
  edits: Record<string, WordEdit>;
  media: Media[];
  lineTpl?: Record<string, TemplateId>; // per line template
  updated: number;
};
export type Song = {
  key: string;
  artist: string;
  title: string;
  lines: Line[];
  audio: string | null;
  beats: number[];
  bpm: number | null;
  stemlab: boolean;
  peaks: Float32Array; // loudness per PEAK_HZ, 0..1
  env: number[];
  duration: number;
};
export type Job = { id: string; label: string; progress: number; status: "running" | "done" | "error"; result?: any; error?: string };

export const PEAK_HZ = 50;

/** URLs guardadas en los proyectos (/file/data/media/x, como Lyric Edits) -> servidor de ficheros. */
export function resolveUrl(u: string) {
  const m = /^\/file\/(letras|stemlab|data)\/(.+)$/.exec(u);
  if (!m) return u;
  const root = { letras: paths.letras, stemlab: paths.stemlab, data: paths.edits }[m[1] as "letras" | "stemlab" | "data"];
  return fileUrl(`${root}/${decodeURIComponent(m[2])}`);
}

const projectsDir = () => `${paths.edits}/projects`;
export async function listProjects() {
  const files = (await listDir(projectsDir()).catch(() => [])).filter((f) => f.name.endsWith(".json"));
  const all = await Promise.all(files.map((f) => readJson<Project | null>(`${projectsDir()}/${f.name}`, null)));
  return all.filter((p): p is Project => !!p).map((p) => ({ id: p.id, name: p.name, key: p.key, updated: p.updated })).sort((a, b) => b.updated - a.updated);
}
export async function loadProject(id: string) {
  const p = await readJson<Project | null>(`${projectsDir()}/${id}.json`, null);
  if (!p) throw new Error("Ese edit ya no existe");
  return p;
}
export const saveProject = (p: Project) => writeBytes(`${projectsDir()}/${p.id}.json`, new TextEncoder().encode(JSON.stringify(p)));
export const deleteProject = (id: string) => removeFile(`${projectsDir()}/${id}.json`);
export async function uploadMedia(f: File): Promise<Media> {
  const name = f.name.replace(/[^\w.-]+/g, "-");
  const file = `${Date.now().toString(36)}-${name}`;
  await writeBytes(`${paths.edits}/media/${file}`, new Uint8Array(await f.arrayBuffer()));
  return { url: `/file/data/media/${file}`, name, type: /\.(mp4|webm|mov)$/i.test(name) ? "video" : "image" };
}
const jobId = async (ids: Promise<string[] | string>) => {
  const r = await ids;
  return { id: Array.isArray(r) ? r[0] : r, label: "En cola", progress: 0, status: "running" } as Job;
};
export const separate = (key: string) => jobId(enqueue("separate", [key]));
export const render = (props: unknown, name: string, key: string) => jobId(invoke<string>("render", { key, name, props }));

export type Preset = { id: string; name: string; style: Style; rate: number };
export const listPresets = () => readJson<Preset[]>(`${paths.edits}/presets.json`, []);
export const savePresets = (all: Preset[]) => writeJson(`${paths.edits}/presets.json`, all);
export const hasDirector = () => invoke<boolean>("has_director").catch(() => false);
export async function direct(brief: unknown) {
  const plan = await invoke<any>("director", { brief });
  if (!plan) throw new Error("Sin ANTHROPIC_API_KEY: uso el director local");
  return plan;
}

/** Sigue un trabajo de la cola de Estudio hasta que acabe; `onTick` ve cada cambio. */
export async function follow(job: Job, onTick: (j: Job) => void): Promise<Job> {
  for (;;) {
    const j = await invoke<any>("job", { id: job.id });
    if (!j) throw new Error("El trabajo desapareció de la cola");
    const status = j.status === "done" ? "done" : j.status === "error" || j.status === "canceled" ? "error" : "running";
    const total = j.steps.length || 1;
    job = { id: j.id, label: j.waiting || j.label || "En cola", progress: (j.cur + (j.pct ?? 0) / 100) / total, status, result: j.result, error: j.error || (j.status === "canceled" ? "cancelado" : "") };
    onTick(job);
    if (status !== "running") break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (job.status === "error") throw new Error(job.error);
  return job;
}

async function decode(url: string) {
  const buf = await (await fetch(url)).arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 44100);
  return ctx.decodeAudioData(buf);
}

/** Loudness per 1/ENV_HZ s, 0..1 against the loud end of the song (not its single loudest hit). */
function envelope(a: AudioBuffer) {
  const ch = a.getChannelData(0);
  const hop = Math.round(a.sampleRate / ENV_HZ);
  const out: number[] = [];
  for (let i = 0; i < ch.length; i += hop) {
    let s = 0;
    const end = Math.min(ch.length, i + hop);
    for (let j = i; j < end; j++) s += ch[j] * ch[j];
    out.push(Math.sqrt(s / (end - i)));
  }
  const ref = [...out].sort((x, y) => x - y)[Math.floor(out.length * 0.97)] || 1;
  return out.map((v) => Math.round(Math.min(1, v / ref) * 1000) / 1000);
}

function peaksOf(a: AudioBuffer) {
  const ch = a.getChannelData(0);
  const hop = Math.round(a.sampleRate / PEAK_HZ);
  const out = new Float32Array(Math.ceil(ch.length / hop));
  let max = 1e-9;
  for (let i = 0; i < out.length; i++) {
    let s = 0;
    const e = Math.min(ch.length, (i + 1) * hop);
    for (let j = i * hop; j < e; j++) s += ch[j] * ch[j];
    out[i] = Math.sqrt(s / Math.max(1, e - i * hop));
    max = Math.max(max, out[i]);
  }
  return out.map((v) => v / max);
}

/** If a step of a load takes over 15 s, say which: console errors reach the dev server's log. */
async function slow<T>(what: string, work: Promise<T>): Promise<T> {
  const t0 = performance.now();
  const timer = setInterval(() => console.error(`[lyric-edits] carga lenta: ${what} lleva ${Math.round((performance.now() - t0) / 1000)} s`), 15_000);
  try {
    return await work;
  } finally {
    clearInterval(timer);
  }
}

export async function loadSong(key: string): Promise<Song> {
  let s = await slow(`pidiendo ${key}`, songDetail(key));
  if (s.audioPath && !s.beatData?.beats?.length) {
    // pulsos del audio (CPU, segundos): el edit automático corta y golpea con ellos
    await follow(await jobId(enqueue("beats", [key])), () => {}).catch(() => {});
    s = await songDetail(key);
  }
  if (!s.doc) throw new Error("Esta canción aún no tiene letra");
  const lines = fromLetras(s.doc);
  const audio = s.audioPath ? fileUrl(s.audioPath) : null;
  const drums = s.drumsPath ? fileUrl(s.drumsPath) : null;
  let peaks = new Float32Array();
  let env: number[] = [];
  let duration = lines.length ? lines[lines.length - 1].end + 5 : 60;
  if (audio) {
    const [mix, dr] = await Promise.all([slow(`decodificando ${audio}`, decode(audio)), drums ? slow(`decodificando ${drums}`, decode(drums)) : null]);
    duration = mix.duration;
    peaks = peaksOf(mix);
    env = envelope(dr ?? mix);
  }
  return {
    key,
    artist: s.artist,
    title: s.title,
    lines,
    audio,
    beats: s.beatData?.beats ?? [],
    bpm: s.beatData?.bpm ?? null,
    stemlab: !!s.stemlab,
    peaks,
    env,
    duration,
  };
}
