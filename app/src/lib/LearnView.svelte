<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, untrack } from "svelte";
  import { ARRANGED, arrange, easyTranspose, fromBeat, levelLabel, judge, LEVELS, median, Practice, toBeat, toMusicXML, toSeconds, VEL_TOL, type Arrangement, type Level } from "./arrange";
  import { accuracy, hardZones, tally, wrongAt, type Bars, type Zone } from "./zones";
  import { loadNotation } from "./ChordsTab.svelte";
  import { enqueue, paths, readJson, songDetail, STEM_INFO, writeBytes, writeJson, type Detail, type Song } from "./engine";
  import { analyze, degree, fromModel, keyName, named, type Harmony, type Note } from "./harmony";
  import InputBar from "./InputBar.svelte";
  import { input, pcKey, pcRelease, useInput } from "./keys.svelte";
  import { Player, voice } from "./player";
  import { loadPiano } from "./piano";
  import { keyOf, LESSONS, stars, type Practice as CoursePractice } from "./course";
  import { EX_LEVELS, EXERCISES, exercisePiece, type Exercise, type Hands } from "./exercises";
  import { OBRA_LEVELS, OBRAS, type Obra } from "./obras";
  import { record } from "./progress.svelte";
  import { songPiece, SONGS } from "./songs";
  import PieceEditor from "./PieceEditor.svelte";
  import { fromMidi, newPiece, pieceArrangement, pieceBeats, pieceDuration, pieceSeconds, type Piece } from "./piece";
  import { deletePiece, importPieces, loadPieces, pieces, savePiece } from "./pieces.svelte";
  import Roll from "./Roll.svelte";
  import SearchInput from "./SearchInput.svelte";
  import Score from "./Score.svelte";
  import { saveSettings, settings } from "./settings.svelte";
  import { jobOf, jobText, store } from "./store.svelte";
  import Transport from "./Transport.svelte";

  /** Modo Aprender: una canción separada como arreglo para piano (arrange.ts), del nivel 1 al 5, para tocarla encima de
   * sus pistas (sin la parte que tocas), con guía sintetizada, modo espera, bucle y piano roll o partitura. O una pieza
   * (escrita en el editor o importada de MIDI / MusicXML): el nivel 5 es la pieza tal cual. */
  let { onback, onsessions, oncourse }: { onback: () => void; onsessions: () => void; oncourse: (lesson: string, step: number) => void } = $props();
  const backToLesson = () => lessonPractice && oncourse(lessonPractice.lesson, lessonPractice.step);

  type Opts = { melody: string; level: Level; transpose: "orig" | "easy" | number; hands: "both" | "rh" | "lh"; wait: boolean; view: "roll" | "score"; guide: number; song: number; hearMine: boolean; pieceRight: boolean; tab: "canciones" | "piezas" | "ejercicios" | "obras"; speed: number; exKey: number; exMinor: boolean; exHands: Hands; more: boolean; list: boolean; style: "clasico" | "pop" };
  const DEFAULTS: Opts = { melody: "vocals", level: 1, transpose: "orig", hands: "both", wait: true, view: "roll", guide: 0.6, song: 0.8, hearMine: false, pieceRight: true, tab: "canciones", speed: 1, exKey: 0, exMinor: false, exHands: "rh", more: false, list: true, style: "clasico" };
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
  // las pistas de la canción y a qué velocidad están cargadas (más lentas: estiradas con FFmpeg, sin cambiar el tono)
  let stemSrcs: { name: string; path: string }[] = [];
  let audioSpeed = $state(1);
  let stretching = $state(false);
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
    exercise = null;
    obra = null;
    lessonPractice = null;
    const ns = [{ stem: "piano", notes: pieceSeconds(pc, "rh") }, { stem: "bass", notes: pieceSeconds(pc, "lh") }].filter((t) => t.notes.length);
    const bs = pieceBeats(pc);
    const len = pieceDuration(pc);
    const h = analyze(ns, bs, len);
    [notes, beats, harmony, piece] = [ns, bs, { ...h, key: pc.key ?? h.key }, pc];
    baseDuration = len + 2;
  }

  // ---------------------------------------------------------------- ejercicios

  let exercise = $state.raw<Exercise | null>(null);
  const exKey = $derived({ tonic: o.exKey, minor: o.exMinor });
  function openExercise(ex: Exercise) {
    openPiece(exercisePiece(ex, exKey, o.exHands, notation.latin));
    exercise = ex;
  }
  // otra tonalidad o manos con el ejercicio abierto: el mismo ejercicio, en las nuevas
  $effect(() => {
    void [o.exKey, o.exMinor, o.exHands];
    const ex = untrack(() => exercise);
    if (ex) untrack(() => openExercise(ex));
  });
  const exShown = $derived(EXERCISES.filter((e) => `${e.title} ${e.concept}`.toLowerCase().includes(query.trim().toLowerCase())));

  // ---------------------------------------------------------------- obras (Mutopia, en public/obras)

  let obra = $state.raw<Obra | null>(null);
  async function openObra(ob: Obra) {
    try {
      const r = await fetch(`/obras/m${ob.id}.mid`);
      if (!r.ok) throw new Error(`m${ob.id}.mid: ${r.status}`);
      const pc = fromMidi(new Uint8Array(await r.arrayBuffer()), ob.title);
      openPiece({ ...pc, id: `obra-${ob.id}`, title: `${ob.composer}: ${ob.title}` });
      obra = ob;
    } catch (e) {
      error = `No se pudo abrir la obra: ${e}`;
    }
  }
  const obrasShown = $derived(OBRAS.filter((x) => `${x.title} ${x.composer}`.toLowerCase().includes(query.trim().toLowerCase())));

  // ---------------------------------------------------------------- practicar desde el curso

  /** La práctica del curso en curso: al llegar al final se apunta el resultado (progreso, estrellas). */
  let lessonPractice = $state.raw<{ lesson: string; step: number; title: string; lessonTitle: string; goal: number } | null>(null);
  let lessonResult = $state<number | null>(null);
  async function openCoursePractice(lessonId: string, stepIdx: number) {
    const l = LESSONS.find((x) => x.id === lessonId), step = l?.steps[stepIdx];
    if (!l || !step || !("p" in step)) return;
    const p: CoursePractice = step.p;
    o.wait = true;
    o.transpose = "orig"; // en la tonalidad que dice la lección
    if (p.kind === "ejercicio") {
      const ex = EXERCISES.find((e) => e.id === p.id);
      if (!ex) return;
      const k = keyOf(p.key);
      [o.tab, o.exKey, o.exMinor, o.exHands, o.hands] = ["ejercicios", k.tonic, k.minor, p.hands ?? (ex.oneHand ? "rh" : "both"), "both"];
      openExercise(ex);
    } else if (p.kind === "cancion") {
      const song = SONGS.find((x) => x.id === p.id);
      if (!song) return;
      openPiece(songPiece(song));
      [o.level, o.hands, o.pieceRight] = [p.level ?? 5, p.hands ?? "both", true];
    } else if (p.kind === "obra") {
      const ob = OBRAS.find((x) => x.id === p.id);
      if (!ob) return;
      o.tab = "obras";
      await openObra(ob);
      [o.level, o.hands, o.pieceRight] = [p.level ?? 5, p.hands ?? "both", true];
    }
    lessonPractice = { lesson: l.id, step: stepIdx, title: step.title, lessonTitle: l.title, goal: step.goal ?? 0.85 };
    lessonResult = null;
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
      stemSrcs = d.stemlab.stems.map((s) => ({ name: s.name, path: `${dir}/${s.file}` }));
      await player.load(stemSrcs);
      audioSpeed = 1;
      if (key !== k) return;
      [notes, beats, harmony, detail] = [ns, bs, cs?.length ? fromModel(cs, ns, bs, d.duration) : analyze(ns, bs, d.duration), d];
      baseDuration = player.duration;
      time = 0;
      if (o.speed !== 1) void loadStems(o.speed); // abierta ya a tempo reducido
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

  // un ejercicio va en la tonalidad y con las manos que dice el suyo: ni se transporta ni se reparte con la guía
  const semis = $derived(!harmony || exercise ? 0 : o.transpose === "orig" ? 0 : o.transpose === "easy" ? easyTranspose(harmony.key) : o.transpose);
  const arr = $derived.by<Arrangement | null>(() => {
    if (!harmony || !loaded) return null;
    if (piece && (o.level === 5 || piece.exercise)) return pieceArrangement(piece, harmony.key, semis); // la pieza tal cual (un ejercicio, siempre)
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
      style: o.style,
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
      void loadStems(sp);
      if (activeZone) applyZone(activeZone); // practicando un pasaje: el mismo, a la nueva velocidad
    });
  });

  /** Las pistas de la canción a la velocidad `sp` (la primera vez se estiran: unos segundos), sin perder el sitio. */
  let stemsVersion = 0;
  async function loadStems(sp: number) {
    if (!detail || !stemSrcs.length || sp === audioSpeed) return;
    const v = ++stemsVersion, k = key;
    stretching = sp !== 1;
    try {
      const paths = sp === 1 ? stemSrcs.map((x) => x.path) : await invoke<string[]>("stretch_stems", { key: k, files: stemSrcs.map((x) => x.path), speed: sp });
      if (v !== stemsVersion || key !== k) return;
      await player.swap(stemSrcs.map((x, i) => ({ name: x.name, path: paths[i] })));
      if (v !== stemsVersion || key !== k) return;
      audioSpeed = sp;
      applyGains();
    } catch (e) {
      error = `No se pudieron preparar las pistas más lentas: ${e}`;
    } finally {
      if (v === stemsVersion) stretching = false;
    }
  }
  const myHands = $derived(exercise ? "both" : o.hands);
  const plays = (hand: "rh" | "lh") => myHands === "both" || myHands === hand;
  // acordes con el mismo transporte que el arreglo, para el piano roll
  const chords = $derived.by(() => {
    if (!harmony || !arr) return [];
    const up = (x: number) => (x + semis + 12) % 12;
    const cs = harmony.chords.map((c) => ({ ...c, t: c.t / o.speed, end: c.end / o.speed, root: up(c.root), bass: up(c.bass) }));
    return named(cs, arr.key, notation).map((c) => ({ ...c, deg: degree(c, arr.key) }));
  });

  // la guía: el arreglo tocado en vivo con el piano (lo que no tocas, y si quieres también lo tuyo, más bajo); al
  // cambiar de velocidad, nivel o manos, la nueva suena al momento
  $effect(() => {
    const [rh, lh] = [rhSec, lhSec];
    untrack(() => {
      player.setNotes("guia-rh", rh);
      player.setNotes("guia-lh", lh);
      applyGains();
    });
  });

  // el reloj del reproductor corre lo que dura el arreglo (una pieza no tiene pistas de audio, solo la guía en vivo)
  $effect(() => {
    player.minDuration = duration;
  });

  // sin espera, nada se queda esperando: si estaba parado en una nota, sigue
  $effect(() => {
    if (o.wait || untrack(() => waiting) == null) return;
    untrack(() => {
      waiting = null;
      player.play();
      playing = true;
    });
  });

  /** La canción sin la parte que tocas: con transporte, solo la batería (el resto sonaría en otra tonalidad). */
  function applyGains() {
    for (const s of detail?.stemlab?.stems ?? []) {
      // transportada, solo la batería (lo demás iría en otra tonalidad); más lenta, solo cuando ya están estiradas
      const off = audioSpeed !== o.speed || (semis !== 0 && s.name !== "drums") || (s.name === melody && plays("rh"));
      player.setGain(s.name, off ? 0 : o.song);
    }
    for (const h of ["rh", "lh"] as const) player.setGain(`guia-${h}`, plays(h) ? (o.hearMine ? o.guide * 0.6 : 0) : o.guide);
  }
  $effect(() => {
    JSON.stringify([o.song, o.guide, o.hearMine, myHands, melody, semis, o.speed, audioSpeed]);
    untrack(applyGains);
  });
  $effect(() => player.setMaster(settings.masterVolume));

  // ---------------------------------------------------------------- práctica

  const practice = $derived(
    new Practice([...(plays("rh") ? rhSec.map(([t, e, p, v]) => ({ t, e, p, v, hand: "rh" as const })) : []), ...(plays("lh") ? lhSec.map(([t, e, p, v]) => ({ t, e, p, v, hand: "lh" as const })) : [])]),
  );
  // al cambiar de nivel, manos… la práctica nueva sigue desde donde vas, no desde el principio
  $effect(() => {
    const pr = practice;
    untrack(() => (pr.reset(time), (recent = [])));
  });
  let waiting: number | null = null;
  let stats = $state<ReturnType<Practice["stats"]>>({ due: 0, hits: 0, wrong: 0, ms: 0, force: null, offForce: 0, sd: 0 });
  const pressed = new Map<number, string>(); // tecla → color (verde acierto, rojo fallo)
  // tiempo de las últimas notas (ms, − adelantado / + atrasado) para la tira de al lado de la puntuación
  let recent = $state<number[]>([]);
  const TIMING_COLOR = { ontime: "#9bd37f", near: "#9bd37f", early: "#6aa9ff", late: "#ff5a5a" };
  // calibración: 16 toques sobre un clic cada 0,6 s; la mediana del desfase es la latencia
  let calib = $state<{ clicks: number[]; taps: number[] } | null>(null);
  function calibrate() {
    const ctx = player.ctx;
    void ctx.resume();
    const t0 = ctx.currentTime + 1;
    const clicks = Array.from({ length: 20 }, (_, i) => t0 + i * 0.6);
    for (const t of clicks) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = 1000;
      g.gain.setValueAtTime(0.3, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.06);
    }
    calib = { clicks, taps: [] };
  }
  function calibTap() {
    const c = calib!;
    const now = player.ctx.currentTime;
    const near = c.clicks.reduce((a, b) => (Math.abs(b - now) < Math.abs(a - now) ? b : a));
    if (Math.abs(now - near) > 0.3) return; // lejos de cualquier clic: despiste
    c.taps.push(now - near);
    if (c.taps.length >= 16) {
      settings.latencyMs = Math.max(0, Math.round(1000 * median(c.taps)));
      saveSettings();
      calib = null;
    }
  }
  const held = (p: number) => pressed.has(p);
  const voices = new Map<number, () => void>();
  let loopA = $state<number | null>(null);
  let loopB = $state<number | null>(null);
  let loop = $state(false);

  function onMidi(msg: number[]) {
    const [st, p, v] = msg;
    const kind = st & 0xf0;
    if (kind === 0x90 && v > 0) {
      if (calib) return calibTap();
      // parado y se empieza a tocar: arranca solo. Si lo siguiente que toca está cerca, desde ahí, como en espera (sigue
      // al completar esa nota o acorde, y cuenta); si queda lejos (una intro), desde donde estaba
      if (!player.playing && waiting == null && loaded && !loading) {
        const now = from();
        practice.reset(now), (recent = []); // otra pasada desde aquí (si acabó, desde el principio)
        const next = practice.targets.find((x) => !x.skipped && x.t >= now - practice.tol);
        if (next && next.t - now <= 1) {
          if (now < 0.5) lessonResult = null;
          player.seek(next.t);
          time = waiting = next.t;
        } else start(now);
      }
      // la fuerza solo cuenta con teclado MIDI (el del ordenador siempre toca igual)
      // Hora = al llegar el mensaje al JS. El callback de midir trae un sello en µs, pero con un origen propio que no se
      // puede casar con el reloj de audio; el salto Rust→JS (Channel) son ~1 ms, bajo la ventana de 35 ms. Lo que de
      // verdad pesa es la latencia fija teclado→oído: se resta la calibrada.
      const hit = practice.press(p, player.time() - settings.latencyMs / 1000, waiting, input.connected ? v / 127 : undefined);
      if (!hit && arr) ((wrongAt(bars(), barAt(player.time())), (zonesDirty = true)));
      const forceOff = hit?.vel != null && hit.v != null && Math.abs(hit.vel - hit.v) > VEL_TOL;
      const tm = hit?.err != null ? judge(hit.err) : null;
      if (tm && !(waiting != null && Math.abs(hit!.err!) > practice.tol)) recent = [...recent.slice(-15), Math.round(1000 * hit!.err!)];
      pressed.set(p, !hit ? "#ff7a6b" : tm && tm !== "ontime" && tm !== "near" ? TIMING_COLOR[tm] : forceOff ? "#f6c84a" : "#9bd37f");
      if (!input.connected) voices.set(p, voice(player.ctx, p, v / 127)); // sin piano, que suene aquí
      // en espera: con todo el grupo tocado, sigue
      if (waiting != null && practice.blocking(waiting) == null && !practice.released(waiting, held)) {
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
    if (player.playing) {
      player.pause();
      playing = false;
    } else if (waiting != null) {
      // parada esperando una nota: el play la salta (queda sin tocar) y sigue
      // (y si esperaba a que se mantuviera una nota, esa deja de pedirlo)
      for (const x of practice.targets)
        if ((!x.hit && Math.abs(x.t - waiting) < 0.03) || (x.e != null && x.t <= waiting && waiting < x.e)) x.skipped = true;
      waiting = null;
      player.play();
      playing = true;
    } else start(from());
  }

  /** Desde dónde empieza a sonar: donde está, o el principio si ya acabó. */
  const from = () => (player.time() >= duration - 0.05 ? 0 : player.time());
  /** Empezar a sonar en `at`: lo que queda vuelve a estar pendiente (otra pasada) y lo de antes sin tocar, saltado. */
  function start(at: number) {
    if (at < 0.5) lessonResult = null;
    player.seek(at);
    time = at;
    practice.reset(at), (recent = []);
    waiting = null;
    player.play();
    playing = true;
  }

  function seek(t: number) {
    if (t < 0.5) lessonResult = null; // desde el principio: otro intento
    player.seek(t);
    time = t;
    waiting = null;
    practice.reset(t), (recent = []);
  }

  function setLoop(which: "a" | "b") {
    activeZone = null;
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
    const params = new URLSearchParams(location.search);
    const want = params.get("piece");
    if (params.get("leccion")) void openCoursePractice(params.get("leccion")!, +(params.get("paso") ?? 0));
    void loadPieces().then(() => {
      const pc = want && pieces.list.find((p) => p.id === want);
      if (pc) ((o.tab = "piezas"), openPiece(pc));
    });
    let raf = 0;
    // bucle, espera y final: en cada frame y además con un temporizador, que el reloj del audio sigue aunque la ventana
    // no se pinte (oculta, o a tirones) y la espera no puede dejar pasar notas
    const check = () => {
      time = player.time();
      if (player.playing) {
        if (loop && loopA != null && loopB != null && time >= loopB) {
          // una pasada del bucle: si ha salido bien y va más lento que el original, se propone subir el tempo
          const inLoop = practice.targets.filter((x) => x.t >= loopA! && x.t < loopB! && !x.skipped);
          const acc = inLoop.length ? inLoop.filter((x) => x.hit).length / inLoop.length : 0;
          suggestUp = acc >= 0.9 && o.speed < 1;
          seek(loopA);
        }
        // modo espera: se para en la primera nota sin tocar que ya debería sonar
        // y solo sigue mientras se mantiene pulsado lo que suena: si se suelta antes, se para ahí hasta volver a pulsar
        const block = o.wait ? practice.blocking(time) : null;
        if (block != null) {
          player.pause();
          player.seek(block);
          waiting = block;
          playing = false;
        } else if (o.wait && practice.released(time, held)) {
          player.pause();
          waiting = player.time();
          playing = false;
        } else if (time >= duration) {
          player.stop();
          playing = false;
          // práctica del curso hecha entera: su resultado al progreso
          if (lessonPractice && lessonResult == null && stats.due > 0) {
            lessonResult = stats.hits / (stats.due + stats.wrong);
            void record(lessonPractice.lesson, lessonPractice.step, lessonResult);
          }
        }
      }
    };
    const watch = setInterval(check, 40);
    const tick = () => {
      check();
      stats = practice.stats(time);
      if (arr && tally(bars(), practice.targets, time, practice.tol, barAt)) zonesDirty = true;
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(watch);
      for (const off of voices.values()) off();
      player.stop();
      void player.ctx.close();
    };
  });

  // ---------------------------------------------------------------- zonas difíciles

  // por canción o pieza, lo que sale cada compás, separado por nivel, melodía y manos (cada combinación es otra música)
  let zoneBook: Record<string, Bars> = {};
  let zonesDirty = false;
  let zonesRev = $state(0); // para repintar el mapa y la lista (cada medio segundo como mucho)
  let activeZone = $state<Zone | null>(null);
  let suggestUp = $state(false);
  const zonePath = () => `${learnDir}/zonas/${safe}.json`;
  const zoneKey = $derived(`${o.level}${o.style === "pop" && o.level !== 5 ? "pop" : ""}/${melody}/${myHands}`);
  const bars = () => (zoneBook[zoneKey] ??= {});
  /** El compás (desde 0, el primero completo tras la anacrusa) de un instante. */
  const barAt = (t: number) => (arr ? Math.floor((toBeat(slowBeats, t) - arr.start) / arr.meter) : 0);
  const barTime = (i: number) => (arr ? fromBeat(slowBeats, arr.start + i * arr.meter) : 0);

  async function loadZones() {
    if (!safe) return;
    zoneBook = await readJson<Record<string, Bars>>(zonePath(), {});
    zonesRev++;
  }
  async function saveZones() {
    if (!zonesDirty || !safe) return;
    zonesDirty = false;
    await writeJson(zonePath(), zoneBook);
  }
  $effect(() => {
    void safe; // otra canción o pieza: se guarda lo de la anterior y se carga lo suyo
    untrack(() => void saveZones().then(loadZones));
  });
  onMount(() => {
    const t = setInterval(() => {
      if (zonesDirty) zonesRev++;
      void saveZones();
    }, 5000);
    const r = setInterval(() => zonesDirty && zonesRev++, 500);
    return () => {
      clearInterval(t);
      clearInterval(r);
      void saveZones();
    };
  });

  const nBars = $derived(arr ? Math.max(1, Math.ceil((toBeat(slowBeats, duration) - arr.start) / arr.meter)) : 0);
  const barMap = $derived.by(() => {
    void zonesRev;
    void zoneKey;
    const b = bars();
    return Array.from({ length: nBars }, (_, i) => accuracy(b[i]));
  });
  const zones = $derived.by(() => {
    void zonesRev;
    void zoneKey;
    return hardZones(bars(), 0.8, 4, 3);
  });
  const nowBar = $derived(barAt(time));
  const barColor = (a: number | null) => (a == null ? "var(--line)" : a >= 0.9 ? "#9bd37f" : a >= 0.75 ? "#e8c45a" : a >= 0.5 ? "#f29d38" : "#ff7a6b");

  // reiniciar lo apuntado de esta pieza en lo que se ve (nivel, melodía y manos); el resto se queda. Dos clics
  const hasZoneData = $derived.by(() => (void zonesRev, barMap.some((a) => a != null)));
  let confirmReset = $state(false);
  let confirmTimer: ReturnType<typeof setTimeout> | undefined;
  function resetZones() {
    if (!confirmReset) {
      confirmReset = true;
      clearTimeout(confirmTimer);
      confirmTimer = setTimeout(() => (confirmReset = false), 3000);
      return;
    }
    confirmReset = false;
    delete zoneBook[zoneKey];
    [activeZone, loop, suggestUp] = [null, false, false];
    zonesDirty = true;
    zonesRev++;
    void saveZones();
  }

  /** Practicar un pasaje: en bucle con un compás antes, en espera y como mucho al 70 %. */
  function practiceZone(z: Zone) {
    activeZone = z;
    suggestUp = false;
    o.wait = true;
    if (o.speed > 0.7) o.speed = 0.7; // el cambio de velocidad pone el bucle (applyZone)
    else applyZone(z);
  }
  function applyZone(z: Zone) {
    [loopA, loopB] = [barTime(Math.max(0, z.from - 1)), barTime(z.to + 1)];
    loop = true;
    seek(loopA);
  }

  // ---------------------------------------------------------------- partitura

  const learnDir = `${paths.data}/aprender`;
  const safe = $derived((key ?? piece?.id ?? "").replace(/[/:]/g, "_"));
  const scoreName = $derived(`${safe}__nivel${levelLabel(o.level)}${o.style === "pop" && o.level !== 5 ? "pop" : ""}_${melody}${semis ? `_${semis > 0 ? "+" : ""}${semis}` : ""}`);
  let scorePath = $state("");
  $effect(() => {
    if (o.view !== "score" || !arr || !loaded) return;
    const path = `${learnDir}/${scoreName}.musicxml`;
    const xml = toMusicXML(arr, `${title} · ${o.level === 5 ? "original" : `nivel ${levelLabel(o.level)}`}`);
    void writeBytes(path, new TextEncoder().encode(xml)).then(
      () => (scorePath = path),
      (e) => (error = `No se pudo guardar la partitura: ${e}`),
    );
  });
  const scoreSong = $derived<Song>({ id: key ?? piece?.id ?? "", title, dir: learnDir, mix: "", bpm: detail?.bpm ?? piece?.bpm ?? 120, stems: [] });

  const keyText = $derived(harmony ? keyName(harmony.key, notation.latin) + (semis && arr ? ` → ${keyName(arr.key, notation.latin)}` : "") : "");
  const fmtSemis = (n: number) => (n > 0 ? `+${n}` : String(n));
</script>

<svelte:window onpointerdown={(e) => o.more && !(e.target instanceof Element && e.target.closest(".more-wrap")) && (o.more = false)} onkeydown={(e) => !editing && !(e.target instanceof Element && e.target.closest("input")) && pcKey(e)} onkeyup={(e) => !editing && pcKey(e)} onblur={() => !editing && pcRelease()} />

{#snippet controls()}
  <Transport {playing} {time} {duration} bind:volume={settings.masterVolume} disabled={loading || !loaded} ontoggle={toggle} onseek={seek}>
    <button class="ghost sm" class:on={loopA != null} onclick={() => setLoop("a")} title="Inicio del bucle aquí">A</button>
    <button class="ghost sm" class:on={loopB != null} onclick={() => setLoop("b")} title="Final del bucle aquí">B</button>
    <button class="ghost sm" class:on={loop} disabled={loopA == null || loopB == null} onclick={() => (loop = !loop)} title="Repetir de A a B">Bucle</button>
  </Transport>
{/snippet}

{#snippet opts()}
  <div class="toolbar opts">
    {#if !exercise}
      <div class="grp" title="Dificultad: {LEVELS[o.level - 1][1]}">
        <span class="lbl">Nivel</span>
        <div class="seg">{#each ARRANGED as n (n)}<button class:on={o.level === n} onclick={() => (o.level = n)} title={LEVELS[n - 1][1]}>{levelLabel(n)}</button>{/each}</div>
        <button class="ghost sm" class:on={o.level === 5} onclick={() => (o.level = 5)} title={LEVELS[4][1]}>Original</button>
      </div>
      {#if o.level !== 5}
        <div class="grp" title="Cómo acompaña el arreglo: arpegios y bajo-acorde clásicos, o el ritmo y las octavas del pop">
          <span class="lbl">Estilo</span>
          <div class="seg">
            <button class:on={o.style !== "pop"} onclick={() => (o.style = "clasico")}>Clásico</button>
            <button class:on={o.style === "pop"} onclick={() => (o.style = "pop")}>Pop</button>
          </div>
        </div>
      {/if}
      <div class="grp" title="Qué manos tocas: la otra la toca la guía">
        <span class="lbl">Manos</span>
        <div class="seg">
          <button class:on={o.hands === "both"} onclick={() => (o.hands = "both")}>Ambas</button>
          <button class:on={o.hands === "rh"} onclick={() => (o.hands = "rh")}>Der.</button>
          <button class:on={o.hands === "lh"} onclick={() => (o.hands = "lh")}>Izq.</button>
        </div>
      </div>
    {/if}
    <div class="grp">
      <label title="La canción se para hasta que tocas la nota que toca, y solo sigue mientras la mantienes"><input type="checkbox" bind:checked={o.wait} onchange={() => (practice.reset(time), (recent = []))} /> Espera</label>
      <label title="Más lento para aprender: todo a ese tempo (de una canción, a tempo reducido suena solo la guía)">
        <span class="lbl">Tempo</span>
        <select value={String(o.speed)} onchange={(e) => (o.speed = +e.currentTarget.value)}>
          {#each [1, 0.9, 0.8, 0.7, 0.6, 0.5] as v (v)}<option value={String(v)}>{Math.round(v * 100)} %</option>{/each}
        </select>
      </label>
    </div>
    <div class="grp">
      <div class="seg">
        <button class:on={o.view === "roll"} onclick={() => (o.view = "roll")}>Roll</button>
        <button class:on={o.view === "score"} onclick={() => (o.view = "score")}>Partitura</button>
      </div>
    </div>
    <div class="grp more-wrap">
      <button class="ghost sm" class:on={o.more} onclick={() => (o.more = !o.more)} title="Teclado, melodía, tonalidad, volúmenes…">Ajustes {o.more ? "▴" : "▾"}</button>
      {#if o.more}
        <div class="pop more-pop">
          <div class="row opts"><InputBar /></div>
          <div class="row opts">
            <label>
              Latencia (ms)
              <input type="number" min="0" max="300" step="5" bind:value={settings.latencyMs} onchange={saveSettings} style="width: 70px" />
            </label>
            {#if calib}
              <span class="muted">Toca una tecla con cada clic: {calib.taps.length}/16</span>
              <button class="ghost sm" onclick={() => (calib = null)}>Cancelar</button>
            {:else}
              <button class="ghost sm" onclick={calibrate} title="Suenan clics: toca una tecla a la vez que cada uno, 16 veces. La mediana del desfase es la latencia del teclado y del sonido.">Calibrar</button>
            {/if}
          </div>
          <div class="row opts">
            {#if piece && !exercise}
              <label>
                Derecha
                <select value={o.pieceRight ? "si" : "no"} onchange={(e) => (o.pieceRight = e.currentTarget.value === "si")}>
                  <option value="si">la mano derecha de la pieza</option>
                  <option value="no">acordes (solo acompañamiento)</option>
                </select>
              </label>
              <button class="ghost sm" onclick={() => piece && ((editing = piece), reset())}>✎ Editar</button>
            {:else if !piece}
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
            {#if !exercise}
              <label title={keyText}>
                Tonalidad
                <select value={String(o.transpose)} onchange={(e) => (o.transpose = /^-?\d+$/.test(e.currentTarget.value) ? +e.currentTarget.value : (e.currentTarget.value as "orig" | "easy"))}>
                  <option value="orig">Original ({harmony ? keyName(harmony.key, notation.latin) : ""})</option>
                  <option value="easy">Fácil ({harmony ? fmtSemis(easyTranspose(harmony.key)) : ""})</option>
                  {#each [-6, -5, -4, -3, -2, -1, 1, 2, 3, 4, 5, 6] as n (n)}<option value={String(n)}>{fmtSemis(n)} semitonos</option>{/each}
                </select>
              </label>
            {/if}
            {#if !piece}
              <label title={semis ? "Con transporte solo suena la batería: lo demás iría en otra tonalidad" : "Las pistas de la canción, sin la que tocas"}>
                Canción <input type="range" min="0" max="1.2" step="0.05" bind:value={o.song} />
              </label>
            {/if}
            <label title="El arreglo sintetizado: lo que no tocas">Guía <input type="range" min="0" max="1" step="0.05" bind:value={o.guide} /></label>
            <label title="La guía también toca tu parte, más baja"><input type="checkbox" bind:checked={o.hearMine} /> Oír mi parte</label>
            {#if detail && !detail.chordData}<small class="muted">Acordes de las notas transcritas (los del audio están en la cola).</small>{/if}
          </div>
          {#if exercise}<p class="hint about">{exercise.about}</p>{/if}
        </div>
      {/if}
    </div>
  </div>
{/snippet}

<div class="learn" class:nolist={!o.list}>
  <aside>
    <header class="side-head">
      {#if lessonPractice}
        <button class="primary sm" onclick={backToLesson} title="Volver a la lección, al paso donde estabas">← Lección</button>
      {:else}
        <button class="ghost sm" onclick={onback} title="Volver al menú">← Menú</button>
      {/if}
      <strong>Aprender</strong>
    </header>
    <div class="seg wide">
      <button class:on={o.tab === "canciones"} onclick={() => (o.tab = "canciones")}>Canciones</button>
      <button class:on={o.tab === "piezas"} onclick={() => (o.tab = "piezas")}>Mis piezas</button>
      <button class:on={o.tab === "ejercicios"} onclick={() => (o.tab = "ejercicios")}>Ejercicios</button>
      <button class:on={o.tab === "obras"} onclick={() => (o.tab = "obras")}>Obras</button>
    </div>
    <div class="find"><SearchInput placeholder="Buscar…" bind:value={query} /></div>
    <div class="list">
      {#if o.tab === "obras"}
        {#each OBRA_LEVELS as [lv, label] (lv)}
          {@const list = obrasShown.filter((x) => x.level === lv)}
          {#if list.length}
            <span class="kicker lvl">{lv} · {label}</span>
            {#each list as x (x.id)}
              <button class="item" class:on={obra?.id === x.id} onclick={() => openObra(x)}>
                <span>{x.title}</span>
                <small>{x.composer}</small>
              </button>
            {/each}
          {/if}
        {/each}
        <p class="muted empty">Del <a href="https://www.mutopiaproject.org" target="_blank" rel="noreferrer">Mutopia Project</a>: dominio público o Creative Commons (créditos en public/obras/CREDITOS.md).</p>
      {:else if o.tab === "ejercicios"}
        <div class="exopts">
          <select value={o.exKey} onchange={(e) => (o.exKey = +e.currentTarget.value)} title="Tonalidad de los ejercicios">
            {#each Array.from({ length: 12 }, (_, i) => i) as t (t)}<option value={t}>{keyName({ tonic: t, minor: o.exMinor }, notation.latin).split(" ")[0]}</option>{/each}
          </select>
          <div class="seg">
            <button class:on={!o.exMinor} onclick={() => (o.exMinor = false)}>mayor</button>
            <button class:on={o.exMinor} onclick={() => (o.exMinor = true)}>menor</button>
          </div>
          <div class="seg" title="Con qué mano (los de dos manos, siempre juntas)">
            <button class:on={o.exHands === "rh"} onclick={() => (o.exHands = "rh")}>Der.</button>
            <button class:on={o.exHands === "lh"} onclick={() => (o.exHands = "lh")}>Izq.</button>
            <button class:on={o.exHands === "both"} onclick={() => (o.exHands = "both")}>Juntas</button>
          </div>
        </div>
        {#each EX_LEVELS as [lv, label] (lv)}
          {@const list = exShown.filter((e) => e.level === lv)}
          {#if list.length}
            <span class="kicker lvl">{lv} · {label}</span>
            {#each list as ex (ex.id)}
              <button class="item" class:on={exercise?.id === ex.id} onclick={() => openExercise(ex)}>
                <span>{ex.title}</span>
                <small>{ex.concept}{ex.oneHand ? "" : " · dos manos"}</small>
              </button>
            {/each}
          {/if}
        {/each}
      {:else if o.tab === "piezas"}
        <div class="add">
          <button class="ghost sm" onclick={() => newOrImport("new")} title="Escribirla en el editor (con el piano o el ratón)">＋ Nueva</button>
          <button class="ghost sm" onclick={() => newOrImport("import")} title="MIDI (.mid) o MusicXML (.musicxml, .xml, .mxl)">Importar…</button>
        </div>
        {#each piecesShown as pc (pc.id)}
          <div class="item piece" class:on={piece?.id === pc.id}>
            <button class="open" onclick={() => openPiece(pc)}>
              <span>{pc.title}</span>
              <small>{pc.notes.length} notas · {pc.bpm} bpm</small>
            </button>
            <button class="icon-btn sm" onclick={() => (reset(), (editing = pc))} title="Editar" aria-label="Editar">✎</button>
            <button class="icon-btn sm" onclick={() => removePiece(pc)} title="Borrar" aria-label="Borrar">✕</button>
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
    {#if lessonPractice && !editing}
      <div class="lesson-bar" class:passed={lessonResult != null && lessonResult >= lessonPractice.goal}>
        <span>📘 <strong>{lessonPractice.lessonTitle}</strong> · {lessonPractice.title} · objetivo {Math.round(lessonPractice.goal * 100)} %</span>
        {#if lessonResult != null}
          <span class="res"><span class="stars">{"★".repeat(stars(lessonResult))}{"☆".repeat(3 - stars(lessonResult))}</span> {Math.round(lessonResult * 100)} %
            {lessonResult >= lessonPractice.goal ? "· ¡Objetivo cumplido!" : "· casi: otra vuelta"}</span>
          <button class="ghost sm" onclick={() => (seek(0), toggle())}>Otra vez</button>
        {/if}
        <span class="grow"></span>
        <button class="primary sm" onclick={backToLesson}>← Volver a la lección</button>
      </div>
    {/if}
    {#if editing}
      <PieceEditor piece={editing} {onsessions} onclose={() => ((editing = null), void loadPieces())}
        onpractice={(pc) => ((editing = null), void loadPieces(), openPiece(pc))} />
    {:else}
    <div class="row titlebar">
      <button class="ghost sm" onclick={() => (o.list = !o.list)} title={o.list ? "Ocultar la lista (más sitio)" : "Mostrar la lista"}>{o.list ? "⇤" : "☰"}</button>
      {#if loaded}<strong class="ptitle" title={title}>{title}</strong>{#if keyText}<small class="muted mono">{keyText}</small>{/if}{/if}
      <span class="grow"></span>
      {#if loaded}
        <span class="mono score" title="Notas acertadas de las que ya tocaban · notas equivocadas · sesgo medio, adelanto (−) o retraso (+): se arregla calibrando · dispersión (±): lo que mejora al practicar">
          {stats.hits}/{stats.due} · {stats.wrong} fallos{stats.hits ? ` · ${stats.ms > 0 ? "+" : ""}${stats.ms} ms · ±${stats.sd}` : ""}{#if stats.force != null}<span
              class="force" class:off={Math.abs(stats.force) > 20}
              title="Fuerza: de media, cuánto más fuerte (+) o flojo (−) que lo que pide (de 127); en amarillo, las notas que se pasan">
              · fuerza {stats.force > 0 ? "+" : ""}{stats.force}{stats.offForce ? ` (${stats.offForce} muy ${stats.force > 0 ? "fuertes" : "flojas"})` : ""}</span>{/if}
        </span>
      {/if}
      {#if loaded && recent.length}
        <svg class="strip" viewBox="-150 -8 300 16" preserveAspectRatio="none" aria-label="Tiempo de las últimas notas">
          <line x1="0" x2="0" y1="-8" y2="8" class="mid" />
          {#each recent as ms, i (i)}
            {@const k = judge(ms / 1000)}
            <line x1={Math.max(-148, Math.min(148, ms))} x2={Math.max(-148, Math.min(148, ms))} y1="-6" y2="6" class="tick {k}" opacity={0.3 + 0.7 * ((i + 1) / recent.length)} />
          {/each}
        </svg>
      {/if}
      <span class="dot" class:on={!!input.connected} title={input.connected ? `Teclado: ${input.connected}` : "Sin teclado MIDI: se toca con el del ordenador (en Ajustes)"}></span>
    </div>
    {#if !loaded}<div class="row opts"><InputBar /></div>{/if}
    {#if loaded && (stretching || (semis && !piece) || (o.melody !== "none" && melody === "none" && !piece))}
      <div class="row opts">
        {#if stretching}<small class="note-warn"><span class="spinner inline"></span> Preparando las pistas al {Math.round(o.speed * 100)} % (solo la primera vez); mientras, suena la guía.</small>
        {:else if semis && !piece}<small class="muted">Transportada {fmtSemis(semis)}: de la canción solo suena la batería.</small>{/if}
        {#if o.melody !== "none" && melody === "none" && !piece}
          <small class="note-warn">
            {STEM_INFO[o.melody]?.label ?? o.melody} sin notas todavía:
            {#if notesJob}sacándolas ({jobText(notesJob)}); la derecha lleva acordes mientras{:else}la derecha lleva acordes{/if}
          </small>
          {#if !notesJob}<button class="ghost sm" onclick={() => pickMelody(o.melody)}>Sacar sus notas</button>{/if}
        {/if}
      </div>
    {/if}

    {#if error}<p class="error-text">{error}</p>{/if}
    {#if loading}
      <div class="msg"><span class="spinner"></span></div>
    {:else if loaded && arr}
      {#if o.view === "roll"}
        <Roll {player} {controls} bind:windowSec={settings.rollSpeed} ontoggle={() => {}} fx tools={opts} {chords} keyLabel={keyText} tonality={arr.key} title="Arreglo"
          lit={() => pressed}
          tracks={[
            { stem: "rh", name: melody === "none" ? "Derecha: acordes" : "Derecha: melodía", color: "#f29d38", path: "rh", hidden: false, notes: rhSec },
            { stem: "lh", name: "Izquierda", color: "#74c6f0", path: "lh", hidden: false, notes: lhSec },
          ]} />
      {:else if scorePath}
        <div class="row">{@render opts()}</div>
        {#key scorePath}
          <Score song={scoreSong} stems={[]} path={scorePath} {player} {controls} bind:follow={settings.scoreFollow} title="{title} · {o.level === 5 ? 'original' : `nivel ${levelLabel(o.level)}`}"
            beatAt={(t) => toBeat(slowBeats, t) - arr.start} pdfName={scoreName} />
        {/key}
      {/if}
      <div class="bottom">
        {#if nBars > 1}
          <div class="zonemap" title="Cómo sale cada compás (verde bien, rojo mal; gris sin practicar). Clic: ir ahí">
            {#each barMap as a, i (i)}<button style:background={barColor(a)} class:now={i === nowBar} class:loop={activeZone && i >= activeZone.from && i <= activeZone.to}
                onclick={() => seek(barTime(i))} aria-label="Compás {i + 1}"></button>{/each}
          </div>
        {/if}
        {#if zones.length || activeZone || hasZoneData}
          <div class="row zones">
            {#if activeZone}
              <span>Practicando c. {activeZone.from + 1}{activeZone.to > activeZone.from ? `–${activeZone.to + 1}` : ""} al {Math.round(o.speed * 100)} %</span>
              {#if suggestUp}<button class="primary sm" onclick={() => ((o.speed = Math.min(1, Math.round((o.speed + 0.1) * 10) / 10)), (suggestUp = false))}>Te sale: subir a {Math.round(Math.min(1, o.speed + 0.1) * 100)} %</button>{/if}
              <button class="ghost sm" onclick={() => ((activeZone = null), (loop = false), (suggestUp = false))}>Dejar el pasaje</button>
            {:else}
              <span class="muted">Zonas difíciles:</span>
              {#each zones as z (z.from)}
                <button class="ghost sm" onclick={() => practiceZone(z)} title="{z.tries} notas tocadas ahí">
                  c. {z.from + 1}{z.to > z.from ? `–${z.to + 1}` : ""} · {Math.round(z.acc * 100)} % · Practicar
                </button>
              {:else}
                <span class="muted">ninguna por ahora</span>
              {/each}
              <span class="grow"></span>
              <button class="ghost sm" class:danger={confirmReset} onclick={resetZones}
                title="Borra lo apuntado de esta pieza en este nivel, melodía y manos (lo demás se queda)">
                {confirmReset ? "¿Seguro? Clic otra vez" : "Reiniciar zonas"}
              </button>
            {/if}
          </div>
        {/if}
        {@render controls()}
      </div>
    {:else if !error}
      <div class="welcome"><h1>Elige una canción<br />y <em>tócala</em>.</h1>
        <p class="hint">Melodía y acompañamiento para piano, del nivel 1 al 5. Con el teclado MIDI o el del ordenador.</p></div>
    {/if}
    {/if}
  </main>
</div>

<style>
  .learn { height: 100vh; display: grid; grid-template-columns: 280px 1fr; }
  .learn.nolist { grid-template-columns: 0 1fr; }
  .learn.nolist > aside { visibility: hidden; overflow: hidden; }
  .titlebar { gap: 12px; }
  .titlebar small { font-size: 11.5px; }
  .toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; }
  .grp { display: flex; align-items: center; gap: 8px; padding: 0 10px; border-left: 1px solid var(--line); }
  .grp:first-child { border-left: 0; padding-left: 0; }
  .lbl { font-size: 11px; color: var(--text-3); }
  .more-wrap { position: relative; }
  .more-pop { position: absolute; left: 0; top: calc(100% + 8px); z-index: 70; width: min(560px, 80vw); }
  .titlebar .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); flex-shrink: 0; }
  .titlebar .dot.on { background: var(--ok); }
  aside { background: var(--sidebar); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; gap: 8px; padding-bottom: 8px; }
  aside > .seg { margin: 0 10px; }
  .find { padding: 0 10px; }
  .list { overflow-y: auto; padding: 0 8px; display: flex; flex-direction: column; gap: 2px; }
  .empty { padding: 10px; font-size: 12px; }
  .lesson-bar {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 6px 12px; border-radius: var(--radius); flex-shrink: 0; font-size: 12.5px;
    background: var(--panel); border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--line));
  }
  .lesson-bar.passed { border-color: var(--ok); }
  .lesson-bar .stars { color: var(--accent); letter-spacing: 2px; }
  .add { display: flex; gap: 6px; padding: 2px 4px 8px; }
  .add button { flex: 1; }
  .piece { flex-direction: row; align-items: center; padding: 0 4px 0 0; }
  .piece .open { flex: 1; display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 7px 10px; border: 0; background: none; color: var(--text); text-align: left; min-width: 0; }
  .piece .open small { color: var(--text-3); font-size: 11px; }
  .ptitle { font-size: 14px; font-weight: 600; color: var(--text); max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .exopts { display: flex; flex-wrap: wrap; gap: 6px; padding: 2px 4px 8px; align-items: center; }
  .exopts select { font-size: 12px; padding: 3px 6px; }
  .lvl { padding: 10px 8px 4px; }
  .about { max-width: 900px; line-height: 1.5; flex-shrink: 0; }

  main { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 12px 24px 16px; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; flex-shrink: 0; }
  .opts { font-size: 12px; color: var(--text-2); }
  .opts label { display: flex; align-items: center; gap: 6px; }
  .opts select { font-size: 12px; padding: 3px 8px; }
  .opts input[type="range"] { width: 90px; }
  .score { font-size: 12px; color: var(--text-2); }
  .strip { width: 110px; height: 14px; flex-shrink: 0; }
  .strip .mid { stroke: var(--text-3); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .strip .tick { stroke-width: 3; stroke-linecap: round; vector-effect: non-scaling-stroke; }
  .tick.ontime, .tick.near { stroke: var(--ok); }
  .tick.early { stroke: var(--early); }
  .tick.late { stroke: var(--late); }

  .note-warn { color: var(--accent); display: inline-flex; align-items: center; gap: 6px; }
  .inline { width: 12px; height: 12px; }
  .force.off { color: var(--warn); }
  .zonemap { display: flex; gap: 1px; height: 8px; margin-bottom: 6px; }
  .zonemap button { flex: 1; min-width: 2px; padding: 0; border: 0; border-radius: 2px; opacity: 0.75; cursor: pointer; }
  .zonemap button:hover, .zonemap button.now { opacity: 1; outline: 1px solid var(--text); }
  .zonemap button.loop { opacity: 1; box-shadow: 0 -3px 0 var(--accent); }
  .zones { margin-bottom: 6px; font-size: 12px; }
  .zones .danger { border-color: var(--bad); }
  .bottom { flex-shrink: 0; }
  .msg { margin: auto; }
  .welcome { margin: auto; text-align: center; }
  .welcome h1 { font-size: 28px; margin: 0 0 12px; }
  .welcome em { font-style: normal; color: var(--accent); }
</style>
