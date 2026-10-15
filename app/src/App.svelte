<script lang="ts">
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { onMount, untrack } from "svelte";
  import AddDialog, { loadAfter, thenOf } from "./lib/AddDialog.svelte";
  import CourseView from "./lib/CourseView.svelte";
  import { deck, deckPause, deckPlay, deckToggle } from "./lib/deck.svelte";
  import EarView from "./lib/EarView.svelte";
  import { enqueue, gpuName, importSources, initPaths, run } from "./lib/engine";
  import LearnView from "./lib/LearnView.svelte";
  import Library from "./lib/Library.svelte";
  import PlayView from "./lib/PlayView.svelte";
  import ProgressionView from "./lib/ProgressionView.svelte";
  import SessionsView from "./lib/SessionsView.svelte";
  import SettingsPanel from "./lib/SettingsPanel.svelte";
  import { loadSettings, saveSettings, settings } from "./lib/settings.svelte";
  import MiniPlayer from "./lib/shell/MiniPlayer.svelte";
  import { RAIL, viewOf, type View } from "./lib/shell/nav";
  import Palette, { type Command } from "./lib/shell/Palette.svelte";
  import QueuePill from "./lib/shell/QueuePill.svelte";
  import Rail from "./lib/shell/Rail.svelte";
  import SingView from "./lib/SingView.svelte";
  import SongView from "./lib/SongView.svelte";
  import { connect, refresh, store } from "./lib/store.svelte";
  import Button from "./lib/ui/Button.svelte";
  import Icon, { type IconName } from "./lib/ui/Icon.svelte";

  // Armazón: barra de iconos a la izquierda, la vista en el centro, el mini-reproductor abajo, la cola flotando y la
  // paleta (Ctrl+K). La canción abierta (SongView) sigue cargada al cambiar de vista: se oye y se controla desde abajo.
  const params = new URLSearchParams(location.search);
  let ready = $state(false);
  let fatal = $state("");
  let loaded = $state<string | null>(params.get("song")); // la canción con SongView montada
  const startView = viewOf(params.get("mode"));
  let view = $state<View>(startView === "cantar" && !params.get("song") ? "biblioteca" : startView);
  let songShown = $state(!!params.get("song")); // en Biblioteca: su página (si no, la rejilla)
  let initialTab = $state(params.get("tab") ?? undefined);
  let picked = $state<string[]>([]);
  let queueOpen = $state(false);
  let adding = $state(false);
  let paletteOpen = $state(false);
  let settingsOpen = $state(false);
  let dragging = $state(false);
  let gpu = $state("");

  $effect(() => {
    JSON.stringify(settings);
    untrack(saveSettings);
  });

  onMount(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        await initPaths();
        await loadSettings();
        await connect();
        ready = true;
        gpuName().then((g) => (gpu = g.replace(/^Radeon\s+/, "").split("/")[0]));
        unlisten = await getCurrentWebview().onDragDropEvent((e) => {
          const t = e.payload.type;
          dragging = view === "biblioteca" && (t === "enter" || t === "over");
          if (t === "drop" && view === "biblioteca" && e.payload.paths.length) void importSources(e.payload.paths, thenOf(loadAfter())).then(() => (queueOpen = true));
        });
      } catch (e) {
        fatal = String(e);
      }
    })();
    return () => unlisten?.();
  });

  const songOpen = $derived(view === "biblioteca" && songShown && !!loaded && store.tracks.some((t) => t.key === loaded));
  // la canción cargada solo suena (y se ve abajo) en Biblioteca; lo de Spotify, en cualquier vista
  const showPlayer = $derived(ready && !songOpen && view !== "cantar" && ((!!deck.key && view === "biblioteca") || !!store.playing));

  function url(extra: Record<string, string> = {}) {
    const p = new URLSearchParams({ mode: view, ...(loaded && songShown && view === "biblioteca" ? { song: loaded } : {}), ...extra });
    history.replaceState(null, "", `?${p}`);
  }
  /** Ir a una vista; pulsar la que ya está abierta vuelve a su principio (en Biblioteca, a la rejilla). */
  function go(v: View, extra: Record<string, string> = {}) {
    if (v === view && v === "biblioteca") songShown = false;
    if (v !== "biblioteca") deckPause(); // fuera de Biblioteca la canción no suena
    view = v;
    url(extra);
  }
  /** ▶ desde la rejilla o el mini-reproductor: la carga (sin abrir su página) y suena en cuanto esté lista. */
  function playSong(key: string) {
    if (loaded !== key) loaded = key;
    deckPlay(key);
  }
  function openSong(key: string, tab?: string) {
    loaded = key;
    songShown = true;
    initialTab = tab;
    view = "biblioteca";
    url();
  }
  function closeSong() {
    loaded = null;
    songShown = false;
    url();
  }

  async function bulk(action: string, keys: string[]) {
    if (action.startsWith("delete-")) {
      const what = action.slice(7);
      const msg = {
        audio: `Borrar el audio en caché de ${keys.length} canciones (se puede volver a sacar).`,
        stems: `Borrar pistas y partituras de ${keys.length} canciones.`,
        all: `Borrar ${keys.length} canciones enteras: letra, audio, pistas, partituras y edits. No se puede deshacer.`,
      }[what];
      if (!confirm(msg)) return;
      await Promise.all(keys.map((k) => run("delete", [k, what]).catch(() => {})));
      if (what === "all") {
        picked = [];
        if (loaded && keys.includes(loaded)) closeSong();
      }
      refresh(true);
      return;
    }
    if (action === "letra-force") await enqueue("letra", keys, ["force"]);
    else if (action === "align-audio") await enqueue("sync", keys, ["lineas"]);
    else if (action === "todo" || action === "notes-all") await enqueue(action, keys, settings.notes === "precise" ? ["precise"] : []);
    else await enqueue(action, keys);
    queueOpen = true;
  }

  const commands = $derived<Command[]>([
    ...RAIL.map((r, i) => ({ id: `view:${r.id}`, label: r.label, icon: r.icon, kbd: `Alt+${i + 1}`, group: "Ir a", run: () => go(r.id) })),
    { id: "add", label: "Añadir canciones", hint: "enlace, YouTube, nombre o ficheros", icon: "plus", kbd: "N", group: "Acciones", run: () => (adding = true) },
    { id: "queue", label: "Cola de trabajo", icon: "queue", kbd: "Q", group: "Acciones", run: () => (queueOpen = true) },
    ...(deck.key && view === "biblioteca" ? [{ id: "toggle", label: deck.playing ? "Pausar" : "Reproducir", hint: store.tracks.find((t) => t.key === deck.key)?.title, icon: (deck.playing ? "pause" : "play") as IconName, group: "Acciones", run: deckToggle }] : []),
    { id: "settings", label: "Ajustes", hint: "Spotify, notas, servidor, playlists", icon: "settings", group: "Acciones", run: () => (settingsOpen = true) },
  ]);

  function onkey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      paletteOpen = !paletteOpen;
      return;
    }
    if (document.querySelector("dialog[open]")) return;
    if (e.altKey && !e.ctrlKey && /^[1-9]$/.test(e.key) && RAIL[+e.key - 1]) {
      e.preventDefault();
      return go(RAIL[+e.key - 1].id);
    }
    const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
    // q / n solo en Biblioteca: en las vistas de tocar, las letras son teclas del piano
    if (typing || e.ctrlKey || e.metaKey || e.altKey || view !== "biblioteca") return;
    if (e.key === "q" || e.key === "Q") ((queueOpen = !queueOpen), e.preventDefault());
    else if (e.key === "n" || e.key === "N") ((adding = true), e.preventDefault());
  }
</script>

<svelte:window onkeydown={onkey} />

{#if fatal}
  <div class="fatal">
    <Icon name="alert" size={28} />
    <h1>No arranca el motor</h1>
    <pre>{fatal}</pre>
    <p>Prepara el motor: <code>cd ~/Projects/estudio/engine &amp;&amp; uv sync</code> (o <code>./install.sh</code> en el repo).</p>
  </div>
{:else if !ready}
  <div class="boot" aria-label="Cargando"><span class="mark">E</span></div>
{:else}
  <div class="shell" class:with-player={showPlayer}>
    <Rail {view} onnav={go} onsearch={() => (paletteOpen = true)} onsettings={() => (settingsOpen = true)} />

    <main class="stage">
      {#if loaded}
        <!-- la canción abierta sigue montada (sonando) aunque no se vea -->
        <div class="page song" class:hidden={!songOpen}>
          <div class="crumb">
            <Button size="sm" variant="ghost" icon="back" onclick={() => ((songShown = false), url())}>Biblioteca</Button>
          </div>
          {#key loaded}
            <SongView
              key={loaded}
              {initialTab}
              active={songOpen}
              onrenamed={(k) => (refresh(true), openSong(k))}
              ondeleted={() => (closeSong(), refresh(true))}
              onopen={(k) => openSong(k)}
              onsing={() => go("cantar")}
            />
          {/key}
        </div>
      {/if}

      {#if view === "biblioteca" && !songOpen}
        <Library bind:picked current={deck.key} onopen={(k) => openSong(k)} onplay={playSong} onadd={() => (adding = true)} onbulk={bulk} onqueue={() => (queueOpen = true)} />
      {:else if view === "cantar" && loaded}
        <div class="page"><SingView key={loaded} onback={() => go("biblioteca")} /></div>
      {:else if view === "aprender"}
        <LearnView onback={() => go("biblioteca")} onsessions={() => go("sesiones")} oncourse={(l, s) => go("curso", { leccion: l, paso: String(s) })} />
      {:else if view === "curso"}
        <CourseView onback={() => go("biblioteca")} onpractice={(l, s) => go("aprender", { leccion: l, paso: String(s) })} />
      {:else if view === "oido"}
        <div class="page padded"><EarView /></div>
      {:else if view === "tocar"}
        <div class="page"><PlayView onback={() => go("biblioteca")} onsessions={() => go("sesiones")} /></div>
      {:else if view === "sesiones"}
        <SessionsView onback={() => go("biblioteca")} onsong={(k) => openSong(k)} onlearn={(id) => go("aprender", { piece: id })} />
      {:else if view === "progresiones"}
        <ProgressionView onback={() => go("biblioteca")} onopen={(k) => openSong(k)} />
      {/if}
    </main>

    {#if showPlayer}
      <MiniPlayer deckOn={view === "biblioteca"} onopen={(k) => openSong(k)} onplay={playSong} onclose={closeSong} />
    {/if}
  </div>

  <QueuePill bind:open={queueOpen} {gpu} raised={showPlayer || songOpen} onopen={(k) => openSong(k)} />
  <Palette bind:open={paletteOpen} {commands} onsong={(k) => openSong(k)} />
  <AddDialog bind:open={adding} onadded={(k) => (k ? openSong(k) : (queueOpen = true), refresh(true))} />
  <SettingsPanel bind:open={settingsOpen} onopen={(k) => openSong(k)} />
  {#if dragging}
    <div class="drop" aria-hidden="true">
      <div><Icon name="upload" size={32} /><strong>Suelta para importar</strong><span>audio o vídeo</span></div>
    </div>
  {/if}
{/if}

<style>
  .shell { display: grid; grid-template-columns: var(--rail-w) minmax(0, 1fr); grid-template-rows: minmax(0, 1fr); height: 100vh; }
  .shell.with-player { grid-template-rows: minmax(0, 1fr) var(--player-h); }
  .stage { position: relative; grid-column: 2; min-width: 0; min-height: 0; display: flex; flex-direction: column; overflow: hidden; background: var(--bg); }
  .stage > :global(*) { flex: 1; min-height: 0; }
  .page { display: flex; flex-direction: column; min-height: 0; min-width: 0; overflow: auto; }
  .page.hidden { display: none; }
  .page.song { padding: var(--s2) var(--s5) var(--s4); }
  .page.padded { padding: var(--s5) var(--s6); }
  .crumb { display: flex; margin: 0 0 var(--s2) calc(-1 * var(--s2)); flex: none; }

  .boot { height: 100vh; display: grid; place-items: center; }
  .boot .mark {
    display: grid; place-items: center; width: 40px; height: 40px; border-radius: var(--r-lg); border: 2px solid var(--text);
    font-weight: 800; font-size: var(--fs-xl); animation: pulse 1.2s ease-in-out infinite;
  }
  .fatal { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s7); max-width: 760px; color: var(--bad); }
  .fatal h1 { color: var(--text); }
  .fatal pre { white-space: pre-wrap; color: var(--bad); background: var(--panel); padding: var(--s3); border-radius: var(--r-lg); margin: 0; }
  .fatal p { color: var(--text-2); }
  .drop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: var(--scrim); animation: fade var(--t); }
  .drop div {
    display: flex; flex-direction: column; gap: var(--s2); align-items: center; padding: var(--s7) 72px; color: var(--text-2);
    border: 2px dashed var(--accent); border-radius: var(--r-lg); background: var(--panel);
  }
  .drop strong { font-size: var(--fs-xl); color: var(--text); }
</style>
