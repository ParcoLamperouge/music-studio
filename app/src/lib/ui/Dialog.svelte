<script lang="ts">
  import type { Snippet } from "svelte";
  import IconButton from "./IconButton.svelte";

  // Modal (<dialog> nativo: foco atrapado, Esc, fondo). Se cierra también al pulsar fuera. `footer`: botones abajo.
  let {
    open = $bindable(false),
    title,
    width = 560,
    children,
    footer,
  }: { open: boolean; title?: string; width?: number; children: Snippet; footer?: Snippet } = $props();
  let el: HTMLDialogElement | undefined = $state();

  $effect(() => {
    if (open && el && !el.open) el.showModal();
  });
</script>

{#if open}
  <dialog
    bind:this={el}
    aria-modal="true"
    aria-label={title}
    style:width="min({width}px, calc(100vw - 32px))"
    onclose={() => (open = false)}
    onclick={(e) => e.target === el && el.close()}
  >
    <div class="inner">
      {#if title}
        <header>
          <h2>{title}</h2>
          <IconButton icon="close" label="Cerrar" kbd="Esc" onclick={() => el?.close()} />
        </header>
      {/if}
      <div class="body">{@render children()}</div>
      {#if footer}<footer>{@render footer()}</footer>{/if}
    </div>
  </dialog>
{/if}

<style>
  dialog {
    max-height: calc(100vh - 64px); padding: 0; border: 0; border-radius: var(--r-lg); background: var(--panel); color: var(--text);
    box-shadow: var(--shadow); overflow: hidden; animation: rise var(--t-slow) var(--ease);
  }
  dialog::backdrop { background: var(--scrim); animation: fade var(--t); }
  .inner { display: flex; flex-direction: column; max-height: calc(100vh - 64px); }
  header { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); padding: var(--s3) var(--s3) var(--s2) var(--s5); }
  .body { flex: 1; min-height: 0; overflow-y: auto; padding: var(--s2) var(--s5) var(--s5); }
  footer { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; padding: var(--s3) var(--s5); border-top: 1px solid var(--line); }
</style>
