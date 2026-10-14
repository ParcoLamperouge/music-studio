<script lang="ts">
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import { tooltip } from "../ui/tooltip";
  import { RAIL, type View } from "./nav";

  // Barra fija de iconos a la izquierda: las vistas (Alt+1…7), buscar (Ctrl+K) y ajustes abajo.
  let { view, onnav, onsearch, onsettings }: { view: View; onnav: (v: View) => void; onsearch: () => void; onsettings: () => void } = $props();
</script>

<nav class="rail" aria-label="Secciones">
  <span class="mark" aria-hidden="true">E</span>
  <IconButton icon="search" label="Buscar o ir a…" kbd="Ctrl+K" side="right" size="lg" onclick={onsearch} />
  <span class="sep"></span>
  {#each RAIL as r, i (r.id)}
    <button
      type="button"
      class="nav-btn"
      class:current={view === r.id}
      aria-current={view === r.id ? "page" : undefined}
      aria-label={r.label}
      use:tooltip={{ text: r.label, kbd: `Alt+${i + 1}`, side: "right" }}
      onclick={() => onnav(r.id)}
    >
      <Icon name={r.icon} size={20} />
    </button>
  {/each}
  <span class="grow"></span>
  <IconButton icon="settings" label="Ajustes" side="right" size="lg" onclick={onsettings} />
</nav>

<style>
  .rail {
    grid-row: 1 / -1; display: flex; flex-direction: column; align-items: center; gap: var(--s1); width: var(--rail-w);
    padding: var(--s3) 0; background: var(--rail); border-right: 1px solid var(--line); min-height: 0; overflow: hidden;
  }
  .mark {
    display: grid; place-items: center; width: 28px; height: 28px; margin-bottom: var(--s2); border-radius: var(--r-md);
    border: 1.5px solid var(--text); color: var(--text); font-weight: 800; font-size: var(--fs-md);
  }
  .sep { width: 24px; height: 1px; background: var(--line); margin: var(--s1) 0; }
  .grow { flex: 1; }
  .nav-btn {
    position: relative; display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: var(--r-lg);
    background: transparent; color: var(--text-3); transition: color var(--t-fast), background var(--t-fast);
  }
  .nav-btn:hover { color: var(--text); background: var(--panel); }
  .nav-btn.current { color: var(--text); background: var(--panel-hi); }
  .nav-btn.current::before {
    content: ""; position: absolute; left: -8px; top: 10px; bottom: 10px; width: 3px; border-radius: 0 2px 2px 0; background: var(--accent);
  }
</style>
