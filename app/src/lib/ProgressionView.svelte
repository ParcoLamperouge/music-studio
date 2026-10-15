<script lang="ts">
  import ProgressionPins from "./ProgressionPins.svelte";
  import ProgressionSearch from "./ProgressionSearch.svelte";
  import Chip from "./ui/Chip.svelte";
  import Popover from "./ui/Popover.svelte";
  import Search from "./ui/Search.svelte";
  import Button from "./ui/Button.svelte";
  import { store } from "./store.svelte";

  let { onopen }: { onback?: () => void; onopen: (key: string, t: number) => void } = $props();
  const PRESETS = ["I V vi IV", "vi IV I V", "I vi IV V", "ii V I", "I IV V", "i bVII bVI V", "i iv v", "I V vi iii IV"];
  let text = $state("");
  let from = $state("");
  let pickOpen = $state(false);
  let q = $state("");
  const songs = $derived(
    [...store.tracks]
      .filter((t) => t.audio && `${t.artist} ${t.title}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title))
      .slice(0, 40),
  );
  const cur = $derived(store.tracks.find((t) => t.key === from));
  const pick = (k: string) => ((from = k), (text = ""), (pickOpen = false));
</script>

<div class="view">
  <div class="inner">
    <header>
      <h1>Progresiones</h1>
      <Popover bind:open={pickOpen} width={340} align="end">
        {#snippet trigger({ toggle })}
          <Button size="sm" icon="library" active={!!from} onclick={toggle}>{cur ? `${cur.title}` : "Desde una canción"}</Button>
        {/snippet}
        <div class="pk">
          <Search bind:value={q} size="sm" placeholder="Buscar canción" />
          <div class="list">
            {#if from}<Button variant="ghost" size="sm" icon="close" onclick={() => ((from = ""), (pickOpen = false))}>Quitar</Button>{/if}
            {#each songs as t (t.key)}
              <Button variant="ghost" size="sm" active={t.key === from} onclick={() => pick(t.key)}>{t.title} · {t.artist}</Button>
            {/each}
          </div>
        </div>
      </Popover>
    </header>
    <div class="presets">
      {#each PRESETS as p (p)}<Chip active={text === p} onclick={() => ((text = p), (from = ""))}>{p}</Chip>{/each}
    </div>
    <ProgressionPins {onopen} />
    <ProgressionSearch bind:text current={from || null} {onopen} pinning />
  </div>
</div>

<style>
  .view { flex: 1; min-height: 0; overflow-y: auto; }
  .inner { max-width: 880px; margin: 0 auto; padding: var(--s5) var(--s4) var(--s7); display: flex; flex-direction: column; gap: var(--s4); }
  header { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); }
  .presets { display: flex; flex-wrap: wrap; gap: var(--s2); }
  .pk { display: flex; flex-direction: column; gap: var(--s2); padding: var(--s2); }
  .list { display: flex; flex-direction: column; max-height: 300px; overflow-y: auto; }
  .list :global(.btn) { justify-content: flex-start; }
</style>
