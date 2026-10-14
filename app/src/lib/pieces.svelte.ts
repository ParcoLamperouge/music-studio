/** Las piezas guardadas (piezas/<id>.json): lista compartida por Aprender, el editor y Sesiones. */

import { invoke } from "@tauri-apps/api/core";
import { open as pickFiles } from "@tauri-apps/plugin-dialog";
import { listDir, paths, readJson, removeFile, writeBytes, writeJson } from "./engine";
import { Live } from "./live";
import { importPiece, pieceEvents, pieceLength, type Piece } from "./piece";

export const pieces = $state({ list: [] as Piece[] });
export const pieceDir = () => `${paths.data}/piezas`;
const file = (id: string) => `${pieceDir()}/${id}.json`;

export async function loadPieces() {
  const files = (await listDir(pieceDir()).catch(() => [])).filter((f) => /^p[\w-]+\.json$/.test(f.name));
  const all = await Promise.all(files.map((f) => readJson<Piece | null>(`${pieceDir()}/${f.name}`, null)));
  pieces.list = all.filter((p): p is Piece => !!p?.notes).sort((a, b) => (b.modified ?? 0) - (a.modified ?? 0));
}

export async function savePiece(pc: Piece) {
  const saved = { ...pc, modified: Date.now() };
  await writeJson(file(pc.id), saved);
  pieces.list = [saved, ...pieces.list.filter((p) => p.id !== pc.id)];
  return saved;
}

export async function deletePiece(id: string) {
  await removeFile(file(id)).catch(() => {});
  pieces.list = pieces.list.filter((p) => p.id !== id);
}

/** Elegir uno o varios MIDI / MusicXML y leerlos como piezas (sin guardar). */
export async function pickPieces() {
  const chosen = await pickFiles({ multiple: true, filters: [{ name: "MIDI o MusicXML", extensions: ["mid", "midi", "musicxml", "xml", "mxl"] }] });
  const out: Piece[] = [];
  for (const path of chosen ?? []) out.push(await importPiece(path, new Uint8Array(await invoke<ArrayBuffer>("read_import", { path }))));
  return out;
}

/** Elegir MIDI / MusicXML y guardarlos como piezas; devuelve las nuevas. */
export async function importPieces() {
  return Promise.all((await pickPieces()).map(savePiece));
}

/** Una pieza como sesión del teclado (sesiones/<fecha>.mid y .json): pasa por el modo Tocar, así que sale con sus
 * acordes y su tonalidad como si se hubiera tocado. */
export async function pieceToSession(pc: Piece, latin = true, started = new Date()) {
  const live = new Live();
  const t0 = 1000;
  for (const [t, msg] of pieceEvents(pc)) live.midi(msg, t0 + t);
  const { json, mid } = live.snapshot(t0 + (pieceLength(pc) * 60) / pc.bpm, pc.title, started, latin);
  const z = (n: number) => String(n).padStart(2, "0");
  const base = `${paths.data}/sesiones/${started.getFullYear()}-${z(started.getMonth() + 1)}-${z(started.getDate())}_${z(started.getHours())}-${z(started.getMinutes())}-${z(started.getSeconds())}`;
  await writeBytes(`${base}.mid`, mid);
  await writeBytes(`${base}.json`, new TextEncoder().encode(JSON.stringify(json)));
  return base;
}
