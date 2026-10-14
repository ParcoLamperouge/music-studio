<script lang="ts">
  import { STEM_INFO, type Stem } from "./engine";

  /** Volumen + M/S de todas las pistas en una tira compacta. Comparte estado con el mezclador grande. */
  let { stems, volume = $bindable(), muted = $bindable(), solo = $bindable() }: {
    stems: Stem[];
    volume: Record<string, number>;
    muted: Record<string, boolean>;
    solo: Record<string, boolean>;
  } = $props();
</script>

<div class="card mini">
  {#each stems as st (st.name)}
    {@const info = STEM_INFO[st.name]}
    <div class="ch" class:absent={!st.present} class:off={muted[st.name]} style:--c={info.color}>
      <span class="dot"></span>
      <span class="name">{info.label}</span>
      <input type="range" min="0" max="1.5" step="0.01" bind:value={volume[st.name]} title="{info.label}: {Math.round(volume[st.name] * 100)}%" />
      <button class="ms-btn" class:on={muted[st.name]} onclick={() => (muted[st.name] = !muted[st.name])} title="Silenciar">M</button>
      <button class="ms-btn solo" class:on={solo[st.name]} onclick={() => (solo[st.name] = !solo[st.name])} title="Solo">S</button>
    </div>
  {/each}
</div>

<style>
  .mini { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 6px 14px; padding: 8px 12px; margin-bottom: 8px; }
  .ch { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .ch.absent { opacity: 0.5; }
  .ch.off .name { color: var(--text-3); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex-shrink: 0; }
  .name { width: 62px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  input { flex: 1; min-width: 50px; accent-color: var(--c); }
</style>
