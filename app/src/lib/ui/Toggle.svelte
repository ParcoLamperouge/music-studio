<script lang="ts">
  import type { Snippet } from "svelte";

  // Interruptor encendido/apagado (checkbox nativo con role=switch). El texto va como hijo.
  let { checked = $bindable(false), disabled = false, title, children }: { checked: boolean; disabled?: boolean; title?: string; children?: Snippet } = $props();
</script>

<label class="toggle" class:disabled {title}>
  <input type="checkbox" role="switch" bind:checked {disabled} />
  <span class="track" aria-hidden="true"></span>
  {#if children}<span class="txt">{@render children()}</span>{/if}
</label>

<style>
  .toggle { display: inline-flex; align-items: center; gap: var(--s2); cursor: pointer; font-size: var(--fs-md); color: var(--text); min-width: 0; }
  .disabled { opacity: 0.45; cursor: default; }
  input { position: absolute; opacity: 0; width: 1px; height: 1px; }
  .track { position: relative; width: 28px; height: 16px; flex-shrink: 0; border-radius: var(--r-full); background: var(--line-hi); transition: background var(--t); }
  .track::after {
    content: ""; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: var(--text-2);
    transition: transform var(--t) var(--ease), background var(--t);
  }
  input:checked + .track { background: var(--accent); }
  input:checked + .track::after { transform: translateX(12px); background: var(--on-accent); }
  input:focus-visible + .track { outline: 2px solid var(--accent); outline-offset: 2px; }
  .txt { min-width: 0; }
</style>
