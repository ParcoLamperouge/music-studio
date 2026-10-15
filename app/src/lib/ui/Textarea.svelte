<script lang="ts">
  import type { HTMLTextareaAttributes } from "svelte/elements";

  // Campo de varias líneas con su etiqueta encima (como Field).
  let { label, value = $bindable(""), ...rest }: Omit<HTMLTextareaAttributes, "value"> & { label: string; value?: string } = $props();
</script>

<label class="field">
  <span>{label}</span>
  <textarea class="ta" bind:value {...rest}></textarea>
</label>

<style>
  .field { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: var(--fs-sm); color: var(--text-2); }
  .ta {
    padding: var(--s2) var(--s3); border: 1px solid var(--line); border-radius: var(--r-md); outline: none; resize: vertical;
    background: var(--bg); color: var(--text); font-size: var(--fs-sm); transition: border-color var(--t-fast);
  }
  .ta:focus { border-color: var(--accent-line); }
  .ta::placeholder { color: var(--text-3); }
</style>
