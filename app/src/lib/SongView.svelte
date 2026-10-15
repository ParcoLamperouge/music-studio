<script lang="ts">
  import { openPath } from "@tauri-apps/plugin-opener";
  import { untrack } from "svelte";
  import ChordsTab, { loadNotation } from "./ChordsTab.svelte";
  import { attachDeck, deck } from "./deck.svelte";
  import EditsTab from "./EditsTab.svelte";
  import { enqueue, fmtClock, log, PITCHED, readJson, run, songDetail, SOURCE_LABEL, STEM_INFO, viewPath, writeJson, type Detail, type Job, type Track } from "./engine";
  import { analyze, degree, fromModel, keyName, named, type Harmony, type Note } from "./harmony";
  import { ledOf, type Led } from "./Leds.svelte";
  import LyricsTab from "./LyricsTab.svelte";
  import MiniMixer from "./MiniMixer.svelte";
  import { waves, wantPeaks } from "./peaks.svelte";
  import { CLICK, peaks, Player } from "./player";
  import { takeSeek } from "./progindex";
  import Roll from "./Roll.svelte";
  import { settings } from "./settings.svelte";
  import { jobOf, jobText, live, store, type Stage } from "./store.svelte";
  import Transport from "./Transport.svelte";
  import Button from "./ui/Button.svelte";
  import Chip from "./ui/Chip.svelte";
  import EmptyState from "./ui/EmptyState.svelte";
  import Icon, { type IconName } from "./ui/Icon.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import Kbd from "./ui/Kbd.svelte";
  import MasterStrip from "./ui/MasterStrip.svelte";
  import Menu, { type MenuItem } from "./ui/Menu.svelte";
  import { sectionsFromLyrics, stemColor } from "./ui/music";
  import MuteSolo from "./ui/MuteSolo.svelte";
  import PlayButton from "./ui/PlayButton.svelte";
  import Popover from "./ui/Popover.svelte";
  import ProgressRing from "./ui/ProgressRing.svelte";
  import Slider from "./ui/Slider.svelte";
  import StemBadge from "./ui/StemBadge.svelte";
  import Tabs from "./ui/Tabs.svelte";
  import Toggle from "./ui/Toggle.svelte";
  import WaveThumb from "./ui/WaveThumb.svelte";

  // Página de una canción: cabecera (título, tonalidad, bpm, etapas del análisis y acciones), la tira de la canción
  // siempre arriba (secciones, acordes, energía; pulsar salta, Mayús+arrastrar hace bucle) y debajo las vistas.
  let { key, initialTab, active = true, onrenamed, ondeleted, onopen, onsing }: {
    key: string;
    active?: boolean; // false: sigue cargada (suena en el mini-reproductor) pero no se ve ni atiende al teclado
    initialTab?: string;
    onrenamed: (key: string) => void;
    ondeleted: () => void;
    onopen: (key: string) => void;
    onsing?: () => void; // Cantar sobre la canción (hace falta la voz con notas)
  } = $props();

  type Tab = "mix" | "letra" | "chords" | "score" | "edits";
  const TABS: { value: Tab; label: string; icon: IconName }[] = [
    { value: "mix", label: "Pistas", icon: "stems" },
    { value: "letra", label: "Letra", icon: "lyrics" },
    { value: "chords", label: "Acordes", icon: "chords" },
    { value: "score", label: "Partitura", icon: "score" },
    { value: "edits", label: "Edits", icon: "edits" },
  ];
  /** Pestañas de antes (y de los enlaces): el piano roll vive ahora en cada pista. */
  const tabOf = (t?: string): Tab | null => (t === "roll" ? "mix" : TABS.some((x) => x.value === t) ? (t as Tab) : null);

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
  let tab = $state<Tab>(tabOf(initialTab) ?? "mix");
  let scoreHidden = $state<Record<string, boolean>>({});
  let roll = $state<Record<string, boolean>>({}); // piano roll encendido en esa pista
  let scorePath = $state<string | null>(null);
  let scoreError = $state("");
  let editing = $state(false);
  let loop = $state<{ a: number; b: number } | null>(null);
  let lanePeaks = $state.raw<Record<string, number[]>>({});

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
  $effect(() => {
    if (track) untrack(() => wantPeaks(key, track.audio || !!track.stems));
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
      // onda de cada pista (0-1), para su carril
      const lp: Record<string, number[]> = {};
      for (const [name, buf] of player.buffers) {
        const p = Array.from(peaks(buf, 360));
        const max = Math.max(...p, 1e-6);
        lp[name] = p.map((v) => v / max);
      }
      lanePeaks = lp;
      if (at) player.seek(at);
      const jump = takeSeek(key);
      if (jump != null) player.seek(jump);
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
      const view = await readJson(viewPath(key), { volume: {}, muted: {}, solo: {}, roll: {}, scoreHidden: {}, tab: "", metro: $state.snapshot(metro) });
      Object.assign(volume, view.volume);
      Object.assign(muted, view.muted);
      Object.assign(solo, view.solo);
      Object.assign(roll, view.roll);
      Object.assign(scoreHidden, view.scoreHidden);
      if (!initialTab && tabOf(view.tab)) tab = tabOf(view.tab)!;
      if (initialTab === "roll" || (!initialTab && view.tab === "roll")) for (const s of stems) roll[s.name] = !!s.roll;
      Object.assign(metro, view.metro, { on: false });
      restored = true;
    });
  });
  let flush: (() => void) | null = null;
  $effect(() => {
    if (!restored) return;
    const view = $state.snapshot({ volume, muted, solo, roll, scoreHidden, tab, metro });
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
  const anySolo = $derived(Object.values(solo).some(Boolean));
  const audible = (name: string) => (anySolo ? solo[name] : !muted[name]);
  $effect(() => {
    if (loading) return;
    for (const t of tracks) player.setGain(t.name, audible(t.name) ? (volume[t.name] ?? 1) : 0);
    player.setGain(CLICK, metro.on && beatData ? metro.volume : 0);
  });
  $effect(() => {
    let raf = 0;
    const tick = () => {
      time = player.time();
      if (player.playing && loop && time >= loop.b) player.seek((time = loop.a));
      else if (player.playing && time >= duration) {
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
  const seek = (t: number) => player.seek(Math.max(0, Math.min(t, duration)));
  // el mini-reproductor de abajo la controla aunque se esté en otra vista
  $effect(() => attachDeck(untrack(() => key), { toggle, seek }));
  $effect(() => void Object.assign(deck, { playing, time, duration: loading || !tracks.length ? 0 : duration })); // duration > 0: audio listo

  // ---- tira de la canción: secciones (de la letra), energía y bucle
  const total = $derived(duration || detail?.duration || 0); // antes de cargar el audio, la de la ficha
  const sections = $derived(detail?.doc ? sectionsFromLyrics(detail.doc.lines, total, detail.doc.offset ?? 0) : []);
  /** Bucle de la sección que suena (o de 8 s si no hay secciones); otra vez lo quita. */
  function toggleLoop() {
    if (loop) return void (loop = null);
    const s = sections.find((x) => x.t <= time && time < x.end);
    loop = s ? { a: s.t, b: s.end } : { a: time, b: Math.min(duration, time + 8) };
  }

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

  // ---- piano roll: el de las pistas con notas que tengas encendidas
  const rollTracks = $derived(
    stems
      .filter((s) => s.roll && audible(s.name))
      .map((s) => ({ stem: s.name, name: STEM_INFO[s.name].label, color: STEM_INFO[s.name].color, path: `${stemlab!.dir}/${s.roll}`, hidden: !roll[s.name] })),
  );
  const rollShown = $derived(tab === "mix" && rollTracks.some((t) => !t.hidden));
  function toggleAllRolls() {
    const on = !stems.some((s) => s.roll && roll[s.name]);
    for (const s of stems) if (s.roll) roll[s.name] = on;
  }

  // ---- acordes y tonalidad: de las notas ya sacadas (sin IA, milisegundos); solo si se miran
  let notation = $state(loadNotation());
  let noteTracks = $state<{ stem: string; notes: Note[] }[]>([]);
  let tracksSig = "";
  const noted = $derived(stems.filter((s) => s.roll));
  // de qué salen acordes y tonalidad: "mix" (toda la canción) o una pista con notas (lo que toca el piano…)
  let chordSrc = $state("mix");
  const src = $derived(noted.some((s) => s.name === chordSrc) ? chordSrc : "mix");
  const wantChords = $derived(tab === "chords" || rollShown);
  // acordes del modelo (lv-chordia, del audio): mandan; los de las notas quedan de respaldo
  const modelHarmony = $derived.by<Harmony | null>(() => {
    const cs = detail?.chordData?.chords;
    return cs?.length ? fromModel(cs, noteTracks, detail?.beatData?.beats ?? [], detail?.duration ?? 0) : null; // revisados con las notas en cuanto se cargan
  });
  const chordsJob = $derived(jobOf(key, "chords"));
  $effect(() => {
    if (wantChords && !detail?.chordData && detail?.audio && !chordsJob) void enqueue("chords", [key]);
  });
  const notesSig = $derived(noted.map((s) => `${s.name}@${s.version ?? 0}`).join(","));
  $effect(() => {
    const sig = notesSig;
    if (!noted.length || !wantChords || sig === tracksSig) return;
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
  // en la tira y en el piano roll, con el grado al lado (V7, vi…)
  const namedChords = $derived(
    shownHarmony ? named(shownHarmony.chords, shownHarmony.key, notation).map((c) => ({ ...c, deg: degree(c, shownHarmony.key) })) : [],
  );
  const keyLabel = $derived(shownHarmony ? keyName(shownHarmony.key, notation.latin) : "");
  const chordsBusy = $derived(chordsJob && chordsJob.status !== "error" ? jobText(chordsJob) : "");
  const notesBusy = $derived.by(() => {
    const j = stage(["notes", "separate"]);
    return j && j.status !== "error" ? jobText(j) : "";
  });

  // ---- etapas
  const busy = $derived(live(key));
  const stage = (actions: string[], arg?: string) => jobOf(key, actions, arg);
  const notesJob = (stem: string) => jobOf(key, "notes", stem);
  const working = (j: Job | undefined) => (j && j.status !== "error" ? j : undefined);
  const pitched = $derived(stems.filter((s) => PITCHED.includes(s.name) && s.present));
  const missing = $derived(
    !!track && (!track.audio || track.lyrics?.status !== "words" || track.stems !== "complete" || track.notes.length < pitched.length || !pitched.length),
  );
  const isStemOnly = $derived(key.startsWith("stem:"));

  /** ["precise"] si las notas por defecto son las precisas (MuScriptor). */
  const quality = () => (settings.notes === "precise" ? ["precise"] : []);

  async function act(action: string, args: string[] = []) {
    try {
      await enqueue(action, [key], args);
    } catch (e) {
      log(String(e));
    }
  }
  async function del(what: "audio" | "stems" | "all") {
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
    if (!active || typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector("[aria-modal='true'], dialog[open]")) return;
    const k = e.key.toLowerCase();
    if (e.code === "Space") toggle();
    else if (e.key === "ArrowLeft") seek(time - 5);
    else if (e.key === "ArrowRight") seek(time + 5);
    else if (/^[1-5]$/.test(e.key)) tab = TABS[+e.key - 1].value;
    else if (k === "v") settings.showMini = !settings.showMini;
    else if (k === "m") metro.on = !metro.on;
    else if (k === "l") toggleLoop();
    else if (k === "r" && noted.length) ((tab = "mix"), toggleAllRolls());
    else if (k === "e" && detail?.doc) ((tab = "letra"), (editing = !editing));
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

  type Step = { stage: Stage; name: string; icon: IconName; state: string; job?: Job; action?: { label: string; run: () => void; title?: string }; go?: Tab };
  const steps = $derived.by<Step[]>(() => {
    const t = track;
    if (!t) return [];
    return [
      {
        stage: "audio", name: "Audio", icon: "audio", go: "mix", job: stage(["audio", "import"]),
        state: t.audio ? (stemlab ? "Mezcla de StemLab" : "WAV en caché") : "Sin audio",
        action: t.audio || isStemOnly ? undefined : { label: "Descargar", run: () => act("audio"), title: "Primer resultado de YouTube con ese título y duración" },
      },
      {
        stage: "letra", name: "Letra", icon: "lyrics", go: "letra", job: stage(["letra", "find", "sync"]), state: lyricLabel,
        action: isStemOnly ? { label: "Ponerle nombre", run: () => (tab = "letra") }
          : !t.lyrics ? { label: "Buscar y sincronizar", run: () => act("letra") }
          : t.lyrics.status !== "words" && t.lyrics.status !== "instrumental" ? { label: "Palabra a palabra", run: () => act("sync") }
          : { label: "Editar", run: () => ((tab = "letra"), (editing = true)) },
      },
      {
        stage: "pistas", name: "Pistas", icon: "stems", go: "mix", job: stage(["separate"]),
        state: t.stems === "complete" ? `${t.present.length} de 6 con sonido` : t.stems ? "Separación a medias" : "Sin separar",
        action: t.stems === "complete" ? undefined : { label: t.stems ? "Rehacer" : "Separar", run: () => act("separate"), title: "BS-RoFormer (voz) + BS-Roformer-SW (6 pistas), en GPU" },
      },
      {
        stage: "notas", name: "Notas", icon: "notes", go: "score", job: stage(["notes"]),
        state: t.notes.length ? `${t.notes.length} de ${pitched.length || "?"} instrumentos` : "Sin notas",
        action: t.notes.length >= pitched.length && pitched.length ? undefined : { label: t.notes.length ? "Sacar el resto" : "Sacar notas", run: () => act("notes-all", quality()), title: "basic-pitch en CPU; la voz lleva la letra de Letras" },
      },
      {
        stage: "edits", name: "Edits", icon: "edits", go: "edits", job: stage(["render"]),
        state: t.edits ? `${t.edits} ${t.edits > 1 ? "edits" : "edit"}` : "Ninguno",
        action: { label: "Nuevo edit", run: () => (tab = "edits") },
      },
    ];
  });
  const RING: Record<Led, { value: number; color: string }> = {
    on: { value: 1, color: "var(--ok)" },
    half: { value: 0.5, color: "var(--warn)" },
    bad: { value: 1, color: "var(--bad)" },
    off: { value: 0, color: "var(--line-hi)" },
    busy: { value: 0, color: "var(--accent)" },
  };

  const moreItems = $derived<MenuItem[]>([
    ...(stemlab ? [{ label: "Abrir carpeta de pistas", icon: "folder" as const, run: () => openPath(stemlab.dir) }] : []),
    { label: "Volver a sacar los pulsos", icon: "metronome", run: () => act("beats") },
    "-",
    ...(track?.audio && !isStemOnly ? [{ label: "Borrar audio en caché", icon: "trash" as const, run: () => del("audio") }] : []),
    ...(track?.stems ? [{ label: "Borrar pistas y partituras", icon: "trash" as const, run: () => del("stems") }] : []),
    { label: "Borrar la canción…", icon: "trash", danger: true, run: () => del("all") },
  ]);
  const KEYS: [string, string][] = [
    ["Espacio", "Reproducir / pausa"],
    ["← →", "±5 segundos"],
    ["1-5", "Pestañas"],
    ["L", "Bucle de la sección"],
    ["Mayús+arrastrar", "Bucle a medida (en la tira)"],
    ["M", "Metrónomo"],
    ["V", "Mezclador compacto"],
    ["R", "Piano roll de las pistas"],
    ["E", "Editar la letra"],
  ];

  /** Pulsar en la onda de una pista: salta ahí. */
  function seekIn(e: PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    seek(((e.clientX - r.left) / r.width) * duration);
  }
</script>

<svelte:window onkeydown={onkey} />

{#snippet controls()}
  {#if settings.showMini && !loading && stemlab}<MiniMixer {stems} bind:volume bind:muted bind:solo />{/if}
  <Transport {playing} {time} {duration} bind:volume={settings.masterVolume} disabled={loading || !tracks.length} ontoggle={toggle} onseek={seek} />
{/snippet}

{#snippet jobLine(j: Job)}
  <span class="jobline">
    <ProgressRing value={j.pct != null && j.status === "running" ? j.pct / 100 : null} size={16} />
    <span>{jobText(j)}</span>
  </span>
{/snippet}

{#snippet stepRing(s: Step)}
  {@const led = ledOf(track!, s.stage)}
  {@const job = working(s.job)}
  {@const failed = s.job?.status === "error"}
  {@const ring = failed ? RING.bad : RING[led]}
  <Popover side="bottom" align="end" width={260} label={s.name}>
    {#snippet trigger({ toggle })}
      <button type="button" class="step" class:busy={!!job} onclick={toggle} aria-label="{s.name}: {s.state}" title="{s.name} · {job ? jobText(job) : s.state}">
        <ProgressRing value={job ? (job.pct != null && job.status === "running" ? job.pct / 100 : null) : ring.value} color={job ? "var(--accent)" : ring.color} size={34} stroke={3}>
          <span class="step-ico" class:dim={led === "off" && !job}><Icon name={failed ? "alert" : s.icon} size={14} /></span>
        </ProgressRing>
      </button>
    {/snippet}
    <div class="pane">
      <div class="pane-head"><Icon name={s.icon} size={14} /><strong>{s.name}</strong></div>
      {#if job}
        {@render jobLine(job)}
      {:else}
        <p class:err={failed}>{failed ? s.job!.error : s.state}</p>
      {/if}
      <div class="pane-acts">
        {#if s.go}<Button size="sm" variant="ghost" onclick={() => (tab = s.go!)}>Ver</Button>{/if}
        {#if s.action && !job}<Button size="sm" variant="secondary" icon={failed ? "retry" : undefined} title={s.action.title} onclick={s.action.run}>{s.action.label}</Button>{/if}
      </div>
    </div>
  </Popover>
{/snippet}

<div class="song-page">
  {#if detailError && !detail}
    <EmptyState icon="alert" title="No se pudo abrir">{detailError}</EmptyState>
  {:else if track}
    <header class="head">
      <div class="who">
        <span class="artist">{track.artist || "Sin artista"}</span>
        <h1 title={track.title || key}>{track.title || key}</h1>
        <div class="chips">
          {#if keyLabel}<Chip icon="chords" title="Tonalidad">{keyLabel}</Chip>{/if}
          {#if beatData || track.bpm}<Chip icon="metronome" title="Tempo">{Math.round(beatData?.bpm ?? track.bpm ?? 0)} BPM</Chip>{/if}
          {#if total}<Chip icon="wait" title="Duración">{fmtClock(total)}</Chip>{/if}
          {#if busy.length}<Chip icon="queue" title="Trabajos de esta canción en la cola" count={busy.length}>En cola</Chip>{/if}
        </div>
      </div>
      <nav class="steps" aria-label="Etapas del análisis">
        {#each steps as s, i (s.stage)}
          {#if i}<i class="joint" class:done={ledOf(track, s.stage) === "on"}></i>{/if}
          {@render stepRing(s)}
        {/each}
      </nav>
      <div class="acts">
        {#if onsing && track.notes.includes("vocals")}
          <Button icon="mic" onclick={onsing} title="Canta encima: pistas sin la voz, la letra y tu nota contra la original">Cantar</Button>
        {/if}
        {#if missing}
          <Button variant="primary" icon="sparkle" onclick={() => act("todo", quality())} title="Pistas, letra palabra a palabra y notas de cada instrumento. Lo hecho no se repite.">Hacer todo</Button>
        {/if}
        <Menu items={moreItems} align="end" label="Más">
          {#snippet trigger({ toggle })}<IconButton icon="more" label="Más" onclick={toggle} />{/snippet}
        </Menu>
      </div>
    </header>

    <section class="deck" aria-label="Transporte">
      <PlayButton {playing} size={44} disabled={loading || !tracks.length} onclick={toggle} />
      <div class="strip">
        <MasterStrip big duration={total} {time} {sections} chords={namedChords} tonality={shownHarmony?.key} energy={waves[key]} {loop} onloop={(l) => (loop = l)} onseek={seek} />
      </div>
      <div class="side">
        <span class="clock num">{fmtClock(time)}<small>/{fmtClock(total)}</small></span>
        <div class="tools">
          <IconButton icon="loop" label={loop ? `Bucle ${fmtClock(loop.a)}–${fmtClock(loop.b)}: quitar` : "Repetir la sección"} kbd="L" size="sm" active={!!loop} onclick={toggleLoop} />
          <Popover side="bottom" align="end" width={250} label="Metrónomo">
            {#snippet trigger({ toggle })}
              <IconButton icon="metronome" label="Metrónomo" kbd="M" size="sm" active={metro.on} onclick={toggle} />
            {/snippet}
            <div class="pane">
              <Toggle bind:checked={metro.on}>Metrónomo</Toggle>
              {#if beatData}
                <span class="bpm num">{Math.round(beatData.bpm * metro.factor)}<small>BPM</small></span>
                <Slider bind:value={metro.volume} max={1.5} label="Volumen del metrónomo" />
                <Tabs size="sm" options={[{ value: "0.5", label: "×½" }, { value: "1", label: "×1" }, { value: "2", label: "×2" }]} value={String(metro.factor)} onchange={(v) => (metro.factor = +v)} label="Velocidad" />
                {#if downbeats.length}
                  <small class="note">{beatData.meter ?? 4} pulsos por compás · acento en el 1</small>
                {:else}
                  <div class="row">
                    <Tabs size="sm" options={[{ value: "3", label: "3/4" }, { value: "4", label: "4/4" }]} value={String(metro.meter)} onchange={(v) => ((metro.meter = +v), (metro.shift %= +v))} label="Compás" />
                    <Button size="sm" variant="ghost" title="Mueve el clic fuerte un pulso para que caiga en el 1" onclick={() => (metro.shift = (metro.shift + 1) % metro.meter)}>Mover acento</Button>
                  </div>
                {/if}
              {:else if working(beatsJob)}
                {@render jobLine(beatsJob!)}
              {:else}
                <small class="note">Al encenderlo se sacan los pulsos (CPU, unos segundos).</small>
              {/if}
            </div>
          </Popover>
          {#if stemlab}<IconButton icon="sliders" label="Mezclador compacto" kbd="V" size="sm" active={settings.showMini} onclick={() => (settings.showMini = !settings.showMini)} />{/if}
          <Popover side="bottom" align="end" width={200} label="Volumen general">
            {#snippet trigger({ toggle })}<IconButton icon="volume" label="Volumen general" size="sm" onclick={toggle} />{/snippet}
            <div class="pane"><Slider bind:value={settings.masterVolume} max={1.5} label="Volumen general" /></div>
          </Popover>
          <Popover side="bottom" align="end" width={290} label="Atajos">
            {#snippet trigger({ toggle })}<IconButton icon="keyboard" label="Atajos" size="sm" onclick={toggle} />{/snippet}
            <dl class="keys">
              {#each KEYS as [k, what] (k)}<dt><Kbd keys={k} /></dt><dd>{what}</dd>{/each}
            </dl>
          </Popover>
        </div>
      </div>
    </section>
    {#if settings.showMini && stemlab && tab !== "mix" && !loading}<div class="mini"><MiniMixer {stems} bind:volume bind:muted bind:solo /></div>{/if}

    <Tabs variant="underline" options={TABS.map((t, i) => ({ ...t, title: `${t.label} (${i + 1})`, count: t.value === "edits" && track.edits ? track.edits : undefined }))} bind:value={tab} label="Vistas de la canción" />

    <div class="body" class:fill={tab !== "edits"}>
      {#if tab === "letra"}
        {#if detail}
          <LyricsTab {detail} {time} {playing} bind:editing onseek={seek} ontoggle={toggle} {onrenamed} />
        {/if}
      {:else if tab === "mix"}
        {#if loadError}
          <EmptyState icon="alert" title="No se pudo cargar el audio">{loadError}</EmptyState>
        {:else if !tracks.length}
          {@const j = working(stage(["audio", "import"]))}
          <EmptyState icon="audio" title="Sin audio">
            {isStemOnly ? "Importa el fichero desde «Añadir»." : "Se baja de YouTube: primer resultado con ese título y duración."}
            {#snippet actions()}
              {#if j}{@render jobLine(j)}{:else if !isStemOnly}<Button variant="primary" icon="download" onclick={() => act("audio")}>Descargar audio</Button>{/if}
            {/snippet}
          </EmptyState>
        {:else if loading}
          <div class="center"><ProgressRing value={null} size={28} label="Cargando audio" /></div>
        {:else}
          <div class="mixwrap" class:with-roll={rollShown}>
            {#if !stemlab}
              {@const j = working(stage(["separate"]))}
              <div class="cta" class:warn={track.stems === "partial"}>
                <span class="cta-ico"><Icon name={track.stems === "partial" ? "alert" : "stems"} size={18} /></span>
                <div class="cta-txt">
                  <strong>{track.stems === "partial" ? "Separación a medias" : "Separa en 6 pistas"}</strong>
                  <div class="badges">{#each ["vocals", "drums", "bass", "guitar", "piano", "other"] as s (s)}<StemBadge stem={s} dot />{/each}</div>
                </div>
                {#if j}{@render jobLine(j)}{:else}
                  <Button variant="primary" icon="stems" title="BS-RoFormer (voz) + BS-Roformer-SW, en GPU. {track.vocals === 'letras' ? 'Su voz sustituirá a la rápida de Letras.' : ''}" onclick={() => act("separate")}>{track.stems === "partial" ? "Rehacer" : "Separar"}</Button>
                {/if}
              </div>
            {/if}
            <div class="lanes">
              {#each tracks as st (st.name)}
                {@const meta = stems.find((s) => s.name === st.name)}
                {@const nj = notesJob(st.name)}
                {@const off = !st.present || !audible(st.name)}
                <div class="lane" class:off style:--c={stemColor(st.name)}>
                  <div class="lane-head">
                    <StemBadge stem={st.name} muted={!audible(st.name)} />
                    <small class="num">{meta ? (st.present ? `${meta.level} dB` : "en silencio") : ""}</small>
                    <span class="msw"><MuteSolo bind:muted={muted[st.name]} bind:solo={solo[st.name]} label={STEM_INFO[st.name]?.label} /></span>
                    <div class="vol"><Slider bind:value={volume[st.name]} max={1.5} label="Volumen {STEM_INFO[st.name]?.label ?? st.name}" color={stemColor(st.name)} /></div>
                    <div class="lane-acts">
                      {#if meta?.roll}
                        <IconButton icon="roll" label="Piano roll" kbd="R" size="sm" active={!!roll[st.name]} onclick={() => (roll[st.name] = !roll[st.name])} />
                      {/if}
                      {#if meta && PITCHED.includes(st.name) && st.present}
                        {#if working(nj)}
                          <span class="lane-job" title={jobText(nj!)}><ProgressRing value={nj!.pct != null && nj!.status === "running" ? nj!.pct / 100 : null} size={18} /></span>
                        {:else if nj?.status === "error"}
                          <IconButton icon="retry" label="Reintentar notas: {nj.error}" size="sm" onclick={() => act("notes", [st.name, ...quality()])} />
                        {:else if !meta.score}
                          <IconButton icon="notes" label={st.name === "vocals" ? "Sacar notas y letra" : "Sacar notas"} size="sm" onclick={() => act("notes", [st.name, ...quality()])} />
                        {:else if (meta as { model?: string }).model !== "muscriptor"}
                          <IconButton icon="sparkle" label="Notas precisas (MuScriptor, GPU)" size="sm" onclick={() => act("notes", [st.name, "precise"])} />
                        {/if}
                      {/if}
                    </div>
                  </div>
                  <div class="wave" role="presentation" onpointerdown={seekIn}>
                    <WaveThumb peaks={lanePeaks[st.name]} bars={180} color={off ? "var(--text-3)" : stemColor(st.name)} progress={duration ? time / duration : 0} height={rollShown ? 26 : 44} />
                    {#if loop}<i class="lane-loop" style:left="{(loop.a / (duration || 1)) * 100}%" style:width="{((loop.b - loop.a) / (duration || 1)) * 100}%"></i>{/if}
                    <i class="playhead" style:left="{(time / (duration || 1)) * 100}%"></i>
                  </div>
                </div>
              {/each}
            </div>
            {#if rollShown}
              <div class="roll">
                <Roll {player} tracks={rollTracks} {controls} bind:windowSec={settings.rollSpeed} ontoggle={(s) => (roll[s] = !roll[s])} chords={namedChords} {keyLabel} tonality={shownHarmony?.key} />
              </div>
            {/if}
          </div>
        {/if}
      {:else if tab === "score"}
        {#if !stemlab || !scored.length}
          {@const j = working(stage(["notes", "separate"]))}
          <EmptyState icon="score" title="Sin partitura">
            {stemlab ? "Se sacan las notas de cada instrumento." : "Se separan las pistas y se sacan sus notas, todo seguido."}
            {#snippet actions()}
              {#if j}{@render jobLine(j)}{:else}<Button variant="primary" icon="notes" onclick={() => act("notes-all", quality())}>Sacar todas las notas</Button>{/if}
            {/snippet}
          </EmptyState>
        {:else}
          <div class="picker">
            {#each scored as st (st.name)}
              <Chip color={stemColor(st.name)} active={!scoreHidden[st.name]} title={scoreHidden[st.name] ? "Mostrar" : "Ocultar"} onclick={() => (scoreHidden[st.name] = !scoreHidden[st.name])}>{STEM_INFO[st.name].label}</Chip>
            {/each}
            {#each pitched.filter((s) => !s.score) as st (st.name)}
              {@const nj = working(notesJob(st.name))}
              {#if nj}
                <Chip color={stemColor(st.name)} title={jobText(nj)}>{STEM_INFO[st.name].label} · {Math.round(nj.pct ?? 0)}%</Chip>
              {:else}
                <Chip icon="plus" title="Sacar sus notas" onclick={() => act("notes", [st.name, ...quality()])}>{STEM_INFO[st.name].label}</Chip>
              {/if}
            {/each}
            <span class="spacer"></span>
            <Tabs size="sm" label="Cómo se sacan las notas a partir de ahora" bind:value={settings.notes}
              options={[{ value: "fast", label: "Rápidas", title: "basic-pitch: CPU, segundos" }, { value: "precise", label: "Precisas", title: "MuScriptor: GPU, minutos por pista, mucho más preciso" }]} />
          </div>
          {#if !scoreShown.length}
            <EmptyState icon="hidden" title="Todo oculto">Enciende algún instrumento arriba.</EmptyState>
          {:else if scoreError}
            <EmptyState icon="alert" title="No se pudo montar">{scoreError}</EmptyState>
          {:else if !scorePath}
            <div class="center"><ProgressRing value={null} size={28} label="Montando la partitura" /></div>
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
          <ChordsTab {detail} harmony={shownHarmony} model={src === "mix" && !!modelHarmony} sources={noted.map((s) => STEM_INFO[s.name].label)} {time} {duration} {sections} bind:notation
            {src} onsrc={(s) => (chordSrc = s)} instruments={pitched.map((s) => ({ name: s.name, label: STEM_INFO[s.name].label, notes: !!s.roll, job: working(notesJob(s.name)) ? jobText(notesJob(s.name)!) : "" }))}
            onstemnotes={(s) => act("notes", [s, ...quality()])} onseek={seek} oncheck={() => act("sync", ["lineas"])} onopen={(k) => onopen(k)} busy={chordsBusy || notesBusy} />
        {/if}
      {:else if tab === "edits"}
        <EditsTab {track} {detail} />
      {/if}
    </div>
  {/if}
</div>

<style>
  .song-page { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--s3); }

  .head { display: flex; align-items: center; gap: var(--s5); flex-shrink: 0; min-width: 0; }
  .who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .artist { color: var(--text-2); font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  h1 { font-size: var(--fs-2xl); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .chips { display: flex; gap: var(--s1); flex-wrap: wrap; margin-top: var(--s1); }
  .acts { display: flex; gap: var(--s2); align-items: center; flex-shrink: 0; }

  .steps { display: flex; align-items: center; flex-shrink: 0; }
  .joint { width: 14px; height: 2px; background: var(--line-hi); border-radius: 1px; }
  .joint.done { background: color-mix(in oklab, var(--ok) 55%, var(--line)); }
  .step { display: grid; place-items: center; padding: 3px; border: 0; border-radius: 50%; background: none; color: var(--text); transition: background var(--t-fast); }
  .step:hover { background: var(--panel-hi); }
  .step-ico { display: grid; place-items: center; }
  .step-ico.dim { color: var(--text-3); }
  .pane { display: flex; flex-direction: column; gap: var(--s2); padding: var(--s2); }
  .pane-head { display: flex; align-items: center; gap: var(--s2); color: var(--text-2); }
  .pane-head strong { color: var(--text); font-weight: 600; }
  .pane p { color: var(--text-2); font-size: var(--fs-sm); overflow-wrap: anywhere; }
  .pane p.err { color: var(--bad); }
  .pane-acts { display: flex; justify-content: flex-end; gap: var(--s1); }
  .pane .row { display: flex; align-items: center; gap: var(--s2); }
  .bpm { font-size: var(--fs-2xl); font-weight: 700; line-height: 1; }
  .bpm small { font-size: var(--fs-sm); font-weight: 500; color: var(--text-3); margin-left: var(--s1); }
  .note { color: var(--text-3); font-size: var(--fs-sm); }
  .jobline { display: inline-flex; align-items: center; gap: var(--s2); min-width: 0; color: var(--text-2); font-size: var(--fs-sm); }
  .jobline span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .keys { display: grid; grid-template-columns: auto 1fr; gap: var(--s2) var(--s3); align-items: center; margin: 0; padding: var(--s2); font-size: var(--fs-sm); }
  .keys dd { margin: 0; color: var(--text-2); }

  .deck {
    display: flex; align-items: center; gap: var(--s4); flex-shrink: 0; padding: var(--s3) var(--s4);
    border-radius: var(--r-lg); background: var(--panel); border: 1px solid var(--line);
  }
  .strip { flex: 1; min-width: 0; }
  .side { display: flex; flex-direction: column; align-items: flex-end; gap: var(--s1); flex-shrink: 0; }
  .clock { font-size: var(--fs-xl); font-weight: 600; line-height: 1; }
  .clock small { font-size: var(--fs-sm); font-weight: 400; color: var(--text-3); margin-left: 2px; }
  .tools { display: flex; gap: 2px; }
  .mini { flex-shrink: 0; }

  .body { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
  .body.fill { overflow: hidden; }
  .center { margin: auto; }
  .spacer { flex: 1; }

  .mixwrap { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--s2); overflow-y: auto; }
  .mixwrap.with-roll { overflow: hidden; }
  .with-roll .lanes { flex-shrink: 0; max-height: 45%; overflow-y: auto; }
  .cta {
    display: flex; align-items: center; gap: var(--s3); padding: var(--s2) var(--s3); flex-shrink: 0;
    border-radius: var(--r-lg); border: 1px dashed var(--line-hi);
  }
  .cta.warn { border-color: color-mix(in oklab, var(--warn) 55%, var(--line)); }
  .cta-ico { display: grid; place-items: center; width: 36px; height: 36px; border-radius: var(--r-md); background: var(--panel-hi); color: var(--text-2); }
  .cta.warn .cta-ico { color: var(--warn); }
  .cta-txt { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .cta-txt strong { font-weight: 600; }
  .badges { display: flex; gap: var(--s2); }
  .lanes { display: flex; flex-direction: column; gap: var(--s1); }
  .lane {
    flex-shrink: 0; display: grid; grid-template-columns: 300px minmax(0, 1fr); align-items: stretch; min-height: 0;
    border-radius: var(--r-lg); background: var(--panel); border: 1px solid var(--line); overflow: hidden;
    box-shadow: inset 3px 0 0 var(--c); transition: opacity var(--t);
  }
  .lane.off { opacity: 0.55; }
  .lane-head { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; grid-template-rows: auto auto; align-items: center; gap: 2px var(--s2); padding: var(--s2) var(--s3) var(--s2) var(--s4); }
  .lane-head small { color: var(--text-3); font-size: var(--fs-xs); }
  .vol { grid-column: 1 / 3; }
  .lane-acts { display: flex; align-items: center; justify-content: flex-end; gap: 2px; min-width: 52px; }
  .lane-job { display: grid; place-items: center; width: 24px; height: 24px; }
  .wave { position: relative; display: flex; align-items: center; padding: var(--s1) 0; cursor: pointer; border-left: 1px solid var(--line); }
  .playhead { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: var(--text); pointer-events: none; }
  .lane-loop { position: absolute; top: 0; bottom: 0; background: var(--accent-soft); pointer-events: none; }
  .with-roll .lane-head { grid-template-columns: 96px minmax(0, 1fr) auto auto; grid-template-rows: auto; padding: 2px var(--s2) 2px var(--s4); }
  .with-roll .lane-head small { display: none; }
  .with-roll .vol { grid-column: 2; grid-row: 1; }
  .with-roll .msw { grid-column: 3; grid-row: 1; }
  .with-roll .lane-acts { grid-column: 4; grid-row: 1; }
  .msw { display: flex; }
  .roll { flex: 1; min-height: 240px; display: flex; flex-direction: column; }

  .picker { display: flex; gap: var(--s1); flex-wrap: wrap; align-items: center; margin-bottom: var(--s2); flex-shrink: 0; }

  @media (max-width: 1100px) {
    .head { flex-wrap: wrap; }
    .lane { grid-template-columns: 240px minmax(0, 1fr); }
  }
</style>
