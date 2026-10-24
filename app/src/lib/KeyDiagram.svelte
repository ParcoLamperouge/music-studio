<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "./i18n.svelte";
  import { loadNotation } from "./ChordsTab.svelte";
  import { noteName } from "./harmony";
  import { loadPiano } from "./piano";
  import { voice } from "./player";
  import { ROLL_DEFAULT } from "./rollfx";
  import { settings } from "./settings.svelte";
  import Button from "./ui/Button.svelte";

  /** Un trozo de teclado con las teclas `keys` (MIDI) resaltadas y su nombre, y un botón para oírlas: juntas (acorde) o
   * una detrás de otra. Las teclas, como el piano de Aprender (y en su color); al sonar, se hunden. */
  let { keys, together = false }: { keys: number[]; together?: boolean } = $props();

  const latin = loadNotation().latin;
  const color = $derived({ ...ROLL_DEFAULT, ...settings.rollStyle }.color);
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const W = 28, H = 104, BW = 17, BH = 64;
  // de Do a Si, octavas enteras alrededor de lo que se enseña
  const lo = $derived(Math.floor(Math.min(...keys) / 12) * 12);
  const hi = $derived(Math.max(lo + 11, Math.ceil((Math.max(...keys) + 1) / 12) * 12 - 1));
  const all = $derived(Array.from({ length: hi - lo + 1 }, (_, i) => lo + i));
  const whites = $derived(all.filter((p) => !BLACK.has(p % 12)));
  const blacks = $derived(all.filter((p) => BLACK.has(p % 12)));
  const xOf = (p: number) => whites.indexOf(p) * W;
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

<div class="kd" style:--k={color}>
  <svg viewBox="0 0 {whites.length * W} {H + 18}" width={whites.length * W} height={H + 18} role="img" aria-label={keys.map(label).join(", ")}>
    <rect x="0" y="0" width={whites.length * W} height="4" class="felt" />
    {#each whites as p (p)}
      <rect x={xOf(p) + 0.5} y={lit.has(p) ? 4 : 3} width={W - 1} height={H - 3} rx="4" class="w" class:on={on.has(p)} class:lit={lit.has(p)} />
      {#if on.has(p)}<text x={xOf(p) + W / 2} y={H - 10} class="n">{label(p)}</text>{/if}
      {#if p % 12 === 0}<text x={xOf(p) + W / 2} y={H + 14} class="o">{label(p)}{Math.floor(p / 12) - 1}</text>{/if}
    {/each}
    {#each blacks as p (p)}
      <rect x={xOf(p - 1) + W - BW / 2} y={lit.has(p) ? 4 : 3} width={BW} height={BH} rx="2.5" class="b" class:on={on.has(p)} class:lit={lit.has(p)} />
      {#if on.has(p)}<text x={xOf(p - 1) + W} y={BH - 8} class="n">{label(p)}</text>{/if}
    {/each}
  </svg>
  <Button size="sm" variant="ghost" icon="volume" onclick={listen} title={together ? t("Oír el acorde") : t("Oír las notas una a una")}>{t("Escuchar")}</Button>
</div>

<style>
  .kd { display: flex; align-items: flex-end; gap: var(--s3); flex-wrap: wrap; margin: var(--s2) 0 2px; }
  svg { max-width: 100%; height: auto; }
  .felt { fill: #0b0a09; }
  .w { fill: #f3f0e8; stroke: #00000040; }
  .b { fill: #1d1d22; stroke: #000; }
  .w.on, .b.on { fill: color-mix(in oklab, var(--k) 70%, white); }
  .b.on { fill: var(--k); }
  .lit { fill: var(--k) !important; filter: drop-shadow(0 0 6px var(--k)); }
  .n { font: 700 9px var(--mono); fill: #1c0f05; text-anchor: middle; }
  .o { font: 500 9px var(--mono); fill: var(--text-3); text-anchor: middle; }
</style>
