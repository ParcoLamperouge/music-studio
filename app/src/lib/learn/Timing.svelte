<script lang="ts">
  import { judge } from "../arrange";
  import { t } from "../i18n.svelte";
  import { TIMING } from "../ui/music";

  // Cómo de a tiempo: `errs` en ms (− adelantada, + atrasada). live: las últimas como rayitas sobre el centro, con la
  // banda del sesgo ± dispersión; hist: el histograma de todas, de adelantada (cyan, ←) a atrasada (naranja, →).
  let { errs, mode = "live", height }: { errs: number[]; mode?: "live" | "hist"; height?: number } = $props();

  const R = 150; // ms a cada lado
  const clamp = (x: number) => Math.max(-R + 2, Math.min(R - 2, x));
  const color = (ms: number) => {
    const j = judge(ms / 1000);
    return TIMING[j === "near" ? "ontime" : j].color;
  };
  const mean = $derived(errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : 0);
  const sd = $derived(errs.length ? Math.sqrt(errs.reduce((a, b) => a + (b - mean) ** 2, 0) / errs.length) : 0);

  const BIN = 15;
  const hist = $derived.by(() => {
    const n = Array.from({ length: (2 * R) / BIN }, () => 0);
    for (const e of errs) n[Math.min(n.length - 1, Math.max(0, Math.floor((e + R) / BIN)))]++;
    const max = Math.max(1, ...n);
    return n.map((c, i) => ({ x: -R + i * BIN, h: c / max, c }));
  });
  const fmt = (ms: number) => `${ms > 0 ? "+" : ""}${Math.round(ms)}`;
</script>

{#if mode === "live"}
  <svg class="live" viewBox="{-R} -10 {2 * R} 20" preserveAspectRatio="none" style:height="{height ?? 20}px"
    role="img" aria-label={t("Tiempo de las últimas notas: sesgo {b} ms, dispersión ±{d} ms", { b: fmt(mean), d: Math.round(sd) })}>
    {#if errs.length > 2}<rect x={clamp(mean - sd)} width={Math.min(2 * R, 2 * sd)} y="-7" height="14" class="band" />{/if}
    <line x1="0" x2="0" y1="-10" y2="10" class="mid" />
    {#each errs as ms, i (i)}
      <line x1={clamp(ms)} x2={clamp(ms)} y1="-6" y2="6" stroke={color(ms)} opacity={0.25 + 0.75 * ((i + 1) / errs.length)} class="tick" />
    {/each}
    {#if errs.length > 2}<path d="M{clamp(mean)} -10 l-4 -0 l4 5 l4 -5z" class="bias" />{/if}
  </svg>
{:else}
  <figure class="hist">
    <svg viewBox="{-R} 0 {2 * R} 60" preserveAspectRatio="none" style:height="{height ?? 96}px" role="img"
      aria-label={t("Histograma de tiempo: sesgo {b} ms, dispersión ±{d} ms", { b: fmt(mean), d: Math.round(sd) })}>
      {#if errs.length > 2}<rect x={clamp(mean - sd)} width={Math.min(2 * R, 2 * sd)} y="0" height="60" class="band" />{/if}
      {#each hist as b (b.x)}
        {#if b.c}<rect x={b.x + 1} width={BIN - 2} y={60 - 56 * b.h} height={56 * b.h} fill={color(b.x + BIN / 2)} rx="1.5" />{/if}
      {/each}
      <line x1="0" x2="0" y1="0" y2="60" class="mid" />
      {#if errs.length}<line x1={clamp(mean)} x2={clamp(mean)} y1="0" y2="60" class="mean" />{/if}
    </svg>
    <figcaption>
      <span style:color={TIMING.early.color}>{TIMING.early.mark} {t("antes")}</span>
      <span class="num">{errs.length ? `${fmt(mean)} ms · ±${Math.round(sd)}` : t("sin notas")}</span>
      <span style:color={TIMING.late.color}>{t("después")} {TIMING.late.mark}</span>
    </figcaption>
  </figure>
{/if}

<style>
  .live { display: block; width: 140px; flex-shrink: 0; }
  .tick { stroke-width: 3; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .mid { stroke: var(--text-3); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .band { fill: var(--line); }
  .bias { fill: var(--text); }
  .hist { margin: 0; display: flex; flex-direction: column; gap: var(--s1); min-width: 0; }
  .hist svg { display: block; width: 100%; }
  .mean { stroke: var(--text); stroke-width: 1.5; stroke-dasharray: 3 2; vector-effect: non-scaling-stroke; }
  figcaption { display: flex; justify-content: space-between; gap: var(--s2); font-size: var(--fs-xs); color: var(--text-2); }
</style>
