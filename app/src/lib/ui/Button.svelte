<script lang="ts">
  import type { Snippet } from "svelte";
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon, { type IconName } from "./Icon.svelte";

  // Botón de texto. primary: la acción principal de la pantalla (una, en magenta); secondary: con borde; ghost: sin borde;
  // danger: borrar. Para solo un icono, IconButton.
  let {
    variant = "secondary",
    size = "md",
    icon,
    kbd,
    active = false,
    children,
    ...rest
  }: HTMLButtonAttributes & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    size?: "sm" | "md" | "lg";
    icon?: IconName;
    kbd?: string;
    active?: boolean; // conmutado (aria-pressed)
    children?: Snippet;
  } = $props();
</script>

<button type="button" class="btn v-{variant} s-{size}" class:active aria-pressed={active || undefined} {...rest}>
  {#if icon}<Icon name={icon} size={size === "sm" ? 14 : 16} />{/if}
  {@render children?.()}
  {#if kbd}<kbd>{kbd}</kbd>{/if}
</button>

<style>
  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: var(--s2); white-space: nowrap; flex-shrink: 0;
    border: 1px solid transparent; border-radius: var(--r-md); background: transparent; color: var(--text-2);
    font-size: var(--fs-md); font-weight: 500; line-height: 1.2;
    transition: color var(--t-fast), background var(--t-fast), border-color var(--t-fast);
  }
  .s-md { height: 32px; padding: 0 var(--s3); }
  .s-lg { height: 44px; padding: 0 var(--s4); border-radius: var(--r-lg); }
  .s-sm { height: 26px; padding: 0 var(--s2); font-size: var(--fs-sm); gap: 6px; }
  .btn:disabled { opacity: 0.4; }
  .v-primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); font-weight: 600; }
  .v-primary:hover:not(:disabled) { background: color-mix(in oklab, var(--accent) 88%, white); }
  .v-primary kbd { color: var(--on-accent); border-color: color-mix(in oklab, var(--on-accent) 35%, transparent); }
  .v-secondary { border-color: var(--line-hi); color: var(--text); }
  .v-secondary:hover:not(:disabled), .v-ghost:hover:not(:disabled) { background: var(--panel-hi); color: var(--text); }
  .v-danger { border-color: color-mix(in oklab, var(--bad) 45%, var(--line)); color: var(--bad); }
  .v-danger:hover:not(:disabled) { background: color-mix(in oklab, var(--bad) 12%, transparent); }
  .active { background: var(--accent-soft); border-color: var(--accent-line); color: var(--text); }
</style>
