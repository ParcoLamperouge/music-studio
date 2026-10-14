<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { listDir, paths, readBytes, readJson, removeFile, writeJson } from "./engine";
  import { stamps } from "./live";
  import { Player, synth } from "./player";
  import Roll from "./Roll.svelte";
  import { settings } from "./settings.svelte";
  import SongPlayer from "./SongPlayer.svelte";
  import { store } from "./store.svelte";
  import Transport from "./Transport.svelte";

  /** Lo que guarda el modo Tocar (live.ts, snapshot). */
  type Session = {
    device: string;
    duration: number;
    key: string | null;
    notes: [number, number, number, number][];
    chords: { t: number; end: number; name: string; deg?: string }[];
    pedal: [number, number][];
  };
  type Item = { name: string; base: string; s: Session | null };

  let { onback, onsong }: { onback: () => void; onsong: (key: string) => void } = $props();

  const dir = `${paths.data}/sesiones`;
  let items = $state<Item[]>([]);
  let sel = $state<Item | null>(null);
  const player = new Player();
  let playing = $state(false);
  let time = $state(0);
  let duration = $state(0);
  let loading = $state(false);
  let analysis = $state("");
  let analyzing = $state(false);
  let error = $state("");

  // ---- canciones separadas para tocar encima (claves de la biblioteca, en sesiones/canciones.json)
  const songsPath = `${dir}/canciones.json`;
  let tab = $state<"sesiones" | "canciones">((() => {
    try {
      return localStorage.getItem("estudio.sesiones.tab") === "canciones" ? "canciones" : "sesiones";
    } catch {
      return "sesiones";
    }
  })());
  $effect(() => {
    try {
      localStorage.setItem("estudio.sesiones.tab", tab);
    } catch {}
  });
  let songs = $state<string[]>([]);
  let song = $state<string | null>(null);
  let songPlayer = $state<SongPlayer>();
  let songTime = $state(0);
  let songChords = $state<{ t: number; end: number; name: string; deg?: string }[]>([]);
  let songKey = $state("");
  let adding = $state(false);
  let query = $state("");
  let picked = $state<string[]>([]);
  const trackOf = (key: string) => store.tracks.find((t) => t.key === key);
  /** Las separadas que aún no están en la lista. */
  const available = $derived(
    store.tracks
      .filter((t) => t.stems && t.present.length && !songs.includes(t.key))
      .filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  function openSong(key: string) {
    player.stop();
    playing = false;
    sel = null;
    song = key;
  }

  async function addSongs() {
    songs = [...picked, ...songs];
    await writeJson(songsPath, songs);
    adding = false;
    if (picked[0]) openSong(picked[0]);
    picked = [];
  }

  async function removeSong() {
    if (!song) return;
    songs = songs.filter((k) => k !== song);
    song = null;
    await writeJson(songsPath, songs);
  }

  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  /** «2026-10-14_11-48-47» → «14 oct 2026 · 11:48». */
  const when = (name: string) => {
    const [d, h] = name.split("_");
    const date = new Date(`${d}T${(h ?? "").replaceAll("-", ":")}`);
    if (isNaN(+date)) return name;
    return `${date.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })} · ${date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}`;
  };

  async function scan() {
    const files = await listDir(dir).catch(() => []);
    const names = files.filter((f) => f.name.endsWith(".json")).map((f) => f.name.slice(0, -5)).sort().reverse();
    items = await Promise.all(names.map(async (name) => ({ name, base: `${dir}/${name}`, s: await readJson<Session | null>(`${dir}/${name}.json`, null) })));
    songs = await readJson<string[]>(songsPath, []);
    if (!sel && !song && tab === "sesiones" && items[0]) void open(items[0]);
  }

  async function open(it: Item) {
    if (!it.s) return;
    player.stop();
    player.buffers.clear();
    player.duration = 0;
    playing = false;
    time = 0;
    song = null;
    sel = it;
    analysis = "";
    error = "";
    loading = true;
    try {
      const buf = await synth(it.s.notes, it.s.duration);
      if (sel !== it) return; // se eligió otra mientras se sintetizaba
      player.setBuffer("piano", buf);
      duration = it.s.duration;
    } catch (e) {
      error = `No se pudo sintetizar: ${e}`;
    }
    loading = false;
    const md = await readBytes(`${it.base}.analisis.md`).catch(() => null);
    if (sel === it && md) analysis = new TextDecoder().decode(md);
  }

  function toggle() {
    if (player.playing) player.pause();
    else player.play();
    playing = player.playing;
  }

  function seek(t: number) {
    player.seek(t);
    time = t;
  }

  /** Un tiempo del análisis: ir ahí y escucharlo. */
  function jump(t: number) {
    seek(Math.min(t, duration));
    if (!player.playing && !loading) toggle();
  }

  async function analyze() {
    const it = sel;
    if (!it) return;
    analyzing = true;
    error = "";
    try {
      const text = await invoke<string>("analyze_session", { path: `${it.base}.json` });
      if (sel === it) analysis = text;
    } catch (e) {
      if (sel === it) error = String(e);
    }
    analyzing = false;
  }

  async function remove() {
    if (!sel || !confirm(`Borrar la sesión del ${when(sel.name)} (.mid, .json y su análisis). No se puede deshacer.`)) return;
    for (const ext of [".json", ".mid", ".analisis.md"]) await removeFile(sel.base + ext).catch(() => {});
    player.stop();
    playing = false;
    sel = null;
    await scan();
  }

  /** Markdown justo para leer el análisis: títulos, viñetas y párrafos, sin HTML. */
  const blocks = $derived(
    analysis
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const text = l.replace(/\*\*|`/g, "");
        if (/^#{1,4}\s/.test(text)) return { kind: "h", text: text.replace(/^#+\s*/, "") };
        if (/^\s*[-*]\s/.test(text)) return { kind: "li", text: text.replace(/^\s*[-*]\s*/, "") };
        return { kind: "p", text };
      }),
  );

  // acordes que más suenan (de la sesión o de la canción)
  const shownChords = $derived(song ? songChords : (sel?.s?.chords ?? []));
  const top = $derived.by(() => {
    const dur = new Map<string, number>();
    for (const c of shownChords) dur.set(c.name, (dur.get(c.name) ?? 0) + c.end - c.t);
    return [...dur].sort((a, b) => b[1] - a[1]).slice(0, 6);
  });

  $effect(() => player.setMaster(settings.masterVolume));
  onMount(() => {
    void scan();
    let raf = 0;
    const tick = () => {
      time = player.time();
      if (player.playing && time >= duration) {
        player.stop();
        playing = false;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      player.stop();
      void player.ctx.close();
    };
  });

  function onkey(e: KeyboardEvent) {
    if (!sel || adding || (e.target as HTMLElement).closest("input, textarea, select, button") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space" && sel && !loading) (e.preventDefault(), toggle());
    else if (e.key === "ArrowLeft") seek(Math.max(0, time - 5));
    else if (e.key === "ArrowRight") seek(Math.min(duration, time + 5));
  }
</script>

<svelte:window onkeydown={onkey} />

{#snippet linked(text: string)}
  {#each stamps(text) as p, i (i)}{#if p.t != null}<button class="ts" onclick={() => jump(p.t!)} title="Ir a {p.text}">{p.text}</button>{:else}{p.text}{/if}{/each}
{/snippet}

{#snippet controls()}
  <Transport {playing} {time} {duration} bind:volume={settings.masterVolume} disabled={loading || !sel} ontoggle={toggle} onseek={seek} />
{/snippet}

<div class="sessions">
  <aside>
    <header>
      <button class="ghost" onclick={onback} title="Volver al menú">← Menú</button>
      <div class="seg">
        <button class:on={tab === "sesiones"} onclick={() => (tab = "sesiones")}>Sesiones</button>
        <button class:on={tab === "canciones"} onclick={() => (tab = "canciones")}>Canciones</button>
      </div>
    </header>
    <div class="list">
      {#if tab === "canciones"}
        <button class="add" onclick={() => (adding = true)}>＋ Añadir canción</button>
        {#each songs as k (k)}
          {@const t = trackOf(k)}
          <button class="item" class:on={song === k} onclick={() => openSong(k)}>
            <span>{t?.title ?? k}</span>
            <small class="mono">{t ? `${t.artist} · ${t.present.length} pistas` : "ya no está en la biblioteca"}</small>
          </button>
        {:else}
          <p class="muted empty">Añade canciones con las pistas separadas para escucharlas por instrumentos aquí.</p>
        {/each}
      {:else}
      {#each items as it (it.name)}
        <button class="item" class:on={sel?.name === it.name} onclick={() => open(it)} disabled={!it.s}>
          <span>{when(it.name)}</span>
          <small class="mono">
            {#if it.s}{fmt(it.s.duration)} · {it.s.notes.length} notas{it.s.key ? ` · ${it.s.key}` : ""}{:else}no se puede leer{/if}
          </small>
        </button>
      {:else}
        <p class="muted empty">Aún no hay sesiones: se guardan solas al tocar en «Tocar».</p>
      {/each}
      {/if}
    </div>
  </aside>

  <main>
    {#if song}
      {#key song}<SongPlayer bind:this={songPlayer} key={song} bind:time={songTime} bind:chords={songChords} bind:keyLabel={songKey} />{/key}
    {:else if sel?.s}
      {#key sel.base}
        <Roll {player} {controls} bind:windowSec={settings.rollSpeed} ontoggle={() => {}} chords={sel.s.chords} keyLabel={sel.s.key ?? ""}
          tracks={[{ stem: "piano", name: sel.s.device || "Teclado", color: "#f29d38", path: `${sel.base}.json`, hidden: false }]} />
      {/key}
      <div class="bottom">{@render controls()}</div>
    {:else}
      <div class="welcome"><h1>Tus sesiones,<br /><em>otra vez</em>.</h1></div>
    {/if}
  </main>

  <section class="panel">
    {#if song}
      {@const t = trackOf(song)}
      <span class="kicker">Canción</span>
      <h2>{t?.title ?? song}</h2>
      <dl class="mono">
        <dt>Artista</dt><dd>{t?.artist ?? "—"}</dd>
        <dt>Tonalidad</dt><dd>{songKey || "—"}</dd>
        {#if t?.bpm}<dt>Tempo</dt><dd>{Math.round(t.bpm)} bpm</dd>{/if}
      </dl>
      {#if top.length}
        <span class="kicker">Acordes que más suenan</span>
        <div class="chips">{#each top as [name, d] (name)}<span>{name} <small>{fmt(d)}</small></span>{/each}</div>
        <span class="kicker">Progresión <small>(clic para ir)</small></span>
        <div class="prog">
          {#each songChords as c, i (i)}
            <button class:now={c.t <= songTime && songTime < c.end} onclick={() => songPlayer?.seek(c.t)} title="{fmt(c.t)}{c.deg ? ` · ${c.deg}` : ''}">{c.name}</button>
          {/each}
        </div>
      {:else}
        <p class="muted">Sin acordes todavía: sácalos en Analizar (pestaña Acordes).</p>
      {/if}
      <div class="actions">
        <button class="ghost" onclick={() => song && onsong(song)} title="Letra, partitura, acordes…">Abrir en Analizar</button>
        <button class="ghost" onclick={removeSong} title="Solo la quita de esta lista; la canción sigue en la biblioteca">Quitar</button>
      </div>
    {:else if sel?.s}
      <span class="kicker">Sesión</span>
      <h2>{when(sel.name)}</h2>
      <dl class="mono">
        <dt>Duración</dt><dd>{fmt(sel.s.duration)}</dd>
        <dt>Notas</dt><dd>{sel.s.notes.length}</dd>
        <dt>Tonalidad</dt><dd>{sel.s.key ?? "—"}</dd>
        <dt>Pedal</dt><dd>{sel.s.pedal.length} veces</dd>
        <dt>Teclado</dt><dd>{sel.s.device}</dd>
      </dl>
      {#if top.length}
        <span class="kicker">Acordes que más suenan</span>
        <div class="chips">{#each top as [name, d] (name)}<span>{name} <small>{fmt(d)}</small></span>{/each}</div>
        <span class="kicker">Progresión <small>(clic para ir)</small></span>
        <div class="prog">
          {#each sel.s.chords as c, i (i)}
            <button class:now={c.t <= time && time < c.end} onclick={() => seek(c.t)} title="{fmt(c.t)}{c.deg ? ` · ${c.deg}` : ''}">{c.name}</button>
          {/each}
        </div>
      {/if}
      <div class="actions">
        <button class="primary" onclick={analyze} disabled={analyzing}>{analyzing ? "Claude escuchando…" : analysis ? "Analizar otra vez" : "Analizar con Claude"}</button>
        <button class="ghost" onclick={() => sel && revealItemInDir(`${sel.base}.mid`)} title="El .mid se abre en cualquier programa">Carpeta</button>
        <button class="ghost" onclick={remove}>Borrar</button>
      </div>
      {#if analyzing}<div class="bar indet"><i></i></div>{/if}
      {#if error}<p class="error-text">{error}</p>{/if}
      {#if blocks.length}
        <article>
          {#each blocks as b, i (i)}
            {#if b.kind === "h"}<h3>{b.text}</h3>{:else}<p class:li={b.kind === "li"}>{@render linked(b.text)}</p>{/if}
          {/each}
        </article>
      {/if}
    {/if}
  </section>
</div>

{#if adding}
  <div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (adding = false)}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Añadir canciones">
      <h3>Añadir canciones</h3>
      <p class="muted">Las que tienen las pistas separadas.</p>
      <!-- svelte-ignore a11y_autofocus -->
      <input type="search" placeholder="Buscar…" bind:value={query} autofocus onkeydown={(e) => e.key === "Escape" && (adding = false)} />
      <div class="pick">
        {#each available as t (t.key)}
          <label class:on={picked.includes(t.key)}>
            <input type="checkbox" bind:group={picked} value={t.key} />
            <span>{t.title}</span><small>{t.artist} · {t.present.length} pistas</small>
          </label>
        {:else}
          <p class="muted">{query ? "Ninguna coincide." : "No quedan canciones separadas sin añadir (sepáralas en Analizar)."}</p>
        {/each}
      </div>
      <div class="actions">
        <button class="ghost" onclick={() => ((adding = false), (picked = []))}>Cancelar</button>
        <button class="primary" disabled={!picked.length} onclick={addSongs}>Añadir{picked.length ? ` (${picked.length})` : ""}</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .sessions { height: 100vh; display: grid; grid-template-columns: 280px 1fr 380px; }
  aside { background: var(--sidebar); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  aside header { display: flex; align-items: center; gap: 12px; padding: 14px; border-bottom: 1px solid var(--line); }
  .seg { display: flex; flex: 1; padding: 3px; border-radius: 10px; background: var(--bg); border: 1px solid var(--line); }
  .seg button { flex: 1; padding: 5px 8px; border: 0; border-radius: 7px; background: none; color: var(--text-2); font-size: 12.5px; }
  .seg button.on { background: var(--panel-hi); color: var(--text); }
  .add { margin-bottom: 6px; padding: 9px 12px; border-radius: 10px; border: 1px dashed var(--line-hi); background: none; color: var(--text-2); text-align: left; }
  .add:hover { color: var(--text); border-color: var(--accent); }

  .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: #0008; backdrop-filter: blur(4px); }
  .dialog {
    width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 60px); display: flex; flex-direction: column; gap: 10px; padding: 20px 22px;
    background: var(--sidebar); border: 1px solid var(--line-hi); border-radius: 18px; box-shadow: 0 40px 100px -20px #000; animation: rise 0.3s var(--ease);
  }
  .dialog h3 { margin: 0; font-family: var(--serif); font-weight: 400; font-size: 30px; }
  .dialog p { margin: 0; font-size: 13px; }
  .pick { overflow-y: auto; min-height: 120px; max-height: 50vh; display: flex; flex-direction: column; gap: 2px; }
  .pick label { display: grid; grid-template-columns: auto 1fr; gap: 0 10px; align-items: center; padding: 7px 10px; border-radius: 9px; cursor: pointer; }
  .pick label:hover { background: var(--panel); }
  .pick label.on { background: var(--accent-soft); }
  .pick input { grid-row: span 2; }
  .pick small { color: var(--text-3); font-size: 11.5px; }
  .dialog .actions { justify-content: flex-end; }
  .list { overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 2px; }
  .item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 9px 12px; border-radius: 10px; border: 0; background: none; color: var(--text); text-align: left; }
  .item:hover:not(:disabled) { background: var(--panel); }
  .item.on { background: var(--panel-hi); box-shadow: inset 2px 0 0 var(--accent); }
  .item small { color: var(--text-3); font-size: 11px; }
  .empty { padding: 12px; font-size: 13px; }

  main { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px 24px; }
  .bottom { flex-shrink: 0; }
  .welcome { margin: auto; }
  .welcome h1 { font-family: var(--serif); font-weight: 400; font-size: 64px; line-height: 0.95; }
  .welcome em { color: var(--accent); }

  .panel { border-left: 1px solid var(--line); background: var(--sidebar); overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
  .panel h2 { font-family: var(--serif); font-weight: 400; font-size: 30px; margin: 0; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0 0 6px; font-size: 12px; }
  dt { color: var(--text-3); }
  dd { margin: 0; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kicker small { text-transform: none; letter-spacing: 0; font-weight: 400; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips span { padding: 3px 10px; border-radius: 99px; background: var(--accent-soft); color: var(--text); font-size: 13px; }
  .chips small { color: var(--text-3); font-family: var(--mono); font-size: 10.5px; }
  .prog { display: flex; flex-wrap: wrap; gap: 4px; max-height: 160px; overflow-y: auto; }
  .prog button { padding: 2px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); color: var(--text-2); font-family: var(--mono); font-size: 11.5px; }
  .prog button:hover { color: var(--text); border-color: var(--line-hi); }
  .prog button.now { color: #1c0f05; background: var(--accent); border-color: var(--accent); }
  .actions { display: flex; gap: 8px; margin-top: 6px; }
  .panel .error-text { font-size: 12.5px; margin: 0; }
  article { border-top: 1px solid var(--line); padding-top: 6px; font-size: 13.5px; color: var(--text-2); }
  article h3 { font-family: var(--serif); font-weight: 400; font-size: 21px; color: var(--text); margin: 14px 0 4px; }
  article p { margin: 0 0 6px; }
  article .li { padding-left: 14px; position: relative; }
  .ts { padding: 0 3px; border: 0; border-radius: 4px; background: var(--accent-soft); color: var(--accent); font-family: var(--mono); font-size: 0.9em; }
  .ts:hover { background: var(--accent); color: #1c0f05; }
  article .li::before { content: "·"; position: absolute; left: 3px; color: var(--accent); }
</style>
