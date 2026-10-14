<script lang="ts">
  import { openPath } from "@tauri-apps/plugin-opener";
  import { untrack } from "svelte";
  import {
    enqueue, fmtClock, log, PITCHED, readJson, run, songDetail, STEM_INFO, SOURCE_LABEL, viewPath, writeJson, type Detail, type Track,
  } from "./engine";
  import ChordsTab, { loadNotation } from "./ChordsTab.svelte";
  import EditsTab from "./EditsTab.svelte";
  import { analyze, degree, fromModel, keyName, named, type Harmony, type Note } from "./harmony";
  import Leds from "./Leds.svelte";
  import LyricsTab from "./LyricsTab.svelte";
  import MiniMixer from "./MiniMixer.svelte";
  import { CLICK, Player } from "./player";
  import Roll from "./Roll.svelte";
  import { settings } from "./settings.svelte";
  import { jobOf, jobText, live, store } from "./store.svelte";
  import Transport from "./Transport.svelte";
  import Waveform from "./Waveform.svelte";

  let { key, initialTab, onrenamed, ondeleted }: {
    key: string;
    initialTab?: string;
    onrenamed: (key: string) => void;
    ondeleted: () => void;
  } = $props();

  type Tab = "letra" | "mix" | "roll" | "score" | "chords" | "edits";
  const TABS: [Tab, string][] = [["letra", "Letra"], ["mix", "Pistas"], ["roll", "Piano roll"], ["score", "Partitura"], ["chords", "Acordes"], ["edits", "Edits"]];

  const track = $derived(store.tracks.find((t) => t.key === key) as Track | undefined);
  let detail = $state<Detail | null>(null);
  let detailError = $state("");
  const player = new Player();
  let loading = $state(true);
  let loadError = $state("");
  let playing = $state(false);
  let time = $state(0);
  let duration = $state(0);
  let loadedSig = "";
  let volume = $state<Record<string, number>>({});
  let muted = $state<Record<string, boolean>>({});
  let solo = $state<Record<string, boolean>>({});
  let metro = $state({ on: false, volume: 0.7, factor: 1, meter: 4, shift: 0 });
  // svelte-ignore state_referenced_locally
  let tab = $state<Tab>((initialTab as Tab) || "letra");
  let scoreHidden = $state<Record<string, boolean>>({});
  let rollHidden = $state<Record<string, boolean>>({});
  let scorePath = $state<string | null>(null);
  let scoreError = $state("");
  let menu = $state(false);
  let editing = $state(false);

  const stemlab = $derived(detail?.stemlab ?? null);
  const stems = $derived(stemlab?.stems ?? []);
  /** Lo que suena: las pistas si está separada, si no la mezcla. */
  const tracks = $derived(
    stemlab ? stemlab.stems.map((s) => ({ name: s.name, path: `${stemlab.dir}/${s.file}`, present: s.present })) : detail?.audioPath ? [{ name: "mix", path: detail.audioPath, present: true }] : [],
  );
  const sig = $derived(tracks.map((t) => t.path).join("|"));

  // ---- ficha: al abrir y cada vez que la cola cambia algo de esta canción
  const rev = $derived(store.rev[key] ?? 0);
  $effect(() => {
    void rev;
    const k = key;
    songDetail(k).then(
      (d) => k === key && ((detail = d), (detailError = "")),
      (e) => (detailError = String(e)),
    );
  });

  // ---- audio: solo cuando cambian los ficheros (separar, descargar), no con cada cambio de letra
  $effect(() => {
    const s = sig;
    if (s === loadedSig) return;
    loadedSig = s;
    untrack(() => load());
  });

  async function load() {
    if (!tracks.length) {
      loading = false;
      duration = detail?.duration ?? 0;
      return;
    }
    const at = player.time();
    const was = player.playing;
    loading = true;
    loadError = "";
    const t0 = performance.now();
    try {
      for (const t of tracks) {
        if (volume[t.name] == null) volume[t.name] = 1;
        if (muted[t.name] == null) muted[t.name] = !t.present;
        if (solo[t.name] == null) solo[t.name] = false;
      }
      await player.load(tracks);
      duration = player.duration;
      if (at) player.seek(at);
      if (was) player.play();
      playing = player.playing;
      log(`${key}: ${tracks.length} pistas en ${Math.round(performance.now() - t0)} ms`);
    } catch (e) {
      loadError = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }
  $effect(() => () => {
    player.stop();
    void player.ctx.close(); // cada canción abre el suyo: sin cerrar, WebKit se queda sin contextos de audio
  });

  // ---- ajustes guardados: por canción y generales
  let restored = $state(false);
  $effect(() => {
    untrack(async () => {
      const view = await readJson(viewPath(key), { volume: {}, muted: {}, solo: {}, rollHidden: {}, scoreHidden: {}, tab: "", metro: $state.snapshot(metro) });
      Object.assign(volume, view.volume);
      Object.assign(muted, view.muted);
      Object.assign(solo, view.solo);
      Object.assign(rollHidden, view.rollHidden);
      Object.assign(scoreHidden, view.scoreHidden);
      if (view.tab && !initialTab) tab = view.tab as Tab;
      Object.assign(metro, view.metro, { on: false });
      restored = true;
    });
  });
  let flush: (() => void) | null = null;
  $effect(() => {
    if (!restored) return;
    const view = $state.snapshot({ volume, muted, solo, rollHidden, scoreHidden, tab, metro });
    const k = untrack(() => key);
    flush = () => {
      flush = null;
      void writeJson(viewPath(k), view);
    };
    const t = setTimeout(() => flush?.(), 500);
    return () => clearTimeout(t);
  });
  $effect(() => {
    const now = () => flush?.();
    window.addEventListener("beforeunload", now);
    return () => {
      window.removeEventListener("beforeunload", now);
      now();
    };
  });

  // ---- reproducción
  $effect(() => player.setMaster(settings.masterVolume));
  $effect(() => {
    if (loading) return;
    const anySolo = Object.values(solo).some(Boolean);
    for (const t of tracks) player.setGain(t.name, (anySolo ? solo[t.name] : !muted[t.name]) ? (volume[t.name] ?? 1) : 0);
    player.setGain(CLICK, metro.on && beatData ? metro.volume : 0);
  });
  $effect(() => {
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
    return () => cancelAnimationFrame(raf);
  });
  function toggle() {
    if (!tracks.length) return;
    if (player.playing) player.pause();
    else player.play();
    playing = player.playing;
  }
  const seek = (t: number) => player.seek(t);

  // ---- metrónomo: pulsos de StemLab o del audio de Letras (CPU, sin separar)
  const beatData = $derived(detail?.beatData?.beats?.length ? detail.beatData : null);
  const beatsJob = $derived(jobOf(key, "beats"));
  // pulsos viejos (librosa, sin compases): se rehacen con Beat This! al usarlos (CPU, ~5 s)
  const beatsOld = $derived(!!beatData && !beatData.downbeats);
  $effect(() => {
    if ((metro.on || tab === "chords") && (!beatData || beatsOld) && detail?.audio && !beatsJob) void enqueue("beats", [key]);
  });
  const downbeats = $derived(beatData?.downbeats ?? []);
  const metroBeats = $derived.by(() => {
    const b = beatData?.beats ?? [];
    if (metro.factor === 0.5) return b.filter((_, i) => i % 2 === 0);
    if (metro.factor === 2) return b.flatMap((t, i) => (i + 1 < b.length ? [t, (t + b[i + 1]) / 2] : [t]));
    return b;
  });
  $effect(() => {
    if (loading || !beatData) return;
    const beats = metroBeats;
    const { meter, shift } = metro;
    const downs = downbeats;
    // con compases (Beat This!) el acento cae en el primer tiempo real; si no, cada `meter` pulsos
    const accent = downs.length
      ? (i: number) => downs.some((d) => Math.abs(d - beats[i]) < 0.06)
      : (i: number) => (((i - shift) % meter) + meter) % meter === 0;
    untrack(() => player.setClicks(beats, accent));
  });

  // ---- partitura de conjunto (sin IA; la letra de la voz sale de Letras)
  const scored = $derived(stems.filter((s) => s.score));
  const scoreShown = $derived(scored.filter((s) => !scoreHidden[s.name]));
  // la letra de la voz entra en la partitura: si cambia (o su desfase), se monta otra vez
  const lyricsSig = $derived(detail?.doc ? `${JSON.stringify(detail.doc.lines).length}:${detail.doc.offset ?? 0}:${detail.doc.word_offset ?? 0}` : "");
  const scoreKey = $derived(scoreShown.map((s) => `${s.name}@${s.version ?? 0}`).join(",") + (scoreShown.some((s) => s.name === "vocals") ? `#${lyricsSig}` : ""));
  $effect(() => {
    const k = scoreKey;
    const shown = untrack(() => scoreShown.map((s) => s.name));
    scorePath = null;
    scoreError = "";
    if (!shown.length || tab !== "score") return;
    run<{ path: string }>("ensemble", [untrack(() => key), ...shown])
      .then((r) => k === scoreKey && (scorePath = r.path))
      .catch((e) => (scoreError = String(e)));
  });
  const audible = (name: string) => (Object.values(solo).some(Boolean) ? solo[name] : !muted[name]);
  const rollTracks = $derived(
    stems
      .filter((s) => s.roll && audible(s.name))
      .map((s) => ({ stem: s.name, name: STEM_INFO[s.name].label, color: STEM_INFO[s.name].color, path: `${stemlab!.dir}/${s.roll}`, hidden: !!rollHidden[s.name] })),
  );

  // ---- acordes y tonalidad: de las notas ya sacadas (sin IA, milisegundos); solo si se miran
  let notation = $state(loadNotation());
  let noteTracks = $state<{ stem: string; notes: Note[] }[]>([]);
  let tracksSig = "";
  const noted = $derived(stems.filter((s) => s.roll));
  // de qué salen acordes y tonalidad: "mix" (toda la canción) o una pista con notas (lo que toca el piano…)
  let chordSrc = $state("mix");
  const src = $derived(noted.some((s) => s.name === chordSrc) ? chordSrc : "mix");
  // acordes del modelo (lv-chordia, del audio): mandan; los de las notas quedan de respaldo
  const modelHarmony = $derived.by<Harmony | null>(() => {
    const cs = detail?.chordData?.chords;
    return cs?.length ? fromModel(cs, noteTracks) : null; // revisados con las notas en cuanto se cargan
  });
  const chordsJob = $derived(jobOf(key, "chords"));
  $effect(() => {
    if ((tab === "chords" || tab === "roll") && !detail?.chordData && detail?.audio && !chordsJob) void enqueue("chords", [key]);
  });
  const notesSig = $derived(noted.map((s) => `${s.name}@${s.version ?? 0}`).join(","));
  $effect(() => {
    const sig = notesSig;
    if (!noted.length || (tab !== "chords" && tab !== "roll") || sig === tracksSig) return;
    tracksSig = sig;
    untrack(async () => {
      const dir = stemlab!.dir;
      const tracks = await Promise.all(noted.map(async (s) => ({ stem: s.name, notes: await readJson<Note[]>(`${dir}/${s.roll}`, []) })));
      if (sig === tracksSig) noteTracks = tracks;
    });
  });
  const harmony = $derived.by<Harmony | null>(() => {
    const ts = src === "mix" ? noteTracks : noteTracks.filter((t) => t.stem === src);
    return noted.length && ts.length ? analyze(ts, beatData?.beats ?? [], duration || detail?.duration || 0) : null;
  });
  const shownHarmony = $derived(src === "mix" ? (modelHarmony ?? harmony) : harmony);
  // en el piano roll, el grado junto al acorde (V7, vi…) siempre
  const rollChords = $derived(
    shownHarmony ? named(shownHarmony.chords, shownHarmony.key, notation).map((c) => ({ ...c, deg: degree(c, shownHarmony.key) })) : [],
  );
  const chordsBusy = $derived(chordsJob && chordsJob.status !== "error" ? jobText(chordsJob) : "");
  const notesBusy = $derived.by(() => {
    const j = stage(["notes", "separate"]);
    return j && j.status !== "error" ? jobText(j) : "";
  });

  // ---- etapas
  const busy = $derived(live(key));
  const stage = (actions: string[], arg?: string) => jobOf(key, actions, arg);
  const notesJob = (stem: string) => jobOf(key, "notes", stem);
  const pitched = $derived(stems.filter((s) => PITCHED.includes(s.name) && s.present));
  const missing = $derived(
    !!track && (!track.audio || track.lyrics?.status !== "words" || track.stems !== "complete" || track.notes.length < pitched.length || !pitched.length),
  );
  const isStemOnly = $derived(key.startsWith("stem:"));

  /** ["precise"] si las notas por defecto son las precisas (MuScriptor). */
  const quality = () => (settings.notes === "precise" ? ["precise"] : []);

  async function act(action: string, args: string[] = []) {
    menu = false;
    try {
      await enqueue(action, [key], args);
    } catch (e) {
      log(String(e));
    }
  }
  async function del(what: "audio" | "stems" | "all") {
    menu = false;
    const msg = {
      audio: "Se borran el audio y las cachés de IA de Letras (se pueden volver a sacar). La letra se queda.",
      stems: "Se borran las pistas separadas y sus partituras.",
      all: "Se borra todo: letra (y su historial), audio, pistas, partituras y edits. No se puede deshacer.",
    }[what];
    if (!confirm(msg)) return;
    player.stop();
    await run("delete", [key, what]);
    if (what === "all") ondeleted();
  }

  function onkey(e: KeyboardEvent) {
    const t = e.target as HTMLElement;
    const typing = t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !["range", "checkbox"].includes(t.type)) || t.isContentEditable;
    if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("[aria-modal='true']")) return;
    if (e.code === "Space") toggle();
    else if (e.key === "ArrowLeft") player.seek(time - 5);
    else if (e.key === "ArrowRight") player.seek(time + 5);
    else if (/^[1-6]$/.test(e.key)) tab = TABS[+e.key - 1][0];
    else if (e.key === "v" || e.key === "V") settings.showMini = !settings.showMini;
    else if (e.key === "m" || e.key === "M") metro.on = !metro.on;
    else if ((e.key === "e" || e.key === "E") && detail?.doc) ((tab = "letra"), (editing = !editing));
    else return;
    e.preventDefault();
  }

  const lyricLabel = $derived.by(() => {
    const l = track?.lyrics;
    if (!l) return isStemOnly ? "Sin artista ni título" : "Sin letra";
    const src = (SOURCE_LABEL[l.source ?? ""] ?? l.source ?? "") + (l.times_from ? ` + ${SOURCE_LABEL[l.times_from] ?? l.times_from}` : "");
    const how = { words: l.synced_by === "ia" ? (l.ai_mode === "lineas" ? "IA rápida" : "IA palabra a palabra") : "palabra a palabra", lines: "por líneas", plain: "sin tiempos", instrumental: "instrumental", empty: "vacía" }[l.status];
    return `${how}${src ? ` · ${src}` : ""}`;
  });
</script>

<svelte:window onkeydown={onkey} />

{#snippet controls()}
  {#if settings.showMini && !loading && stemlab}<MiniMixer stems={stems} bind:volume bind:muted bind:solo />{/if}
  <Transport {playing} {time} {duration} bind:volume={settings.masterVolume} disabled={loading || !tracks.length} ontoggle={toggle} onseek={seek}>
    {#if stemlab}
      <button class="ghost mix-toggle" class:active={settings.showMini} onclick={() => (settings.showMini = !settings.showMini)} title="Volumen de cada instrumento (V)">Pistas</button>
    {/if}
    <button class="ghost mix-toggle" class:active={metro.on} onclick={() => (metro.on = !metro.on)} title="Metrónomo (M)">
      {metro.on && !beatData ? "…" : "♩"} {beatData ? Math.round(beatData.bpm * metro.factor) : ""}
    </button>
  </Transport>
{/snippet}

{#snippet stageCard(name: string, state: string, led: string, job: ReturnType<typeof stage>, button?: { label: string; run: () => void; title?: string; primary?: boolean }, go?: Tab)}
  {@const active = job && job.status !== "error"}
  <div class="stage" class:active>
    <button class="stage-top" onclick={() => go && (tab = go)} disabled={!go}>
      <span class="kicker">{name}</span>
      <i class="led {active ? 'busy' : led}"></i>
    </button>
    {#if active}
      <span class="stage-state">{jobText(job)}</span>
      <div class="bar" class:indet={job.pct == null || job.status !== "running"}><i style:width="{job.pct ?? 0}%"></i></div>
    {:else}
      <span class="stage-state" class:err={job?.status === "error"} title={job?.status === "error" ? job.error : state}>{job?.status === "error" ? `Falló: ${job.error}` : state}</span>
      {#if button}
        <button class="stage-btn" class:primary-lite={button.primary} onclick={button.run} title={button.title}>{button.label}</button>
      {/if}
    {/if}
  </div>
{/snippet}

<div class="view">
  {#if detailError && !detail}
    <p class="error-text">{detailError}</p>
  {:else if track}
    <header class="hero">
      <div class="who">
        <span class="kicker">{track.artist || "Sin artista"}</span>
        <h1>{track.title || key}</h1>
        <p class="meta">
          {#if duration}<span class="mono">{fmtClock(duration)}</span>{/if}
          {#if track.bpm}<span class="mono">{track.bpm} BPM</span>{/if}
          <span>{lyricLabel}</span>
          <Leds {track} size="lg" />
        </p>
      </div>
      <div class="hero-actions">
        {#if missing}
          <button class="primary" onclick={() => act("todo", quality())} title="Pistas, letra palabra a palabra y notas de cada instrumento. Lo hecho no se repite.">Hacer todo</button>
        {/if}
        <div class="menu-wrap">
          <button class="ghost" onclick={() => (menu = !menu)} aria-label="Más">⋯</button>
          {#if menu}
            <div class="menu">
              {#if stemlab}<button onclick={() => ((menu = false), openPath(stemlab.dir))}>Abrir carpeta de pistas</button>{/if}
              <button onclick={() => act("beats")}>Volver a sacar los pulsos</button>
              <hr />
              {#if track.audio && !isStemOnly}<button onclick={() => del("audio")}>Borrar audio en caché</button>{/if}
              {#if track.stems}<button onclick={() => del("stems")}>Borrar pistas y partituras</button>{/if}
              <button class="danger" onclick={() => del("all")}>Borrar la canción…</button>
            </div>
          {/if}
        </div>
      </div>
    </header>

    <section class="stages">
      {@render stageCard("Audio", track.audio ? (stemlab ? "Mezcla de StemLab" : "WAV en caché") : "Sin audio", track.audio ? "on" : "off", stage(["audio", "import"]),
        track.audio || isStemOnly ? undefined : { label: "Descargar", run: () => act("audio"), title: "Primer resultado de YouTube con ese título y duración" })}
      {@render stageCard("Letra", lyricLabel, track.lyrics?.status === "words" ? (track.lyrics.doubts && !track.lyrics.edited ? "half" : "on") : track.lyrics ? "half" : "off", stage(["letra", "find", "sync"]),
        isStemOnly ? { label: "Ponerle nombre", run: () => (tab = "letra") }
        : !track.lyrics ? { label: "Buscar y sincronizar", run: () => act("letra"), primary: true }
        : track.lyrics.status !== "words" && track.lyrics.status !== "instrumental" ? { label: "Palabra a palabra", run: () => act("sync"), primary: true }
        : { label: "Editar", run: () => ((tab = "letra"), (editing = true)) }, "letra")}
      {@render stageCard("Pistas", track.stems === "complete" ? `${track.present.length} de 6 con sonido` : track.stems ? "Separación a medias" : "Sin separar", track.stems === "complete" ? "on" : track.stems ? "bad" : "off", stage(["separate"]),
        track.stems === "complete" ? undefined : { label: track.stems ? "Rehacer" : "Separar", run: () => act("separate"), primary: true, title: "BS-RoFormer (voz) + BS-Roformer-SW (6 pistas), en GPU" }, "mix")}
      {@render stageCard("Notas", track.notes.length ? `${track.notes.length} de ${pitched.length || "?"} instrumentos` : "Sin partitura", !track.notes.length ? "off" : track.notes.length >= pitched.length ? "on" : "half", stage(["notes"]),
        track.notes.length >= pitched.length && pitched.length ? undefined : { label: track.notes.length ? "Sacar el resto" : "Sacar notas", run: () => act("notes-all", quality()), title: "basic-pitch en CPU; la voz lleva la letra de Letras" }, "score")}
      {@render stageCard("Edits", track.edits ? `${track.edits} ${track.edits > 1 ? "edits" : "edit"}` : "Ninguno", track.edits ? "on" : "off", stage(["render"]),
        { label: "Nuevo edit", run: () => (tab = "edits") }, "edits")}
    </section>

    <nav class="tabs">
      {#each TABS as [id, label], i (id)}
        <button class:on={tab === id} onclick={() => (tab = id)} title="Atajo: {i + 1}">{label}</button>
      {/each}
      <span class="keys"><kbd>Espacio</kbd> reproducir <kbd>◂ ▸</kbd> 5 s <kbd>1-6</kbd> pestañas <kbd>E</kbd> editar letra <kbd>M</kbd> metrónomo <kbd>Q</kbd> cola</span>
    </nav>

    <div class="content" class:fill={tab !== "mix" && tab !== "edits"}>
      {#if tab === "letra"}
        {#if detail}
          <LyricsTab {detail} {time} {playing} bind:editing onseek={seek} ontoggle={toggle} {onrenamed} />
        {/if}
      {:else if tab === "mix"}
        {#if loadError}
          <p class="error-text">No se pudo cargar el audio: {loadError}</p>
        {:else if !tracks.length}
          <div class="empty">
            <h2>Sin audio todavía</h2>
            <p>Se descarga de YouTube (primer resultado con ese título y duración) o importa tu fichero desde «Añadir».</p>
            {#if !isStemOnly}<button class="primary" onclick={() => act("audio")}>Descargar audio</button>{/if}
          </div>
        {:else}
          {#if !stemlab}
            {@const job = stage(["separate"])}
            <div class="cta" class:warn={track.stems === "partial"}>
              <div>
                <strong>{track.stems === "partial" ? "La separación se quedó a medias" : "Separa voz, batería, bajo, guitarra, piano y el resto"}</strong>
                <p>
                  {track.stems === "partial"
                    ? "Se cortó antes de acabar. Se rehace de cero en una carpeta aparte: nada a medias vuelve a usarse."
                    : `Calidad completa de StemLab. ${track.vocals === "letras" ? "Su voz sustituirá a la rápida que usó Letras." : "Letras usará esta voz en vez de separar la suya."}`}
                </p>
              </div>
              {#if job && job.status !== "error"}
                <div class="cta-job"><span>{jobText(job)}</span><div class="bar" class:indet={job.pct == null}><i style:width="{job.pct ?? 0}%"></i></div></div>
              {:else}
                <button class="primary" onclick={() => act("separate")}>{track.stems === "partial" ? "Rehacer" : "Separar pistas"}</button>
              {/if}
            </div>
          {/if}
          {#if loading}
            <div class="loading"><span class="spinner"></span> Cargando audio…</div>
          {:else}
            <section class="lanes">
              {#each tracks as st (st.name)}
                {@const info = STEM_INFO[st.name] ?? { label: st.name, color: "#aaa" }}
                {@const buf = player.buffers.get(st.name)}
                {@const meta = stems.find((s) => s.name === st.name)}
                {@const nj = notesJob(st.name)}
                <div class="lane" class:absent={!st.present} style:--c={info.color}>
                  <div class="head">
                    <span class="dot"></span>
                    <div class="name">
                      <strong>{info.label}</strong>
                      <small>{meta ? (st.present ? `${meta.level} dB` : "no suena") : "sin separar"}</small>
                    </div>
                    <div class="ms">
                      <button class:on={muted[st.name]} onclick={() => (muted[st.name] = !muted[st.name])} title="Silenciar">M</button>
                      <button class:on={solo[st.name]} class="solo" onclick={() => (solo[st.name] = !solo[st.name])} title="Solo">S</button>
                    </div>
                    <input type="range" min="0" max="1.5" step="0.01" bind:value={volume[st.name]} title="Volumen" />
                    {#if meta && PITCHED.includes(st.name) && st.present}
                      {#if nj && nj.status !== "error"}
                        <span class="notes busy">{jobText(nj)}</span>
                      {:else}
                        <div class="notes-row">
                          <button class="notes" class:done={!!meta.score} onclick={() => act("notes", [st.name, ...quality()])} title={nj?.error}>
                            {nj?.status === "error" ? "Reintentar notas" : meta.score ? `↻ ${meta.notes ?? ""} notas` : `♪ Sacar notas${st.name === "vocals" ? " y letra" : ""}`}
                          </button>
                          {#if meta.score && (meta as { model?: string }).model !== "muscriptor"}
                            <button class="notes precise" onclick={() => act("notes", [st.name, "precise"])} title="Otra vez con MuScriptor (GPU, mucho más lento y más preciso)">Precisas</button>
                          {:else if meta.score}
                            <span class="model" title="Transcritas con MuScriptor">precisas</span>
                          {/if}
                        </div>
                      {/if}
                    {/if}
                  </div>
                  <div class="track"><div class="inner">
                    {#if buf}<Waveform buffer={buf} color={info.color} dim={!st.present || muted[st.name]} onseek={(f) => seek(f * duration)} />{/if}
                    <div class="playhead" style:left="{(time / (duration || 1)) * 100}%"></div>
                  </div></div>
                </div>
              {/each}
            </section>
            {#if metro.on || beatData}
              <section class="metro" class:on={metro.on}>
                <strong>Metrónomo</strong>
                <small>{beatData ? `${Math.round(beatData.bpm * metro.factor)} BPM · sigue los pulsos reales` : "Sacando pulsos…"}</small>
                <input type="range" min="0" max="1.5" step="0.01" bind:value={metro.volume} title="Volumen del metrónomo" />
                <div class="seg">
                  {#each [[0.5, "×½"], [1, "×1"], [2, "×2"]] as [f, label] (f)}
                    <button class:on={metro.factor === f} onclick={() => (metro.factor = +f)}>{label}</button>
                  {/each}
                </div>
                {#if downbeats.length}
                  <small>{beatData?.meter ?? 4} pulsos por compás · acento en el 1 real</small>
                {:else}
                  <div class="seg">
                    {#each [3, 4] as m (m)}
                      <button class:on={metro.meter === m} onclick={() => ((metro.meter = m), (metro.shift %= m))}>{m}/4</button>
                    {/each}
                  </div>
                  <button class="ghost" onclick={() => (metro.shift = (metro.shift + 1) % metro.meter)} title="Mueve el clic fuerte un pulso para que caiga en el 1">Mover acento</button>
                {/if}
                <button class="ghost" onclick={() => (metro.on = !metro.on)}>{metro.on ? "Apagar" : "Encender"}</button>
              </section>
            {/if}
          {/if}
        {/if}
      {:else if tab === "roll" || tab === "score"}
        {#if !stemlab || !(tab === "roll" ? stems.some((s) => s.roll) : scored.length)}
          <div class="empty">
            <h2>{tab === "roll" ? "El piano roll necesita notas" : "Aún no hay partitura"}</h2>
            <p>
              {stemlab
                ? "Saca las notas de cada instrumento (CPU, en paralelo con la GPU). La voz lleva la letra de Letras, palabra a palabra."
                : "Primero se separan las pistas; luego las notas de cada instrumento. Todo seguido, sin hacer nada más:"}
            </p>
            {#if stage(["notes", "separate"]) && stage(["notes", "separate"])?.status !== "error"}
              <p class="muted">{jobText(stage(["notes", "separate"])!)}</p>
            {:else}
              <button class="primary" onclick={() => act("notes-all", quality())}>Sacar todas las notas</button>
            {/if}
          </div>
        {:else if tab === "roll"}
          <Roll {player} tracks={rollTracks} {controls} bind:windowSec={settings.rollSpeed} ontoggle={(s) => (rollHidden[s] = !rollHidden[s])}
            chords={rollChords} keyLabel={shownHarmony ? keyName(shownHarmony.key, notation.latin) : ""} />
        {:else}
          <div class="picker">
            {#each scored as st (st.name)}
              <button class="chip" class:off={scoreHidden[st.name]} style:--c={STEM_INFO[st.name].color} onclick={() => (scoreHidden[st.name] = !scoreHidden[st.name])}>
                <span class="dot"></span>{STEM_INFO[st.name].label}
              </button>
            {/each}
            {#each pitched.filter((s) => !s.score) as st (st.name)}
              {@const nj = notesJob(st.name)}
              <button class="chip add" disabled={!!nj && nj.status !== "error"} onclick={() => act("notes", [st.name, ...quality()])}>
                {nj && nj.status !== "error" ? `${STEM_INFO[st.name].label}: ${jobText(nj)}` : `＋ ${STEM_INFO[st.name].label}`}
              </button>
            {/each}
            <div class="seg quality" title="Cómo se sacan las notas que pidas a partir de ahora">
              <button class:on={settings.notes === "fast"} onclick={() => (settings.notes = "fast")} title="basic-pitch: CPU, segundos">Notas rápidas</button>
              <button class:on={settings.notes === "precise"} onclick={() => (settings.notes = "precise")} title="MuScriptor: GPU, minutos por pista, mucho más preciso">Precisas</button>
            </div>
          </div>
          {#if !scoreShown.length}
            <div class="empty"><p>Todos los instrumentos están ocultos.</p></div>
          {:else if scoreError}
            <p class="error-text">{scoreError}</p>
          {:else if !scorePath}
            <div class="loading"><span class="spinner"></span> Montando la partitura…</div>
          {:else}
            {#key `${scorePath}:${scoreKey}`}
              <!-- OpenSheetMusicDisplay pesa ~1 MB: solo se carga al abrir la partitura -->
              {#await import("./Score.svelte") then { default: Score }}
                <Score song={stemlab} stems={scoreShown} path={scorePath} {player} {controls} bind:follow={settings.scoreFollow} />
              {/await}
            {/key}
          {/if}
        {/if}
      {:else if tab === "chords"}
        {#if detail}
          <ChordsTab {detail} harmony={shownHarmony} model={src === "mix" && !!modelHarmony} sources={noted.map((s) => STEM_INFO[s.name].label)} {time} bind:notation
            {src} onsrc={(s) => (chordSrc = s)} instruments={pitched.map((s) => ({ name: s.name, label: STEM_INFO[s.name].label, notes: !!s.roll, job: notesJob(s.name) && notesJob(s.name)!.status !== "error" ? jobText(notesJob(s.name)!) : "" }))}
            onstemnotes={(s) => act("notes", [s, ...quality()])} onseek={seek} onnotes={() => act("notes-all", quality())} oncheck={() => act("sync", ["lineas"])} busy={chordsBusy || notesBusy} />
        {/if}
      {:else if tab === "edits"}
        <EditsTab {track} {detail} />
      {/if}
    </div>

    <footer class="transport-bar">{@render controls()}</footer>
  {/if}
</div>

<style>
  .view { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .hero { display: flex; justify-content: space-between; align-items: flex-end; gap: 20px; flex-shrink: 0; animation: rise 0.4s var(--ease); }
  .who { min-width: 0; }
  h1 {
    margin: 2px 0 6px; font-family: var(--serif); font-weight: 400; font-size: clamp(38px, 5vw, 64px); line-height: 0.95;
    letter-spacing: -0.015em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .meta { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 0; color: var(--text-2); font-size: 13px; }
  .meta .mono { color: var(--text); }
  .hero-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }
  .menu-wrap { position: relative; }
  .menu {
    position: absolute; top: calc(100% + 6px); right: 0; min-width: 240px; padding: 6px; border-radius: 12px; z-index: 20;
    background: var(--panel-hi); border: 1px solid var(--line-hi); box-shadow: 0 20px 50px -10px #000c; animation: rise 0.2s var(--ease);
  }
  .menu button { display: block; width: 100%; text-align: left; padding: 7px 10px; border: 0; border-radius: 8px; background: none; color: var(--text-2); }
  .menu button:hover { background: var(--panel); color: var(--text); }
  .menu .danger { color: var(--bad); }
  .menu hr { border: 0; border-top: 1px solid var(--line); margin: 5px 4px; }

  .stages { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin: 20px 0 6px; flex-shrink: 0; }
  .stage {
    display: flex; flex-direction: column; gap: 6px; padding: 10px 12px 12px; min-height: 92px; border-radius: 12px;
    background: var(--panel); border: 1px solid var(--line); animation: rise 0.45s var(--ease) both;
  }
  .stage:nth-child(2) { animation-delay: 40ms; } .stage:nth-child(3) { animation-delay: 80ms; } .stage:nth-child(4) { animation-delay: 120ms; } .stage:nth-child(5) { animation-delay: 160ms; }
  .stage.active { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 7%, var(--panel)), var(--panel)); }
  .stage-top { display: flex; justify-content: space-between; align-items: center; border: 0; background: none; padding: 0; text-align: left; }
  .stage-top:hover:not(:disabled) .kicker { color: var(--text-2); }
  .led { width: 22px; height: 5px; border-radius: 3px; background: #2b2420; }
  .led.on { background: var(--accent); box-shadow: 0 0 10px -1px var(--accent); }
  .led.half { background: linear-gradient(90deg, var(--accent) 50%, #4a3a2c 50%); }
  .led.bad { background: var(--bad); }
  .led.busy { background: var(--accent); animation: pulse 1.1s ease-in-out infinite; }
  .stage-state { font-size: 12.5px; color: var(--text-2); line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .stage-state.err { color: var(--bad); }
  .stage-btn {
    margin-top: auto; align-self: flex-start; padding: 4px 10px; border-radius: 7px; font-size: 12px;
    border: 1px solid var(--line-hi); background: transparent; color: var(--text); transition: all 0.15s;
  }
  .stage-btn:hover { border-color: var(--accent); color: var(--accent); }
  .stage-btn.primary-lite { border-color: color-mix(in srgb, var(--accent) 55%, transparent); color: var(--accent); }
  .stage-btn.primary-lite:hover { background: var(--accent); color: #1c0f05; }
  .stage .bar { margin-top: auto; }

  .tabs { display: flex; align-items: center; gap: 2px; margin: 14px 0 14px; border-bottom: 1px solid var(--line); flex-shrink: 0; }
  .tabs button { padding: 10px 14px; margin-bottom: -1px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--text-2); font-size: 14px; transition: color 0.15s; }
  .tabs button:hover { color: var(--text); }
  .tabs button.on { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
  .keys { margin-left: auto; display: flex; align-items: center; gap: 4px; color: var(--text-3); font-size: 11px; white-space: nowrap; overflow: hidden; }
  .keys kbd { margin-left: 6px; }

  .content { flex: 1; min-height: 0; overflow-y: auto; }
  .content.fill { display: flex; flex-direction: column; overflow: hidden; }
  .transport-bar { flex-shrink: 0; padding-top: 12px; }
  .mix-toggle { padding: 6px 12px; flex-shrink: 0; }

  .empty { margin: auto; text-align: center; max-width: 520px; padding: 40px 0; animation: rise 0.35s var(--ease); }
  .empty h2 { margin: 0 0 8px; font-family: var(--serif); font-weight: 400; font-size: 34px; }
  .empty p { color: var(--text-2); margin: 0 0 18px; }
  .loading { display: flex; align-items: center; gap: 12px; color: var(--text-2); padding: 40px 0; }

  .cta {
    display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 16px 18px; margin-bottom: 10px; border-radius: 14px;
    border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--line));
    background: radial-gradient(600px 120px at 0% 0%, color-mix(in srgb, var(--accent) 12%, transparent), transparent), var(--panel);
  }
  .cta.warn { border-color: color-mix(in srgb, var(--bad) 45%, var(--line)); }
  .cta strong { font-size: 15px; }
  .cta p { margin: 4px 0 0; color: var(--text-2); font-size: 13px; max-width: 620px; }
  .cta-job { min-width: 220px; display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--text-2); }

  .lanes { display: flex; flex-direction: column; gap: 8px; }
  .lane {
    display: grid; grid-template-columns: 250px 1fr; align-items: center; background: var(--panel); border: 1px solid var(--line);
    border-radius: 12px; overflow: hidden; transition: opacity 0.2s; animation: rise 0.35s var(--ease) both;
  }
  .lane.absent { opacity: 0.5; }
  .head { display: grid; grid-template-columns: auto 1fr auto; gap: 6px 10px; align-items: center; padding: 10px 14px; border-right: 1px solid var(--line); }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--c); box-shadow: 0 0 10px var(--c); flex-shrink: 0; }
  .name { display: flex; flex-direction: column; line-height: 1.2; }
  .name small { color: var(--text-3); font-size: 11px; font-family: var(--mono); }
  .ms { display: flex; gap: 4px; }
  .ms button { width: 26px; height: 24px; border-radius: 6px; border: 1px solid var(--line); background: transparent; color: var(--text-2); font-size: 11px; font-weight: 700; }
  .ms button.on { background: var(--accent-2); border-color: var(--accent-2); color: white; }
  .ms button.solo.on { background: #f5c542; border-color: #f5c542; color: #1a1a1a; }
  .head input { grid-column: 1 / -1; width: 100%; accent-color: var(--c); }
  .notes { grid-column: 1 / -1; padding: 5px 8px; border-radius: 7px; border: 1px solid var(--line); background: transparent; color: var(--text-2); font-size: 12px; text-align: center; }
  .notes:hover { color: var(--text); border-color: var(--c); }
  .notes.done { color: var(--text-3); }
  .notes-row { grid-column: 1 / -1; display: flex; gap: 4px; }
  .notes-row .notes { flex: 1; grid-column: auto; }
  .notes.precise { flex: 0 0 auto; color: var(--accent); }
  .model { align-self: center; font-size: 11px; color: var(--accent); padding: 0 4px; }
  .notes.busy { color: var(--accent); border-style: dashed; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .track { padding: 6px 12px; }
  .inner { position: relative; }
  .playhead { position: absolute; top: 0; bottom: 0; width: 2px; background: var(--text); opacity: 0.85; pointer-events: none; box-shadow: 0 0 8px var(--accent); }

  .metro { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-top: 10px; padding: 10px 14px; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; }
  .metro.on { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
  .metro small { color: var(--text-3); }
  .metro input { width: 110px; }
  .metro .ghost { padding: 4px 10px; font-size: 12px; }
  .seg { display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .seg button { padding: 4px 9px; border: 0; background: transparent; color: var(--text-2); font-size: 12px; }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button.on { background: var(--panel-hi); color: var(--text); font-weight: 600; }

  .picker { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; flex-shrink: 0; align-items: center; }
  .picker .quality { margin-left: auto; }
  .chip { display: flex; align-items: center; gap: 7px; padding: 5px 12px; border-radius: 99px; border: 1px solid var(--c); background: color-mix(in srgb, var(--c) 15%, transparent); color: var(--text); font-size: 13px; }
  .chip.off { opacity: 0.45; text-decoration: line-through; background: transparent; border-color: var(--line); }
  .chip.add { --c: var(--line-hi); background: transparent; color: var(--text-2); border-style: dashed; }
  .chip.add:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }

  @media (max-width: 1200px) {
    .stages { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .keys { display: none; }
  }
</style>
