<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon from "./Icon.svelte";

  // Respuesta grande de una prueba (oído): `state` right (era esta, ✓), wrong (la elegida y mal, ×), dim (las demás al
  // contestar). `kbd`: la tecla que la elige. Lo de dentro (texto, acordes) como hijo.
  let { state = "idle", kbd, disabled = false, title, onclick, children }: {
    state?: "idle" | "right" | "wrong" | "dim";
    kbd?: string;
    disabled?: boolean;
    title?: string;
    onclick: () => void;
    children: Snippet;
  } = $props();
</script>

<button type="button" class="ans {state}" {disabled} {title} {onclick}>
  {#if kbd}<kbd>{kbd}</kbd>{/if}
  <span class="body">{@render children()}</span>
  {#if state === "right"}<span class="mark"><Icon name="check" size={16} label="Correcta" /></span>
  {:else if state === "wrong"}<span class="mark"><Icon name="close" size={16} label="Incorrecta" /></span>{/if}
</button>

<style>
  .ans {
    position: relative; display: flex; align-items: center; justify-content: center; gap: var(--s2); min-height: 64px; min-width: 0; padding: var(--s3) var(--s4);
    border: 1px solid var(--line-hi); border-radius: var(--r-lg); background: var(--panel); color: var(--text); font-size: var(--fs-lg); font-weight: 600;
    transition: background var(--t-fast), border-color var(--t-fast), transform var(--t-fast), opacity var(--t);
  }
  .ans:hover:not(:disabled) { background: var(--panel-hi); border-color: var(--text-3); transform: translateY(-1px); }
  .ans:active:not(:disabled) { transform: none; }
  kbd { position: absolute; top: 6px; left: 8px; }
  .body { display: flex; align-items: center; justify-content: center; gap: var(--s1); flex-wrap: wrap; min-width: 0; }
  .mark { position: absolute; top: 6px; right: 8px; }
  .right { border-color: var(--ok); background: color-mix(in oklab, var(--ok) 16%, var(--panel)); }
  .right .mark { color: var(--ok); }
  .wrong { border-color: var(--bad); background: color-mix(in oklab, var(--bad) 14%, var(--panel)); }
  .wrong .mark { color: var(--bad); }
  .dim { opacity: 0.4; }
  .ans:disabled { cursor: default; }
</style>
