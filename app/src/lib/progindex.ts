/** Índice de progresiones en disco (datos/progresiones/indice.json): una secuencia simplificada por canción, que se
 * rehace solo para las canciones cuyo catálogo cambió (`modified`/`bytes`). */
import { paths, readJson, songDetail, writeJson, type Track } from "./engine";
import { normalize, type Seq } from "./progression";

type Entry = Seq & { sig: string };
const file = () => `${paths.data}/progresiones/indice.json`;
const sigOf = (t: Track) => `${t.modified}:${t.bytes}:${t.audio ? 1 : 0}`;

let running: Promise<Map<string, Seq>> | null = null;

/** Todas las canciones indexadas; `onprogress(hechas, total)` mientras lee las que faltan. */
export function buildIndex(tracks: Track[], onprogress: (done: number, total: number) => void = () => {}) {
  return (running ??= run(tracks, onprogress).finally(() => (running = null)));
}

async function run(tracks: Track[], onprogress: (d: number, n: number) => void) {
  const saved = await readJson<{ v: number; songs: Record<string, Entry> }>(file(), { v: 2, songs: {} });
  const songs: Record<string, Entry> = saved.v === 2 ? saved.songs : {};
  const todo = tracks.filter((t) => songs[t.key]?.sig !== sigOf(t));
  let done = 0, i = 0;
  onprogress(0, todo.length);
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < todo.length) {
        const t = todo[i++];
        try {
          const d = t.audio ? await songDetail(t.key) : null;
          songs[t.key] = { ...normalize(d?.chordData?.chords ?? [], d?.beatData?.beats ?? []), sig: sigOf(t) };
        } catch {} // sin entrada: se reintenta la próxima vez
        onprogress(++done, todo.length);
      }
    }),
  );
  const live = new Set(tracks.map((t) => t.key));
  for (const k of Object.keys(songs)) if (!live.has(k)) delete songs[k];
  if (todo.length || Object.keys(songs).length !== Object.keys(saved.songs).length) await writeJson(file(), { v: 2, songs });
  return new Map(Object.entries(songs).filter(([, s]) => s.c.length));
}

/** Tiempo al que abrir la canción tras elegir un resultado (SongView lo consume al cargar). */
const pending = { key: "", t: 0 };
export const seekOnOpen = (key: string, t: number) => Object.assign(pending, { key, t });
export function takeSeek(key: string) {
  if (pending.key !== key) return null;
  pending.key = "";
  return pending.t;
}
