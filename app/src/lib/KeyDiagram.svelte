<script lang="ts">
  import { onMount } from "svelte";
  import { loadNotation } from "./ChordsTab.svelte";
  import { noteName } from "./harmony";
  import { loadPiano } from "./piano";
  import { voice } from "./player";

  /** Un trozo de teclado con las teclas `keys` (MIDI) resaltadas y su nombre, y un botón para oírlas: juntas (acorde) o
   * una detrás de otra. Para los pasos de teoría del curso. */
  let { keys, together = false }: { keys: number[]; together?: boolean } = $props();

  const latin = loadNotation().latin;
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const W = 26, H = 96, BW = 16, BH = 60;
  // de Do a Si, octavas enteras alrededor de lo que se enseña
  const lo = $derived(Math.floor(Math.min(...keys) / 12) * 12);
  const hi = $derived(Math.max(lo + 11, Math.ceil((Math.max(...keys) + 1) / 12) * 12 - 1));
  const whites = $derived(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((p) => !BLACK.has(p % 12)));
  const xOf = (p: number) => whites.indexOf(p) * W;
  const blacks = $derived(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i).filter((p) => BLACK.has(p % 12)));
  const on = $derived(new Set(keys));
  const label = (p: number) => noteName(p % 12, { tonic: 0, minor: false }, latin);

  let ctx: AudioContext | null = null;
  let lit = $state(new Set<number>());
  onMount(() => () => void ctx?.close());

  async function listen() {
    ctx ??= new AudioContext();
    void ctx.resume();
    await loadPiano().catch(() => {});
    const seq = together ? [keys] : keys.map((k) => [k]);
    seq.forEach((group, i) =>
      setTimeout(() => {
        const stops = group.map((p) => voice(ctx!, p, 0.7));
        lit = new Set(group);
        setTimeout(() => (stops.forEach((s) => s()), (lit = new Set())), together ? 1400 : 420);
      }, i * 450),
    );
  }
</script>

<div class="kd">
  <svg viewBox="0 0 {whites.length * W} {H + 18}" width={whites.length * W} height={H + 18} role="img" aria-label={keys.map(label).join(", ")}>
    {#each whites as p (p)}
      <rect x={xOf(p) + 0.5} y="0.5" width={W - 1} height={H} rx="3" class="w" class:on={on.has(p)} class:lit={lit.has(p)} />
      {#if on.has(p)}<text x={xOf(p) + W / 2} y={H - 8} class="n">{label(p)}</text>{/if}
      {#if p % 12 === 0}<text x={xOf(p) + W / 2} y={H + 14} class="o">Do{Math.floor(p / 12) - 1}</text>{/if}
    {/each}
    {#each blacks as p (p)}
      <rect x={xOf(p - 1) + W - BW / 2} y="0.5" width={BW} height={BH} rx="2" class="b" class:on={on.has(p)} class:lit={lit.has(p)} />
      {#if on.has(p)}<text x={xOf(p - 1) + W} y={BH - 7} class="n nb">{label(p)}</text>{/if}
    {/each}
  </svg>
  <button class="ghost listen" onclick={listen} title={together ? "Oír el acorde" : "Oír las notas una a una"}>♪ Escuchar</button>
</div>

<style>
  .kd { display: flex; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin: 6px 0 2px; }
  svg { max-width: 100%; height: auto; }
  .w { fill: #eceae4; stroke: #2e2723; }
  .b { fill: #15161c; stroke: #000; }
  .w.on { fill: #f6c27e; }
  .b.on { fill: #e08a2a; }
  .w.lit, .b.lit { fill: #f29d38; }
  .n { font: 600 9px var(--mono); fill: #1c0f05; text-anchor: middle; }
  .nb { fill: #fff; font-size: 7.5px; }
  .o { font: 500 9px var(--mono); fill: var(--text-3); text-anchor: middle; }
  .listen { padding: 5px 12px; font-size: 12.5px; }
</style>
