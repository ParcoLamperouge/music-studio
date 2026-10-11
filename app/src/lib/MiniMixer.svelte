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

<div class="mini">
  {#each stems as st (st.name)}
    {@const info = STEM_INFO[st.name]}
    <div class="ch" class:absent={!st.present} class:off={muted[st.name]} style:--c={info.color}>
      <span class="dot"></span>
      <span class="name">{info.label}</span>
      <input type="range" min="0" max="1.5" step="0.01" bind:value={volume[st.name]} title="{info.label}: {Math.round(volume[st.name] * 100)}%" />
      <button class:on={muted[st.name]} onclick={() => (muted[st.name] = !muted[st.name])} title="Silenciar">M</button>
      <button class="solo" class:on={solo[st.name]} onclick={() => (solo[st.name] = !solo[st.name])} title="Solo">S</button>
    </div>
  {/each}
</div>

<style>
  .mini {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 6px 14px;
    padding: 10px 14px; margin-bottom: 8px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
  }
  .ch { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .ch.absent { opacity: 0.5; }
  .ch.off .name { color: var(--text-3); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); flex-shrink: 0; }
  .name { width: 62px; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  input { flex: 1; min-width: 50px; accent-color: var(--c); }
  button {
    width: 22px; height: 20px; border-radius: 5px; border: 1px solid var(--line); background: transparent;
    color: var(--text-2); font-size: 10px; font-weight: 700; cursor: pointer; flex-shrink: 0; padding: 0;
  }
  button.on { background: #e5484d; border-color: #e5484d; color: white; }
  button.solo.on { background: #f5c542; border-color: #f5c542; color: #1a1a1a; }
</style>
