<script lang="ts">
  import { fmtBytes, type Track } from "./engine";
  import Leds from "./Leds.svelte";
  import { live, store } from "./store.svelte";

  let { selected, picked = $bindable(), onselect, onadd, onbulk }: {
    selected: string | null;
    picked: string[];
    onselect: (key: string) => void;
    onadd: () => void;
    onbulk: (action: string, keys: string[]) => void;
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
  let more = $state(false);
  let search: HTMLInputElement;
  let anchor = -1; // última fila pulsada, para Mayús+clic

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
  const fold = (s: string) => s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();

  const shown = $derived.by(() => {
    const test = FILTERS.find((f) => f[0] === filter)?.[2] ?? (() => true);
    const needle = fold(q.trim());
    const list = store.tracks.filter((t) => test(t) && (!needle || fold(`${t.artist} ${t.title}`).includes(needle)));
    const by: Record<string, (a: Track, b: Track) => number> = {
      recent: (a, b) => b.modified - a.modified,
      artist: (a, b) => a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title),
      title: (a, b) => a.title.localeCompare(b.title),
      size: (a, b) => b.bytes - a.bytes,
    };
    return list.sort(by[sort] ?? by.recent);
  });
  const count = (f: (t: Track) => boolean) => store.tracks.filter(f).length;
  const total = $derived(store.tracks.reduce((n, t) => n + t.bytes, 0));

  function click(e: MouseEvent, t: Track, i: number) {
    if (e.shiftKey && anchor >= 0) {
      const [a, b] = [Math.min(anchor, i), Math.max(anchor, i)];
      picked = [...new Set([...picked, ...shown.slice(a, b + 1).map((x) => x.key)])];
    } else if (e.ctrlKey || e.metaKey || picked.length) {
      picked = picked.includes(t.key) ? picked.filter((k) => k !== t.key) : [...picked, t.key];
      anchor = i;
    } else {
      onselect(t.key);
      anchor = i;
    }
  }
  function toggle(t: Track, i: number) {
    picked = picked.includes(t.key) ? picked.filter((k) => k !== t.key) : [...picked, t.key];
    anchor = i;
  }

  function onkey(e: KeyboardEvent) {
    const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
    if (e.key === "/" && !typing) {
      e.preventDefault();
      search.focus();
    } else if (e.key === "Escape" && picked.length) {
      picked = [];
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a" && !typing) {
      e.preventDefault();
      picked = shown.map((t) => t.key);
    } else if (!typing && (e.key === "ArrowDown" || e.key === "ArrowUp") && e.altKey) {
      e.preventDefault();
      const i = shown.findIndex((t) => t.key === selected) + (e.key === "ArrowDown" ? 1 : -1);
      if (shown[i]) onselect(shown[i].key);
    }
  }

  function bulk(action: string) {
    more = false;
    onbulk(action, [...picked]);
  }

  const progressOf = (key: string) => {
    const j = live(key).find((j) => j.status === "running");
    return j ? (j.pct ?? -1) : null;
  };
</script>

<svelte:window onkeydown={onkey} />

<div class="lib">
  <header>
    <div class="brand"><span class="mark">E</span><h1>Estudio</h1></div>
    <button class="primary add" onclick={onadd} title="Añadir canciones (N)">＋ Añadir</button>
  </header>

  <div class="search">
    <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></svg>
    <input type="search" bind:this={search} bind:value={q} placeholder="Buscar artista o canción" />
    <kbd>/</kbd>
  </div>

  <nav class="filters">
    {#each FILTERS as [id, label, test] (id)}
      {@const n = id === "all" ? store.tracks.length : count(test)}
      {#if id === "all" || n}
        <button class:on={filter === id} onclick={() => (filter = id)}>{label}<span>{n}</span></button>
      {/if}
    {/each}
  </nav>

  <div class="listhead">
    <span class="kicker">{shown.length} canciones</span>
    <select bind:value={sort} aria-label="Ordenar">
      <option value="recent">Recientes</option>
      <option value="artist">Artista</option>
      <option value="title">Título</option>
      <option value="size">Tamaño</option>
    </select>
  </div>

  <div class="list" class:picking={picked.length > 0}>
    {#each shown as t, i (t.key)}
      {@const p = progressOf(t.key)}
      {@const isPicked = picked.includes(t.key)}
      <div class="row" class:sel={t.key === selected} class:picked={isPicked} style:--d="{Math.min(i, 20) * 18}ms">
        <input type="checkbox" checked={isPicked} onclick={() => toggle(t, i)} aria-label="Seleccionar {t.title}" />
        <button class="body" onclick={(e) => click(e, t, i)}>
          <span class="title">{t.title || t.key}</span>
          <span class="artist">{t.artist || "Sin artista"}</span>
          <Leds track={t} />
        </button>
        {#if p != null}
          <div class="bar row-bar" class:indet={p < 0}><i style:width="{Math.max(0, p)}%"></i></div>
        {/if}
      </div>
    {:else}
      <div class="empty">
        {#if store.tracks.length}
          <p>Nada con ese filtro.</p>
          <button class="link" onclick={() => ((q = ""), (filter = "all"))}>Ver todas</button>
        {:else}
          <p>Aún no hay canciones.</p>
          <button class="link" onclick={onadd}>Añade la primera</button>
        {/if}
      </div>
    {/each}
  </div>

  {#if picked.length}
    <div class="bulk">
      <div class="bulk-head">
        <strong>{picked.length} seleccionadas</strong>
        <button class="link" onclick={() => (picked = shown.map((t) => t.key))}>todas</button>
        <button class="icon-btn" onclick={() => (picked = [])} title="Quitar selección (Esc)">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div class="bulk-actions">
        <button class="primary" onclick={() => bulk("todo")} title="Pistas, letra palabra a palabra y notas de cada instrumento">Todo</button>
        <button class="ghost" onclick={() => bulk("letra")}>Letra</button>
        <button class="ghost" onclick={() => bulk("separate")}>Pistas</button>
        <button class="ghost" onclick={() => bulk("notes-all")}>Notas</button>
        <button class="ghost more" class:on={more} onclick={() => (more = !more)} aria-label="Más acciones">⋯</button>
      </div>
      {#if more}
        <div class="menu">
          <button onclick={() => bulk("sync")}>Volver a sincronizar la letra</button>
          <button onclick={() => bulk("align-audio")} title="Whisper comprueba que el audio es la versión de los tiempos de la letra (un videoclip con intro no lo es) y, si no, lo pone a la par">Comprobar la versión del audio</button>
          <button onclick={() => bulk("letra-force")}>Buscar la letra otra vez</button>
          <button onclick={() => bulk("beats")}>Sacar pulsos</button>
          <hr />
          <button onclick={() => bulk("delete-audio")}>Borrar audio en caché</button>
          <button onclick={() => bulk("delete-stems")}>Borrar pistas y partituras</button>
          <button class="danger" onclick={() => bulk("delete-all")}>Borrar canciones…</button>
        </div>
      {/if}
    </div>
  {:else}
    <footer><span>{store.tracks.length} canciones</span><span class="mono">{fmtBytes(total)}</span></footer>
  {/if}
</div>

<style>
  .lib { display: flex; flex-direction: column; height: 100%; min-height: 0; }
  header { display: flex; align-items: center; justify-content: space-between; padding: 18px 16px 12px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark {
    width: 30px; height: 30px; border-radius: 9px; display: grid; place-items: center; background: var(--accent-grad);
    color: #1c0f05; font-family: var(--serif); font-style: italic; font-size: 22px; line-height: 1; padding-top: 2px;
  }
  h1 { margin: 0; font-family: var(--serif); font-weight: 400; font-size: 28px; letter-spacing: -0.01em; font-style: italic; }
  .add { padding: 7px 12px; font-size: 13px; }

  .search { position: relative; margin: 0 14px; }
  .search svg { position: absolute; left: 10px; top: 50%; translate: 0 -50%; width: 15px; height: 15px; stroke: var(--text-3); fill: none; stroke-width: 2; }
  .search input { width: 100%; padding: 8px 34px 8px 32px; background: var(--panel); }
  .search kbd { position: absolute; right: 9px; top: 50%; translate: 0 -50%; }

  .filters { display: flex; gap: 5px; padding: 12px 14px 6px; overflow-x: auto; scrollbar-width: none; flex-wrap: wrap; }
  .filters button {
    display: flex; gap: 6px; align-items: center; padding: 4px 9px; border-radius: 99px; border: 1px solid var(--line);
    background: transparent; color: var(--text-2); font-size: 12px; white-space: nowrap; transition: all 0.15s;
  }
  .filters button span { color: var(--text-3); font-family: var(--mono); font-size: 10.5px; }
  .filters button:hover { color: var(--text); border-color: var(--line-hi); }
  .filters button.on { background: var(--accent-soft); border-color: color-mix(in srgb, var(--accent) 50%, transparent); color: var(--text); }
  .filters button.on span { color: var(--accent); }

  .listhead { display: flex; justify-content: space-between; align-items: center; padding: 6px 16px 6px; }
  .listhead select {
    appearance: none; padding: 3px 22px 3px 8px; font-size: 12px; border-color: transparent; color: var(--text-2); background:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%237c7164' stroke-width='1.5'/%3E%3C/svg%3E") right 7px center / 9px no-repeat, transparent;
  }
  .listhead select:hover { border-color: var(--line); color: var(--text); }
  .listhead select option { background: var(--panel); color: var(--text); }

  .list { flex: 1; overflow-y: auto; padding: 0 8px 10px; }
  .row { position: relative; display: flex; align-items: center; border-radius: 10px; animation: rise 0.35s var(--ease) both; animation-delay: var(--d); }
  .row input { position: absolute; left: 8px; opacity: 0; transition: opacity 0.15s; z-index: 1; }
  .row:hover input, .picking .row input, .row.picked input { opacity: 1; }
  .body {
    flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; column-gap: 8px;
    text-align: left; padding: 8px 10px; border: 0; border-radius: 10px; background: transparent; transition: background 0.12s, padding 0.15s;
  }
  .row:hover .body, .picking .body, .row.picked .body { padding-left: 32px; }
  .body:hover { background: var(--panel); }
  .row.sel .body { background: var(--panel-hi); box-shadow: inset 2px 0 0 var(--accent); }
  .row.picked .body { background: var(--accent-soft); }
  .title { font-weight: 560; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .artist { grid-column: 1; color: var(--text-3); font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .body :global(.leds) { grid-column: 2; grid-row: 1 / 3; align-self: center; }
  .row-bar { position: absolute; left: 10px; right: 10px; bottom: 1px; height: 2px; }

  .empty { padding: 30px 16px; text-align: center; color: var(--text-3); }
  .empty p { margin: 0 0 6px; }

  footer { display: flex; justify-content: space-between; padding: 10px 16px; border-top: 1px solid var(--line); color: var(--text-3); font-size: 12px; }

  .bulk { position: relative; border-top: 1px solid var(--line); padding: 10px 12px 12px; background: linear-gradient(180deg, var(--panel), var(--sidebar)); animation: rise 0.25s var(--ease); }
  .bulk-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .bulk-head strong { font-size: 13px; }
  .bulk-head .icon-btn { margin-left: auto; }
  .bulk-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .bulk-actions button { padding: 6px 11px; font-size: 12.5px; }
  .more.on { color: var(--text); border-color: var(--line-hi); }
  .menu {
    position: absolute; bottom: calc(100% - 4px); right: 12px; min-width: 240px; padding: 6px; border-radius: 12px;
    background: var(--panel-hi); border: 1px solid var(--line-hi); box-shadow: 0 20px 50px -10px #000c; animation: rise 0.2s var(--ease); z-index: 5;
  }
  .menu button { display: block; width: 100%; text-align: left; padding: 7px 10px; border: 0; border-radius: 8px; background: none; color: var(--text-2); font-size: 13px; }
  .menu button:hover { background: var(--panel); color: var(--text); }
  .menu .danger { color: var(--bad); }
  .menu hr { border: 0; border-top: 1px solid var(--line); margin: 5px 4px; }
</style>
