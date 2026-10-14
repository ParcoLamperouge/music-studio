import { readBytes } from "./engine";

/** Fragmentos de canciones: decodifica el fichero una vez (caché de las 3 últimas) y suena un tramo con fundidos cortos.
 * Compartido por el oído (EarView) y las progresiones. */
let ctx: AudioContext | null = null;
export const audioCtx = () => (ctx ??= new AudioContext());
const bufs = new Map<string, Promise<AudioBuffer>>();

// ponytail: canciones enteras decodificadas (~80 MB cada una) y solo las 3 últimas; con muchas, decodificar por tramos
export function decodeCached(path: string) {
  if (!bufs.has(path)) {
    if (bufs.size >= 3) bufs.delete(bufs.keys().next().value!);
    const c = audioCtx();
    bufs.set(path, readBytes(path).then((b) => c.decodeAudioData(b)));
    bufs.get(path)!.catch(() => bufs.delete(path));
  }
  return bufs.get(path)!;
}

/** Programa el tramo [t, t+dur) del buffer en el instante `at` del contexto; devuelve la fuente (para pararla). */
export function scheduleClip(buf: AudioBuffer, t: number, dur: number, at: number, fade = 0.03) {
  const c = audioCtx(), s = c.createBufferSource(), g = c.createGain();
  s.buffer = buf;
  s.connect(g).connect(c.destination);
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(1, at + fade);
  g.gain.setValueAtTime(1, at + dur - fade);
  g.gain.linearRampToValueAtTime(0, at + dur);
  s.start(at, t, dur);
  return s;
}
