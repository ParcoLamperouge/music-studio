<script lang="ts">
  import type { Key } from "../harmony";
  import { chordFn, FN_LABEL } from "./music";

  // Un acorde coloreado por su función en la tonalidad: macizo si es mayor, hueco si es menor, gris con borde
  // discontinuo si es prestado. El grado (V7, vi…) va al lado: el color nunca va solo.
  let { chord, tonality, name, showDegree = true, active = false, size = "md", onclick }: {
    chord: { root: number; kind: string };
    tonality: Key;
    name: string; // «Lam7» (chordName / named en harmony.ts)
    showDegree?: boolean;
    active?: boolean; // el que suena
    size?: "sm" | "md" | "lg";
    onclick?: () => void;
  } = $props();
  const f = $derived(chordFn(chord, tonality));
</script>

<svelte:element
  this={onclick ? "button" : "span"}
  type={onclick ? "button" : undefined}
  role={onclick ? undefined : "img"}
  class="cc s-{size}"
  class:minor={f.minor}
  class:borrowed={f.borrowed}
  class:active
  style:--c={f.color}
  title="{name} · {f.label} · {FN_LABEL[f.fn]}"
  aria-label="{name}, {f.label}"
  {onclick}
>
  <b>{name}</b>
  {#if showDegree}<small>{f.label}</small>{/if}
</svelte:element>

<style>
  .cc {
    display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 8px; border-radius: var(--r-md); white-space: nowrap; flex-shrink: 0;
    border: 1.5px solid var(--c); background: var(--c); color: var(--on-data); font-size: var(--fs-md); line-height: 1;
    transition: box-shadow var(--t-fast), transform var(--t-fast);
  }
  .s-sm { height: 20px; padding: 0 6px; font-size: var(--fs-sm); gap: 4px; }
  .s-lg { height: 36px; padding: 0 12px; font-size: var(--fs-lg); }
  b { font-weight: 700; }
  small { font-size: 0.8em; opacity: 0.75; }
  .minor { background: color-mix(in oklab, var(--c) 14%, transparent); color: var(--c); }
  .borrowed { border-style: dashed; background: transparent; color: var(--text-2); }
  .active { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--text); }
  button.cc { cursor: pointer; }
  button.cc:hover { transform: translateY(-1px); }
</style>
