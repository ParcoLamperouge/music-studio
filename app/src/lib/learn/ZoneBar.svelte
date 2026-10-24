<script lang="ts" module>
  /** Color de lo bien que sale un compás (0-1); null sin practicar. Va con el % en el tooltip: nunca solo color. */
  export const accColor = (a: number | null) =>
    a == null ? "var(--line)" : a >= 0.9 ? "var(--ontime)" : a >= 0.75 ? "var(--warn)" : a >= 0.5 ? "var(--late)" : "var(--miss)";
</script>

<script lang="ts">
  import { fmtClock } from "../engine";
  import { t } from "../i18n.svelte";

  // Mapa de calor de los compases (cómo sale cada uno), con el bucle A–B y el cursor. Pulsar o arrastrar salta ahí.
  let { bars, barTime, duration, time, loopA = null, loopB = null, loop = false, onseek }: {
    bars: (number | null)[]; // acierto de cada compás
    barTime: (i: number) => number;
    duration: number;
    time: number;
    loopA?: number | null;
    loopB?: number | null;
    loop?: boolean;
    onseek?: (t: number) => void;
  } = $props();

  let el: HTMLDivElement;
  const pct = (tr: number) => `${(Math.max(0, Math.min(tr, duration)) / (duration || 1)) * 100}%`;
  const at = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };
  const cells = $derived(bars.map((a, i) => ({ a, t: barTime(i), end: i + 1 < bars.length ? barTime(i + 1) : duration })));
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<div
  class="zb"
  class:static={!onseek}
  bind:this={el}
  role={onseek ? "slider" : "img"}
  tabindex={onseek ? 0 : undefined}
  aria-label={t("Cómo sale cada compás")}
  aria-valuenow={onseek ? Math.round(time) : undefined}
  aria-valuetext={onseek ? fmtClock(time) : undefined}
  onpointerdown={(e) => onseek && (el.setPointerCapture(e.pointerId), onseek(at(e)))}
  onpointermove={(e) => onseek && el.hasPointerCapture(e.pointerId) && onseek(at(e))}
  onkeydown={(e) => onseek && (e.key === "ArrowLeft" || e.key === "ArrowRight") && (e.preventDefault(), onseek(Math.max(0, time + (e.key === "ArrowRight" ? 5 : -5))))}
>
  {#each cells as c, i (i)}
    <i
      style:left={pct(c.t)}
      style:width={pct(c.end - c.t)}
      style:background={accColor(c.a)}
      title={c.a == null ? t("c. {n}", { n: i + 1 }) : t("c. {n} · {p} %", { n: i + 1, p: Math.round(c.a * 100) })}
    ></i>
  {/each}
  {#if loopA != null}
    <b class="ab" class:on={loop} style:left={pct(loopA)} style:width={loopB != null && loopB > loopA ? pct(loopB - loopA) : "2px"}></b>
  {/if}
  {#if onseek}<span class="head" style:left={pct(time)}></span>{/if}
</div>

<style>
  .zb { position: relative; height: 12px; min-width: 0; width: 100%; flex: none; cursor: pointer; touch-action: none; border-radius: var(--r-sm); outline-offset: 3px; }
  .static { cursor: default; }
  i { position: absolute; top: 0; bottom: 0; border-radius: 2px; box-shadow: inset -1px 0 0 var(--bg); opacity: 0.85; }
  .ab { position: absolute; top: -3px; bottom: -3px; border: 1px dashed var(--text-3); border-radius: var(--r-sm); pointer-events: none; }
  .ab.on { border: 1.5px solid var(--accent); background: var(--accent-soft); }
  .head { position: absolute; top: -4px; bottom: -4px; width: 2px; margin-left: -1px; background: var(--text); border-radius: 1px; box-shadow: 0 0 0 1px var(--bg); pointer-events: none; }
</style>
