<script lang="ts">
  import { isUrl, loadAfter, thenOf } from "./AddDialog.svelte";
  import { fmtBytes, importSources, type Track } from "./engine";
  import { fold } from "./shell/nav";
  import SongCard from "./SongCard.svelte";
  import { live, store } from "./store.svelte";
  import Button from "./ui/Button.svelte";
  import Chip from "./ui/Chip.svelte";
  import EmptyState from "./ui/EmptyState.svelte";
  import Icon from "./ui/Icon.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import Menu, { type MenuItem } from "./ui/Menu.svelte";
  import Search from "./ui/Search.svelte";

  // La biblioteca: rejilla de canciones con su onda de portada, filtros, búsqueda, orden y acciones en bloque.
  let { picked = $bindable(), current, onopen, onadd, onbulk, onqueue }: {
    picked: string[];
    current: string | null; // la cargada en el reproductor
    onopen: (key: string) => void;
    onadd: () => void;
    onbulk: (action: string, keys: string[]) => void;
    onqueue: () => void;
  } = $props();

  const saved = (k: string, d: string) => {
    try {
      return localStorage.getItem(k) ?? d;
    } catch {
      return d;
    }
  };
  let q = $state("");
  let filter = $state(saved("estudio.filter", "all"));
  let sort = $state(saved("estudio.sort", "recent"));
  let search: HTMLInputElement | undefined = $state();
  let link = $state("");
  let anchor = -1; // última pulsada, para Mayús+clic

  $effect(() => {
    try {
      localStorage.setItem("estudio.filter", filter);
      localStorage.setItem("estudio.sort", sort);
    } catch {}
  });

  const FILTERS: [string, string, (t: Track) => boolean][] = [
    ["all", "Todas", () => true],
    ["busy", "Trabajando", (t) => live(t.key).length > 0],
    ["nolyrics", "Sin letra", (t) => !t.lyrics || t.lyrics.status === "plain" || t.lyrics.status === "empty"],
    ["review", "Por revisar", (t) => !!t.lyrics?.doubts && !t.lyrics.edited],
    ["unsplit", "Sin separar", (t) => t.stems !== "complete"],
    ["scored", "Con partitura", (t) => t.notes.length > 0],
    ["edits", "Con edits", (t) => t.edits > 0],
    ["hidden", "Ocultas", (t) => !!t.lyrics?.hidden],
    ["failed", "Fallidas", (t) => t.failed],
  ];
  const SORTS: [string, string][] = [["recent", "Recientes"], ["artist", "Artista"], ["title", "Título"], ["size", "Tamaño"]];
  const BY: Record<string, (a: Track, b: Track) => number> = {
    recent: (a, b) => b.modified - a.modified,
    artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
    title: (a, b) => a.title.localeCompare(b.title),
    size: (a, b) => b.bytes - a.bytes,
  };

  const counts = $derived(Object.fromEntries(FILTERS.map(([id, , test]) => [id, store.tracks.filter(test).length])));
  const shown = $derived.by(() => {
    const test = FILTERS.find((f) => f[0] === filter)?.[2] ?? (() => true);
    const needle = fold(q.trim());
    return store.tracks.filter((t) => test(t) && (!needle || fold(`${t.artist} ${t.title}`).includes(needle))).sort(BY[sort] ?? BY.recent);
  });
  const total = $derived(store.tracks.reduce((n, t) => n + t.bytes, 0));

  function click(e: MouseEvent, t: Track, i: number) {
    if (e.shiftKey && anchor >= 0) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      picked = [...new Set([...picked, ...shown.slice(a, b + 1).map((x) => x.key)])];
      return;
    }
    anchor = i;
    if (e.ctrlKey || e.metaKey || picked.length) toggle(t);
    else onopen(t.key);
  }
  function toggle(t: Track) {
    picked = picked.includes(t.key) ? picked.filter((k) => k !== t.key) : [...picked, t.key];
  }

  function onkey(e: KeyboardEvent) {
    const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
    if (document.querySelector("dialog[open]")) return;
    if (e.key === "/" && !typing) {
      e.preventDefault();
      search?.focus();
    } else if (e.key === "Escape" && picked.length) {
      picked = [];
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !typing) {
      e.preventDefault();
      picked = shown.map((t) => t.key);
    }
  }

  const bulk = (action: string) => onbulk(action, [...picked]);
  const more: MenuItem[] = [
    { label: "Volver a sincronizar la letra", icon: "lyrics", run: () => bulk("sync") },
    { label: "Comprobar la versión del audio", icon: "audio", title: "Whisper comprueba que el audio es la versión de los tiempos de la letra", run: () => bulk("align-audio") },
    { label: "Buscar la letra otra vez", icon: "search", run: () => bulk("letra-force") },
    { label: "Sacar pulsos", icon: "sessions", run: () => bulk("beats") },
    { label: "Sincronizar con el servidor", icon: "cloud", run: () => bulk("remote") },
    "-",
    { label: "Borrar audio en caché", icon: "trash", run: () => bulk("delete-audio") },
    { label: "Borrar pistas y partituras", icon: "trash", run: () => bulk("delete-stems") },
    { label: "Borrar canciones…", icon: "trash", danger: true, run: () => bulk("delete-all") },
  ];

  async function importLink(e: Event) {
    e.preventDefault();
    if (!isUrl(link)) return onadd();
    await importSources([link.trim()], thenOf(loadAfter()));
    link = "";
    onqueue();
  }
</script>

<svelte:window onkeydown={onkey} />

<section class="lib">
  <header class="head">
    <div class="title">
      <h1>Biblioteca</h1>
      <span class="sub num">{store.tracks.length} · {fmtBytes(total)}</span>
    </div>
    <div class="tools">
      <div class="find"><Search bind:ref={search} bind:value={q} placeholder="Buscar artista o canción" kbd="/" /></div>
      <Menu
        align="end"
        label="Ordenar"
        items={SORTS.map(([id, label]) => ({ label, icon: sort === id ? "check" : undefined, run: () => (sort = id) }))}
      >
        {#snippet trigger({ toggle })}
          <Button variant="ghost" icon="sort" onclick={toggle} title="Ordenar">{SORTS.find((s) => s[0] === sort)?.[1]}</Button>
        {/snippet}
      </Menu>
      <Button variant="primary" icon="plus" kbd="N" onclick={onadd}>Añadir</Button>
    </div>
  </header>

  {#if store.tracks.length}
    <nav class="filters" aria-label="Filtros">
      {#each FILTERS as [id, label] (id)}
        {#if id === "all" || counts[id] || filter === id}
          <Chip active={filter === id} count={counts[id]} onclick={() => (filter = id)}>{label}</Chip>
        {/if}
      {/each}
    </nav>
  {/if}

  {#if store.error}
    <p class="err" role="alert"><Icon name="alert" size={14} /> {store.error}</p>
  {/if}

  <div class="scroll">
    {#if !store.tracks.length}
      <EmptyState icon="library" title="Tu biblioteca está vacía">
        Pega un enlace, busca en YouTube o arrastra audio aquí.
        {#snippet actions()}
          <form class="quick" onsubmit={importLink}>
            <input class="quick-input" bind:value={link} placeholder="https://youtube.com/watch?v=…" aria-label="Enlace" />
            <Button variant="primary" type="submit">{isUrl(link) ? "Importar" : "Añadir"}</Button>
          </form>
        {/snippet}
      </EmptyState>
    {:else if !shown.length}
      <EmptyState icon="search" title="Nada por aquí">
        {#snippet actions()}
          <Button onclick={() => ((q = ""), (filter = "all"))}>Ver todas</Button>
        {/snippet}
      </EmptyState>
    {:else}
      <div class="grid" class:picking={picked.length > 0}>
        {#each shown as t, i (t.key)}
          <SongCard
            track={t}
            picked={picked.includes(t.key)}
            picking={picked.length > 0}
            current={t.key === current}
            onclick={(e) => click(e, t, i)}
            ontoggle={(e) => (e.shiftKey ? click(e, t, i) : ((anchor = i), toggle(t)))}
          />
        {/each}
      </div>
    {/if}
  </div>

  {#if picked.length}
    <div class="bulk" role="toolbar" aria-label="Acciones con la selección">
      <strong class="num">{picked.length}</strong>
      <span class="sel">seleccionadas</span>
      <Button size="sm" variant="ghost" onclick={() => (picked = shown.map((t) => t.key))}>Todas</Button>
      <span class="div"></span>
      <Button size="sm" variant="primary" icon="sparkle" onclick={() => bulk("todo")} title="Pistas, letra palabra a palabra y notas de cada instrumento">Todo</Button>
      <Button size="sm" icon="lyrics" onclick={() => bulk("letra")}>Letra</Button>
      <Button size="sm" icon="stems" onclick={() => bulk("separate")}>Pistas</Button>
      <Button size="sm" icon="notes" onclick={() => bulk("notes-all")}>Notas</Button>
      <Menu items={more} side="top" align="end" label="Más acciones">
        {#snippet trigger({ toggle, open })}
          <IconButton icon="more" label="Más acciones" size="sm" active={open} onclick={toggle} />
        {/snippet}
      </Menu>
      <IconButton icon="close" label="Quitar selección" kbd="Esc" size="sm" onclick={() => (picked = [])} />
    </div>
  {/if}
</section>

<style>
  .lib { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: var(--s4); padding: var(--s5) var(--s6) var(--s3); flex-wrap: wrap; }
  .title { display: flex; align-items: baseline; gap: var(--s3); min-width: 0; }
  .sub { color: var(--text-3); font-size: var(--fs-sm); white-space: nowrap; }
  .tools { display: flex; align-items: center; gap: var(--s2); min-width: 0; flex: 1; justify-content: flex-end; }
  .find { flex: 0 1 300px; min-width: 140px; display: flex; }
  .filters { display: flex; gap: 6px; padding: 0 var(--s6) var(--s3); overflow-x: auto; flex-shrink: 0; scrollbar-width: none; }
  .err { display: flex; align-items: center; gap: var(--s2); margin: 0 var(--s6) var(--s3); color: var(--bad); font-size: var(--fs-sm); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .scroll { flex: 1; min-height: 0; overflow-y: auto; padding: var(--s1) var(--s6) 96px; display: flex; flex-direction: column; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: var(--s4); animation: fade var(--t-slow); }

  .quick { display: flex; gap: var(--s2); width: 100%; max-width: 460px; }
  .quick-input {
    flex: 1; min-width: 0; height: 32px; padding: 0 var(--s3); border: 1px solid var(--line); border-radius: var(--r-md); outline: none;
    background: var(--panel); color: var(--text); font-size: var(--fs-md);
  }
  .quick-input:focus { border-color: var(--accent-line); }

  .bulk {
    position: absolute; left: 50%; bottom: var(--s4); translate: -50% 0; z-index: 5; display: flex; align-items: center; gap: var(--s2);
    max-width: calc(100% - 2 * var(--s4)); padding: var(--s2) var(--s2) var(--s2) var(--s4); border-radius: var(--r-full);
    background: var(--panel-hi); box-shadow: var(--shadow); animation: rise var(--t) var(--ease); white-space: nowrap; overflow-x: auto;
  }
  .sel { color: var(--text-2); font-size: var(--fs-sm); }
  .div { width: 1px; height: 18px; background: var(--line-hi); margin: 0 var(--s1); }
</style>
