import { songDetail } from "./engine";
import { audioCtx, decodeCached, scheduleClip } from "./clip";
import type { SongHit } from "./progression";

/** Escucha de un resultado sin salir de la vista (una a la vez) y los resultados fijados para comparar. */
export type Pin = Pick<SongHit, "key" | "t" | "end" | "ts" | "codes" | "songKey" | "tr" | "path" | "exact" | "qkey" | "same" | "amb">;
export const pinId = (p: Pick<Pin, "key" | "t">) => `${p.key}@${p.t}`;
const MAX = 12;

export const preview = $state({ id: "", loading: false, pos: 0, dur: 0 });
let src: AudioScheduledSourceNode | null = null;
let token = 0;
const paths = new Map<string, string | null>();

export function stopPreview() {
  token++;
  try { src?.stop(); } catch {}
  src = null;
  Object.assign(preview, { id: "", loading: false, pos: 0, dur: 0 });
}

/** Suena el tramo de la coincidencia; resuelve true si llegó al final (false si se paró o falló). */
export async function playPreview(p: Pin): Promise<boolean> {
  stopPreview();
  const my = token, id = pinId(p);
  Object.assign(preview, { id, loading: true });
  try {
    if (!paths.has(p.key)) paths.set(p.key, (await songDetail(p.key)).audioPath);
    const path = paths.get(p.key);
    if (!path) throw 0;
    const buf = await decodeCached(path);
    if (my !== token) return false;
    const dur = Math.min(MAX, Math.max(2, p.end - p.t));
    const c = audioCtx();
    void c.resume();
    const at = c.currentTime + 0.05;
    src = scheduleClip(buf, p.t, dur, at, 0.05);
    Object.assign(preview, { loading: false, dur, pos: 0 });
    return await new Promise<boolean>((done) => {
      const tick = () => {
        if (my !== token) return done(false);
        preview.pos = Math.max(0, c.currentTime - at);
        if (preview.pos >= dur) return (stopPreview(), done(true));
        requestAnimationFrame(tick);
      };
      tick();
    });
  } catch {
    if (my === token) stopPreview();
    return false;
  }
}

export const pins = $state<Pin[]>(load());
function load(): Pin[] {
  try { return (JSON.parse(localStorage.getItem("estudio.pins") ?? "[]") as Pin[]).filter((p) => p.path && p.qkey); } catch { return []; }
}
const save = () => { try { localStorage.setItem("estudio.pins", JSON.stringify(pins)); } catch {} };
export const isPinned = (p: Pin) => pins.some((x) => pinId(x) === pinId(p));
export function togglePin(p: Pin) {
  const i = pins.findIndex((x) => pinId(x) === pinId(p));
  if (i >= 0) pins.splice(i, 1);
  else pins.push({ key: p.key, t: p.t, end: p.end, ts: p.ts, codes: p.codes, songKey: p.songKey, tr: p.tr, path: p.path, exact: p.exact, qkey: p.qkey, same: p.same, amb: p.amb });
  save();
}

let allToken = 0;
export async function playAll() {
  const me = ++allToken;
  for (const p of [...pins]) if (me !== allToken || !(await playPreview(p))) break;
}
export function stopAll() {
  allToken++;
  stopPreview();
}
