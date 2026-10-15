<script lang="ts" module>
  /** Lo que sale de una canción o pieza, sumando todos sus niveles y manos (aprender/zonas/<id>.json); null sin datos. */
  export function overall(book: Record<string, Record<number, { tries: number; hits: number; wrong: number }>>) {
    let hits = 0, all = 0;
    for (const bars of Object.values(book)) for (const b of Object.values(bars)) [hits, all] = [hits + b.hits, all + b.tries + b.wrong];
    return all ? hits / all : null;
  }
</script>

<script lang="ts">
  import type { Track } from "../engine";
  import { paths, readJson } from "../engine";
  import type { Exercise, Hands } from "../exercises";
  import { EX_LEVELS, EXERCISES } from "../exercises";
  import { keyName } from "../harmony";
  import { OBRA_LEVELS, OBRAS, type Obra } from "../obras";
  import { waves, wantPeaks } from "../peaks.svelte";
  import type { Piece } from "../piece";
  import { pieceLength } from "../piece";
  import { pieces } from "../pieces.svelte";
  import { ROLL_DEFAULT } from "../rollfx";
  import { settings } from "../settings.svelte";
  import { fold } from "../shell/nav";
  import { store } from "../store.svelte";
  import Button from "../ui/Button.svelte";
  import EmptyState from "../ui/EmptyState.svelte";
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Menu from "../ui/Menu.svelte";
  import ProgressRing from "../ui/ProgressRing.svelte";
  import Search from "../ui/Search.svelte";
  import Tabs from "../ui/Tabs.svelte";
  import WaveThumb from "../ui/WaveThumb.svelte";
  import { accColor } from "./ZoneBar.svelte";

  type Tab = "canciones" | "piezas" | "ejercicios" | "obras";
  // Elegir qué tocar: canciones de la biblioteca (con pistas y notas), tus piezas, ejercicios y obras, como tarjetas.
  let { tab = $bindable(), exKey = $bindable(), exMinor = $bindable(), exHands = $bindable(), latin, current, resume, onsong, onpiece, onedit, ondelete, onnew, onimport, onexercise, onobra, onlibrary }: {
    tab: Tab;
    exKey: number;
    exMinor: boolean;
    exHands: Hands;
    latin: boolean;
    current: string | null; // id de lo abierto (clave, pieza, ejercicio u obra)
    resume?: { title: string; go: () => void } | null;
    onsong: (key: string) => void;
    onpiece: (pc: Piece) => void;
    onedit: (pc: Piece) => void;
    ondelete: (pc: Piece) => void;
    onnew: () => void;
    onimport: () => void;
    onexercise: (ex: Exercise) => void;
    onobra: (ob: Obra) => void;
    onlibrary: () => void;
  } = $props();

  let query = $state("");
  const has = (s: string) => fold(s).includes(fold(query.trim()));
  const songs = $derived(store.tracks.filter((t) => t.stems && t.notes.length && has(`${t.title} ${t.artist}`)).sort((a, b) => a.title.localeCompare(b.title)));
  const piecesShown = $derived(pieces.list.filter((p) => has(p.title)));
  const exShown = $derived(EXERCISES.filter((e) => has(`${e.title} ${e.concept}`)));
  const obrasShown = $derived(OBRAS.filter((x) => has(`${x.title} ${x.composer}`)));

  // lo que sale de cada canción y pieza (de sus zonas), para el anillo de la tarjeta
  let acc = $state<Record<string, number | null>>({});
  $effect(() => {
    const ids = [...songs.map((t) => t.key), ...piecesShown.map((p) => p.id)].filter((id) => !(id in acc));
    for (const id of ids) {
      acc[id] = null;
      void readJson(`${paths.data}/aprender/zonas/${id.replace(/[/:]/g, "_")}.json`, {}).then((b) => (acc[id] = overall(b)));
    }
  });

  const style = $derived({ ...ROLL_DEFAULT, ...settings.rollStyle });
  function thumb(pc: Piece) {
    if (!pc.notes.length) return [];
    const len = Math.max(1, pieceLength(pc));
    const ps = pc.notes.map((n) => n.p);
    const [lo, hi] = [Math.min(...ps), Math.max(...ps) + 1];
    return pc.notes.slice(0, 600).map((n) => ({ x: n.b / len, w: Math.max(0.004, n.d / len), y: 1 - (n.p + 1 - lo) / (hi - lo || 1), h: 1 / Math.max(12, hi - lo), c: n.hand === "rh" ? style.color : style.color2 }));
  }

  const TABS = $derived([
    { value: "canciones" as Tab, label: "Canciones", count: songs.length },
    { value: "piezas" as Tab, label: "Mis piezas", count: pieces.list.length },
    { value: "ejercicios" as Tab, label: "Ejercicios" },
    { value: "obras" as Tab, label: "Obras" },
  ]);
  const KEYS = $derived(Array.from({ length: 12 }, (_, t) => ({ label: keyName({ tonic: t, minor: exMinor }, latin), icon: (t === exKey ? "check" : undefined) as "check" | undefined, run: () => (exKey = t) })));

  function observe(el: HTMLElement, t: Track) {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && (wantPeaks(t.key, t.audio || !!t.stems), io.disconnect()), { rootMargin: "200px" });
    io.observe(el);
    return { destroy: () => io.disconnect() };
  }
</script>

{#snippet ring(a: number | null | undefined)}
  {#if a != null}
    <span class="ring" title="Te sale el {Math.round(a * 100)} %"><ProgressRing value={a} size={30} stroke={3} color={accColor(a)}><span class="num">{Math.round(a * 100)}</span></ProgressRing></span>
  {/if}
{/snippet}

{#snippet level(lv: number, max: number, label: string)}
  <span class="ring" title="Nivel {lv}: {label}"><ProgressRing value={lv / max} size={30} stroke={3} color="var(--text-2)"><span class="num">{lv}</span></ProgressRing></span>
{/snippet}

<section class="picker">
  <header class="head">
    <h1>Aprender</h1>
    <Tabs options={TABS} bind:value={tab} variant="underline" label="Qué tocar" />
    <span class="fill"></span>
    {#if resume}<Button icon="play" onclick={resume.go} title="Volver a lo que estabas tocando">{resume.title}</Button>{/if}
    <div class="find"><Search bind:value={query} placeholder="Buscar" size="sm" /></div>
  </header>

  {#if tab === "ejercicios"}
    <div class="filters">
      <Menu items={KEYS} label="Tonalidad">
        {#snippet trigger({ toggle })}<Button size="sm" icon="chevron-down" onclick={toggle}>{keyName({ tonic: exKey, minor: exMinor }, latin)}</Button>{/snippet}
      </Menu>
      <Tabs size="sm" bind:value={() => (exMinor ? "m" : "M"), (v) => (exMinor = v === "m")} options={[{ value: "M", label: "mayor" }, { value: "m", label: "menor" }]} label="Modo" />
      <Tabs size="sm" bind:value={exHands} options={[{ value: "lh", label: "Izq." }, { value: "both", label: "Juntas" }, { value: "rh", label: "Der." }]} label="Mano" />
    </div>
  {/if}

  <div class="scroll">
    {#if tab === "canciones"}
      {#if songs.length}
        <div class="grid">
          {#each songs as t (t.key)}
            <article class="tcard" class:on={current === t.key} use:observe={t}>
              <button type="button" class="hit" aria-label="Tocar {t.title}" onclick={() => onsong(t.key)}></button>
              <div class="art"><WaveThumb peaks={waves[t.key]} height={52} />{@render ring(acc[t.key])}</div>
              <div class="meta"><span class="t">{t.title}</span><span class="a">{t.artist}</span></div>
            </article>
          {/each}
        </div>
      {:else}
        <EmptyState icon="stems" title={query ? "Nada con ese nombre" : "Ninguna canción lista"}>
          Hacen falta las pistas separadas y sus notas.
          {#snippet actions()}<Button icon="library" onclick={onlibrary}>Ir a la Biblioteca</Button>{/snippet}
        </EmptyState>
      {/if}
    {:else if tab === "piezas"}
      <div class="grid">
        <article class="tcard add">
          <button type="button" class="hit" aria-label="Pieza nueva" onclick={onnew}></button>
          <span class="big"><Icon name="plus" size={22} /></span><span class="t">Nueva</span><span class="a">tocando o con el ratón</span>
        </article>
        <article class="tcard add">
          <button type="button" class="hit" aria-label="Importar MIDI o MusicXML" onclick={onimport}></button>
          <span class="big"><Icon name="upload" size={22} /></span><span class="t">Importar</span><span class="a">MIDI · MusicXML</span>
        </article>
        {#each piecesShown as pc (pc.id)}
          <article class="tcard" class:on={current === pc.id}>
            <button type="button" class="hit" aria-label="Tocar {pc.title}" onclick={() => onpiece(pc)}></button>
            <div class="art">
              <svg class="mini" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
                {#each thumb(pc) as n, i (i)}<rect x={n.x} y={n.y} width={n.w} height={n.h} fill={n.c} />{/each}
              </svg>
              {@render ring(acc[pc.id])}
            </div>
            <div class="meta row">
              <div class="col"><span class="t">{pc.title}</span><span class="a num">{pc.notes.length} notas · {pc.bpm} bpm</span></div>
              <span class="over">
                <Menu align="end" label="Pieza" items={[
                  { label: "Editar", icon: "edit", run: () => onedit(pc) },
                  "-",
                  { label: "Borrar…", icon: "trash", danger: true, run: () => ondelete(pc) },
                ]}>
                  {#snippet trigger({ toggle })}<IconButton icon="more" label="Más" size="sm" onclick={toggle} />{/snippet}
                </Menu>
              </span>
            </div>
          </article>
        {/each}
      </div>
    {:else if tab === "ejercicios"}
      {#each EX_LEVELS as [lv, label] (lv)}
        {@const list = exShown.filter((e) => e.level === lv)}
        {#if list.length}
          <h2 class="lvl">{lv} · {label}</h2>
          <div class="grid small">
            {#each list as ex (ex.id)}
              <article class="tcard tile" class:on={current === ex.id}>
                <button type="button" class="hit" aria-label="Tocar {ex.title}" onclick={() => onexercise(ex)}></button>
                {@render level(ex.level, 4, label)}
                <div class="col"><span class="t">{ex.title}</span><span class="a">{ex.concept}</span></div>
                {#if !ex.oneHand}<span class="two" title="Dos manos">2</span>{/if}
              </article>
            {/each}
          </div>
        {/if}
      {/each}
    {:else}
      {#each OBRA_LEVELS as [lv, label] (lv)}
        {@const list = obrasShown.filter((x) => x.level === lv)}
        {#if list.length}
          <h2 class="lvl">{lv} · {label}</h2>
          <div class="grid small">
            {#each list as x (x.id)}
              <article class="tcard tile" class:on={current === `obra-${x.id}`}>
                <button type="button" class="hit" aria-label="Tocar {x.title}" onclick={() => onobra(x)}></button>
                {@render level(x.level, 6, label)}
                <div class="col"><span class="t">{x.title}</span><span class="a">{x.composer}</span></div>
              </article>
            {/each}
          </div>
        {/if}
      {/each}
      <p class="credit">Del <a href="https://www.mutopiaproject.org" target="_blank" rel="noreferrer">Mutopia Project</a>: dominio público o Creative Commons.</p>
    {/if}
  </div>
</section>

<style>
  .picker { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
  .head { display: flex; align-items: center; gap: var(--s5); padding: var(--s5) var(--s6) 0; flex-wrap: wrap; }
  .head :global(.tabs-ui) { border-bottom: 0; }
  .find { flex: 0 1 220px; min-width: 120px; display: flex; }
  .fill { flex: 1; }
  .filters { display: flex; align-items: center; gap: var(--s2); padding: var(--s3) var(--s6) 0; flex-wrap: wrap; }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; padding: var(--s4) var(--s6) var(--s7); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: var(--s4); animation: fade var(--t-slow); }
  .grid.small { grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: var(--s2); }
  .lvl { font-size: var(--fs-sm); color: var(--text-2); font-weight: 500; margin: var(--s4) 0 var(--s2); }
  .lvl:first-child { margin-top: 0; }

  .tcard {
    position: relative; display: flex; flex-direction: column; min-width: 0; border-radius: var(--r-lg); background: var(--panel);
    border: 1px solid var(--line); transition: border-color var(--t-fast), background var(--t-fast);
  }
  .tcard:hover { border-color: var(--line-hi); background: var(--panel-hi); }
  .tcard.on { border-color: var(--accent-line); }
  .hit { position: absolute; inset: 0; z-index: 1; width: 100%; padding: 0; border: 0; border-radius: inherit; background: none; }
  .art { position: relative; height: 84px; padding: var(--s4) var(--s3) var(--s2); border-bottom: 1px solid var(--line); }
  .mini { display: block; width: 100%; height: 100%; }
  .ring { position: absolute; top: 6px; right: 6px; display: grid; padding: 2px; border-radius: 50%; background: var(--panel); }
  .ring .num { font-size: 10px; color: var(--text); }
  .meta { display: flex; flex-direction: column; padding: var(--s2) var(--s3) var(--s3); min-width: 0; }
  .meta.row { flex-direction: row; align-items: center; gap: var(--s1); }
  .col { display: flex; flex-direction: column; min-width: 0; flex: 1; }
  .t, .a { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t { font-weight: 600; }
  .a { color: var(--text-3); font-size: var(--fs-sm); }
  .over { position: relative; z-index: 2; }

  .add { align-items: center; justify-content: center; min-height: 150px; border-style: dashed; gap: 2px; }
  .add .big { display: grid; place-items: center; width: 44px; height: 44px; margin-bottom: var(--s2); border-radius: var(--r-lg); background: var(--bg); color: var(--text-2); }

  .tile { flex-direction: row; align-items: center; gap: var(--s3); padding: var(--s2) var(--s3); }
  .tile .ring { position: static; padding: 0; background: none; }
  .two { font-size: var(--fs-xs); color: var(--text-3); border: 1px solid var(--line-hi); border-radius: var(--r-sm); padding: 0 4px; }
  .credit { margin-top: var(--s5); font-size: var(--fs-xs); color: var(--text-3); }
  .credit a { color: var(--text-2); }
</style>
