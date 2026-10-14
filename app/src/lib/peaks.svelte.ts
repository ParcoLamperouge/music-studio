import { paths, readBytes, readJson, songDetail, writeJson } from "./engine";

/** Forma de onda (energía RMS, 0-1) de cada canción, para portadas y la tira de la canción. Se guarda en
 * data/peaks/<clave>.json; si no está, se saca del audio en segundo plano, de una en una, solo de las que se piden.
 * ponytail: la caché no se invalida si cambia el audio; borrar el fichero si hiciera falta. */
export const COLUMNS = 240;
export const waves = $state<Record<string, number[] | null>>({}); // null: sin audio o no se pudo

const asked = new Set<string>();
const pending: string[] = [];
let busy = false;
let ctx: OfflineAudioContext | undefined;
const file = (key: string) => `${paths.data}/peaks/${key.replace(/[/:]/g, "_")}.json`;

/** Pide la onda de una canción (`audio`: si tiene de dónde sacarla). Llega a `waves[key]`. */
export function wantPeaks(key: string, audio = true) {
  if (asked.has(key)) return;
  asked.add(key);
  readJson<number[] | null>(file(key), null).then((p) => {
    if (p?.length) waves[key] = p;
    else if (audio) (pending.push(key), void pump());
    else waves[key] = null;
  });
}

async function pump() {
  if (busy) return;
  const key = pending.shift();
  if (!key) return;
  busy = true;
  try {
    const p = await compute(key);
    waves[key] = p;
    if (p) void writeJson(file(key), p);
  } catch {
    waves[key] = null;
  } finally {
    busy = false;
    setTimeout(pump, 80); // deja respirar a la interfaz entre canción y canción
  }
}

async function compute(key: string) {
  const d = await songDetail(key);
  const path = d.audioPath ?? (d.stemlab ? `${d.stemlab.dir}/${d.stemlab.mix}` : null);
  if (!path) return null;
  ctx ??= new OfflineAudioContext(1, 1, 44100);
  const buf = await ctx.decodeAudioData(await readBytes(path));
  return rms(buf.getChannelData(0), COLUMNS);
}

/** Energía por columna, normalizada a la más fuerte y con 2 decimales. */
export function rms(data: Float32Array, columns: number) {
  const out: number[] = [];
  const step = Math.max(1, Math.floor(data.length / columns));
  for (let c = 0; c < columns; c++) {
    let sum = 0, n = 0;
    for (let i = c * step, end = Math.min(i + step, data.length); i < end; i += 8) (sum += data[i] * data[i]), n++;
    out.push(n ? Math.sqrt(sum / n) : 0);
  }
  const max = Math.max(...out, 1e-6);
  return out.map((v) => Math.round((v / max) * 100) / 100);
}
