<script lang="ts">
  import type { HTMLButtonAttributes } from "svelte/elements";
  import Icon, { type IconName } from "./Icon.svelte";
  import { tooltip, type TipOpts } from "./tooltip";

  // Botón de un icono: `label` es su nombre (aria-label) y su tooltip; `kbd`, el atajo que sale en el tooltip.
  let {
    icon,
    label,
    kbd,
    side = "top",
    size = "md",
    active = false,
    ...rest
  }: HTMLButtonAttributes & {
    icon: IconName;
    label: string;
    kbd?: string;
    side?: TipOpts["side"];
    size?: "sm" | "md" | "lg";
    active?: boolean;
  } = $props();
</script>

<button
  type="button"
  class="ib s-{size}"
  class:active
  aria-label={label}
  aria-pressed={active || undefined}
  use:tooltip={{ text: label, kbd, side }}
  {...rest}
>
  <Icon name={icon} size={size === "sm" ? 14 : size === "lg" ? 20 : 16} />
</button>

<style>
  .ib {
    display: inline-grid; place-items: center; flex-shrink: 0; padding: 0; border: 0; border-radius: var(--r-md);
    background: transparent; color: var(--text-2); transition: color var(--t-fast), background var(--t-fast);
  }
  .s-sm { width: 24px; height: 24px; }
  .s-md { width: 32px; height: 32px; }
  .s-lg { width: 40px; height: 40px; border-radius: var(--r-lg); }
  .ib:hover:not(:disabled) { color: var(--text); background: var(--panel-hi); }
  .ib:disabled { opacity: 0.4; }
  .active { color: var(--text); background: var(--panel-hi); }
</style>
