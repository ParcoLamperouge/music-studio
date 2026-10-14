<script lang="ts" module>
  import type { IconName } from "../ui/Icon.svelte";
  /** Una orden de la paleta (Ctrl+K). */
  export type Command = { id: string; label: string; hint?: string; icon: IconName; kbd?: string; group: string; run: () => void };
</script>

<script lang="ts">
  import { store } from "../store.svelte";
  import Dialog from "../ui/Dialog.svelte";
  import Icon from "../ui/Icon.svelte";
  import Search from "../ui/Search.svelte";
  import { fold } from "./nav";

  // Paleta de órdenes: ir a una vista, una acción o cualquier canción, escribiendo. Flechas + Intro.
  let { open = $bindable(false), commands, onsong }: { open: boolean; commands: Command[]; onsong: (key: string) => void } = $props();

  let q = $state("");
  let at = $state(0);
  let input: HTMLInputElement | undefined = $state();
  let list: HTMLElement | undefined = $state();

  $effect(() => {
    if (open) {
      q = "";
      queueMicrotask(() => input?.focus());
    }
  });

  const results = $derived.by<Command[]>(() => {
    const needle = fold(q.trim());
    const cmds = commands.filter((c) => !needle || fold(`${c.label} ${c.hint ?? ""}`).includes(needle));
    const tracks = needle
      ? store.tracks.filter((t) => fold(`${t.artist} ${t.title}`).includes(needle)).slice(0, 40)
      : [...store.tracks].sort((a, b) => b.modified - a.modified).slice(0, 6);
    const songs: Command[] = tracks.map((t) => ({
      id: `song:${t.key}`, label: t.title || t.key, hint: t.artist, icon: "audio", group: needle ? "Canciones" : "Recientes", run: () => onsong(t.key),
    }));
    return [...cmds, ...songs];
  });
  $effect(() => {
    void results;
    at = 0;
  });
  $effect(() => {
    list?.querySelector(`[data-i="${at}"]`)?.scrollIntoView({ block: "nearest" });
  });

  function run(c: Command | undefined) {
    if (!c) return;
    open = false;
    c.run();
  }
  function key(e: KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      at = (at + (e.key === "ArrowDown" ? 1 : -1) + results.length) % Math.max(1, results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      run(results[at]);
    }
  }
</script>

<Dialog bind:open width={620}>
  <div class="pal">
    <Search bind:ref={input} bind:value={q} size="lg" placeholder="Buscar canción, vista o acción…" onkeydown={key} aria-controls="pal-list" />
    <div class="list" id="pal-list" role="listbox" aria-label="Resultados" bind:this={list}>
      {#each results as c, i (c.id)}
        {#if i === 0 || results[i - 1].group !== c.group}<h3>{c.group}</h3>{/if}
        <button
          type="button"
          role="option"
          aria-selected={i === at}
          data-i={i}
          class="opt"
          class:sel={i === at}
          onpointermove={() => (at = i)}
          onclick={() => run(c)}
        >
          <Icon name={c.icon} size={16} />
          <span class="l">{c.label}</span>
          {#if c.hint}<span class="h">{c.hint}</span>{/if}
          {#if c.kbd}<kbd>{c.kbd}</kbd>{/if}
        </button>
      {:else}
        <p class="none">Nada con «{q}».</p>
      {/each}
    </div>
    <footer><span><kbd>↑</kbd><kbd>↓</kbd> moverse</span><span><kbd>Intro</kbd> abrir</span><span><kbd>Esc</kbd> cerrar</span></footer>
  </div>
</Dialog>

<style>
  .pal { display: flex; flex-direction: column; gap: var(--s2); padding-top: var(--s3); }
  .list { display: flex; flex-direction: column; max-height: min(420px, 60vh); overflow-y: auto; margin: 0 calc(-1 * var(--s2)); padding: 0 var(--s2); }
  h3 { margin: var(--s3) 0 var(--s1); padding: 0 var(--s2); font-size: var(--fs-xs); font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em; }
  .opt {
    display: flex; align-items: center; gap: var(--s3); min-height: 36px; padding: 0 var(--s2); border: 0; border-radius: var(--r-md);
    background: none; color: var(--text-2); text-align: left; min-width: 0;
  }
  .opt.sel { background: var(--panel-hi); color: var(--text); box-shadow: inset 2px 0 0 var(--accent); }
  .l { color: var(--text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .h { flex: 1; color: var(--text-3); font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .none { padding: var(--s4) var(--s2); color: var(--text-3); }
  footer { display: flex; align-items: center; gap: var(--s4); padding-top: var(--s2); border-top: 1px solid var(--line); color: var(--text-3); font-size: var(--fs-xs); }
  footer span { display: inline-flex; align-items: center; gap: 4px; }
</style>
