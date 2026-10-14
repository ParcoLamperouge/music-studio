/** Piano de verdad: muestras del Salamander Grand (public/piano, CC BY), una cada tercera menor de La0 a Do8; las notas
 * de en medio, con la muestra más cercana reafinada (como mucho un semitono y medio). Se cargan una vez para toda la app. */

const NAMES = ["C", "Ds", "Fs", "A"];
/** Nota MIDI de cada muestra y su fichero: La0 (21) … Do8 (108). */
export const SAMPLES: [number, string][] = [];
for (let p = 21; p <= 108; p += 3) SAMPLES.push([p, `${NAMES[(p % 12) / 3]}${Math.floor(p / 12) - 1}`]);

let bank: Promise<Map<number, AudioBuffer>> | null = null;
/** Ya cargadas (para tocar en el momento, sin esperar). */
export let ready: Map<number, AudioBuffer> | null = null;

/** Carga (una vez) y decodifica las muestras; un AudioBuffer vale para cualquier contexto. */
export function loadPiano() {
  bank ??= (async () => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const out = new Map<number, AudioBuffer>();
    await Promise.all(
      SAMPLES.map(async ([p, name]) => {
        const r = await fetch(`/piano/${name}.mp3`);
        if (!r.ok) throw new Error(`piano/${name}.mp3: ${r.status}`);
        out.set(p, await ctx.decodeAudioData(await r.arrayBuffer()));
      }),
    );
    return (ready = out);
  })();
  bank.catch(() => (bank = null)); // que se pueda reintentar
  return bank;
}

/** La muestra para `p` y su velocidad de reproducción. */
export function sampleFor(p: number): [number, number] {
  const near = Math.min(108, Math.max(21, 21 + Math.round((p - 21) / 3) * 3));
  return [near, 2 ** ((p - near) / 12)];
}

/** Una nota en `ctx` hacia `dest`: de `start` a `end` (null: hasta que se suelte), con la fuerza `v` (0-1). Las suaves,
 * además, más apagadas (filtro), como en un piano. Devuelve con qué soltarla. */
export function playNote(ctx: BaseAudioContext, dest: AudioNode, samples: Map<number, AudioBuffer>, p: number, v: number, start: number, end: number | null) {
  const [near, rate] = sampleFor(p);
  const src = ctx.createBufferSource();
  src.buffer = samples.get(near)!;
  src.playbackRate.value = rate;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 1200 + 14000 * v * v;
  const g = ctx.createGain();
  g.gain.value = 0.15 + 0.85 * v ** 1.6;
  src.connect(tone).connect(g).connect(dest);
  src.start(start);
  const release = (t: number) => {
    g.gain.setTargetAtTime(0, t, 0.09); // apagador: ~0.3 s hasta el silencio
    src.stop(t + 0.6);
  };
  if (end != null) release(Math.max(end, start + 0.05));
  return () => release(ctx.currentTime);
}
