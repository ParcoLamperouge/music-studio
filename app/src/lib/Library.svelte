<script lang="ts">
  import { fmtBytes, type Track } from "./engine";
  import Leds from "./Leds.svelte";
  import SearchInput from "./SearchInput.svelte";
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
  let search: HTMLInputElement | undefined = $state();
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
      search?.focus();
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
    <button class="primary sm" onclick={onadd} title="Añadir canciones (N)">＋ Añadir</button>
  </header>

  <div class="find"><SearchInput bind:ref={search} bind:value={q} placeholder="Buscar artista o canción" kbd="/" /></div>

  <nav class="filters">
    {#each FILTERS as [id, label, test] (id)}
      {@const n = id === "all" ? store.tracks.length : count(test)}
      {#if id === "all" || n}
        <button class="chip" class:on={filter === id} onclick={() => (filter = id)}>{label}<small>{n}</small></button>
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
      <div class="row" class:picked={isPicked} style:--d="{Math.min(i, 20) * 18}ms">
        <input type="checkbox" checked={isPicked} onclick={() => toggle(t, i)} aria-label="Seleccionar {t.title}" />
        <button class="item body" class:on={t.key === selected} onclick={(e) => click(e, t, i)}>
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
        <button class="icon-btn sm" onclick={() => (picked = [])} title="Quitar selección (Esc)">
          <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
      <div class="bulk-actions">
        <button class="primary sm" onclick={() => bulk("todo")} title="Pistas, letra palabra a palabra y notas de cada instrumento">Todo</button>
        <button class="ghost sm" onclick={() => bulk("letra")}>Letra</button>
        <button class="ghost sm" onclick={() => bulk("separate")}>Pistas</button>
        <button class="ghost sm" onclick={() => bulk("notes-all")}>Notas</button>
        <button class="ghost sm" class:on={more} onclick={() => (more = !more)} aria-label="Más acciones">⋯</button>
      </div>
      {#if more}
        <div class="pop menu">
          <button onclick={() => bulk("sync")}>Volver a sincronizar la letra</button>
          <button onclick={() => bulk("align-audio")} title="Whisper comprueba que el audio es la versión de los tiempos de la letra (un videoclip con intro no lo es) y, si no, lo pone a la par">Comprobar la versión del audio</button>
          <button onclick={() => bulk("letra-force")}>Buscar la letra otra vez</button>
          <button onclick={() => bulk("beats")}>Sacar pulsos</button>
          <button onclick={() => bulk("remote")} title="Sube lo que solo está aquí y baja lo que solo está en el servidor (Ajustes → Servidor)">Sincronizar con el servidor</button>
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
  header { display: flex; align-items: center; justify-content: space-between; padding: 14px 14px 10px; }
  .brand { display: flex; align-items: center; gap: 8px; }
  .mark { width: 22px; height: 22px; border-radius: var(--radius-sm); display: grid; place-items: center; background: var(--accent); color: var(--on-accent); font-weight: 700; font-size: 13px; }
  h1 { font-size: 15px; }

  .find { padding: 0 12px; }
  .filters { display: flex; gap: 4px; padding: 10px 12px 4px; flex-wrap: wrap; }

  .listhead { display: flex; justify-content: space-between; align-items: center; padding: 4px 14px; }
  .listhead select {
    appearance: none; padding: 2px 20px 2px 6px; font-size: 12px; border-color: transparent; color: var(--text-2); background:
      url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' fill='none' stroke='%237c7164' stroke-width='1.5'/%3E%3C/svg%3E") right 6px center / 9px no-repeat, transparent;
  }
  .listhead select:hover { border-color: var(--line); color: var(--text); }

  .list { flex: 1; overflow-y: auto; padding: 0 8px 8px; }
  .row { position: relative; display: flex; align-items: center; }
  .row input { position: absolute; left: 8px; opacity: 0; transition: opacity 0.15s; z-index: 1; }
  .row:hover input, .picking .row input, .row.picked input { opacity: 1; }
  .body { flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto; column-gap: 8px; transition: background 0.12s, padding 0.15s; }
  .row:hover .body, .picking .body, .row.picked .body { padding-left: 30px; }
  .row.picked .body { background: var(--accent-soft); }
  .title { max-width: 100%; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .artist { grid-column: 1; max-width: 100%; color: var(--text-3); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .body :global(.leds) { grid-column: 2; grid-row: 1 / 3; align-self: center; }
  .row-bar { position: absolute; left: 10px; right: 10px; bottom: 1px; height: 2px; }

  .empty { padding: 24px 16px; text-align: center; color: var(--text-3); }
  .empty p { margin: 0 0 6px; }

  footer { display: flex; justify-content: space-between; padding: 8px 14px; border-top: 1px solid var(--line); color: var(--text-3); font-size: 12px; }

  .bulk { position: relative; border-top: 1px solid var(--line); padding: 10px 12px; background: var(--panel); }
  .bulk-head { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
  .bulk-head strong { font-size: 12.5px; font-weight: 600; }
  .bulk-head .icon-btn { margin-left: auto; }
  .bulk-actions { display: flex; gap: 6px; flex-wrap: wrap; }
  .menu { position: absolute; bottom: calc(100% - 4px); right: 12px; min-width: 240px; z-index: 5; }
</style>
