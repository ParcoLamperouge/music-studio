<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  // El buscador de toda la app: lupa + campo; `kbd` muestra el atajo a la derecha.
  let {
    value = $bindable(""),
    ref = $bindable(),
    kbd,
    ...rest
  }: Omit<HTMLInputAttributes, "value"> & { value?: string; ref?: HTMLInputElement; kbd?: string } = $props();
</script>

<label class="search">
  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
  <input type="search" bind:this={ref} bind:value {...rest} />
  {#if kbd}<kbd>{kbd}</kbd>{/if}
</label>

<style>
  .search { position: relative; display: block; flex: 1; min-width: 0; }
  svg { position: absolute; left: 9px; top: 50%; translate: 0 -50%; width: 14px; height: 14px; stroke: var(--text-3); fill: none; stroke-width: 2; pointer-events: none; }
  input { width: 100%; padding-left: 30px; padding-right: 30px; background: var(--panel); }
  kbd { position: absolute; right: 8px; top: 50%; translate: 0 -50%; pointer-events: none; }
</style>
