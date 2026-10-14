<script lang="ts" module>
  import type { IconName } from "./Icon.svelte";
  /** Una opción del menú; "-" separa grupos. */
  export type MenuItem = { label: string; icon?: IconName; kbd?: string; title?: string; danger?: boolean; disabled?: boolean; run: () => void } | "-";
</script>

<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";
  import Popover from "./Popover.svelte";

  // Menú de acciones sobre un Popover: flechas para moverse, Intro para elegir, Esc para cerrar.
  let { items, side = "bottom", align = "start", label, trigger }: {
    items: MenuItem[];
    side?: "bottom" | "top" | "right";
    align?: "start" | "end";
    label?: string;
    trigger: Snippet<[{ open: boolean; toggle: () => void }]>;
  } = $props();
  let open = $state(false);

  function nav(e: KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const list = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>("[role='menuitem']:not(:disabled)")];
    const i = list.indexOf(document.activeElement as HTMLElement) + (e.key === "ArrowDown" ? 1 : -1);
    list[(i + list.length) % list.length]?.focus();
  }
</script>

<Popover bind:open {side} {align} {label} {trigger}>
  <div class="menu-list" role="menu" tabindex="-1" aria-label={label} onkeydown={nav}>
    {#each items as it, i (i)}
      {#if it === "-"}
        <hr />
      {:else}
        <button
          type="button"
          role="menuitem"
          class:danger={it.danger}
          disabled={it.disabled}
          title={it.title}
          onclick={() => ((open = false), it.run())}
        >
          <span class="ico">{#if it.icon}<Icon name={it.icon} size={14} />{/if}</span>
          <span class="lbl">{it.label}</span>
          {#if it.kbd}<kbd>{it.kbd}</kbd>{/if}
        </button>
      {/if}
    {/each}
  </div>
</Popover>

<style>
  .menu-list { display: flex; flex-direction: column; outline: none; }
  button {
    display: flex; align-items: center; gap: var(--s2); width: 100%; height: 30px; padding: 0 var(--s2); border: 0; border-radius: var(--r-md);
    background: none; color: var(--text); font-size: var(--fs-md); text-align: left; white-space: nowrap;
  }
  button:hover:not(:disabled), button:focus-visible { background: var(--panel-hi); outline: none; }
  button:disabled { opacity: 0.4; }
  .ico { width: 14px; display: grid; place-items: center; color: var(--text-2); }
  .lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .danger, .danger .ico { color: var(--bad); }
  hr { border: 0; border-top: 1px solid var(--line); margin: var(--s1) var(--s2); }
</style>
