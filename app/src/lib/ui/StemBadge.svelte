<script lang="ts">
  import { STEM_INFO } from "../engine";
  import { stemColor } from "./music";

  // Una pista con su color y su nombre. `muted` la tacha (apagada); `dot`: solo el punto (con su nombre en el tooltip).
  let { stem, muted = false, dot = false }: { stem: string; muted?: boolean; dot?: boolean } = $props();
  const label = $derived(STEM_INFO[stem]?.label ?? stem);
</script>

<span class="stem" class:muted title={dot ? label : undefined} style:--c={stemColor(stem)}>
  <i></i>{#if !dot}<span>{label}</span>{:else}<span class="sr-only">{label}</span>{/if}
</span>

<style>
  .stem { display: inline-flex; align-items: center; gap: 6px; font-size: var(--fs-sm); color: var(--text); white-space: nowrap; min-width: 0; }
  i { width: 8px; height: 8px; border-radius: 2px; background: var(--c); flex-shrink: 0; }
  .muted { color: var(--text-3); text-decoration: line-through; }
  .muted i { background: transparent; box-shadow: inset 0 0 0 1.5px var(--c); }
</style>
