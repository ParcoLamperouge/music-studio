<script lang="ts">
  // Forma de onda en miniatura (SVG, escala sola): barras de energía 0-1 (peaks.svelte.ts). `progress` 0-1 pinta lo
  // ya sonado más claro. Sin datos, una línea plana tenue.
  let { peaks, bars = 60, color = "var(--text-2)", progress, height = 48 }: {
    peaks: number[] | null | undefined;
    bars?: number;
    color?: string;
    progress?: number;
    height?: number;
  } = $props();

  // remuestreo a `bars` columnas (el máximo de cada tramo)
  const cols = $derived.by(() => {
    if (!peaks?.length) return [];
    const per = peaks.length / bars;
    return Array.from({ length: bars }, (_, i) => Math.max(...peaks.slice(Math.floor(i * per), Math.max(Math.floor((i + 1) * per), Math.floor(i * per) + 1))));
  });
  const path = (from: number, to: number) =>
    cols
      .slice(from, to)
      .map((v, j) => {
        const i = from + j, h = Math.max(0.04, v) * 0.9;
        return `M${i + 0.5} ${0.5 - h / 2}v${h}`;
      })
      .join("");
  const cut = $derived(progress == null ? bars : Math.round(progress * bars));
</script>

<svg class="wave" viewBox="0 0 {bars} 1" preserveAspectRatio="none" style:height="{height}px" aria-hidden="true">
  {#if cols.length}
    <path d={path(0, cut)} stroke={color} />
    {#if cut < bars}<path d={path(cut, bars)} stroke={color} opacity="0.35" />{/if}
  {:else}
    <path d="M0 0.5H{bars}" stroke="var(--line-hi)" class="flat" />
  {/if}
</svg>

<style>
  .wave { display: block; width: 100%; }
  path { stroke-width: 0.55; stroke-linecap: butt; fill: none; }
  .flat { stroke-width: 1px; vector-effect: non-scaling-stroke; }
</style>
