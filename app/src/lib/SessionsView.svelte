<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { listDir, paths, readBytes, readJson, removeFile, STEM_INFO, writeBytes, writeJson, type Detail } from "./engine";
  import { parseKey, type Note } from "./harmony";
  import { sessionForAI, songForAI, stamps } from "./live";
  import { toToon } from "./toon";
  import { Player, synth } from "./player";
  import { loadPiano } from "./piano";
  import { fromSession } from "./piece";
  import { pickPieces, pieceToSession, savePiece } from "./pieces.svelte";
  import Roll from "./Roll.svelte";
  import SearchInput from "./ui/Search.svelte";
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

  let { onback, onsong, onlearn }: { onback: () => void; onsong: (key: string) => void; onlearn: (pieceId: string) => void } = $props();

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
  let songInfo = $state<Detail | null>(null);
  let songFromNotes = $state(false);
  // instrumentos que se le pasan a Claude: al abrir una canción, todos los que tienen notas
  const noted = $derived(songInfo?.stemlab?.stems.filter((s) => s.roll) ?? []);
  let aiStems = $state<string[]>([]);
  $effect(() => {
    aiStems = noted.map((s) => s.name);
  });
  /** Cada canción + instrumentos tiene su análisis: sesiones/canciones/<canción>__<pistas>.{toon,analisis.md}. */
  const aiBase = $derived(song && aiStems.length ? `${dir}/canciones/${song.replace(/[/:]/g, "_")}__${[...aiStems].sort().join("+")}` : "");
  const target = $derived(song ? aiBase : (sel?.base ?? ""));
  $effect(() => {
    const base = aiBase;
    if (!song) return;
    analysis = "";
    error = "";
    if (base) readBytes(`${base}.analisis.md`).then((b) => base === aiBase && (analysis = new TextDecoder().decode(b)), () => {});
  });
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
    [songInfo, songChords, songKey] = [null, [], ""]; // que no se cuele la ficha de la anterior
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
    const names = files.filter((f) => f.name.endsWith(".json") && `${dir}/${f.name}` !== songsPath).map((f) => f.name.slice(0, -5)).sort().reverse();
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
    if (song) return songPlayer?.seek(t, true);
    seek(Math.min(t, duration));
    if (!player.playing && !loading) toggle();
  }

  async function analyze() {
    const base = target;
    if (!base) return;
    analyzing = true;
    error = "";
    try {
      // la IA lee TOON (tablas en vez de JSON: muchos menos tokens); el .json de la sesión sigue siendo el de la app
      const data = song ? await songJson() : sessionForAI(sel!.s as never);
      await writeBytes(`${base}.toon`, new TextEncoder().encode(toToon(data)));
      const text = await invoke<string>("analyze_session", { path: `${base}.toon` });
      if (target === base) analysis = text;
    } catch (e) {
      if (target === base) error = String(e);
    }
    analyzing = false;
  }

  /** Las notas de los instrumentos elegidos, los acordes y la letra de la canción abierta. */
  async function songJson() {
    const d = songInfo!;
    const tracks = await Promise.all(
      noted.filter((s) => aiStems.includes(s.name)).map(async (s) => ({ name: STEM_INFO[s.name]?.label ?? s.name, notes: await readJson<Note[]>(`${d.stemlab!.dir}/${s.roll}`, []) })),
    );
    return songForAI({ title: d.title, artist: d.artist, duration: d.duration, key: songKey || null, bpm: d.bpm }, tracks, songChords, d.doc);
  }

  /** La sesión como pieza, para practicarla en Aprender (o retocarla en el editor). */
  async function toPiece() {
    if (!sel?.s) return;
    const pc = await savePiece(fromSession(sel.s.notes, `Sesión del ${when(sel.name)}`));
    onlearn(pc.id);
  }

  /** MIDI o MusicXML como sesión (su piano roll, sus acordes, el análisis de Claude). */
  async function importSession() {
    try {
      const got = await pickPieces();
      let base = "";
      for (const [i, pc] of got.entries()) base = await pieceToSession(pc, true, new Date(Date.now() + i * 1000));
      await scan();
      const it = items.find((x) => x.base === base);
      if (it) void open(it);
    } catch (e) {
      error = `No se pudo importar: ${e}`;
    }
  }

  async function remove() {
    if (!sel || !confirm(`Borrar la sesión del ${when(sel.name)} (.mid, .json, .toon y su análisis). No se puede deshacer.`)) return;
    for (const ext of [".json", ".mid", ".toon", ".analisis.md"]) await removeFile(sel.base + ext).catch(() => {});
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
    void loadPiano().catch(() => {}); // que la primera nota ya suene a piano
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

{#snippet aiOut()}
  {#if analyzing}<div class="bar indet"><i></i></div>{/if}
  {#if error}<p class="error-text">{error}</p>{/if}
  {#if blocks.length}
    <article>
      {#each blocks as b, i (i)}
        {#if b.kind === "h"}<h3>{b.text}</h3>{:else}<p class:li={b.kind === "li"}>{@render linked(b.text)}</p>{/if}
      {/each}
    </article>
  {/if}
{/snippet}

{#snippet controls()}
  <Transport {playing} {time} {duration} bind:volume={settings.masterVolume} disabled={loading || !sel} ontoggle={toggle} onseek={seek} />
{/snippet}

<div class="sessions">
  <aside>
    <header class="side-head">
      <button class="ghost sm" onclick={onback} title="Volver al menú">← Menú</button>
      <div class="seg wide">
        <button class:on={tab === "sesiones"} onclick={() => (tab = "sesiones")}>Sesiones</button>
        <button class:on={tab === "canciones"} onclick={() => (tab = "canciones")}>Canciones</button>
      </div>
    </header>
    <div class="list">
      {#if tab === "canciones"}
        <button class="ghost add" onclick={() => (adding = true)}>＋ Añadir canción</button>
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
      <button class="ghost add" onclick={importSession} title="MIDI (.mid) o MusicXML (.musicxml, .xml, .mxl) como sesión">＋ Importar MIDI o MusicXML</button>
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
      {#key song}<SongPlayer bind:this={songPlayer} key={song} bind:time={songTime} bind:chords={songChords} bind:keyLabel={songKey} bind:detail={songInfo} bind:fromNotes={songFromNotes} />{/key}
    {:else if sel?.s}
      {#key sel.base}
        <Roll {player} {controls} bind:windowSec={settings.rollSpeed} ontoggle={() => {}} chords={sel.s.chords} keyLabel={sel.s.key ?? ""} tonality={parseKey(sel.s.key) ?? undefined}
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
        {#if songFromNotes}<p class="muted note">De las notas transcritas: los del audio (lv-chordia) están en la cola y saldrán la próxima vez que la abras.</p>{/if}
        <span class="kicker">Acordes que más suenan</span>
        <div class="chips">{#each top as [name, d] (name)}<span class="chip">{name} <small>{fmt(d)}</small></span>{/each}</div>
        <span class="kicker" title="Clic en un acorde para ir a él">Progresión</span>
        <div class="prog">
          {#each songChords as c, i (i)}
            <button class:now={c.t <= songTime && songTime < c.end} onclick={() => songPlayer?.seek(c.t)} title="{fmt(c.t)}{c.deg ? ` · ${c.deg}` : ''}">{c.name}</button>
          {/each}
        </div>
      {:else}
        <p class="muted">Sin acordes todavía: sus pistas no tienen notas y los del audio (lv-chordia) están en la cola.</p>
      {/if}
      <span class="kicker">Instrumentos para Claude</span>
      {#if noted.length}
        <div class="chips">
          {#each noted as st (st.name)}
            <button class="chip" class:on={aiStems.includes(st.name)} onclick={() => (aiStems = aiStems.includes(st.name) ? aiStems.filter((x) => x !== st.name) : [...aiStems, st.name])}>
              {STEM_INFO[st.name]?.label ?? st.name}{#if st.notes}<small> {st.notes} notas</small>{/if}
            </button>
          {/each}
        </div>
      {:else}
        <p class="muted">Ninguna pista tiene notas todavía: sácalas en Analizar.</p>
      {/if}
      <div class="actions">
        <button class="primary" onclick={analyze} disabled={analyzing || !aiStems.length}>{analyzing ? "Claude escuchando…" : analysis ? "Analizar otra vez" : "Analizar con Claude"}</button>
        <button class="ghost" onclick={() => song && onsong(song)} title="Letra, partitura, acordes…">Abrir en Analizar</button>
        <button class="ghost" onclick={removeSong} title="Solo la quita de esta lista; la canción sigue en la biblioteca">Quitar</button>
      </div>
      {@render aiOut()}
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
        <div class="chips">{#each top as [name, d] (name)}<span class="chip">{name} <small>{fmt(d)}</small></span>{/each}</div>
        <span class="kicker" title="Clic en un acorde para ir a él">Progresión</span>
        <div class="prog">
          {#each sel.s.chords as c, i (i)}
            <button class:now={c.t <= time && time < c.end} onclick={() => seek(c.t)} title="{fmt(c.t)}{c.deg ? ` · ${c.deg}` : ''}">{c.name}</button>
          {/each}
        </div>
      {/if}
      <div class="actions">
        <button class="primary" onclick={analyze} disabled={analyzing}>{analyzing ? "Claude escuchando…" : analysis ? "Analizar otra vez" : "Analizar con Claude"}</button>
        <button class="ghost" onclick={toPiece} title="Pasarla a pieza para practicarla con niveles (o retocarla en el editor)">Practicar en Aprender</button>
        <button class="ghost" onclick={() => sel && revealItemInDir(`${sel.base}.mid`)} title="El .mid se abre en cualquier programa">Carpeta</button>
        <button class="ghost" onclick={remove}>Borrar</button>
      </div>
      {@render aiOut()}
    {/if}
  </section>
</div>

{#if adding}
  <div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && (adding = false)}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Añadir canciones">
      <h3>Añadir canciones</h3>
      <p class="hint">Las que tienen las pistas separadas.</p>
      <SearchInput placeholder="Buscar…" bind:value={query} autofocus onkeydown={(e) => e.key === "Escape" && (adding = false)} />
      <div class="picklist">
        {#each available as t (t.key)}
          <label class="item" class:on={picked.includes(t.key)}>
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
  .sessions { height: 100%; display: grid; grid-template-columns: 280px 1fr 360px; }
  aside { background: var(--sidebar); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  .add { width: 100%; justify-content: flex-start; margin-bottom: 6px; border-style: dashed; }
  .side-head .seg { flex: 1; }

  .dialog { width: min(560px, calc(100vw - 32px)); gap: 10px; padding: 18px; }
  .dialog h3 { font-size: 16px; }
  .picklist { overflow-y: auto; min-height: 120px; max-height: 50vh; display: flex; flex-direction: column; gap: 2px; }
  .picklist label { display: grid; grid-template-columns: auto 1fr; gap: 0 10px; align-items: center; cursor: pointer; }
  .picklist input { grid-row: span 2; }
  .dialog .actions { justify-content: flex-end; }
  .list { overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 2px; }
  .empty { padding: 10px; font-size: 12px; }

  main { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px 24px; }
  .bottom { flex-shrink: 0; }
  .welcome { margin: auto; }
  .welcome h1 { font-size: 28px; }
  .welcome em { font-style: normal; color: var(--accent); }

  .panel { border-left: 1px solid var(--line); background: var(--sidebar); overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 10px; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0 0 6px; font-size: 12px; }
  dt { color: var(--text-3); }
  dd { margin: 0; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .note { margin: 0; font-size: 12px; }
  .prog { display: flex; flex-wrap: wrap; gap: 4px; max-height: 160px; overflow-y: auto; }
  .prog button { padding: 1px 7px; border-radius: 4px; border: 1px solid var(--line); background: none; color: var(--text-2); font-size: 11.5px; }
  .prog button:hover { color: var(--text); border-color: var(--line-hi); }
  .prog button.now { color: var(--on-accent); background: var(--accent); border-color: var(--accent); }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .panel .error-text { font-size: 12.5px; margin: 0; }
  .panel > p.muted { margin: 0; font-size: 12px; }
  article { border-top: 1px solid var(--line); padding-top: 6px; font-size: 12.5px; color: var(--text-2); }
  article h3 { margin: 12px 0 4px; }
  article p { margin: 0 0 6px; }
  article .li { padding-left: 14px; position: relative; }
  article .li::before { content: "·"; position: absolute; left: 3px; color: var(--accent); }
  .ts { padding: 0 3px; border: 0; border-radius: 4px; background: var(--accent-soft); color: var(--accent); font-family: var(--mono); font-size: 0.9em; }
  .ts:hover { background: var(--accent); color: var(--on-accent); }
</style>
