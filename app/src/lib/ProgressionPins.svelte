<script lang="ts">
  import { chips } from "./progression";
  import { seekOnOpen } from "./progindex";
  import { pinId, pins, playAll, playPreview, preview, stopAll, stopPreview, togglePin } from "./preview.svelte";
  import { store } from "./store.svelte";

  let { onopen }: { onopen: (key: string, t: number) => void } = $props();
  const name = (key: string) => store.tracks.find((x) => x.key === key)?.title ?? key;
  const artist = (key: string) => store.tracks.find((x) => x.key === key)?.artist ?? "";
</script>

{#if pins.length}
  <section class="pins">
    <div class="head">
      <span class="kicker">Comparar · {pins.length}</span>
      <button class="ghost sm" onclick={() => (preview.id ? stopAll() : void playAll())}>{preview.id ? "■ Parar" : "▶ Todas"}</button>
    </div>
    <div class="cards">
      {#each pins as p (pinId(p))}
        {@const on = preview.id === pinId(p)}
        <div class="card pin" class:on>
          <b>{name(p.key)}</b><small>{artist(p.key)}</small>
          <div class="chips">
            {#each chips(p, p.songKey) as c, i (i)}
              <span class="chip {c.kind}" title={c.tip} class:on={on && !preview.loading && preview.pos >= p.ts[i] - p.t && preview.pos < (p.ts[i + 1] ?? p.end) - p.t}>{c.name}<small>{c.deg}</small></span>
            {/each}
          </div>
          <div class="acts">
            <button class="ghost sm" onclick={() => (on ? stopPreview() : void playPreview(p))}>{on && preview.loading ? "…" : on ? "■" : "▶"}</button>
            <button class="ghost sm" title="Abrir" onclick={() => (seekOnOpen(p.key, p.t), onopen(p.key, p.t))}>↗</button>
            <button class="ghost sm" title="Quitar" onclick={() => togglePin(p)}>✕</button>
          </div>
          {#if on && preview.dur}<i class="bar" style="width:{Math.min(100, (preview.pos / preview.dur) * 100)}%"></i>{/if}
        </div>
      {/each}
    </div>
  </section>
{/if}

<style>
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 8px; }
  .pin { position: relative; display: flex; flex-direction: column; gap: 4px; }
  .pin b { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pin small { color: var(--text-3); }
  .chips { display: flex; gap: 3px; flex-wrap: wrap; }
  .chip.rel, .chip.same, .chip.far { border-style: dashed; opacity: 0.75; }
  .chip.extra { opacity: 0.45; }
  .acts { display: flex; gap: 4px; }
  .bar { position: absolute; left: 0; bottom: 0; height: 2px; background: var(--accent); }
</style>
