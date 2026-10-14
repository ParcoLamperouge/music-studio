<script lang="ts">
  import ProgressionPins from "./ProgressionPins.svelte";
  import ProgressionSearch from "./ProgressionSearch.svelte";
  import { store } from "./store.svelte";

  let { onback, onopen }: { onback: () => void; onopen: (key: string, t: number) => void } = $props();
  const PRESETS = ["I V vi IV", "vi IV I V", "I vi IV V", "ii V I", "I IV V", "i bVII bVI V", "i iv v", "I V vi iii IV"];
  let text = $state("");
  let from = $state("");
  const songs = $derived([...store.tracks].sort((a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title)));
</script>

<main class="solo prog-view">
  <header>
    <button class="ghost sm" onclick={onback}>← Menú</button>
    <h2>Progresiones</h2>
  </header>
  <div class="chips">
    {#each PRESETS as p (p)}<button class="chip" class:on={text === p} onclick={() => ((text = p), (from = ""))}>{p}</button>{/each}
  </div>
  <label class="from">
    <span class="kicker">Desde una canción</span>
    <select bind:value={from} onchange={() => (text = "")}>
      <option value="">—</option>
      {#each songs as t (t.key)}<option value={t.key}>{t.artist} · {t.title}</option>{/each}
    </select>
  </label>
  <ProgressionPins {onopen} />
  <ProgressionSearch bind:text current={from || null} {onopen} pinning />
</main>

<style>
  .prog-view { max-width: 640px; margin: 0 auto; padding: 24px 16px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; }
  header { display: flex; align-items: center; gap: 12px; }
  h2 { margin: 0; }
  .chips { display: flex; gap: 6px; flex-wrap: wrap; }
  .from { display: flex; flex-direction: column; gap: 4px; }
  .prog-view :global(.prog) { border: 0; padding: 0; background: none; }
  .prog-view :global(.search input) { font-size: 16px; padding-top: 10px; padding-bottom: 10px; }
</style>
