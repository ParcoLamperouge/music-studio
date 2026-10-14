<script lang="ts">
  import type { Snippet } from "svelte";

  // Anillo de progreso: `value` 0-1, o null para indeterminado (gira). Lo de dentro (un número, un icono) va como hijo.
  let { value, size = 20, stroke = 2.5, color = "var(--accent)", label, children }: {
    value: number | null;
    size?: number;
    stroke?: number;
    color?: string;
    label?: string;
    children?: Snippet;
  } = $props();
  const r = $derived((size - stroke) / 2);
  const c = $derived(2 * Math.PI * r);
</script>

<span
  class="ring"
  class:indet={value == null}
  style:width="{size}px"
  style:height="{size}px"
  role="progressbar"
  aria-label={label}
  aria-valuemin={0}
  aria-valuemax={100}
  aria-valuenow={value == null ? undefined : Math.round(value * 100)}
>
  <svg viewBox="0 0 {size} {size}" width={size} height={size}>
    <circle cx={size / 2} cy={size / 2} {r} stroke-width={stroke} class="bg" />
    <circle
      cx={size / 2}
      cy={size / 2}
      {r}
      stroke-width={stroke}
      stroke={color}
      stroke-dasharray={c}
      stroke-dashoffset={value == null ? c * 0.7 : c * (1 - Math.max(0, Math.min(1, value)))}
      class="fg"
    />
  </svg>
  {#if children}<span class="in">{@render children()}</span>{/if}
</span>

<style>
  .ring { position: relative; display: inline-grid; place-items: center; flex-shrink: 0; }
  svg { position: absolute; inset: 0; transform: rotate(-90deg); }
  circle { fill: none; }
  .bg { stroke: var(--line-hi); }
  .fg { stroke-linecap: round; transition: stroke-dashoffset var(--t-slow) var(--ease); }
  .indet svg { animation: spin 0.9s linear infinite; }
  .in { position: relative; display: grid; place-items: center; font-size: 10px; line-height: 1; }
</style>
