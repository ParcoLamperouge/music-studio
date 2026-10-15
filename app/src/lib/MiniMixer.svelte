<script lang="ts">
  import type { Stem } from "./engine";
  import MuteSolo from "./ui/MuteSolo.svelte";
  import Slider from "./ui/Slider.svelte";
  import StemBadge from "./ui/StemBadge.svelte";
  import { stemColor } from "./ui/music";

  /** Volumen + M/S de todas las pistas en una tira compacta. Comparte estado con las pistas grandes. */
  let { stems, volume = $bindable(), muted = $bindable(), solo = $bindable() }: {
    stems: Stem[];
    volume: Record<string, number>;
    muted: Record<string, boolean>;
    solo: Record<string, boolean>;
  } = $props();
</script>

<div class="mixer">
  {#each stems as st (st.name)}
    <div class="ch" class:absent={!st.present}>
      <StemBadge stem={st.name} muted={muted[st.name]} />
      <Slider bind:value={volume[st.name]} max={1.5} label="Volumen" color={stemColor(st.name)} />
      <MuteSolo bind:muted={muted[st.name]} bind:solo={solo[st.name]} />
    </div>
  {/each}
</div>

<style>
  .mixer {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--s1) var(--s4); padding: var(--s2) var(--s3);
    border-radius: var(--r-lg); background: var(--panel); border: 1px solid var(--line);
  }
  .ch { display: grid; grid-template-columns: 76px 1fr auto; align-items: center; gap: var(--s2); min-width: 0; }
  .absent { opacity: 0.45; }
</style>
