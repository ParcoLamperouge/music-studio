<script lang="ts">
  import { seekOnOpen } from "./progindex";
  import { pinId, pins, playAll, playPreview, preview, stopAll, stopPreview, togglePin } from "./preview.svelte";
  import ProgressionLane from "./ProgressionLane.svelte";
  import Button from "./ui/Button.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import { store } from "./store.svelte";

  // Comparar: cada fijado es un carril; las celdas miden lo mismo, así que las progresiones se leen una sobre otra.
  let { onopen }: { onopen: (key: string, t: number) => void } = $props();
  const track = (key: string) => store.tracks.find((x) => x.key === key);
</script>

{#if pins.length}
  <section class="pins">
    <div class="head">
      <span>Comparar · {pins.length}</span>
      <Button size="sm" icon={preview.id ? "pause" : "play"} onclick={() => (preview.id ? stopAll() : void playAll())}>{preview.id ? "Parar" : "Todas"}</Button>
    </div>
    {#each pins as p (pinId(p))}
      {@const on = preview.id === pinId(p)}
      <div class="pin" class:on>
        <div class="who">
          <IconButton icon={on && !preview.loading ? "pause" : "play"} label={on ? "Parar" : "Escuchar"} size="sm" active={on} onclick={() => (on ? stopPreview() : void playPreview(p))} />
          <span class="nm" title="{track(p.key)?.title ?? p.key}"><b>{track(p.key)?.title ?? p.key}</b><i>{track(p.key)?.artist ?? ""}</i></span>
        </div>
        <ProgressionLane hit={p} />
        <div class="acts">
          <IconButton icon="chevron-right" label="Abrir" size="sm" onclick={() => (seekOnOpen(p.key, p.t), onopen(p.key, p.t))} />
          <IconButton icon="close" label="Quitar" size="sm" onclick={() => togglePin(p)} />
        </div>
        {#if on && preview.dur}<i class="bar" style:width="{Math.min(100, (preview.pos / preview.dur) * 100)}%"></i>{/if}
      </div>
    {/each}
  </section>
{/if}

<style>
  .pins { --cw: 72px; display: flex; flex-direction: column; gap: var(--s2); padding: var(--s3); border: 1px solid var(--line); border-radius: var(--r-lg); background: var(--panel); min-width: 0; }
  .head { display: flex; justify-content: space-between; align-items: center; font-size: var(--fs-sm); color: var(--text-3); }
  .pin { position: relative; display: grid; grid-template-columns: 170px minmax(0, 1fr) auto; align-items: center; gap: var(--s3); padding-bottom: 4px; }
  .who { display: flex; align-items: center; gap: var(--s2); min-width: 0; }
  .nm { display: flex; flex-direction: column; min-width: 0; line-height: 1.3; font-size: var(--fs-sm); }
  .nm b, .nm i { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nm i { font-style: normal; color: var(--text-3); font-size: var(--fs-xs); }
  .acts { display: flex; }
  .bar { position: absolute; left: 0; bottom: 0; height: 2px; border-radius: 1px; background: var(--text); max-width: 100%; }
  @media (max-width: 720px) { .pin { grid-template-columns: minmax(0, 1fr) auto; } .pin > :global(.lane) { grid-column: 1 / -1; order: 3; } }
</style>
