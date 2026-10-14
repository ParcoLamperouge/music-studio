<script lang="ts">
  import { buildIndex, seekOnOpen } from "./progindex";
  import { isPinned, pinId, playPreview, preview, stopPreview, togglePin } from "./preview.svelte";
  import { keyName, type Key } from "./harmony";
  import { chips, code, shift, nameOf, degreeOf, describe, loops, MIN_SCORE, parseQuery, search, type Seq, type SongHit } from "./progression";
  import SearchInput from "./ui/Search.svelte";
  import { store } from "./store.svelte";

  // `current`: canción abierta (se buscan sus bucles); lo escrito a mano manda sobre ella.
  let { current, onopen, text = $bindable(""), pinning = false }: { current: string | null; onopen: (key: string, t: number) => void; text?: string; pinning?: boolean } = $props();

  let index = $state<Map<string, Seq> | null>(null);
  let progress = $state("");

  // se construye (o se completa) la primera vez que se enseña; después, una vez por cambio del catálogo
  $effect(() => {
    const tracks = store.tracks;
    if (!tracks.length) return;
    void buildIndex(tracks, (d, n) => (progress = n ? `Indexando acordes ${d}/${n}…` : "")).then((m) => {
      index = m;
      progress = "";
    });
  });

  type Group = { codes: number[]; label: string; hits: SongHit[]; key?: Key };
  const typed = $derived(text.trim() ? parseQuery(text) : null);
  const groups = $derived.by<Group[]>(() => {
    if (!index) return [];
    if (text.trim()) return typed ? [{ codes: typed.codes, label: "Lo que escribiste", hits: search(typed.codes, index, { qkey: typed.key }), key: typed.key }] : [];
    const own = current ? index.get(current) : undefined;
    return own
      ? loops(own.c).map((l) => ({ codes: l.codes, label: `Repetida ${l.n}×`, hits: search(l.codes, index!, { skip: current! }) }))
      : [];
  });
  const name = (key: string) => {
    const t = store.tracks.find((x) => x.key === key);
    return t ? `${t.title} · ${t.artist}` : key;
  };
  const approx = (g: Group) => g.hits.filter((h) => h.same && !h.exact);
  const other = (g: Group) => g.hits.filter((h) => !h.same);
  const shown = (g: Group) => g.codes.map((c) => degreeOf(shift(c, -(g.key?.tonic ?? 0)), { tonic: 0, minor: g.key?.minor ?? false }));
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
</script>

{#snippet row(h: SongHit)}
        {@const on = preview.id === pinId(h)}
        <div class="hit" class:on>
          <button class="ghost sm play" onclick={() => (on ? stopPreview() : void playPreview(h))} title="Escuchar aquí">{on && preview.loading ? "…" : on ? "■" : "▶"}</button>
          <span class="nm">{name(h.key)}</span>
          <span class="sc mono">{Math.round(h.score * 100)}% · {mmss(h.t)}</span>
          {#if pinning}<button class="ghost sm" class:on={isPinned(h)} onclick={() => togglePin(h)} title="Comparar">{isPinned(h) ? "✓" : "＋"}</button>{/if}
          <button class="ghost sm" onclick={() => (seekOnOpen(h.key, h.t), onopen(h.key, h.t))} title="Abrir en {mmss(h.t)}">↗</button>
          {#if h.amb}<span class="alt hint" title="No está claro si la canción está en mayor o en su relativa menor">tonalidad dudosa · {h.amb.map((k) => `${keyName(k, true)}: ${h.codes.map((c) => degreeOf(c, k)).join(" ")}`).join(" · ")}</span>
          {:else if !h.same}<span class="alt hint">{chips(h, h.songKey).map((c) => c.own).join(" ")} · leída en {nameOf(code((h.qkey.tonic + h.tr) % 12, h.qkey.minor ? 1 : 0), { tonic: 0, minor: false })}{h.qkey.minor ? "m" : ""}: {chips(h, h.songKey).map((c) => c.deg).join(" ")}</span>{/if}
          <span class="chips">
            {#each chips(h, h.songKey) as c, i (i)}
              <span class="chip {c.kind}" title={c.tip} class:on={on && !preview.loading && preview.pos >= h.ts[i] - h.t && preview.pos < (h.ts[i + 1] ?? h.end) - h.t}>{c.name}<small>{c.deg}</small></span>
            {/each}
          </span>
          {#if on && preview.dur}<i class="bar" style="width:{Math.min(100, (preview.pos / preview.dur) * 100)}%"></i>{/if}
        </div>
{/snippet}


<div class="card prog">
  <span class="kicker">Canciones con esta progresión</span>
  <SearchInput bind:value={text} placeholder="I V vi IV · ii-V-I · Am F C G" />
  {#if progress}<p class="hint">{progress}</p>{/if}
  {#if typed}<p class="hint">{describe(typed.codes, typed.key)}</p>{/if}
  {#if text.trim() && !typed}
    <p class="hint">No lo entiendo: grados (I V vi IV, bVII, vii°) o acordes (Am F C G, Lam Fa). En menor, i bVII bVI V.</p>
  {:else if index && !groups.length}
    <p class="hint">{current ? "Esta canción no repite ninguna progresión." : "Escribe una progresión."}</p>
  {/if}
  {#each groups as g (g.label + g.codes.join())}
    <div class="grp">
      <span class="kicker">{g.label}</span>
      <div class="chips">{#each shown(g) as d, i (i)}<span class="chip on">{d}</span>{/each}</div>
      {#each g.hits.filter((h) => h.same && h.exact).slice(0, 12) as h (h.key)}
        {@render row(h)}
      {/each}
      {#if !g.hits.length}
        <p class="hint">Ninguna canción con ≥ {Math.round(MIN_SCORE * 100)}% de parecido.</p>
      {/if}
      {#if approx(g).length}
        <details>
          <summary>{approx(g).length} parecida{approx(g).length === 1 ? "" : "s"}</summary>
          {#each approx(g).slice(0, 12) as h (h.key)}
            {@render row(h)}
          {/each}
        </details>
      {/if}
      {#if other(g).length}
        <details>
          <summary>{other(g).length} en otra escala</summary>
          {#each other(g).slice(0, 12) as h (h.key)}
            {@render row(h)}
          {/each}
        </details>
      {/if}
    </div>
  {/each}
</div>

<style>
  .prog { display: flex; flex-direction: column; gap: 8px; }
  .grp { display: flex; flex-direction: column; gap: 4px; }
  .chips { display: flex; gap: 3px; flex-wrap: wrap; }
  .hit {
    position: relative; display: grid; grid-template-columns: auto 1fr auto auto auto; align-items: center; gap: 2px 8px;
    padding: 5px 6px; border-radius: var(--radius-sm); color: var(--text);
  }
  .hit:hover, .hit.on { background: var(--accent-soft); }
  .bar { position: absolute; left: 0; bottom: 0; height: 2px; background: var(--accent); }
  .nm { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sc { font-size: 11px; color: var(--text-3); }
  .chip.rel, .chip.same, .chip.far { border-style: dashed; opacity: 0.75; }
  .chip.extra { opacity: 0.45; }
  details { margin-top: 2px; }
  summary { cursor: pointer; font-size: 11.5px; color: var(--text-3); padding: 3px 0; }
  .hit .chips, .hit .alt { grid-column: 2 / -1; }
</style>
