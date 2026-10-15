<script lang="ts">
  import { buildIndex, seekOnOpen } from "./progindex";
  import { isPinned, pinId, playPreview, preview, stopPreview, togglePin } from "./preview.svelte";
  import { keyName, type Key } from "./harmony";
  import { code, degreeOf, loops, MIN_SCORE, nameOf, parseQuery, search, shift, type Seq, type SongHit } from "./progression";
  import ProgressionLane from "./ProgressionLane.svelte";
  import Button from "./ui/Button.svelte";
  import ChordChip from "./ui/ChordChip.svelte";
  import Icon from "./ui/Icon.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import Search from "./ui/Search.svelte";
  import { store } from "./store.svelte";

  // `current`: canción abierta (se buscan sus bucles); lo escrito a mano manda sobre ella.
  let { current, onopen, text = $bindable(""), pinning = false }: { current: string | null; onopen: (key: string, t: number) => void; text?: string; pinning?: boolean } = $props();

  let index = $state<Map<string, Seq> | null>(null);
  let progress = $state("");
  let opened = $state<Record<string, boolean>>({});
  const KINDS = ["", "m", "dim", "aug"];

  // se construye (o se completa) la primera vez que se enseña; después, una vez por cambio del catálogo
  $effect(() => {
    const tracks = store.tracks;
    if (!tracks.length) return;
    void buildIndex(tracks, (d, n) => (progress = n ? `Indexando acordes ${d}/${n}…` : "")).then((m) => {
      index = m;
      progress = "";
    });
  });

  type Group = { codes: number[]; label: string; hits: SongHit[]; key?: Key; id: string };
  const typed = $derived(text.trim() ? parseQuery(text) : null);
  const groups = $derived.by<Group[]>(() => {
    if (!index) return [];
    if (text.trim()) return typed ? [{ codes: typed.codes, label: "Lo que escribiste", hits: search(typed.codes, index, { qkey: typed.key }), key: typed.key, id: "q" }] : [];
    const own = current ? index.get(current) : undefined;
    return own
      ? loops(own.c).map((l) => ({ codes: l.codes, label: `Repetida ${l.n}×`, hits: search(l.codes, index!, { skip: current! }), id: l.codes.join() }))
      : [];
  });
  const name = (key: string) => store.tracks.find((x) => x.key === key);
  const exact = (g: Group) => g.hits.filter((h) => h.same && h.exact);
  const approx = (g: Group) => g.hits.filter((h) => h.same && !h.exact);
  const other = (g: Group) => g.hits.filter((h) => !h.same);
  const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const qchord = (c: number) => ({ root: c >> 2, kind: KINDS[c & 3] });
  const deg = (c: number, k: Key) => degreeOf(shift(c, -k.tonic), { tonic: 0, minor: k.minor });
  const readings = (h: SongHit) =>
    h.amb ? h.amb.map((k) => `${keyName(k, true)}: ${h.codes.map((c) => degreeOf(c, k)).join(" ")}`) : !h.same ? [`en ${nameOf(code((h.qkey.tonic + h.tr) % 12, h.qkey.minor ? 1 : 0), { tonic: 0, minor: false })}${h.qkey.minor ? "m" : ""}`] : [];
</script>

{#snippet row(h: SongHit)}
  {@const on = preview.id === pinId(h)}
  {@const tr = name(h.key)}
  <div class="hit" class:on>
    <div class="top">
      <IconButton icon={on && !preview.loading ? "pause" : "play"} label={on ? "Parar" : "Escuchar aquí"} size="sm" active={on} onclick={() => (on ? stopPreview() : void playPreview(h))} />
      <span class="nm" title="{tr?.title ?? h.key} · {tr?.artist ?? ''}"><b>{tr?.title ?? h.key}</b> <i>{tr?.artist ?? ""}</i></span>
      <span class="sc" title="Parecido y minuto de la coincidencia">{Math.round(h.score * 100)}% · {mmss(h.t)}</span>
      {#if pinning}<IconButton icon={isPinned(h) ? "check" : "plus"} label={isPinned(h) ? "Quitar de comparar" : "Comparar"} size="sm" active={isPinned(h)} onclick={() => togglePin(h)} />{/if}
      <IconButton icon="chevron-right" label="Abrir en {mmss(h.t)}" size="sm" onclick={() => (seekOnOpen(h.key, h.t), onopen(h.key, h.t))} />
    </div>
    <ProgressionLane hit={h} />
    {#if h.amb}<p class="alt" title="No está claro si la canción está en mayor o en su relativa menor"><Icon name="alert" size={12} /> tonalidad dudosa · {readings(h).join(" · ")}</p>
    {:else if !h.same}<p class="alt">{readings(h).join(" ")}</p>{/if}
    {#if on && preview.dur}<i class="bar" style:width="{Math.min(100, (preview.pos / preview.dur) * 100)}%"></i>{/if}
  </div>
{/snippet}

{#snippet more(g: Group, kind: string, label: string, hits: SongHit[])}
  {#if hits.length}
    {@const id = g.id + kind}
    <Button variant="ghost" size="sm" icon={opened[id] ? "chevron-down" : "chevron-right"} onclick={() => (opened[id] = !opened[id])}>{hits.length} {label}</Button>
    {#if opened[id]}{#each hits.slice(0, 12) as h (h.key)}{@render row(h)}{/each}{/if}
  {/if}
{/snippet}

<div class="prog">
  <Search bind:value={text} size="lg" placeholder="I V vi IV · ii-V-I · Am F C G" />
  {#if progress}<p class="note">{progress}</p>{/if}
  {#if text.trim() && !typed}
    <p class="note">No lo entiendo: grados (I V vi IV, bVII, vii°) o acordes (Am F C G, Lam Fa). En menor, i bVII bVI V.</p>
  {:else if index && !groups.length}
    <p class="note">{current ? "Esta canción no repite ninguna progresión." : "Escribe una progresión o elige una de arriba."}</p>
  {/if}
  {#each groups as g (g.id)}
    {@const k = g.key ?? { tonic: 0, minor: false }}
    <section class="grp">
      <div class="q">
        <span class="lbl">{g.label}{#if g.key}{" · " + keyName(k, true)}{/if}</span>
        <div class="qlane">
          {#each g.codes as c, i (i)}
            <span class="qc"><ChordChip chord={qchord(c)} tonality={k} name={nameOf(c, k)} showDegree={false} size="lg" /><small>{deg(c, k)}</small></span>
          {/each}
        </div>
      </div>
      {#each exact(g).slice(0, 12) as h (pinId(h))}{@render row(h)}{/each}
      {#if !g.hits.length}<p class="note">Ninguna canción con ≥ {Math.round(MIN_SCORE * 100)}% de parecido.</p>{/if}
      {@render more(g, "a", approx(g).length === 1 ? "parecida" : "parecidas", approx(g))}
      {@render more(g, "o", "en otra escala", other(g))}
    </section>
  {/each}
</div>

<style>
  .prog { --cw: 84px; display: flex; flex-direction: column; gap: var(--s4); min-width: 0; }
  .note, .alt { font-size: var(--fs-sm); color: var(--text-3); }
  .alt { display: flex; align-items: center; gap: var(--s1); }
  .grp { display: flex; flex-direction: column; gap: var(--s2); align-items: flex-start; }
  .grp > :global(*) { max-width: 100%; }
  .q { display: flex; flex-direction: column; gap: var(--s2); }
  .lbl { font-size: var(--fs-sm); color: var(--text-3); }
  .qlane { display: flex; gap: var(--s1); padding: 0 var(--s2); }
  .lbl { padding: 0 var(--s2); }
  .qc { flex: 0 0 var(--cw); display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .qc small { font-size: var(--fs-xs); color: var(--text-3); }
  .hit { position: relative; align-self: stretch; display: flex; flex-direction: column; gap: 2px; padding: var(--s2) var(--s2) var(--s3); border-radius: var(--r-md); transition: background var(--t-fast); }
  .hit:hover, .hit.on { background: var(--panel); }
  .top { display: flex; align-items: center; gap: var(--s2); min-width: 0; }
  .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--fs-md); }
  .nm i { font-style: normal; color: var(--text-3); }
  .sc { font-size: var(--fs-sm); color: var(--text-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
  .bar { position: absolute; left: var(--s2); bottom: 5px; height: 2px; border-radius: 1px; background: var(--text); max-width: calc(100% - 16px); }
</style>
