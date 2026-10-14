<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { arrange, easyTranspose, LEVELS, Practice, toBeat, toMusicXML, toSeconds, type Arrangement, type Level } from "./arrange";
  import { loadNotation } from "./ChordsTab.svelte";
  import { enqueue, paths, readJson, songDetail, STEM_INFO, writeBytes, type Detail, type Song } from "./engine";
  import { analyze, degree, fromModel, keyName, named, type Harmony, type Note } from "./harmony";
  import InputBar from "./InputBar.svelte";
  import { input, pcKey, pcRelease, useInput } from "./keys.svelte";
  import { Player, synth, voice } from "./player";
  import { loadPiano } from "./piano";
  import PieceEditor from "./PieceEditor.svelte";
  import { newPiece, pieceArrangement, pieceBeats, pieceLength, pieceSeconds, type Piece } from "./piece";
  import { deletePiece, importPieces, loadPieces, pieces, savePiece } from "./pieces.svelte";
  import Roll from "./Roll.svelte";
  import Score from "./Score.svelte";
  import { settings } from "./settings.svelte";
  import { jobOf, jobText, store } from "./store.svelte";
  import Transport from "./Transport.svelte";

  /** Modo Aprender: una canción separada como arreglo para piano (arrange.ts), del nivel 1 al 5, para tocarla encima de
   * sus pistas (sin la parte que tocas), con guía sintetizada, modo espera, bucle y piano roll o partitura. O una pieza
   * (escrita en el editor o importada de MIDI / MusicXML): el nivel 5 es la pieza tal cual. */
  let { onback, onsessions }: { onback: () => void; onsessions: () => void } = $props();

  type Opts = { melody: string; level: Level; transpose: "orig" | "easy" | number; hands: "both" | "rh" | "lh"; wait: boolean; view: "roll" | "score"; guide: number; song: number; hearMine: boolean; pieceRight: boolean; tab: "canciones" | "piezas"; speed: number };
  const DEFAULTS: Opts = { melody: "vocals", level: 1, transpose: "orig", hands: "both", wait: true, view: "roll", guide: 0.6, song: 0.8, hearMine: false, pieceRight: true, tab: "canciones", speed: 1 };
  const saved = (() => {
    try {
      return { ...DEFAULTS, ...JSON.parse(localStorage.getItem("estudio.aprender") ?? "{}") } as Opts;
    } catch {
      return DEFAULTS;
    }
  })();
  const o = $state<Opts>(saved);
  $effect(() => {
    const snap = JSON.stringify(o);
    try {
      localStorage.setItem("estudio.aprender", snap);
    } catch {}
  });
  const notation = loadNotation();

  // ---------------------------------------------------------------- canción

  let query = $state("");
  let key = $state<string | null>(null);
  const songs = $derived(
    store.tracks
      .filter((t) => t.stems && t.notes.length)
      .filter((t) => `${t.title} ${t.artist}`.toLowerCase().includes(query.trim().toLowerCase()))
      .sort((a, b) => a.title.localeCompare(b.title)),
  );

  const player = new Player();
  let detail = $state<Detail | null>(null);
  let notes = $state.raw<{ stem: string; notes: Note[] }[]>([]);
  let harmony = $state.raw<Harmony | null>(null);
  let beats = $state.raw<number[]>([]);
  let loading = $state(false);
  let error = $state("");
  let playing = $state(false);
  let time = $state(0);
  let baseDuration = $state(0); // a tempo
  /** A tempo reducido todo se estira: pulsos, notas, acordes y la duración. */
  const duration = $derived(baseDuration / o.speed);

  let piece = $state.raw<Piece | null>(null);
  let editing = $state.raw<Piece | null>(null);
  const loaded = $derived(!!detail || !!piece);
  const title = $derived(detail?.title ?? piece?.title ?? "");
  const piecesShown = $derived(pieces.list.filter((p) => p.title.toLowerCase().includes(query.trim().toLowerCase())));

  function reset() {
    player.stop();
    player.buffers.clear();
    player.duration = 0;
    playing = false;
    [detail, piece, error, time] = [null, null, "", 0];
  }

  /** Una pieza: sus manos como «piano» (derecha) y «bajo» (izquierda), para sacar acordes y tonalidad de sus notas. */
  function openPiece(pc: Piece) {
    key = null;
    reset();
    const ns = [{ stem: "piano", notes: pieceSeconds(pc, "rh") }, { stem: "bass", notes: pieceSeconds(pc, "lh") }].filter((t) => t.notes.length);
    const bs = pieceBeats(pc);
    const len = (pieceLength(pc) * 60) / pc.bpm;
    const h = analyze(ns, bs, len);
    [notes, beats, harmony, piece] = [ns, bs, { ...h, key: pc.key ?? h.key }, pc];
    baseDuration = len + 2;
  }

  async function newOrImport(kind: "new" | "import") {
    try {
      if (kind === "new") editing = await savePiece(newPiece());
      else {
        const added = await importPieces();
        if (added[0]) editing = added[0];
      }
      o.tab = "piezas";
    } catch (e) {
      error = `No se pudo importar: ${e}`;
    }
  }

  async function removePiece(pc: Piece) {
    if (!confirm(`Borrar la pieza «${pc.title}». No se puede deshacer.`)) return;
    await deletePiece(pc.id);
    if (piece?.id === pc.id) reset();
  }

  async function open(k: string) {
    key = k;
    piece = null;
    loading = true;
    error = "";
    player.stop();
    playing = false;
    detail = null;
    try {
      const d = await songDetail(k);
      if (key !== k) return;
      if (!d.stemlab) throw new Error("Esta canción no tiene las pistas separadas");
      const dir = d.stemlab.dir;
      const ns = await Promise.all(d.stemlab.stems.filter((s) => s.roll).map(async (s) => ({ stem: s.name, notes: await readJson<Note[]>(`${dir}/${s.roll}`, []) })));
      const bs = d.beatData?.beats?.length ? d.beatData.beats : Array.from({ length: Math.ceil((d.duration * (d.bpm ?? 120)) / 60) }, (_, i) => (i * 60) / (d.bpm ?? 120));
      const cs = d.chordData?.chords;
      if (!cs?.length && d.audio && !jobOf(k, "chords")) void enqueue("chords", [k]); // los del audio, para la próxima vez
      await player.load(d.stemlab.stems.map((s) => ({ name: s.name, path: `${dir}/${s.file}` })));
      if (key !== k) return;
      [notes, beats, harmony, detail] = [ns, bs, cs?.length ? fromModel(cs, ns, bs, d.duration) : analyze(ns, bs, d.duration), d];
      baseDuration = player.duration;
      time = 0;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  // ---------------------------------------------------------------- arreglo

  // la melodía que se usa: la elegida si ya tiene notas; si no (la voz sin transcribir), acordes mientras se sacan
  const melody = $derived(
    piece ? (o.pieceRight && notes.some((t) => t.stem === "piano") ? "piano" : "none") : o.melody !== "none" && notes.some((t) => t.stem === o.melody) ? o.melody : "none",
  );
  /** Pistas que pueden llevar la melodía: las que tienen notas y las que aún no (se sacan al elegirlas). */
  const melodyStems = $derived(
    (detail?.stemlab?.stems ?? []).filter((s) => s.name !== "drums" && s.present).map((s) => ({ name: s.name, ready: notes.some((t) => t.stem === s.name) })),
  );
  const notesJob = $derived(key && o.melody !== "none" && melody === "none" ? jobOf(key, "notes", o.melody) : undefined);
  function pickMelody(stem: string) {
    o.melody = stem;
    // sin notas todavía: a la cola (como en Analizar); al acabar la canción se recarga sola
    if (key && stem !== "none" && !notes.some((t) => t.stem === stem) && !jobOf(key, "notes", stem))
      void enqueue("notes", [key], [stem, ...(settings.notes === "precise" ? ["precise"] : [])]);
  }
  // cuando la cola cambia algo de esta canción (notas nuevas, acordes del audio), se vuelve a cargar
  let rev = 0;
  $effect(() => {
    const r = key ? (store.rev[key] ?? 0) : 0;
    if (r !== rev && key && untrack(() => !loading)) {
      const at = untrack(() => time);
      void open(key).then(() => seek(at));
    }
    rev = r;
  });

  const semis = $derived(!harmony ? 0 : o.transpose === "orig" ? 0 : o.transpose === "easy" ? easyTranspose(harmony.key) : o.transpose);
  const arr = $derived.by<Arrangement | null>(() => {
    if (!harmony || !loaded) return null;
    if (piece && o.level === 5) return pieceArrangement(piece, harmony.key, semis); // la pieza tal cual
    return arrange({
      melody: melody === "none" ? null : (notes.find((t) => t.stem === melody)?.notes ?? null),
      piano: notes.find((t) => t.stem === "piano")?.notes,
      bass: notes.find((t) => t.stem === "bass")?.notes,
      chords: harmony.chords,
      beats,
      downbeats: piece ? [0] : detail?.beatData?.downbeats,
      meter: piece ? piece.meter : detail?.beatData?.meter,
      key: harmony.key,
      level: o.level,
      transpose: semis,
    });
  });
  const slowBeats = $derived(o.speed === 1 ? beats : beats.map((t) => t / o.speed));
  const rhSec = $derived(arr ? toSeconds(arr.rh, slowBeats) : []);
  const lhSec = $derived(arr ? toSeconds(arr.lh, slowBeats) : []);
  // al cambiar de velocidad se sigue en el mismo punto de la canción (y el bucle, que era de otro tempo, fuera)
  let lastSpeed = untrack(() => o.speed);
  $effect(() => {
    const sp = o.speed;
    if (sp === lastSpeed) return;
    const at = untrack(() => time) * (lastSpeed / sp);
    lastSpeed = sp;
    untrack(() => {
      [loop, loopA, loopB] = [false, null, null];
      seek(at);
    });
  });
  const plays = (hand: "rh" | "lh") => o.hands === "both" || o.hands === hand;
  // acordes con el mismo transporte que el arreglo, para el piano roll
  const chords = $derived.by(() => {
    if (!harmony || !arr) return [];
    const up = (x: number) => (x + semis + 12) % 12;
    const cs = harmony.chords.map((c) => ({ ...c, t: c.t / o.speed, end: c.end / o.speed, root: up(c.root), bass: up(c.bass) }));
    return named(cs, arr.key, notation).map((c) => ({ ...c, deg: degree(c, arr.key) }));
  });

  // la guía: el arreglo sintetizado (lo que no tocas, y si quieres también lo tuyo, más bajo)
  let guideVersion = 0;
  $effect(() => {
    const [rh, lh] = [rhSec, lhSec];
    const v = ++guideVersion;
    const len = untrack(() => duration);
    if (!len) return;
    void Promise.all([synth(rh, len), synth(lh, len)]).then(([a, b]) => {
      if (v !== guideVersion) return;
      player.setBuffer("guia-rh", a);
      player.setBuffer("guia-lh", b);
      applyGains();
    });
  });

  /** La canción sin la parte que tocas: con transporte, solo la batería (el resto sonaría en otra tonalidad). */
  function applyGains() {
    for (const s of detail?.stemlab?.stems ?? []) {
      // transportada, solo la batería (lo demás iría en otra tonalidad); más lenta, nada (no se estira sin cambiar el tono)
      const off = o.speed !== 1 || (semis !== 0 && s.name !== "drums") || (s.name === melody && plays("rh"));
      player.setGain(s.name, off ? 0 : o.song);
    }
    for (const h of ["rh", "lh"] as const) player.setGain(`guia-${h}`, plays(h) ? (o.hearMine ? o.guide * 0.6 : 0) : o.guide);
  }
  $effect(() => {
    JSON.stringify([o.song, o.guide, o.hearMine, o.hands, melody, semis, o.speed]);
    untrack(applyGains);
  });
  $effect(() => player.setMaster(settings.masterVolume));

  // ---------------------------------------------------------------- práctica

  const practice = $derived(
    new Practice([...(plays("rh") ? rhSec.map(([t, , p]) => ({ t, p, hand: "rh" as const })) : []), ...(plays("lh") ? lhSec.map(([t, , p]) => ({ t, p, hand: "lh" as const })) : [])]),
  );
  // al cambiar de nivel, manos… la práctica nueva sigue desde donde vas, no desde el principio
  $effect(() => {
    const pr = practice;
    untrack(() => pr.reset(time));
  });
  let waiting: number | null = null;
  let stats = $state({ due: 0, hits: 0, wrong: 0, ms: 0 });
  const pressed = new Map<number, string>(); // tecla → color (verde acierto, rojo fallo)
  const voices = new Map<number, () => void>();
  let loopA = $state<number | null>(null);
  let loopB = $state<number | null>(null);
  let loop = $state(false);

  function onMidi(msg: number[]) {
    const [st, p, v] = msg;
    const kind = st & 0xf0;
    if (kind === 0x90 && v > 0) {
      const hit = practice.press(p, player.time(), waiting);
      pressed.set(p, hit ? "#9bd37f" : "#ff7a6b");
      if (!input.connected) voices.set(p, voice(player.ctx, p, v / 127)); // sin piano, que suene aquí
      // en espera: con todo el grupo tocado, sigue
      if (waiting != null && practice.blocking(waiting) == null) {
        waiting = null;
        player.play();
        playing = true;
      }
    } else if (kind === 0x80 || kind === 0x90) {
      pressed.delete(p);
      voices.get(p)?.();
      voices.delete(p);
    }
  }

  function toggle() {
    if (loading || !loaded) return;
    if (player.playing) player.pause();
    else {
      waiting = null;
      player.play();
    }
    playing = player.playing;
  }

  function seek(t: number) {
    player.seek(t);
    time = t;
    waiting = null;
    practice.reset(t);
  }

  function setLoop(which: "a" | "b") {
    if (which === "a") loopA = time;
    else loopB = time;
    if (loopA != null && loopB != null && loopB > loopA) loop = true;
  }

  // la entrada (MIDI y teclado) es de esta vista salvo mientras se edita una pieza: entonces es del editor
  $effect(() => {
    if (editing) return;
    return useInput(onMidi);
  });

  onMount(() => {
    void loadPiano().catch(() => {}); // que la primera nota ya suene a piano
    // desde Sesiones («Practicar en Aprender») llega con ?piece=<id>
    const want = new URLSearchParams(location.search).get("piece");
    void loadPieces().then(() => {
      const pc = want && pieces.list.find((p) => p.id === want);
      if (pc) ((o.tab = "piezas"), openPiece(pc));
    });
    let raf = 0;
    const tick = () => {
      time = player.time();
      if (player.playing) {
        if (loop && loopA != null && loopB != null && time >= loopB) seek(loopA);
        // modo espera: se para en la primera nota sin tocar que ya debería sonar
        const block = o.wait ? practice.blocking(time) : null;
        if (block != null) {
          player.pause();
          player.seek(block);
          waiting = block;
          playing = false;
        } else if (time >= duration) {
          player.stop();
          playing = false;
        }
      }
      stats = practice.stats(time);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      for (const off of voices.values()) off();
      player.stop();
      void player.ctx.close();
    };
  });

  // ---------------------------------------------------------------- partitura

  const learnDir = `${paths.data}/aprender`;
  const safe = $derived((key ?? piece?.id ?? "").replace(/[/:]/g, "_"));
  const scoreName = $derived(`${safe}__nivel${o.level}_${melody}${semis ? `_${semis > 0 ? "+" : ""}${semis}` : ""}`);
  let scorePath = $state("");
  $effect(() => {
    if (o.view !== "score" || !arr || !loaded) return;
    const path = `${learnDir}/${scoreName}.musicxml`;
    const xml = toMusicXML(arr, `${title} · nivel ${o.level}`);
    void writeBytes(path, new TextEncoder().encode(xml)).then(
      () => (scorePath = path),
      (e) => (error = `No se pudo guardar la partitura: ${e}`),
    );
  });
  const scoreSong = $derived<Song>({ id: key ?? piece?.id ?? "", title, dir: learnDir, mix: "", bpm: detail?.bpm ?? piece?.bpm ?? 120, stems: [] });

  const keyText = $derived(harmony ? keyName(harmony.key, notation.latin) + (semis && arr ? ` → ${keyName(arr.key, notation.latin)}` : "") : "");
  const fmtSemis = (n: number) => (n > 0 ? `+${n}` : String(n));
</script>

<svelte:window onkeydown={(e) => !editing && !(e.target instanceof Element && e.target.closest("input")) && pcKey(e)} onkeyup={(e) => !editing && pcKey(e)} onblur={() => !editing && pcRelease()} />

{#snippet controls()}
  <Transport {playing} {time} {duration} bind:volume={settings.masterVolume} disabled={loading || !loaded} ontoggle={toggle} onseek={seek}>
    <button class="ghost" class:on={loopA != null} onclick={() => setLoop("a")} title="Inicio del bucle aquí">A</button>
    <button class="ghost" class:on={loopB != null} onclick={() => setLoop("b")} title="Final del bucle aquí">B</button>
    <button class="ghost" class:on={loop} disabled={loopA == null || loopB == null} onclick={() => (loop = !loop)} title="Repetir de A a B">Bucle</button>
  </Transport>
{/snippet}

<div class="learn">
  <aside>
    <header>
      <button class="ghost" onclick={onback} title="Volver al menú">← Menú</button>
      <strong>Aprender</strong>
    </header>
    <div class="tabs">
      <button class:on={o.tab === "canciones"} onclick={() => (o.tab = "canciones")}>Canciones</button>
      <button class:on={o.tab === "piezas"} onclick={() => (o.tab = "piezas")}>Mis piezas</button>
    </div>
    <input type="search" placeholder="Buscar…" bind:value={query} />
    <div class="list">
      {#if o.tab === "piezas"}
        <div class="add">
          <button class="ghost" onclick={() => newOrImport("new")} title="Escribirla en el editor (con el piano o el ratón)">＋ Nueva</button>
          <button class="ghost" onclick={() => newOrImport("import")} title="MIDI (.mid) o MusicXML (.musicxml, .xml, .mxl)">Importar…</button>
        </div>
        {#each piecesShown as pc (pc.id)}
          <div class="item piece" class:on={piece?.id === pc.id}>
            <button class="open" onclick={() => openPiece(pc)}>
              <span>{pc.title}</span>
              <small>{pc.notes.length} notas · {pc.bpm} bpm</small>
            </button>
            <button class="icon-btn" onclick={() => (reset(), (editing = pc))} title="Editar" aria-label="Editar">✎</button>
            <button class="icon-btn" onclick={() => removePiece(pc)} title="Borrar" aria-label="Borrar">✕</button>
          </div>
        {:else}
          <p class="muted empty">Escribe una con «＋ Nueva» (tocando en el piano o con el ratón) o importa un MIDI o MusicXML.</p>
        {/each}
      {:else}
        {#each songs as t (t.key)}
          <button class="item" class:on={key === t.key} onclick={() => open(t.key)}>
            <span>{t.title}</span>
            <small>{t.artist}</small>
          </button>
        {:else}
          <p class="muted empty">Hacen falta canciones con las pistas separadas y sus notas (en Analizar).</p>
        {/each}
      {/if}
    </div>
  </aside>

  <main>
    {#if editing}
      <PieceEditor piece={editing} {onsessions} onclose={() => ((editing = null), void loadPieces())}
        onpractice={(pc) => ((editing = null), void loadPieces(), openPiece(pc))} />
    {:else}
    <div class="row">
      <InputBar />
      <span class="grow"></span>
      {#if loaded}
        <span class="mono score" title="Notas acertadas de las que ya tocaban · notas equivocadas · adelanto (−) o retraso (+) medio">
          {stats.hits}/{stats.due} · {stats.wrong} fallos{stats.hits ? ` · ${stats.ms > 0 ? "+" : ""}${stats.ms} ms` : ""}
        </span>
      {/if}
    </div>
    {#if loaded}
      <div class="row opts">
        {#if piece}
          <strong class="ptitle">{piece.title}</strong>
          <label>
            Derecha
            <select value={o.pieceRight ? "si" : "no"} onchange={(e) => (o.pieceRight = e.currentTarget.value === "si")}>
              <option value="si">la mano derecha de la pieza</option>
              <option value="no">acordes (solo acompañamiento)</option>
            </select>
          </label>
          <button class="ghost small" onclick={() => piece && ((editing = piece), reset())}>✎ Editar</button>
        {:else}
        <label>
          Melodía
          <select value={o.melody} onchange={(e) => pickMelody(e.currentTarget.value)}>
            {#each melodyStems as st (st.name)}
              <option value={st.name}>{STEM_INFO[st.name]?.label ?? st.name}{st.ready ? "" : " (sacar sus notas)"}</option>
            {/each}
            <option value="none">Ninguna: solo acompañamiento</option>
          </select>
        </label>
        {/if}
        <div class="seg" title="Dificultad">
          {#each LEVELS as [n, label] (n)}<button class:on={o.level === n} onclick={() => (o.level = n)} title={label}>{n}</button>{/each}
        </div>
        <small class="muted">{LEVELS[o.level - 1][1]}</small>
        <label title={keyText}>
          Tonalidad
          <select value={String(o.transpose)} onchange={(e) => (o.transpose = /^-?\d+$/.test(e.currentTarget.value) ? +e.currentTarget.value : (e.currentTarget.value as "orig" | "easy"))}>
            <option value="orig">Original ({harmony ? keyName(harmony.key, notation.latin) : ""})</option>
            <option value="easy">Fácil ({harmony ? fmtSemis(easyTranspose(harmony.key)) : ""})</option>
            {#each [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6] as n (n)}<option value={String(n)}>{fmtSemis(n)} semitonos</option>{/each}
          </select>
        </label>
        <div class="seg" title="Qué manos tocas: la otra la toca la guía">
          <button class:on={o.hands === "both"} onclick={() => (o.hands = "both")}>Ambas</button>
          <button class:on={o.hands === "rh"} onclick={() => (o.hands = "rh")}>Derecha</button>
          <button class:on={o.hands === "lh"} onclick={() => (o.hands = "lh")}>Izquierda</button>
        </div>
        <label title="La canción se para hasta que tocas la nota que toca"><input type="checkbox" bind:checked={o.wait} onchange={() => practice.reset(time)} /> Espera</label>
        <div class="seg">
          <button class:on={o.view === "roll"} onclick={() => (o.view = "roll")}>Piano roll</button>
          <button class:on={o.view === "score"} onclick={() => (o.view = "score")}>Partitura</button>
        </div>
      </div>
      <div class="row opts">
        {#if !piece}
          <label title={semis ? "Con transporte solo suena la batería: lo demás iría en otra tonalidad" : "Las pistas de la canción, sin la que tocas"}>
            Canción <input type="range" min="0" max="1.2" step="0.05" bind:value={o.song} />
          </label>
        {/if}
        <label title="Más lento para aprender: todo a ese tempo (de una canción, a tempo reducido suena solo la guía)">
          Tempo
          <select value={String(o.speed)} onchange={(e) => (o.speed = +e.currentTarget.value)}>
            {#each [1, 0.9, 0.8, 0.7, 0.6, 0.5] as v (v)}<option value={String(v)}>{Math.round(v * 100)} %</option>{/each}
          </select>
        </label>
        <label title="El arreglo sintetizado: lo que no tocas">Guía <input type="range" min="0" max="1" step="0.05" bind:value={o.guide} /></label>
        <label title="La guía también toca tu parte, más baja"><input type="checkbox" bind:checked={o.hearMine} /> Oír mi parte</label>
        {#if o.speed !== 1 && !piece}<small class="muted">Al {Math.round(o.speed * 100)} %: de la canción suena solo la guía (el audio no se puede ralentizar sin cambiar el tono).</small>
        {:else if semis && !piece}<small class="muted">Transportada {fmtSemis(semis)}: de la canción solo suena la batería.</small>{/if}
        {#if o.melody !== "none" && melody === "none"}
          <small class="note-warn">
            {STEM_INFO[o.melody]?.label ?? o.melody} sin notas todavía:
            {#if notesJob}sacándolas ({jobText(notesJob)}); la derecha lleva acordes mientras{:else}la derecha lleva acordes{/if}
          </small>
          {#if !notesJob}<button class="ghost small" onclick={() => pickMelody(o.melody)}>Sacar sus notas</button>{/if}
        {/if}
        {#if detail && !detail.chordData}<small class="muted">Acordes de las notas transcritas (los del audio están en la cola).</small>{/if}
      </div>
    {/if}

    {#if error}<p class="error-text">{error}</p>{/if}
    {#if loading}
      <div class="msg"><span class="spinner"></span></div>
    {:else if loaded && arr}
      {#if o.view === "roll"}
        <Roll {player} {controls} bind:windowSec={settings.rollSpeed} ontoggle={() => {}} {chords} keyLabel={keyText} tonality={arr.key} title="Arreglo"
          lit={() => pressed}
          tracks={[
            { stem: "rh", name: melody === "none" ? "Derecha: acordes" : "Derecha: melodía", color: "#f29d38", path: "rh", hidden: false, notes: rhSec },
            { stem: "lh", name: "Izquierda", color: "#74c6f0", path: "lh", hidden: false, notes: lhSec },
          ]} />
      {:else if scorePath}
        {#key scorePath}
          <Score song={scoreSong} stems={[]} path={scorePath} {player} {controls} bind:follow={settings.scoreFollow} title="{title} · nivel {o.level}"
            beatAt={(t) => toBeat(slowBeats, t) - arr.start} pdfName={scoreName} />
        {/key}
      {/if}
      <div class="bottom">{@render controls()}</div>
    {:else if !error}
      <div class="welcome"><h1>Elige una canción<br />y <em>tócala</em>.</h1>
        <p class="muted">Melodía y acompañamiento para piano, del nivel 1 al 5. Con el teclado MIDI o el del ordenador.</p></div>
    {/if}
    {/if}
  </main>
</div>

<style>
  .learn { height: 100vh; display: grid; grid-template-columns: 280px 1fr; }
  aside { background: var(--sidebar); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; gap: 8px; padding-bottom: 8px; }
  aside header { display: flex; align-items: center; gap: 12px; padding: 14px; border-bottom: 1px solid var(--line); }
  aside strong { font-family: var(--serif); font-weight: 400; font-size: 24px; }
  aside input { margin: 0 10px; }
  .list { overflow-y: auto; padding: 0 8px; display: flex; flex-direction: column; gap: 2px; }
  .item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 12px; border-radius: 10px; border: 0; background: none; color: var(--text); text-align: left; }
  .item:hover { background: var(--panel); }
  .item.on { background: var(--panel-hi); box-shadow: inset 2px 0 0 var(--accent); }
  .item small { color: var(--text-3); font-size: 11.5px; }
  .empty { padding: 12px; font-size: 13px; }
  .tabs { display: flex; margin: 0 10px; padding: 3px; border-radius: 10px; background: var(--bg); border: 1px solid var(--line); }
  .tabs button { flex: 1; padding: 5px 8px; border: 0; border-radius: 7px; background: none; color: var(--text-2); font-size: 12.5px; }
  .tabs button.on { background: var(--panel-hi); color: var(--text); }
  .add { display: flex; gap: 6px; padding: 2px 4px 8px; }
  .add button { flex: 1; padding: 6px 8px; font-size: 12.5px; }
  .piece { flex-direction: row !important; align-items: center !important; padding: 0 4px 0 0 !important; }
  .piece .open { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 8px 12px; border: 0; background: none; color: var(--text); text-align: left; min-width: 0; }
  .piece .open small { color: var(--text-3); font-size: 11.5px; }
  .ptitle { font-family: var(--serif); font-weight: 400; font-size: 20px; color: var(--text); }

  main { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 14px 24px 16px; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex-shrink: 0; }
  .opts { font-size: 12.5px; color: var(--text-2); }
  .opts label { display: flex; align-items: center; gap: 6px; }
  .opts select { font-size: 12px; padding: 4px 8px; }
  .opts input[type="range"] { width: 90px; }
  .grow { flex: 1; }
  .score { font-size: 12px; color: var(--text-2); }
  .note-warn { color: var(--accent); }
  .small { padding: 3px 10px; font-size: 12px; }
  .seg { display: flex; padding: 2px; border-radius: 9px; background: var(--bg); border: 1px solid var(--line); }
  .seg button { padding: 4px 10px; border: 0; border-radius: 7px; background: none; color: var(--text-2); font-size: 12px; }
  .seg button.on { background: var(--panel-hi); color: var(--text); }
  .bottom { flex-shrink: 0; }
  .msg { margin: auto; }
  .welcome { margin: auto; text-align: center; }
  .welcome h1 { font-family: var(--serif); font-weight: 400; font-size: 60px; line-height: 0.95; margin: 0 0 12px; }
  .welcome em { color: var(--accent); }
  :global(.transport button.on) { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 50%, var(--line)); }
</style>
