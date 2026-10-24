<script lang="ts">
  /** Sesiones: lo tocado en Tocar (o importado de MIDI / MusicXML) y canciones separadas para escuchar por instrumentos.
   * A la izquierda, tarjetas con su mini piano roll (o su onda) y la tira de acordes; a la derecha, carriles por
   * instrumento, acordes que más suenan, la tonalidad en el círculo de quintas, la progresión y el análisis de Claude. */
  import { invoke } from "@tauri-apps/api/core";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { loadNotation } from "./ChordsTab.svelte";
  import { enqueue, fmtClock, listDir, paths, readBytes, readJson, removeFile, songDetail, STEM_INFO, viewPath, writeBytes, writeJson, type Detail } from "./engine";
  import { analyze as analyzeNotes, degree, fromModel, keyName, named, parseKey, type Key, type Note } from "./harmony";
  import { sessionForAI, songForAI, stamps } from "./live";
  import { engineErr, t } from "./i18n.svelte";
  import { loadPiano } from "./piano";
  import { toToon } from "./toon";
  import { fromSession } from "./piece";
  import { pickPieces, pieceToSession, savePiece } from "./pieces.svelte";
  import { waves, wantPeaks } from "./peaks.svelte";
  import { Player, synth } from "./player";
  import SessionLanes from "./SessionLanes.svelte";
  import { settings } from "./settings.svelte";
  import { jobOf, store } from "./store.svelte";
  import Button from "./ui/Button.svelte";
  import Card from "./ui/Card.svelte";
  import Chip from "./ui/Chip.svelte";
  import ChordChip from "./ui/ChordChip.svelte";
  import Dialog from "./ui/Dialog.svelte";
  import EmptyState from "./ui/EmptyState.svelte";
  import FifthsWheel from "./ui/FifthsWheel.svelte";
  import Icon from "./ui/Icon.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import MasterStrip from "./ui/MasterStrip.svelte";
  import Menu, { type MenuItem } from "./ui/Menu.svelte";
  import { chordFn, cssVar, stemColor } from "./ui/music";
  import ProgressRing from "./ui/ProgressRing.svelte";
  import Search from "./ui/Search.svelte";
  import Slider from "./ui/Slider.svelte";
  import Tabs from "./ui/Tabs.svelte";
  import { tooltip } from "./ui/tooltip";
  import WaveThumb from "./ui/WaveThumb.svelte";

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
  type C = { t: number; end: number; name: string; deg?: string; root: number; kind: string };
  type Lane = { stem: string; label: string; notes: Note[]; muted?: boolean };

  let { onsong, onlearn }: { onback?: () => void; onsong: (key: string) => void; onlearn: (pieceId: string) => void } = $props();

  const dir = `${paths.data}/sesiones`;
  const songsPath = `${dir}/canciones.json`; // canciones separadas para escuchar aquí (claves de la biblioteca)
  const latin = loadNotation().latin;

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

  let items = $state<Item[]>([]);
  let songs = $state<string[]>([]);
  let sel = $state<Item | null>(null);
  let song = $state<string | null>(null);

  // lo abierto (sesión o canción): un reproductor, sus carriles, acordes y tonalidad
  let player = $state.raw(new Player());
  let playing = $state(false);
  let time = $state(0);
  let duration = $state(0);
  let loading = $state(false);
  let error = $state("");
  let lanes = $state.raw<Lane[]>([]);
  let chords = $state.raw<C[]>([]);
  let tonality = $state.raw<Key | null>(null);
  let keyLabel = $state("");
  let span = $state(12); // segundos que se ven en los carriles

  // canción: ficha, mezcla (la de Analizar, solo se lee) y de dónde salen los acordes
  let songInfo = $state.raw<Detail | null>(null);
  let fromNotes = $state(false);
  let volume = $state<Record<string, number>>({});
  let muted = $state<Record<string, boolean>>({});
  let solo = $state<Record<string, boolean>>({});

  // análisis de Claude
  let analysis = $state("");
  let analyzing = $state(false);
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
    if (base) readBytes(`${base}.analisis.md`).then((b) => base === aiBase && (analysis = new TextDecoder().decode(b)), () => {});
  });

  // añadir canciones
  let adding = $state(false);
  let query = $state("");
  let picked = $state<string[]>([]);
  let filter = $state("");
  const trackOf = (key: string) => store.tracks.find((t) => t.key === key);
  /** Las separadas que aún no están en la lista. */
  const available = $derived(
    store.tracks
      .filter((t) => t.stems && t.present.length && !songs.includes(t.key))
      .filter((tr) => `${tr.title} ${tr.artist}`.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  /** «2026-10-14_11-48-47» → «14 oct 2026 · 11:48». */
  const when = (name: string) => {
    const [d, h] = name.split("_");
    const date = new Date(`${d}T${(h ?? "").replaceAll("-", ":")}`);
    if (isNaN(+date)) return name;
    return `${date.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })} · ${date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}`;
  };

  // las sesiones guardan el nombre del acorde («Sol7», «Do/Mi»): se recupera la fundamental y el tipo para colorearlo
  const PC: Record<string, number> = { Do: 0, Re: 2, Mi: 4, Fa: 5, Sol: 7, La: 9, Si: 11, C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const KIND: Record<string, string> = { "m7(b5)": "m7b5", "m(maj7)": "mmaj7" };
  const ACC: Record<string, number> = { b: -1, bb: -2, "#": 1, x: 2 };
  function parseChord(name: string) {
    const m = /^(Do|Re|Mi|Fa|Sol|La|Si|[A-G])(bb|b|#|x)?([^/]*)/.exec(name);
    return m ? { root: (PC[m[1]] + (ACC[m[2]] ?? 0) + 12) % 12, kind: KIND[m[3]] ?? m[3] } : null;
  }
  const withRoots = (cs: Session["chords"]): C[] => cs.flatMap((c) => {
    const p = parseChord(c.name);
    return p ? [{ ...c, ...p }] : [];
  });

  async function scan() {
    const files = await listDir(dir).catch(() => []);
    const names = files.filter((f) => f.name.endsWith(".json") && `${dir}/${f.name}` !== songsPath).map((f) => f.name.slice(0, -5)).sort().reverse();
    items = await Promise.all(names.map(async (name) => ({ name, base: `${dir}/${name}`, s: await readJson<Session | null>(`${dir}/${name}.json`, null) })));
    songs = await readJson<string[]>(songsPath, []);
    if (!sel && !song && tab === "sesiones" && items[0]) void open(items[0]);
  }

  /** Un reproductor nuevo para lo que se abre (el anterior se cierra: WebKit se queda sin contextos si no). */
  function reset() {
    player.stop();
    void player.ctx.close();
    player = new Player();
    [playing, time, duration, error, analysis] = [false, 0, 0, "", ""];
    [lanes, chords, tonality, keyLabel, songInfo, fromNotes] = [[], [], null, "", null, false];
  }

  async function open(it: Item) {
    if (!it.s) return;
    reset();
    song = null;
    sel = it;
    loading = true;
    const s = it.s;
    lanes = [{ stem: "piano", label: s.device || "Teclado", notes: s.notes }];
    chords = withRoots(s.chords);
    tonality = parseKey(s.key);
    keyLabel = s.key ?? "";
    duration = s.duration;
    const p = player;
    try {
      const buf = await synth(s.notes, s.duration);
      if (sel !== it || p !== player) return; // se eligió otra mientras se sintetizaba
      player.setBuffer("piano", buf);
    } catch (e) {
      error = t("No se pudo sintetizar: {e}", { e: engineErr(String(e)) });
    }
    loading = false;
    const md = await readBytes(`${it.base}.analisis.md`).catch(() => null);
    if (sel === it && md) analysis = new TextDecoder().decode(md);
  }

  async function openSong(key: string) {
    reset();
    sel = null;
    song = key;
    loading = true;
    const p = player;
    const stale = () => song !== key || p !== player;
    try {
      const d = await songDetail(key);
      if (stale()) return;
      if (!d.stemlab) throw new Error("Esta canción ya no tiene las pistas separadas");
      const view = await readJson(viewPath(key), { volume: {}, muted: {}, solo: {} } as Record<string, Record<string, never>>);
      for (const s of d.stemlab.stems) {
        volume[s.name] = view.volume[s.name] ?? 1;
        muted[s.name] = view.muted[s.name] ?? !s.present;
        solo[s.name] = view.solo[s.name] ?? false;
      }
      const sdir = d.stemlab.dir;
      const tracks = await Promise.all(d.stemlab.stems.filter((s) => s.roll).map(async (s) => ({ stem: s.name, notes: await readJson<Note[]>(`${sdir}/${s.roll}`, []) })));
      if (stale()) return;
      songInfo = d;
      duration = d.duration;
      lanes = d.stemlab.stems.filter((s) => s.present).map((s) => ({ stem: s.name, label: STEM_INFO[s.name]?.label ?? s.name, notes: tracks.find((t) => t.stem === s.name)?.notes ?? [] }));
      await player.load(d.stemlab.stems.map((s) => ({ name: s.name, path: `${sdir}/${s.file}` })));
      if (stale()) return;
      duration = player.duration;
      const cs = d.chordData?.chords;
      // sin acordes del modelo (lv-chordia) se piden a la cola y, mientras, salen de las notas, como en Analizar
      if (!cs?.length && d.audio && !jobOf(key, "chords")) void enqueue("chords", [key]);
      // los del modelo, revisados con las notas de cada pista (el V7 que dio como v menor…)
      const h = cs?.length ? fromModel(cs, tracks, d.beatData?.beats ?? [], d.duration) : tracks.length ? analyzeNotes(tracks, d.beatData?.beats ?? [], d.duration) : null;
      fromNotes = !cs?.length && !!h;
      if (h) {
        chords = named(h.chords, h.key, loadNotation()).map((c) => ({ ...c, deg: degree(c, h.key) }));
        keyLabel = keyName(h.key, latin);
        tonality = h.key;
      }
    } catch (e) {
      if (!stale()) error = engineErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (!stale()) loading = false;
    }
  }

  async function addSongs() {
    songs = [...picked, ...songs];
    await writeJson(songsPath, songs);
    adding = false;
    if (picked[0]) {
      tab = "canciones";
      void openSong(picked[0]);
    }
    picked = [];
  }

  async function removeSong() {
    if (!song) return;
    songs = songs.filter((k) => k !== song);
    reset();
    song = null;
    await writeJson(songsPath, songs);
  }

  function toggle() {
    if (loading || error || !duration) return;
    if (player.playing) player.pause();
    else player.play();
    playing = player.playing;
  }

  function seek(tr: number) {
    player.seek(Math.max(0, Math.min(tr, duration)));
    time = player.time();
  }

  /** Un tiempo del análisis: ir ahí y escucharlo. */
  function jump(tr: number) {
    seek(tr);
    if (!player.playing) toggle();
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
      if (target === base) error = engineErr(String(e));
    }
    analyzing = false;
  }

  /** Las notas de los instrumentos elegidos, los acordes y la letra de la canción abierta. */
  async function songJson() {
    const d = songInfo!;
    const tracks = await Promise.all(
      noted.filter((s) => aiStems.includes(s.name)).map(async (s) => ({ name: STEM_INFO[s.name]?.label ?? s.name, notes: await readJson<Note[]>(`${d.stemlab!.dir}/${s.roll}`, []) })),
    );
    return songForAI({ title: d.title, artist: d.artist, duration: d.duration, key: keyLabel || null, bpm: d.bpm }, tracks, chords, d.doc);
  }

  /** La sesión como pieza, para practicarla en Aprender (o retocarla en el editor). */
  async function toPiece() {
    if (!sel?.s) return;
    const pc = await savePiece(fromSession(sel.s.notes, t("Sesión del {when}", { when: when(sel.name) })));
    onlearn(pc.id);
  }

  /** MIDI o MusicXML como sesión (su piano roll, sus acordes, el análisis de Claude). */
  async function importSession() {
    try {
      const got = await pickPieces();
      let base = "";
      for (const [i, pc] of got.entries()) base = await pieceToSession(pc, latin, new Date(Date.now() + i * 1000));
      await scan();
      tab = "sesiones";
      const it = items.find((x) => x.base === base);
      if (it) void open(it);
    } catch (e) {
      error = t("No se pudo importar: {e}", { e: String(e) });
    }
  }

  async function remove() {
    if (!sel || !confirm(t("Borrar la sesión del {when} (.mid, .json, .toon y su análisis). No se puede deshacer.", { when: when(sel.name) }))) return;
    for (const ext of [".json", ".mid", ".toon", ".analisis.md"]) await removeFile(sel.base + ext).catch(() => {});
    reset();
    sel = null;
    await scan();
  }

  // ---------------------------------------------------------------- análisis: secciones (tarjetas), viñetas, tiempos

  const sections = $derived.by(() => {
    const out: { title: string; blocks: { li: boolean; text: string }[] }[] = [{ title: "", blocks: [] }];
    for (const l of analysis.split("\n")) {
      const text = l.replace(/\*\*|`/g, "").trim();
      if (!text || /^-{3,}$/.test(text)) continue;
      if (/^#{1,4}\s/.test(text)) out.push({ title: text.replace(/^#+\s*/, ""), blocks: [] });
      else out[out.length - 1].blocks.push({ li: /^[-*]\s/.test(text), text: text.replace(/^[-*]\s*/, "") });
    }
    return out.filter((s) => s.blocks.length);
  });

  // ---------------------------------------------------------------- acordes: los que más suenan, el de ahora, pesos

  const top = $derived.by(() => {
    const dur = new Map<string, C & { d: number }>();
    for (const c of chords) {
      const e = dur.get(c.name) ?? { ...c, d: 0 };
      e.d += c.end - c.t;
      dur.set(c.name, e);
    }
    return [...dur.values()].sort((a, b) => b.d - a.d);
  });
  const total = $derived(top.reduce((a, c) => a + c.d, 0) || 1);
  const maxD = $derived(top[0]?.d || 1);
  const current = $derived(chords.find((c) => c.t <= time && time < c.end) ?? null);
  const wheelChords = $derived(top.map((c) => ({ root: c.root, kind: c.kind, w: c.d / maxD })));

  // ---------------------------------------------------------------- mezcla de la canción

  const audible = (name: string) => (Object.values(solo).some(Boolean) ? solo[name] : !muted[name]);
  const shownLanes = $derived(lanes.map((l) => ({ ...l, muted: song ? !audible(l.stem) : false })));
  $effect(() => player.setMaster(settings.masterVolume));
  $effect(() => {
    if (!song || !songInfo?.stemlab) return;
    for (const s of songInfo.stemlab.stems) player.setGain(s.name, audible(s.name) ? (volume[s.name] ?? 1) : 0);
  });

  // ---------------------------------------------------------------- lista

  const shownItems = $derived(items.filter((it) => !filter.trim() || `${when(it.name)} ${it.s?.key ?? ""} ${it.s?.device ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase())));
  const shownSongs = $derived(songs.filter((k) => !filter.trim() || `${trackOf(k)?.title ?? k} ${trackOf(k)?.artist ?? ""}`.toLowerCase().includes(filter.trim().toLowerCase())));

  /** Mini piano roll de una sesión, dibujado una vez. */
  function thumb(c: HTMLCanvasElement, s: Session) {
    const [w, h] = [c.clientWidth, c.clientHeight];
    const dpr = devicePixelRatio || 1;
    [c.width, c.height] = [w * dpr, h * dpr];
    const g = c.getContext("2d")!;
    g.scale(dpr, dpr);
    const ps = s.notes.map((n) => n[2]);
    const lo = Math.min(...ps, 60) - 1, hi = Math.max(...ps, 72) + 1;
    const dur = s.duration || 1;
    g.fillStyle = cssVar("--stem-piano");
    for (const [a, b, p, v] of s.notes) {
      g.globalAlpha = 0.4 + v * 0.6;
      g.fillRect((a / dur) * w, h - ((p - lo) / (hi - lo)) * h, Math.max(1, ((b - a) / dur) * w), Math.max(1.5, h / (hi - lo)));
    }
  }
  /** Tira de acordes de una sesión, en el color de su función. */
  const strip = (s: Session) => {
    const k = parseKey(s.key);
    if (!k || !s.duration) return [];
    return withRoots(s.chords).map((c) => ({ left: (c.t / s.duration) * 100, width: ((c.end - c.t) / s.duration) * 100, color: chordFn(c, k).color }));
  };

  onMount(() => {
    void scan();
    void loadPiano().catch(() => {}); // que la primera nota ya suene a piano
    let raf = 0;
    const tick = () => {
      time = player.time();
      if (player.playing && duration && time >= duration) {
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

  $effect(() => {
    if (tab === "canciones") for (const k of songs) wantPeaks(k, !!trackOf(k)?.audio || !!trackOf(k)?.stems);
  });

  function onkey(e: KeyboardEvent) {
    if (!(sel || song) || adding || document.querySelector("dialog[open]")) return;
    if ((e.target as HTMLElement).closest("input:not([type=range]), textarea, select, button, [role=slider]") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space") (e.preventDefault(), toggle());
    else if (e.key === "ArrowLeft") seek(time - 5);
    else if (e.key === "ArrowRight") seek(time + 5);
  }

  const sessionMenu: MenuItem[] = [
    { label: t("Mostrar en la carpeta"), icon: "folder", title: t("El .mid se abre en cualquier programa"), run: () => sel && revealItemInDir(`${sel.base}.mid`) },
    "-",
    { label: t("Borrar sesión…"), icon: "trash", danger: true, run: remove },
  ];
  const songMenu: MenuItem[] = [{ label: t("Quitar de la lista"), icon: "close", title: t("La canción sigue en la biblioteca"), run: removeSong }];
</script>

<svelte:window onkeydown={onkey} />

{#snippet linked(text: string)}
  {#each stamps(text) as p, i (i)}{#if p.t != null}<span class="ts"><Chip icon="play" onclick={() => jump(p.t!)} title={t("Ir a {text}", { text: p.text })}>{p.text}</Chip></span>{:else}{p.text}{/if}{/each}
{/snippet}

{#snippet stat(label: string, value: string)}
  <div class="stat"><span>{label}</span><b class="num">{value}</b></div>
{/snippet}

<div class="sessions">
  <aside class="list">
    <header class="list-head">
      <Tabs
        bind:value={tab}
        label={t("Qué ver")}
        options={[
          { value: "sesiones", label: t("Sesiones"), count: items.length },
          { value: "canciones", label: t("Canciones"), count: songs.length },
        ]}
      />
      {#if tab === "sesiones"}
        <IconButton icon="upload" label={t("Importar MIDI o MusicXML")} onclick={importSession} />
      {:else}
        <IconButton icon="plus" label={t("Añadir canciones separadas")} onclick={() => (adding = true)} />
      {/if}
    </header>
    {#if (tab === "sesiones" ? items : songs).length > 4}
      <div class="filter"><Search bind:value={filter} size="sm" placeholder={tab === "sesiones" ? t("Fecha, tonalidad…") : t("Canción o artista")} /></div>
    {/if}

    <div class="cards">
      {#if tab === "sesiones"}
        {#each shownItems as it (it.name)}
          <article class="sc" class:on={sel?.name === it.name} class:broken={!it.s}>
            <button type="button" class="hit" onclick={() => open(it)} disabled={!it.s} aria-label={t("Abrir la sesión del {when}", { when: when(it.name) })}></button>
            {#if it.s}
              <canvas class="thumb" use:thumb={it.s} aria-hidden="true"></canvas>
              <div class="strip" aria-hidden="true">{#each strip(it.s) as c, i (i)}<i style:left="{c.left}%" style:width="{c.width}%" style:background={c.color}></i>{/each}</div>
            {/if}
            <div class="meta">
              <span class="t">{when(it.name)}</span>
              <span class="a num">{#if it.s}{fmtClock(it.s.duration)} · {t("{n} notas", { n: it.s.notes.length })}{it.s.key ? ` · ${it.s.key}` : ""}{:else}{t("no se puede leer")}{/if}</span>
            </div>
          </article>
        {:else}
          <EmptyState icon="midi" title={items.length ? t("Ninguna coincide") : t("Aún no hay sesiones")}>
            {items.length ? "" : t("Se guardan solas al tocar en Tocar.")}
            {#snippet actions()}<Button icon="upload" onclick={importSession}>{t("Importar MIDI")}</Button>{/snippet}
          </EmptyState>
        {/each}
      {:else}
        {#each shownSongs as k (k)}
          {@const tr = trackOf(k)}
          <article class="sc" class:on={song === k}>
            <button type="button" class="hit" onclick={() => openSong(k)} aria-label={t("Abrir {title}", { title: tr?.title ?? k })}></button>
            <div class="wave"><WaveThumb peaks={waves[k]} height={36} /></div>
            <div class="meta">
              <span class="t">{tr?.title ?? k}</span>
              <span class="a">{tr ? tr.artist : t("ya no está en la biblioteca")}</span>
              {#if tr}<span class="dots">{#each tr.present as s (s)}<i style:background={stemColor(s)} use:tooltip={t(STEM_INFO[s]?.label ?? s)}></i>{/each}</span>{/if}
            </div>
          </article>
        {:else}
          <EmptyState icon="stems" title={t("Escucha por instrumentos")}>
            {t("Añade canciones con las pistas separadas.")}
            {#snippet actions()}<Button variant="primary" icon="plus" onclick={() => (adding = true)}>{t("Añadir canción")}</Button>{/snippet}
          </EmptyState>
        {/each}
      {/if}
    </div>
  </aside>

  <main class="detail">
    {#if !(sel?.s || song)}
      <EmptyState icon="sessions" title={t("Tus sesiones, otra vez")}>
        {t("Elige una sesión o una canción para oírla, ver sus acordes y analizarla con Claude.")}
      </EmptyState>
    {:else}
      {@const tr = song ? trackOf(song) : null}
      <header class="hero">
        <div class="who">
          <span class="kick">{song ? t("Canción") : t("Sesión")}</span>
          <h1>{song ? (tr?.title ?? song) : when(sel!.name)}</h1>
          {#if song && tr?.artist}<span class="sub">{tr.artist}</span>{/if}
        </div>
        <div class="actions">
          <Button variant="primary" icon="sparkle" onclick={analyze} disabled={analyzing || (!!song && !aiStems.length)}>
            {analyzing ? t("Claude escuchando…") : analysis ? t("Analizar otra vez") : t("Analizar con Claude")}
          </Button>
          {#if song}
            <Button icon="library" onclick={() => song && onsong(song)} title={t("Letra, partitura, acordes…")}>{t("Abrir canción")}</Button>
            <Menu items={songMenu} align="end" label={t("Más")}>
              {#snippet trigger({ toggle, open })}<IconButton icon="more" label={t("Más")} active={open} onclick={toggle} />{/snippet}
            </Menu>
          {:else}
            <Button icon="learn" onclick={toPiece} title={t("Pasarla a pieza para practicarla con niveles (o retocarla en el editor)")}>{t("Practicar en Aprender")}</Button>
            <Menu items={sessionMenu} align="end" label={t("Más")}>
              {#snippet trigger({ toggle, open })}<IconButton icon="more" label={t("Más")} active={open} onclick={toggle} />{/snippet}
            </Menu>
          {/if}
        </div>
      </header>

      <div class="stats">
        {#if song}
          {@render stat(t("Tonalidad"), keyLabel || "—")}
          {@render stat(t("Tempo"), tr?.bpm ? `${Math.round(tr.bpm)} bpm` : "—")}
          {@render stat(t("Duración"), duration ? fmtClock(duration) : "—")}
          {@render stat(t("Pistas"), String(lanes.length))}
          {@render stat(t("Acordes"), String(top.length))}
        {:else if sel?.s}
          {@render stat(t("Duración"), fmtClock(sel.s.duration))}
          {@render stat(t("Notas"), String(sel.s.notes.length))}
          {@render stat(t("Tonalidad"), sel.s.key ?? "—")}
          {@render stat(t("Pedal"), t("{n} veces", { n: sel.s.pedal.length }))}
          {@render stat(t("Teclado"), sel.s.device)}
        {/if}
      </div>

      {#if error}<p class="err" role="alert"><Icon name="alert" size={14} /> {error}</p>{/if}

      <div class="transport">
        {#if loading}
          <span class="spin" use:tooltip={song ? t("Cargando pistas…") : t("Sintetizando el piano…")}><ProgressRing value={null} size={24} label={t("Cargando")} /></span>
        {:else}
          <IconButton icon={playing ? "pause" : "play"} label={playing ? t("Pausa") : t("Reproducir")} kbd={t("Espacio")} size="lg" active={playing} onclick={toggle} disabled={!duration} />
        {/if}
        <span class="clock num">{fmtClock(time)}<span> / {fmtClock(duration)}</span></span>
        <div class="master"><MasterStrip {duration} {time} chords={duration ? chords : []} {tonality} onseek={seek} /></div>
        <span class="vol" use:tooltip={t("Volumen general")}><Icon name="volume" size={14} /><Slider bind:value={settings.masterVolume} min={0} max={1.5} label={t("Volumen general")} /></span>
      </div>

      {#if loading && !lanes.length}
        <div class="loading"><ProgressRing value={null} size={28} label={t("Cargando")} /><span>{t("Cargando pistas…")}</span></div>
      {:else if lanes.length}
        <SessionLanes lanes={shownLanes} {chords} {tonality} {time} {span} onseek={seek}>
          {#snippet head(l)}
            <div class="lane-name"><i style:background={stemColor(l.stem)}></i><span>{t(l.label)}</span></div>
            {#if song}
              <div class="lane-ctl">
                <Button size="sm" variant="ghost" active={!!muted[l.stem]} onclick={() => (muted[l.stem] = !muted[l.stem])} title={t("Silenciar")}>M</Button>
                <Button size="sm" variant="ghost" active={!!solo[l.stem]} onclick={() => (solo[l.stem] = !solo[l.stem])} title={t("Solo")}>S</Button>
                <Slider bind:value={volume[l.stem]} min={0} max={1.5} label={t("Volumen de {stem}", { stem: t(l.label) })} color={stemColor(l.stem)} />
              </div>
              {#if !l.notes.length}<small class="dim">{t("sin notas")}</small>{/if}
            {:else}
              <small class="dim num">{t("{n} notas", { n: l.notes.length })}</small>
            {/if}
          {/snippet}
        </SessionLanes>
        <div class="zoom" use:tooltip={t("Segundos que se ven en los carriles")}>
          <Icon name="search" size={13} /><Slider value={42 - span} min={6} max={38} step={1} label={t("Zoom de los carriles")} oninput={(v) => (span = 42 - v)} />
        </div>
      {/if}

      <div class="harmony">
        <Card>
          <h3>{t("Acordes que más suenan")}</h3>
          {#if top.length}
            {#if fromNotes}<p class="note">{t("De las notas transcritas: los del audio (lv-chordia) están en la cola y saldrán la próxima vez.")}</p>{/if}
            <ol class="bars">
              {#each top.slice(0, 8) as c (c.name)}
                {@const f = tonality ? chordFn(c, tonality) : null}
                <li>
                  {#if tonality}<ChordChip chord={c} {tonality} name={c.name} size="sm" active={current?.name === c.name} onclick={() => seek(c.t)} />{:else}<Chip onclick={() => seek(c.t)}>{c.name}</Chip>{/if}
                  <span class="track"><i style:width="{(c.d / maxD) * 100}%" style:background={f?.color ?? "var(--text-3)"}></i></span>
                  <span class="num pct">{Math.round((c.d / total) * 100)}%</span>
                  <span class="num dur">{fmtClock(c.d)}</span>
                </li>
              {/each}
            </ol>
          {:else}
            <p class="note">{song ? t("Sin acordes todavía: sus pistas no tienen notas y los del audio (lv-chordia) están en la cola.") : t("Sin acordes: hacen falta tres notas a la vez.")}</p>
          {/if}
        </Card>
        <Card>
          <h3>{t("Tonalidad")}</h3>
          <div class="wheel"><FifthsWheel {tonality} chords={wheelChords} {current} size={190} {latin} /></div>
        </Card>
      </div>

      {#if chords.length}
        <Card>
          <h3 use:tooltip={t("Pulsa un acorde para ir a él")}>{t("Progresión")} <small class="num">{chords.length}</small></h3>
          <div class="prog">
            {#each chords as c, i (i)}
              {#if tonality}
                <ChordChip chord={c} {tonality} name={c.name} size="sm" showDegree={false} active={c === current} onclick={() => seek(c.t)} />
              {:else}
                <Chip active={c === current} onclick={() => seek(c.t)}>{c.name}</Chip>
              {/if}
            {/each}
          </div>
        </Card>
      {/if}

      <section class="ai">
        <header class="ai-head">
          <h2><Icon name="sparkle" size={16} /> {t("Análisis de Claude")}</h2>
          {#if song}
            <div class="ai-stems" aria-label={t("Instrumentos para Claude")}>
              {#each noted as st (st.name)}
                <Chip color={stemColor(st.name)} active={aiStems.includes(st.name)} count={st.notes} onclick={() => (aiStems = aiStems.includes(st.name) ? aiStems.filter((x) => x !== st.name) : [...aiStems, st.name])}>
                  {t(STEM_INFO[st.name]?.label ?? st.name)}
                </Chip>
              {:else}
                <span class="note">{t("Ninguna pista tiene notas todavía: sácalas en la canción.")}</span>
              {/each}
            </div>
          {/if}
        </header>
        {#if analyzing}
          <div class="loading"><ProgressRing value={null} size={22} label={t("Analizando")} /><span>{t("Claude está escuchando…")}</span></div>
        {:else if sections.length}
          <div class="ai-grid">
            {#each sections as s, i (i)}
              <Card>
                {#if s.title}<h3>{s.title}</h3>{/if}
                {#each s.blocks as b, j (j)}
                  <p class:li={b.li}>{@render linked(b.text)}</p>
                {/each}
              </Card>
            {/each}
          </div>
        {:else}
          <p class="note">{t("Aún sin analizar: Claude lee las notas, los acordes y {what}, y marca los momentos para ir a ellos.", { what: song ? t("la letra") : t("el pedal") })}</p>
        {/if}
      </section>
    {/if}
  </main>
</div>

<Dialog bind:open={adding} title={t("Añadir canciones")}>
  <div class="adder">
    <Search bind:value={query} placeholder={t("Buscar entre las separadas…")} />
    <div class="picklist">
      {#each available as tr (tr.key)}
        <label class:on={picked.includes(tr.key)}>
          <input type="checkbox" bind:group={picked} value={tr.key} />
          <span class="t">{tr.title}</span>
          <span class="dots">{#each tr.present as s (s)}<i style:background={stemColor(s)}></i>{/each}</span>
          <small>{tr.artist}</small>
        </label>
      {:else}
        <p class="note">{query ? t("Ninguna coincide.") : t("No quedan canciones separadas sin añadir (sepáralas en la canción).")}</p>
      {/each}
    </div>
  </div>
  {#snippet footer()}
    <Button variant="ghost" onclick={() => ((adding = false), (picked = []))}>{t("Cancelar")}</Button>
    <Button variant="primary" disabled={!picked.length} onclick={addSongs}>{t("Añadir")}{picked.length ? ` (${picked.length})` : ""}</Button>
  {/snippet}
</Dialog>

<style>
  .sessions { display: grid; grid-template-columns: 300px minmax(0, 1fr); height: 100%; min-height: 0; }

  .list { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); background: var(--rail); }
  .list-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s2); padding: var(--s4) var(--s3) var(--s2); }
  .filter { display: flex; padding: 0 var(--s3) var(--s2); }
  .cards { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--s2); padding: var(--s1) var(--s3) var(--s5); }
  .sc {
    position: relative; display: flex; flex-direction: column; flex-shrink: 0; border-radius: var(--r-lg); border: 1px solid var(--line);
    background: var(--panel); overflow: hidden; transition: border-color var(--t-fast), background var(--t-fast);
  }
  .sc:hover { border-color: var(--line-hi); background: var(--panel-hi); }
  .sc.on { border-color: var(--accent-line); background: var(--panel-hi); }
  .sc.broken { opacity: 0.5; }
  .hit { position: absolute; inset: 0; z-index: 1; width: 100%; padding: 0; border: 0; border-radius: inherit; background: none; }
  .thumb { display: block; width: 100%; height: 44px; background: var(--bg); }
  .strip { position: relative; height: 5px; background: var(--bg); }
  .strip i { position: absolute; top: 0; bottom: 0; }
  .wave { padding: var(--s2) var(--s3) 0; }
  .meta { display: flex; flex-direction: column; padding: var(--s2) var(--s3); min-width: 0; }
  .t { color: var(--text); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .a { color: var(--text-3); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dots { display: flex; gap: 3px; margin-top: var(--s1); position: relative; z-index: 2; }
  .dots i { width: 8px; height: 8px; border-radius: 50%; }

  .detail { min-width: 0; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--s4); padding: var(--s5) var(--s6) 96px; }
  .detail > :global(*) { flex-shrink: 0; }
  .hero { display: flex; align-items: flex-end; justify-content: space-between; gap: var(--s4); flex-wrap: wrap; }
  .who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .kick { color: var(--text-3); font-size: var(--fs-xs); text-transform: uppercase; letter-spacing: 0.08em; }
  .who h1 { font-size: var(--fs-2xl); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sub { color: var(--text-2); }
  .actions { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
  .stats { display: grid; grid-template-columns: repeat(auto-fill, minmax(130px, 1fr)); gap: var(--s2); }
  .stat { display: flex; flex-direction: column; gap: 2px; padding: var(--s2) var(--s3); border-radius: var(--r-md); background: var(--panel); border: 1px solid var(--line); min-width: 0; }
  .stat span { color: var(--text-3); font-size: var(--fs-xs); }
  .stat b { font-size: var(--fs-lg); font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .err { display: flex; align-items: center; gap: var(--s2); color: var(--bad); font-size: var(--fs-sm); }

  .transport { display: flex; align-items: center; gap: var(--s3); }
  .clock { font-size: var(--fs-sm); white-space: nowrap; }
  .clock span { color: var(--text-3); }
  .master { flex: 1; min-width: 0; overflow: hidden; }
  .spin { display: grid; place-items: center; width: 40px; height: 40px; flex-shrink: 0; }
  .vol { display: flex; align-items: center; gap: var(--s2); width: 110px; color: var(--text-3); flex-shrink: 0; }
  .loading { display: flex; align-items: center; gap: var(--s3); color: var(--text-3); font-size: var(--fs-sm); padding: var(--s3) 0; }
  .lane-name { display: flex; align-items: center; gap: var(--s2); min-width: 0; font-weight: 600; }
  .lane-name i { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
  .lane-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lane-ctl { display: flex; align-items: center; gap: 2px; }
  .dim { color: var(--text-3); font-size: var(--fs-xs); }
  .zoom { display: flex; align-items: center; gap: var(--s2); align-self: flex-end; width: 160px; margin-top: calc(-1 * var(--s2)); color: var(--text-3); }

  .harmony { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: var(--s4); }
  h3 { display: flex; align-items: center; gap: var(--s2); margin-bottom: var(--s3); }
  h3 small { color: var(--text-3); font-weight: 400; }
  .note { color: var(--text-3); font-size: var(--fs-sm); }
  .bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--s2); }
  .bars li { display: grid; grid-template-columns: 96px minmax(0, 1fr) 4ch 5ch; align-items: center; gap: var(--s3); }
  .track { height: 10px; border-radius: var(--r-full); background: var(--panel-hi); overflow: hidden; }
  .track i { display: block; height: 100%; border-radius: inherit; transition: width var(--t-slow) var(--ease); }
  .pct { color: var(--text); font-size: var(--fs-sm); text-align: right; }
  .dur { color: var(--text-3); font-size: var(--fs-xs); text-align: right; }
  .wheel { display: grid; place-items: center; padding: 0 var(--s3); }
  .prog { display: flex; flex-wrap: wrap; gap: 4px; max-height: 168px; overflow-y: auto; }

  .ai { display: flex; flex-direction: column; gap: var(--s3); }
  .ai-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s3); flex-wrap: wrap; }
  .ai-head h2 { display: flex; align-items: center; gap: var(--s2); }
  .ai-stems { display: flex; gap: 6px; flex-wrap: wrap; }
  .ai-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: var(--s3); align-items: start; }
  .ai-grid p { color: var(--text-2); font-size: var(--fs-md); line-height: 1.75; margin-bottom: var(--s2); }
  .ai-grid p.li { position: relative; padding-left: var(--s4); }
  .ai-grid p.li::before { content: ""; position: absolute; left: 4px; top: 0.7em; width: 5px; height: 5px; border-radius: 50%; background: var(--text-3); }
  .ts { display: inline-flex; vertical-align: middle; margin: -2px 0; }

  .adder { display: flex; flex-direction: column; gap: var(--s3); }
  .picklist { display: flex; flex-direction: column; gap: 2px; max-height: 50vh; min-height: 120px; overflow-y: auto; }
  .picklist label { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 0 var(--s3); align-items: center; padding: var(--s2); border-radius: var(--r-md); cursor: pointer; }
  .picklist label:hover { background: var(--panel-hi); }
  .picklist label.on { background: var(--accent-soft); }
  .picklist input { grid-row: span 2; margin: 0; }
  .picklist .dots { margin: 0; }
  .picklist small { grid-column: 2 / 4; color: var(--text-3); font-size: var(--fs-xs); }

  @media (max-width: 1100px) {
    .harmony { grid-template-columns: minmax(0, 1fr); }
  }
</style>
