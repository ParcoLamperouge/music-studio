<script lang="ts">
  import type { HTMLInputAttributes } from "svelte/elements";

  // Campo de texto con su etiqueta encima.
  let { label, value = $bindable(""), ref = $bindable(), ...rest }: Omit<HTMLInputAttributes, "value"> & {
    label: string;
    value?: string;
    ref?: HTMLInputElement;
  } = $props();
</script>

<label class="field">
  <span>{label}</span>
  <input class="field-input" bind:this={ref} bind:value {...rest} />
</label>

<style>
  .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: var(--fs-sm); color: var(--text-2); }
  .field-input {
    height: 36px; padding: 0 var(--s3); border: 1px solid var(--line); border-radius: var(--r-md); outline: none;
    background: var(--bg); color: var(--text); font-size: var(--fs-md); transition: border-color var(--t-fast);
  }
  .field-input:focus { border-color: var(--accent-line); }
  .field-input::placeholder { color: var(--text-3); }
</style>
