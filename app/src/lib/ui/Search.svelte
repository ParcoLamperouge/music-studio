<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";
  import Icon from "./Icon.svelte";
  import { t } from "../i18n.svelte";

  // El buscador de toda la app: lupa, campo, borrar y el atajo (`kbd`) a la derecha.
  let {
    value = $bindable(""),
    ref = $bindable(),
    kbd,
    size = "md",
    ...rest
  }: Omit<HTMLInputAttributes, "value" | "size"> & { value?: string; ref?: HTMLInputElement; kbd?: string; size?: "sm" | "md" | "lg" } = $props();
</script>

<label class="search s-{size}">
  <Icon name="search" size={size === "lg" ? 18 : 14} />
  <input class="search-input" type="search" bind:this={ref} bind:value {...rest} />
  {#if value}
    <button type="button" class="clear" aria-label={t("Borrar")} onclick={() => ((value = ""), ref?.focus())}><Icon name="close" size={12} /></button>
  {:else if kbd}<kbd>{kbd}</kbd>{/if}
</label>

<style>
  .search {
    position: relative; display: flex; align-items: center; gap: var(--s2); flex: 1; min-width: 0; height: 32px; padding: 0 var(--s2) 0 10px;
    border: 1px solid var(--line); border-radius: var(--r-md); background: var(--panel); color: var(--text-3);
    transition: border-color var(--t-fast);
  }
  .search:focus-within { border-color: var(--accent-line); }
  .s-sm { height: 26px; }
  .s-lg { height: 44px; padding: 0 var(--s3) 0 var(--s3); gap: var(--s3); border-radius: var(--r-lg); }
  .search-input {
    flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: none; background: none; color: var(--text); font-size: var(--fs-md);
  }
  .s-lg .search-input { font-size: var(--fs-lg); }
  .search-input::-webkit-search-cancel-button { display: none; }
  .search-input::placeholder { color: var(--text-3); }
  .clear { display: grid; place-items: center; width: 20px; height: 20px; padding: 0; border: 0; border-radius: var(--r-sm); background: none; color: var(--text-3); }
  .clear:hover { color: var(--text); background: var(--panel-hi); }
</style>
