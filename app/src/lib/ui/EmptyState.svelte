<script lang="ts">
  import type { Snippet } from "svelte";
  import Icon, { type IconName } from "./Icon.svelte";

  // Estado vacío: icono, una frase y la acción que lo arregla (actions). Nada de párrafos.
  let { icon, title, children, actions }: { icon: IconName; title: string; children?: Snippet; actions?: Snippet } = $props();
</script>

<div class="empty-ui">
  <span class="ico"><Icon name={icon} size={28} /></span>
  <h2>{title}</h2>
  {#if children}<p>{@render children()}</p>{/if}
  {#if actions}<div class="acts">{@render actions()}</div>{/if}
</div>

<style>
  .empty-ui {
    display: flex; flex-direction: column; align-items: center; text-align: center; gap: var(--s2); margin: auto; padding: var(--s6) var(--s4);
    max-width: 520px; animation: rise var(--t-slow) var(--ease);
  }
  .ico { display: grid; place-items: center; width: 56px; height: 56px; border-radius: var(--r-lg); background: var(--panel); color: var(--text-2); margin-bottom: var(--s2); }
  p { color: var(--text-2); font-size: var(--fs-md); }
  .acts { display: flex; flex-wrap: wrap; justify-content: center; align-items: center; gap: var(--s2); margin-top: var(--s3); width: 100%; }
</style>
