<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon, { type IconName } from "./Icon.svelte";

  // Pastilla: filtro conmutable (con onclick) o etiqueta (sin él). `color` pone un punto de color de datos delante.
  let {
    active = false,
    count,
    icon,
    color,
    title,
    onclick,
    children,
  }: { active?: boolean; count?: number; icon?: IconName; color?: string; title?: string; onclick?: () => void; children: Snippet } = $props();
</script>

{#snippet body()}
  {#if color}<i style:background={color}></i>{/if}
  {#if icon}<Icon name={icon} size={13} />{/if}
  {@render children()}
  {#if count != null}<small class="num">{count}</small>{/if}
{/snippet}

{#if onclick}
  <button type="button" class="pill" class:active aria-pressed={active} {title} {onclick}>{@render body()}</button>
{:else}
  <span class="pill" {title}>{@render body()}</span>
{/if}

<style>
  .pill {
    display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 10px; border-radius: var(--r-full); flex-shrink: 0;
    border: 1px solid var(--line); background: transparent; color: var(--text-2); font-size: var(--fs-sm); white-space: nowrap;
    transition: color var(--t-fast), border-color var(--t-fast), background var(--t-fast);
  }
  button.pill:hover { color: var(--text); border-color: var(--line-hi); }
  .active { background: var(--accent-soft); border-color: var(--accent-line); color: var(--text); }
  i { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  small { color: var(--text-3); font-size: var(--fs-xs); }
  .active small { color: var(--text-2); }
</style>
