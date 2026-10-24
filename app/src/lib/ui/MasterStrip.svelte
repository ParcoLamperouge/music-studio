<script lang="ts">
  import { fmtClock } from "../engine";
  import type { Key } from "../harmony";
  import { t } from "../i18n.svelte";
  import { chordFn, type Section } from "./music";

  // La canción entera en una tira: secciones, acordes (color por función) y energía, con el cursor de reproducción.
  // Pulsar o arrastrar en cualquier sitio salta ahí; flechas ←/→ mueven 5 s. `compact`: la del mini-reproductor; `big`: la
  // de la página de la canción. Con `onloop`, Mayús+arrastrar marca un bucle (`loop`, franja de acento).
  let { duration, time, sections = [], chords = [], tonality, energy, compact = false, big = false, loop = null, onloop, onseek }: {
    duration: number;
    time: number;
    sections?: Section[];
    chords?: { t: number; end: number; root: number; kind: string; name: string }[];
    tonality?: Key | null;
    energy?: number[] | null;
    compact?: boolean;
    big?: boolean;
    loop?: { a: number; b: number } | null;
    onloop?: (loop: { a: number; b: number } | null) => void;
    onseek: (t: number) => void;
  } = $props();

  const uid = $props.id();
  let el: HTMLDivElement;
  let width = $state(0);
  let hover = $state<number | null>(null);
  const pct = (tr: number) => `${(Math.max(0, Math.min(tr, duration)) / (duration || 1)) * 100}%`;
  const span = (a: number, b: number) => `${(Math.max(0, b - a) / (duration || 1)) * 100}%`;
  const at = (e: PointerEvent) => {
    const r = el.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * duration;
  };
  const coloured = $derived(tonality ? chords.map((c) => ({ ...c, f: chordFn(c, tonality) })) : []);
  const area = $derived.by(() => {
    if (!energy?.length) return "";
    const n = energy.length;
    return `M0 1${energy.map((v, i) => `L${(i + 0.5) / n} ${1 - v * 0.95}`).join("")}L1 1Z`;
  });

  let anchor: number | null = null; // Mayús+arrastrar: dónde empezó el bucle
  function down(e: PointerEvent) {
    if (!duration) return;
    el.setPointerCapture(e.pointerId);
    if (onloop && e.shiftKey) {
      anchor = at(e);
      return onloop({ a: anchor, b: anchor });
    }
    onseek(at(e));
  }
  function move(e: PointerEvent) {
    hover = at(e);
    if (!el.hasPointerCapture(e.pointerId)) return;
    if (anchor != null) onloop?.({ a: Math.min(anchor, hover), b: Math.max(anchor, hover) });
    else onseek(hover);
  }
  function up() {
    if (anchor == null) return;
    anchor = null;
    if (loop && loop.b - loop.a < 0.5) onloop?.(null);
    else if (loop) onseek(loop.a);
  }
  function key(e: KeyboardEvent) {
    const d = e.key === "ArrowRight" ? 5 : e.key === "ArrowLeft" ? -5 : e.key === "Home" ? -Infinity : 0;
    if (!d) return;
    e.preventDefault();
    e.stopPropagation();
    onseek(Math.max(0, Math.min(duration, time + d)));
  }
</script>

<div
  class="strip"
  class:compact
  class:big
  bind:this={el}
  bind:clientWidth={width}
  role="slider"
  tabindex="0"
  aria-label={t("Posición en la canción")}
  aria-valuemin={0}
  aria-valuemax={Math.round(duration)}
  aria-valuenow={Math.round(time)}
  aria-valuetext={fmtClock(time)}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointerleave={() => (hover = null)}
  onkeydown={key}
>
  {#if sections.length}
    <div class="row secs">
      {#each sections as s (s.t)}
        <span class="sec {s.kind}" style:left={pct(s.t)} style:width={span(s.t, s.end)} title="{t(s.label)} · {fmtClock(s.t)}">
          {#if !compact && ((s.end - s.t) / (duration || 1)) * width > 56}<em>{t(s.label)}</em>{/if}
        </span>
      {/each}
    </div>
  {/if}
  {#if coloured.length}
    <div class="row chords">
      {#each coloured as c (c.t)}
        <span
          class="ch"
          class:minor={c.f.minor}
          class:borrowed={c.f.borrowed}
          style:left={pct(c.t)}
          style:width={span(c.t, c.end)}
          style:--c={c.f.color}
          title="{c.name} · {c.f.label}"
        >
          {#if !compact && ((c.end - c.t) / (duration || 1)) * width > 26}<b>{c.name}</b>{/if}
        </span>
      {/each}
    </div>
  {/if}
  {#if area}
    <svg class="row energy" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <clipPath id="played-{uid}"><rect x="0" y="0" width={duration ? time / duration : 0} height="1" /></clipPath>
      </defs>
      <path d={area} class="e-all" />
      <path d={area} class="e-played" clip-path="url(#played-{uid})" />
    </svg>
  {/if}
  {#if loop}<i class="loop" style:left={pct(loop.a)} style:width={span(loop.a, loop.b)}></i>{/if}
  {#if hover != null}
    <i class="hov" style:left={pct(hover)}><span class="num">{fmtClock(hover)}</span></i>
  {/if}
  <i class="head" style:left={pct(time)}></i>
</div>

<style>
  .strip {
    position: relative; display: flex; flex-direction: column; gap: 2px; min-width: 0; width: 100%; padding: 2px 0;
    cursor: pointer; touch-action: none; user-select: none; border-radius: var(--r-sm); outline-offset: 3px;
  }
  .row { position: relative; width: 100%; flex-shrink: 0; }
  .secs { height: 16px; }
  .chords { height: 18px; }
  .energy { display: block; height: 22px; }
  .compact .secs { height: 4px; }
  .compact .chords { height: 6px; }
  .compact .energy { height: 14px; }
  .big .secs { height: 20px; }
  .big .chords { height: 28px; }
  .big .energy { height: 56px; }
  .big .sec em { font-size: var(--fs-xs); }
  .big .ch b { font-size: var(--fs-sm); padding: 0 6px; }
  .loop {
    position: absolute; top: -2px; bottom: -2px; pointer-events: none; border-radius: var(--r-sm);
    background: var(--accent-soft); box-shadow: inset 2px 0 0 var(--accent), inset -2px 0 0 var(--accent);
  }

  .sec, .ch { position: absolute; top: 0; bottom: 0; overflow: hidden; border-radius: 2px; }
  .sec { background: var(--line); box-shadow: inset -1px 0 0 var(--bg); display: flex; align-items: center; }
  .sec.chorus { background: var(--line-hi); }
  .sec.inst, .sec.intro, .sec.outro { background: transparent; box-shadow: inset 0 0 0 1px var(--line); }
  .sec em { padding: 0 6px; font-style: normal; font-size: 10px; color: var(--text-2); white-space: nowrap; }
  .sec.chorus em { color: var(--text); }

  .ch { background: var(--c); box-shadow: inset -1px 0 0 var(--bg); display: flex; align-items: center; }
  .ch.minor { background: color-mix(in oklab, var(--c) 30%, transparent); box-shadow: inset 0 0 0 1px var(--c), inset -1px 0 0 var(--bg); }
  .ch.borrowed { background: transparent; box-shadow: none; border: 1px dashed var(--fn-other); }
  .ch b { padding: 0 4px; font-size: 10px; font-weight: 700; color: var(--on-data); white-space: nowrap; }
  .ch.minor b, .ch.borrowed b { color: var(--text); }

  .e-all { fill: var(--line-hi); }
  .e-played { fill: var(--text-3); }

  .head, .hov { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; pointer-events: none; }
  .head { background: var(--text); border-radius: 1px; box-shadow: 0 0 0 1px var(--bg); }
  .hov { background: var(--text-3); width: 1px; }
  .hov span {
    position: absolute; bottom: calc(100% + 4px); left: 50%; translate: -50% 0; padding: 1px 5px; border-radius: var(--r-sm);
    background: var(--panel-hi); color: var(--text); font-size: 10.5px; white-space: nowrap;
  }
</style>
