<script lang="ts">
  import { getCurrentWebview } from "@tauri-apps/api/webview";
  import { onMount, untrack } from "svelte";
  import AddDialog, { loadAfter, thenOf } from "./lib/AddDialog.svelte";
  import { enqueue, finished, fmtBytes, gpuName, importSources, initPaths, run } from "./lib/engine";
  import Library from "./lib/Library.svelte";
  import PlayView from "./lib/PlayView.svelte";
  import SessionsView from "./lib/SessionsView.svelte";
  import Queue from "./lib/Queue.svelte";
  import SettingsPanel from "./lib/SettingsPanel.svelte";
  import { loadSettings, saveSettings, settings } from "./lib/settings.svelte";
  import SongView from "./lib/SongView.svelte";
  import { connect, refresh, store } from "./lib/store.svelte";

  const params = new URLSearchParams(location.search);
  let ready = $state(false);
  let fatal = $state("");
  let selected = $state<string | null>(params.get("song"));
  // qué se va a hacer: analizar canciones o tocar el teclado; sin elegir, el menú
  type Mode = "analizar" | "tocar" | "sesiones";
  let mode = $state<Mode | null>(params.get("song") ? "analizar" : (params.get("mode") as Mode | null));
  let initialTab = $state(params.get("tab") ?? undefined);
  let picked = $state<string[]>([]);
  let queueOpen = $state(false);
  let adding = $state(false);
  let dragging = $state(false);
  let gpu = $state("");
  let settingsOpen = $state(false);
  $effect(() => {
    JSON.stringify(settings);
    untrack(saveSettings);
  });
  const playing = $derived(store.playing);
  const playingTrack = $derived(playing?.key ? store.tracks.find((t) => t.key === playing.key) : undefined);

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
          dragging = t === "enter" || t === "over";
          if (t === "drop" && mode === "analizar" && e.payload.paths.length) void importSources(e.payload.paths, thenOf(loadAfter())).then(() => (queueOpen = true));
        });
      } catch (e) {
        fatal = String(e);
      }
    })();
    return () => unlisten?.();
  });

  // primera canción al abrir, si no venía ninguna
  $effect(() => {
    if (ready && !selected && store.tracks.length) selected = [...store.tracks].sort((a, b) => b.modified - a.modified)[0].key;
  });

  const active = $derived(store.jobs.filter((j) => !finished(j)));
  const gpuJob = $derived(store.jobs.find((j) => j.status === "running" && j.steps[j.cur]?.res === "gpu"));
  const gpuWaiting = $derived(store.jobs.filter((j) => j.status === "ready" && j.steps[j.cur]?.res === "gpu").length);
  const titleOf = (key: string) => store.tracks.find((t) => t.key === key)?.title ?? key;

  function go(m: typeof mode) {
    mode = m;
    history.replaceState(null, "", m ? `?mode=${m}` : "?");
  }

  function select(key: string) {
    selected = key;
    initialTab = undefined;
    history.replaceState(null, "", `?song=${encodeURIComponent(key)}`);
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
        if (selected && keys.includes(selected)) selected = null;
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

  function onkey(e: KeyboardEvent) {
    const typing = (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]");
    if (typing || e.ctrlKey || e.metaKey || e.altKey || adding) return;
    const pick = ({ "1": "analizar", "2": "tocar", "3": "sesiones" } as const)[e.key as "1"];
    if (!mode && pick) return go(pick);
    if (mode !== "analizar") return;
    if (e.key === "q" || e.key === "Q") ((queueOpen = !queueOpen), e.preventDefault());
    else if (e.key === "n" || e.key === "N") ((adding = true), e.preventDefault());
  }
</script>

<svelte:window onkeydown={onkey} />

{#if fatal}
  <div class="fatal">
    <h1>No arranca el motor</h1>
    <pre>{fatal}</pre>
    <p>Prepara el motor: <code>cd ~/Projects/estudio/engine &amp;&amp; uv sync</code> (o <code>./install.sh</code> en el repo).</p>
  </div>
{:else if !ready}
  <div class="boot"><span class="spinner"></span></div>
{:else if !mode}
  <div class="menu">
    <span class="kicker">Estudio</span>
    <h1>¿Qué vas a <em>hacer</em>?</h1>
    <div class="choices">
      <button onclick={() => go("analizar")}>
        <kbd>1</kbd>
        <strong>Analizar canciones</strong>
        <span>Biblioteca: letra, pistas separadas, partitura, acordes y edits.</span>
      </button>
      <button onclick={() => go("tocar")}>
        <kbd>2</kbd>
        <strong>Tocar</strong>
        <span>Teclado MIDI: piano roll en vivo, el acorde que suena y la sesión guardada para analizarla luego.</span>
      </button>
      <button onclick={() => go("sesiones")}>
        <kbd>3</kbd>
        <strong>Sesiones</strong>
        <span>Lo que tocaste: volver a oírlo con su piano roll y sus acordes, y analizarlo con Claude.</span>
      </button>
    </div>
  </div>
{:else if mode === "tocar"}
  <main class="solo"><PlayView onback={() => go(null)} onsessions={() => go("sesiones")} /></main>
{:else if mode === "sesiones"}
  <SessionsView onback={() => go(null)} />
{:else}
  <div class="app">
    <aside class="side">
      <Library {selected} bind:picked onselect={select} onadd={() => (adding = true)} onbulk={bulk} />
    </aside>
    <main>
      <div class="topbar">
        {#if store.error}<span class="error-text top-err" title={store.error}>{store.error}</span>{/if}
        {#if playing}
          <button class="np" class:live={playing.playing} disabled={!playing.key} onclick={() => playing.key && select(playing.key)}
            title={settings.spotify ? "Suena en Spotify: su letra se busca y sincroniza sola" : "Suena en Spotify"}>
            <i></i>
            <span class="np-what"><b>{playing.title}</b> · {playing.artist}</span>
            {#if playingTrack?.lyrics}
              <span class="np-tag">{playingTrack.lyrics.status === "words" ? "palabra a palabra" : playingTrack.lyrics.status === "lines" ? "por líneas" : playingTrack.lyrics.status === "instrumental" ? "instrumental" : "sin tiempos"}</span>
            {:else}
              <span class="np-tag off">sin letra</span>
            {/if}
          </button>
        {/if}
        <button class="gpu" class:busy={!!gpuJob} onclick={() => (queueOpen = true)} title="La GPU hace una cosa a la vez; lo demás (CPU, red) va en paralelo">
          <i></i>
          <span class="gpu-name">{gpu || "GPU"}</span>
          {#if gpuJob}
            <span class="gpu-what">{gpuJob.waiting || gpuJob.label} · {titleOf(gpuJob.key)}</span>
            {#if gpuJob.pct != null}<span class="mono">{Math.round(gpuJob.pct)}%</span>{/if}
          {:else}
            <span class="gpu-what">libre</span>
          {/if}
          {#if gpuWaiting}<span class="wait">+{gpuWaiting}</span>{/if}
        </button>
        <button class="qbtn" class:on={active.length > 0} onclick={() => (queueOpen = !queueOpen)} title="Cola (Q)">
          Cola{#if active.length}<b>{active.length}</b>{/if}
        </button>
        <button class="icon-btn gear" onclick={() => go(null)} title="Menú: analizar o tocar" aria-label="Menú">
          <svg viewBox="0 0 24 24"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" /></svg>
        </button>
        <button class="icon-btn gear" onclick={() => (settingsOpen = true)} title="Ajustes: Spotify, notas, playlists" aria-label="Ajustes">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
        </button>
      </div>
      {#if selected && store.tracks.some((t) => t.key === selected)}
        {#key selected}
          <SongView
            key={selected}
            {initialTab}
            onrenamed={(k) => (refresh(true), select(k))}
            ondeleted={() => ((selected = null), refresh(true))}
          />
        {/key}
      {:else}
        <div class="welcome">
          <span class="kicker">Letras · StemLab · Lyric Edits</span>
          <h1>Cada canción,<br /><em>entera</em>, en un sitio.</h1>
          <p>
            Letra palabra a palabra, pistas separadas, partitura con la letra debajo y edits para vídeo. Lo que ya está hecho
            con más calidad se reutiliza; lo de menos calidad no se saca.
          </p>
          <div class="cta">
            <button class="primary" onclick={() => (adding = true)}>Añadir canciones <kbd>N</kbd></button>
          </div>
          {#if store.tracks.length}
            <p class="stats mono">{store.tracks.length} canciones · {fmtBytes(store.tracks.reduce((n, t) => n + t.bytes, 0))}</p>
          {/if}
        </div>
      {/if}
    </main>
  </div>
{/if}
{#if ready && mode === "analizar"}
  <Queue bind:open={queueOpen} {gpu} onopen={(k) => ((queueOpen = false), select(k))} />
  <SettingsPanel bind:open={settingsOpen} onopen={select} />
  <AddDialog bind:open={adding} onadded={(k) => (k ? select(k) : (queueOpen = true), refresh(true))} />
  {#if dragging}
    <div class="drop"><div><span class="kicker">Soltar para importar</span><strong>Audio o vídeo</strong></div></div>
  {/if}
{/if}

<style>
  .app { display: grid; grid-template-columns: 320px 1fr; height: 100vh; }
  .side { background: var(--sidebar); border-right: 1px solid var(--line); min-height: 0; }
  main {
    position: relative; min-width: 0; min-height: 0; display: flex; flex-direction: column; padding: 14px 32px 16px;
    background:
      radial-gradient(900px 420px at 85% -12%, color-mix(in srgb, var(--accent-2) 13%, transparent), transparent 65%),
      radial-gradient(700px 380px at 10% 110%, color-mix(in srgb, var(--accent) 6%, transparent), transparent 60%),
      var(--bg);
  }
  .topbar { display: flex; justify-content: flex-end; align-items: center; gap: 8px; min-height: 32px; margin-bottom: 8px; flex-shrink: 0; }
  .top-err { margin-right: auto; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .gpu {
    display: flex; align-items: center; gap: 8px; max-width: 520px; padding: 5px 12px 5px 10px; border-radius: 99px;
    border: 1px solid var(--line); background: var(--panel); color: var(--text-2); font-size: 12px;
  }
  .gpu i { width: 7px; height: 7px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 8px var(--ok); flex-shrink: 0; }
  .gpu.busy i { background: var(--accent); box-shadow: 0 0 10px var(--accent); animation: pulse 1s ease-in-out infinite; }
  .gpu-name { font-family: var(--mono); font-size: 11px; color: var(--text); white-space: nowrap; }
  .gpu-what { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .wait { font-family: var(--mono); font-size: 11px; color: var(--accent); }
  .np {
    display: flex; align-items: center; gap: 8px; max-width: 460px; margin-right: auto; padding: 5px 12px 5px 10px; border-radius: 99px;
    border: 1px solid var(--line); background: var(--panel); color: var(--text-2); font-size: 12px;
  }
  .np:hover:not(:disabled) { border-color: var(--line-hi); color: var(--text); }
  .np i { width: 7px; height: 7px; border-radius: 50%; background: var(--text-3); flex-shrink: 0; }
  .np.live i { background: #1ed760; box-shadow: 0 0 8px #1ed760; }
  .np-what { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .np-what b { color: var(--text); font-weight: 600; }
  .np-tag { font-family: var(--mono); font-size: 10.5px; color: var(--accent); white-space: nowrap; }
  .np-tag.off { color: var(--text-3); }
  .gear { width: 30px; height: 30px; }
  .qbtn { display: flex; align-items: center; gap: 7px; padding: 5px 12px; border-radius: 99px; border: 1px solid var(--line); background: var(--panel); color: var(--text-2); font-size: 12px; }
  .qbtn.on { color: var(--text); border-color: color-mix(in srgb, var(--accent) 50%, var(--line)); }
  .qbtn b { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 9px; background: var(--accent); color: #1c0f05; font-size: 11px; display: grid; place-items: center; }

  .welcome { margin: auto; max-width: 640px; animation: rise 0.6s var(--ease); }
  .welcome h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(52px, 7vw, 92px); line-height: 0.92; letter-spacing: -0.02em; margin: 14px 0 20px; }
  .welcome em { color: var(--accent); }
  .welcome p { color: var(--text-2); font-size: 15px; max-width: 520px; }
  .cta { margin-top: 24px; }
  .cta .primary { padding: 12px 22px; font-size: 15px; display: inline-flex; gap: 10px; align-items: center; }
  .cta kbd { background: #0002; border-color: #0003; color: #1c0f05; }
  .stats { margin-top: 30px; color: var(--text-3) !important; font-size: 12px !important; }

  .solo { height: 100vh; }
  .menu { height: 100vh; display: flex; flex-direction: column; justify-content: center; max-width: 1080px; margin: 0 auto; padding: 32px; animation: rise 0.6s var(--ease); }
  .menu h1 { font-family: var(--serif); font-weight: 400; font-size: clamp(48px, 6vw, 80px); line-height: 0.95; margin: 14px 0 32px; }
  .menu em { color: var(--accent); }
  .choices { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .choices button {
    display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 22px; border-radius: var(--radius); text-align: left;
    border: 1px solid var(--line); background: var(--panel); color: var(--text-2); transition: border-color 0.15s, background 0.15s, transform 0.15s var(--ease);
  }
  .choices button:hover { border-color: var(--accent); background: var(--panel-hi); transform: translateY(-2px); }
  .choices strong { font-family: var(--serif); font-weight: 400; font-size: 32px; color: var(--text); }
  .boot { height: 100vh; display: grid; place-items: center; }
  .fatal { padding: 60px; max-width: 760px; }
  .fatal h1 { font-family: var(--serif); font-weight: 400; font-size: 48px; margin: 0 0 16px; }
  .fatal pre { white-space: pre-wrap; color: var(--bad); background: var(--panel); padding: 14px; border-radius: 10px; }
  .drop { position: fixed; inset: 0; z-index: 90; display: grid; place-items: center; background: #0b0908cc; backdrop-filter: blur(6px); animation: fade 0.15s; }
  @keyframes fade { from { opacity: 0; } }
  .drop div { display: flex; flex-direction: column; gap: 6px; align-items: center; padding: 56px 84px; border: 2px dashed var(--accent); border-radius: 22px; }
  .drop strong { font-family: var(--serif); font-weight: 400; font-size: 40px; }
</style>
