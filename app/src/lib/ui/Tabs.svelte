<script lang="ts" generics="T extends string">
  import Icon, { type IconName } from "./Icon.svelte";
  import type { Snippet } from "svelte";

  // Elegir una de pocas opciones. segmented: pastilla con fondo (modos, filtros cortos); underline: pestañas de una vista.
  // `right`: contenido extra dentro del botón (p. ej. un menú), con clics que no cambian de pestaña.
  let {
    options,
    value = $bindable(),
    variant = "segmented",
    size = "md",
    label,
    onchange,
  }: {
    options: { value: T; label?: string; icon?: IconName; count?: number; title?: string; right?: Snippet }[];
    value: T;
    variant?: "segmented" | "underline";
    size?: "sm" | "md";
    label?: string; // aria-label del grupo
    onchange?: (v: T) => void;
  } = $props();

  function pick(v: T) {
    value = v;
    onchange?.(v);
  }
  function key(e: KeyboardEvent) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const i = options.findIndex((o) => o.value === value) + (e.key === "ArrowRight" ? 1 : -1);
    const next = options[(i + options.length) % options.length];
    pick(next.value);
    (e.currentTarget as HTMLElement).querySelector<HTMLElement>(`[data-v="${next.value}"]`)?.focus();
    e.preventDefault();
  }
</script>

<div class="tabs-ui {variant} s-{size}" role="tablist" aria-label={label} tabindex="-1" onkeydown={key}>
  {#each options as o (o.value)}
    <button
      type="button"
      role="tab"
      data-v={o.value}
      aria-selected={o.value === value}
      tabindex={o.value === value ? 0 : -1}
      title={o.title}
      aria-label={o.label ? undefined : o.title}
      onclick={(e) => {
        if (!(e.target as HTMLElement).closest(".right")) pick(o.value); // lo de «right» (menús) no cambia de pestaña
      }}
    >
      {#if o.icon}<Icon name={o.icon} size={14} />{/if}
      {#if o.label}<span>{o.label}</span>{/if}
      {#if o.count != null}<small class="num">{o.count}</small>{/if}
      {#if o.right}<span class="right">{@render o.right()}</span>{/if}
    </button>
  {/each}
</div>

<style>
  .tabs-ui { display: inline-flex; align-items: center; min-width: 0; outline: none; }
  button {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; background: none; white-space: nowrap;
    color: var(--text-2); font-size: var(--fs-md); transition: color var(--t-fast), background var(--t-fast), box-shadow var(--t-fast);
  }
  button:hover { color: var(--text); }
  small { color: var(--text-3); font-size: var(--fs-xs); }
  .segmented { align-self: flex-start; gap: 2px; padding: 2px; border-radius: var(--r-md); background: var(--panel); border: 1px solid var(--line); }
  .segmented button { height: 26px; padding: 0 10px; border-radius: var(--r-sm); }
  .segmented.s-sm button { height: 22px; padding: 0 8px; font-size: var(--fs-sm); }
  .segmented button[aria-selected="true"] { background: var(--panel-hi); color: var(--text); box-shadow: 0 0 0 1px var(--line-hi); }
  .underline { gap: var(--s4); border-bottom: 1px solid var(--line); align-self: stretch; }
  .underline button { height: 36px; padding: 0 12px; margin-bottom: -1px; box-shadow: inset 0 -2px 0 transparent; }
  .underline.s-sm button { height: 30px; font-size: var(--fs-sm); }
  .underline button[aria-selected="true"] { color: var(--text); box-shadow: inset 0 -2px 0 var(--accent); }
  .right { display: inline-flex; align-items: center; }
</style>
