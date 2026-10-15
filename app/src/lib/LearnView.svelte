<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { onMount, untrack } from "svelte";
  import { ARRANGED, arrange, easyTranspose, fromBeat, levelLabel, judge, LEVELS, median, Practice, toBeat, toMusicXML, toSeconds, VEL_TOL, type Arrangement, type Level } from "./arrange";
  import { accuracy, hardZones, tally, wrongAt, type Bars, type Zone } from "./zones";
  import { loadNotation } from "./ChordsTab.svelte";
  import { enqueue, fmtClock, paths, readJson, songDetail, STEM_INFO, writeBytes, writeJson, type Detail, type Song } from "./engine";
  import { analyze, degree, fromModel, keyName, named, type Harmony, type Note } from "./harmony";
  import { input, pcKey, pcRelease, useInput } from "./keys.svelte";
  import { Player, voice } from "./player";
  import { loadPiano } from "./piano";
  import { keyOf, LESSONS, stars, type Practice as CoursePractice } from "./course";
  import { EXERCISES, exercisePiece, type Exercise, type Hands } from "./exercises";
  import { OBRAS, type Obra } from "./obras";
  import { record } from "./progress.svelte";
  import { songPiece, SONGS } from "./songs";
  import PieceEditor from "./PieceEditor.svelte";
  import { fromMidi, newPiece, pieceArrangement, pieceBeats, pieceDuration, pieceSeconds, type Piece } from "./piece";
  import { deletePiece, importPieces, loadPieces, pieces, savePiece } from "./pieces.svelte";
  import Roll from "./Roll.svelte";
  import Score from "./Score.svelte";
  import { saveSettings, settings } from "./settings.svelte";
  import { jobOf, jobText, store } from "./store.svelte";
  import MidiStatus from "./learn/MidiStatus.svelte";
  import Picker from "./learn/Picker.svelte";
  import Results from "./learn/Results.svelte";
  import Timing from "./learn/Timing.svelte";
  import ZoneBar, { accColor } from "./learn/ZoneBar.svelte";
  import Button from "./ui/Button.svelte";
  import Chip from "./ui/Chip.svelte";
  import Icon from "./ui/Icon.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import MasterStrip from "./ui/MasterStrip.svelte";
  import PlayButton from "./ui/PlayButton.svelte";
  import { cssVar, stemColor } from "./ui/music";
  import Popover from "./ui/Popover.svelte";
  import ProgressRing from "./ui/ProgressRing.svelte";
  import Slider from "./ui/Slider.svelte";
  import Stepper from "./ui/Stepper.svelte";
  import Tabs from "./ui/Tabs.svelte";
  import Toggle from "./ui/Toggle.svelte";

  /** Modo Aprender: una canción separada como arreglo para piano (arrange.ts), del nivel 1 al 5, para tocarla encima de
   * sus pistas (sin la parte que tocas), con guía sintetizada, modo espera, bucle y piano roll o partitura. O una pieza
   * (escrita en el editor o importada de MIDI / MusicXML): el nivel 5 es la pieza tal cual. */
  let { onback, onsessions, oncourse }: { onback: () => void; onsessions: () => void; oncourse: (lesson: string, step: number) => void } = $props();
  const backToLesson = () => lessonPractice && oncourse(lessonPractice.lesson, lessonPractice.step);

  type Opts = { melody: string; level: Level; transpose: "orig" | "easy" | number; hands: "both" | "rh" | "lh"; wait: boolean; view: "roll" | "score"; guide: number; song: number; hearMine: boolean; pieceRight: boolean; tab: "canciones" | "piezas" | "ejercicios" | "obras"; speed: number; exKey: number; exMinor: boolean; exHands: Hands; style: "clasico" | "pop"; watch: boolean };
  const DEFAULTS: Opts = { melody: "vocals", level: 1, transpose: "orig", hands: "both", wait: true, view: "roll", guide: 0.6, song: 0.8, hearMine: false, pieceRight: true, tab: "canciones", speed: 1, exKey: 0, exMinor: false, exHands: "rh", style: "clasico", watch: false };
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

  let key = $state<string | null>(null);
  /** Eligiendo qué tocar (las tarjetas) en vez de tocando; lo abierto sigue cargado. */
  let picking = $state(true);

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
    picking = false;
    results = false;
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
    if (ex)
      untrack(() => {
        const was = picking; // cambiando la tonalidad en las tarjetas: se queda en las tarjetas
        openExercise(ex);
        picking = was;
      });
  });

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
    picking = false;
    results = false;
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
  // en Espectador no tocas nada: suena todo (la guía también lo tuyo) y no se juzga (Practice sin notas)
  const plays = (hand: "rh" | "lh") => !o.watch && (myHands === "both" || myHands === hand);
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
    if ((o.wait && !o.watch) || untrack(() => waiting) == null) return;
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
    JSON.stringify([o.song, o.guide, o.hearMine, o.watch, myHands, melody, semis, o.speed, audioSpeed]);
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
  // color de la tecla al tocarla (hex: el teclado del roll lo matiza): a tiempo, adelantada, atrasada, fallada, fuerza
  const FEEDBACK = { ontime: cssVar("--ontime"), near: cssVar("--ontime"), early: cssVar("--early"), late: cssVar("--late"), miss: cssVar("--miss"), force: cssVar("--warn"), watch: cssVar("--text-3") };
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
      if (o.watch) {
        // mirando: suena y se ilumina, sin juzgar; arriba se ofrece pasar a practicar
        watchPlayed = true;
        pressed.set(p, FEEDBACK.watch);
        if (!input.connected) voices.set(p, voice(player.ctx, p, v / 127));
        return;
      }
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
      pressed.set(p, !hit ? FEEDBACK.miss : tm && tm !== "ontime" && tm !== "near" ? FEEDBACK[tm] : forceOff ? FEEDBACK.force : FEEDBACK.ontime);
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
        const waitOn = o.wait && !o.watch;
        const block = waitOn ? practice.blocking(time) : null;
        if (block != null) {
          player.pause();
          player.seek(block);
          waiting = block;
          playing = false;
        } else if (waitOn && practice.released(time, held)) {
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
          if (practice.stats(time).due > 0) showResults();
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

  // ---------------------------------------------------------------- resultados

  let results = $state(false);
  let resultStats = $state<ReturnType<Practice["stats"]>>({ due: 0, hits: 0, wrong: 0, ms: 0, force: null, offForce: 0, sd: 0 });
  let resultErrs = $state<number[]>([]);
  /** Lo de esta pasada, congelado para verlo con calma (al acabar, o con el botón). */
  function showResults() {
    if (player.playing) toggle();
    resultStats = practice.stats(time);
    resultErrs = practice.targets.filter((x) => x.hit && x.err != null).map((x) => Math.round(1000 * x.err!));
    results = true;
  }
  function again() {
    results = false;
    seek(loop && loopA != null ? loopA : 0);
    start(from());
  }

  const acc = $derived(stats.due + stats.wrong ? stats.hits / (stats.due + stats.wrong) : null);
  const levelOpts = [...ARRANGED.map((n) => ({ value: String(n), label: levelLabel(n), title: LEVELS[n - 1][1] })), { value: "5", label: "Orig.", title: LEVELS[4][1] }];
  const SPEEDS = [0.5, 0.6, 0.7, 0.8, 0.9, 1];
  const pickerCurrent = $derived(exercise?.id ?? (obra ? `obra-${obra.id}` : null) ?? piece?.id ?? key);
  let watchPlayed = $state(false);
  function toggleWatch() {
    o.watch = !o.watch;
    watchPlayed = false;
    recent = [];
    if (!o.watch) practice.reset(time);
  }
  function toggleWait() {
    o.wait = !o.wait;
    practice.reset(time);
    recent = [];
  }
</script>

<svelte:window onkeydown={(e) => !editing && !picking && !(e.target instanceof Element && e.target.closest("input")) && pcKey(e)} onkeyup={(e) => !editing && pcKey(e)} onblur={() => !editing && pcRelease()} />

{#snippet transport()}
  <div class="transport">
    <PlayButton {playing} onclick={toggle} disabled={loading || !loaded} />
    <IconButton icon="chevron-left" label="−5 s" size="sm" onclick={() => seek(Math.max(0, time - 5))} disabled={!loaded} />
    <IconButton icon="chevron-right" label="+5 s" size="sm" onclick={() => seek(Math.min(duration, time + 5))} disabled={!loaded} />
    <span class="clock num">{fmtClock(time)}<small> / {fmtClock(duration)}</small></span>
    <div class="strips">
      {#if nBars > 1}<ZoneBar bars={barMap} {barTime} {duration} {time} {loopA} {loopB} {loop} onseek={seek} />{/if}
      {#if arr}<MasterStrip {duration} {time} {chords} tonality={arr.key} onseek={seek} />{/if}
    </div>
    <div class="ab">
      <Button size="sm" variant="ghost" active={loopA != null} onclick={() => setLoop("a")} title="Inicio del bucle aquí">A</Button>
      <Button size="sm" variant="ghost" active={loopB != null} onclick={() => setLoop("b")} title="Final del bucle aquí">B</Button>
      <IconButton icon="loop" label="Repetir de A a B" size="sm" active={loop} disabled={loopA == null || loopB == null} onclick={() => (loop = !loop)} />
    </div>
    <Popover side="top" align="end" width={220} label="Volumen">
      {#snippet trigger({ toggle })}<IconButton icon="volume" label="Volumen general" onclick={toggle} />{/snippet}
      <div class="pop-row"><Icon name="volume" /><Slider bind:value={settings.masterVolume} min={0} max={1.5} label="Volumen general" /></div>
    </Popover>
  </div>
{/snippet}

{#snippet bar()}
  <div class="ctl">
    {#if !exercise}
      <Tabs size="sm" label="Nivel" options={levelOpts} bind:value={() => String(o.level), (v) => (o.level = +v as Level)} />
      <Tabs size="sm" label="Manos" bind:value={o.hands} options={[{ value: "lh", label: "Izq.", title: "Tocas la izquierda; la guía, la derecha" }, { value: "both", label: "Ambas" }, { value: "rh", label: "Der.", title: "Tocas la derecha; la guía, la izquierda" }]} />
    {/if}
    <IconButton icon="eye" size="sm" label={o.watch ? "Espectador: ver y escuchar, sin contar nada. Pulsa para practicar" : "Espectador: ver y escuchar, sin contar nada"} active={o.watch} onclick={toggleWatch} />
    <Button size="sm" variant="ghost" icon="wait" active={o.wait && !o.watch} disabled={o.watch} onclick={toggleWait} title="Espera: se para hasta que tocas la nota, y solo sigue mientras la mantienes">Espera</Button>
    <Popover width={260} label="Tempo">
      {#snippet trigger({ toggle })}
        <Button size="sm" variant="ghost" icon="metronome" active={o.speed < 1} onclick={toggle} title="Tempo: más lento para aprender">{Math.round(o.speed * 100)} %</Button>
      {/snippet}
      <div class="opts-pop">
        <span class="lbl">Tempo</span>
        <Tabs size="sm" label="Tempo" options={SPEEDS.map((v) => ({ value: String(v), label: `${Math.round(v * 100)}` }))} bind:value={() => String(o.speed), (v) => (o.speed = +v)} />
        {#if detail}<small class="faint">Más lento, las pistas se estiran (la primera vez, unos segundos).</small>{/if}
      </div>
    </Popover>
    <Tabs size="sm" label="Vista" bind:value={o.view} options={[{ value: "roll", icon: "roll", title: "Piano roll" }, { value: "score", icon: "score", title: "Partitura" }]} />
    <Popover width={360} label="Más opciones">
      {#snippet trigger({ toggle, open })}<IconButton icon="sliders" label="Teclado, melodía, tonalidad, volúmenes" size="sm" active={open} onclick={toggle} />{/snippet}
      <div class="opts-pop">
        <span class="lbl">Teclado</span>
        <MidiStatus />
        <div class="pop-row">
          <span class="faint">Latencia</span>
          <span class="fill"></span>
          {#if calib}
            <ProgressRing value={calib.taps.length / 16} size={24}><span class="num tiny">{calib.taps.length}</span></ProgressRing>
            <Button size="sm" variant="ghost" onclick={() => (calib = null)}>Cancelar</Button>
          {:else}
            <Stepper bind:value={settings.latencyMs} min={0} max={300} step={5} label="Latencia" format={(v) => `${v} ms`} onchange={saveSettings} />
            <Button size="sm" variant="ghost" icon="target" onclick={calibrate} title="Suenan clics: toca una tecla con cada uno, 16 veces">Calibrar</Button>
          {/if}
        </div>
        {#if calib}<small class="faint">Toca una tecla a la vez que cada clic.</small>{/if}

        {#if piece && !exercise}
          <span class="lbl">Mano derecha</span>
          <div class="pop-row">
            <Tabs size="sm" label="Mano derecha" bind:value={() => (o.pieceRight ? "si" : "no"), (v) => (o.pieceRight = v === "si")} options={[{ value: "si", label: "La de la pieza" }, { value: "no", label: "Acordes" }]} />
            <span class="fill"></span>
            <Button size="sm" variant="ghost" icon="edit" onclick={() => piece && ((editing = piece), reset())}>Editar</Button>
          </div>
        {:else if !piece}
          <span class="lbl">Melodía</span>
          <div class="chips">
            {#each melodyStems as st (st.name)}
              <Chip color={stemColor(st.name)} active={o.melody === st.name} onclick={() => pickMelody(st.name)} title={st.ready ? "" : "Sin notas: se sacan al elegirla"}>
                {STEM_INFO[st.name]?.label ?? st.name}{st.ready ? "" : " …"}
              </Chip>
            {/each}
            <Chip active={o.melody === "none"} onclick={() => pickMelody("none")}>Solo acordes</Chip>
          </div>
        {/if}

        {#if !exercise}
          <span class="lbl">Tonalidad <small class="faint">{keyText}</small></span>
          <div class="pop-row">
            <Tabs size="sm" label="Tonalidad" bind:value={() => (typeof o.transpose === "number" ? "n" : o.transpose), (v) => (o.transpose = v === "n" ? 0 : (v as "orig" | "easy"))}
              options={[{ value: "orig", label: "Original" }, { value: "easy", label: `Fácil ${harmony ? fmtSemis(easyTranspose(harmony.key)) : ""}` }, { value: "n", label: "Otra" }]} />
            {#if typeof o.transpose === "number"}
              <Stepper bind:value={() => o.transpose as number, (v) => (o.transpose = v)} min={-6} max={6} label="Semitonos" format={fmtSemis} />
            {/if}
          </div>
          {#if o.level !== 5}
            <span class="lbl">Estilo del arreglo</span>
            <Tabs size="sm" label="Estilo" bind:value={o.style} options={[{ value: "clasico", label: "Clásico", title: "Bajo-acorde; en los más difíciles, la textura del original (acordes o arpegios)" }, { value: "pop", label: "Pop", title: "El ritmo y las octavas del pop" }]} />
          {/if}
        {/if}

        <span class="lbl">Volumen</span>
        {#if !piece}<label class="vol"><span>Canción</span><Slider bind:value={o.song} min={0} max={1.2} step={0.05} label="Canción" /></label>{/if}
        <label class="vol"><span>Guía</span><Slider bind:value={o.guide} min={0} max={1} step={0.05} label="Guía: lo que no tocas" /></label>
        <Toggle bind:checked={o.hearMine} title="La guía también toca tu parte, más baja">Oír mi parte</Toggle>
        {#if exercise}<p class="about">{exercise.about}</p>{/if}
        {#if detail && !detail.chordData}<small class="faint">Acordes de las notas transcritas (los del audio, en la cola).</small>{/if}
      </div>
    </Popover>
  </div>
{/snippet}

<div class="learn">
  {#if error}<p class="err"><Icon name="alert" size={14} /> {error} <IconButton icon="close" size="sm" label="Cerrar" onclick={() => (error = "")} /></p>{/if}

  {#if editing}
    <PieceEditor piece={editing} {onsessions} onclose={() => ((editing = null), void loadPieces(), (picking = true))}
      onpractice={(pc) => ((editing = null), void loadPieces(), openPiece(pc))} />
  {:else if picking || (!loaded && !loading)}
    <Picker
      bind:tab={o.tab}
      bind:exKey={o.exKey}
      bind:exMinor={o.exMinor}
      bind:exHands={o.exHands}
      latin={notation.latin}
      current={pickerCurrent}
      resume={loaded ? { title, go: () => (picking = false) } : null}
      onsong={open}
      onpiece={openPiece}
      onedit={(pc) => (reset(), (editing = pc))}
      ondelete={removePiece}
      onnew={() => newOrImport("new")}
      onimport={() => newOrImport("import")}
      onexercise={openExercise}
      onobra={openObra}
      onlibrary={onback}
    />
  {:else}
    <header class="top">
      <IconButton icon="grid" label="Elegir otra" onclick={() => ((picking = true), playing && toggle())} />
      <div class="title">
        <strong title={title}>{title}</strong>
        {#if keyText}<small class="num">{keyText}</small>{/if}
      </div>
      {#if lessonPractice}
        <Button size="sm" icon="course" onclick={backToLesson} title="Volver a la lección, al paso donde estabas">
          {lessonPractice.title} <span class="faint">· {Math.round(lessonPractice.goal * 100)} %</span>
        </Button>
      {/if}
      {#if stretching}<Chip><ProgressRing value={null} size={12} /> Pistas al {Math.round(o.speed * 100)} %</Chip>
      {:else if semis && !piece}<Chip title="Transportada: de la canción solo suena la batería">{fmtSemis(semis)} · solo batería</Chip>{/if}
      {#if detail && !loading && o.melody !== "none" && melody === "none"}
        <Chip onclick={notesJob ? undefined : () => pickMelody(o.melody)} title={notesJob ? jobText(notesJob) : "Sacar sus notas"}>
          {#if notesJob}<ProgressRing value={null} size={12} />{:else}<Icon name="notes" size={13} />{/if}
          {STEM_INFO[o.melody]?.label ?? o.melody}: acordes mientras
        </Chip>
      {/if}
      <span class="fill"></span>
      {#if o.watch}
        <Chip icon="eye" title="Suena todo y no se juzga nada">Espectador</Chip>
        {#if watchPlayed}<Button size="sm" variant="primary" icon="play" onclick={toggleWatch}>Practicar</Button>{/if}
      {:else if loaded}
        <div class="live" title="Notas acertadas de las que tocaban · de más · tiempo de las últimas (sesgo ± dispersión)">
          {#if stats.wrong}<span class="miss num">× {stats.wrong}</span>{/if}
          {#if recent.length}<Timing errs={recent} />{/if}
          <ProgressRing value={acc} size={30} stroke={3} color={acc == null ? "var(--line-hi)" : accColor(acc)} label="Acierto">
            <span class="num tiny">{acc == null ? "–" : Math.round(acc * 100)}</span>
          </ProgressRing>
          {#if stats.force != null}<span class="force num" class:off={Math.abs(stats.force) > 20} title="Fuerza media respecto a la que pide (de 127)">{stats.force > 0 ? "+" : ""}{stats.force}</span>{/if}
        </div>
        <IconButton icon="target" label="Resultados" onclick={showResults} disabled={!stats.due} />
      {/if}
      <MidiStatus />
    </header>

    <div class="stage">
      {#if loading || !arr}
        <div class="wait"><ProgressRing value={null} size={28} /></div>
      {:else if o.view === "roll"}
        <Roll {player} controls={transport} bind:windowSec={settings.rollSpeed} ontoggle={() => {}} fx tools={bar} {chords} keyLabel={keyText} tonality={arr.key} title="Arreglo"
          lit={() => pressed}
          tracks={[
            { stem: "rh", name: melody === "none" ? "Derecha: acordes" : "Derecha: melodía", color: "#f29d38", path: "rh", hidden: false, notes: rhSec },
            { stem: "lh", name: "Izquierda", color: "#74c6f0", path: "lh", hidden: false, notes: lhSec },
          ]} />
      {:else}
        <div class="score-bar">{@render bar()}</div>
        {#if scorePath}
          {#key scorePath}
            <Score song={scoreSong} stems={[]} path={scorePath} {player} controls={transport} bind:follow={settings.scoreFollow} title="{title} · {o.level === 5 ? 'original' : `nivel ${levelLabel(o.level)}`}"
              beatAt={(t) => toBeat(slowBeats, t) - arr!.start} pdfName={scoreName} />
          {/key}
        {/if}
      {/if}

      {#if activeZone}
        <div class="zone-pill">
          <Icon name="loop" size={14} />
          <span>c. {activeZone.from + 1}{activeZone.to > activeZone.from ? `–${activeZone.to + 1}` : ""} al {Math.round(o.speed * 100)} %</span>
          {#if suggestUp}<Button size="sm" variant="primary" onclick={() => ((o.speed = Math.min(1, Math.round((o.speed + 0.1) * 10) / 10)), (suggestUp = false))}>Te sale: {Math.round(Math.min(1, o.speed + 0.1) * 100)} %</Button>{/if}
          <IconButton icon="close" size="sm" label="Dejar el pasaje" onclick={() => ((activeZone = null), (loop = false), (suggestUp = false))} />
        </div>
      {/if}

      {#if results}
        <Results
          stats={resultStats}
          errs={resultErrs}
          bars={barMap}
          {barTime}
          {duration}
          {zones}
          lesson={lessonPractice ? { goal: lessonPractice.goal, result: lessonResult, stars: stars(lessonResult ?? (resultStats.due ? resultStats.hits / (resultStats.due + resultStats.wrong) : 0)), onback: backToLesson } : null}
          onzone={(z) => ((results = false), practiceZone(z))}
          onretry={again}
          onclose={() => (results = false)}
          onreset={() => ((confirmReset = true), resetZones())}
        />
      {/if}
    </div>
    {@render transport()}
  {/if}
</div>

<style>
  .learn { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; }
  .err { display: flex; align-items: center; gap: var(--s2); margin: var(--s2) var(--s4) 0; color: var(--bad); font-size: var(--fs-sm); }
  .fill { flex: 1; }
  .faint { color: var(--text-3); }
  .tiny { font-size: 10px; }

  .top { display: flex; align-items: center; gap: var(--s3); padding: var(--s2) var(--s4); min-width: 0; flex-wrap: wrap; }
  .title { display: flex; align-items: baseline; gap: var(--s2); min-width: 0; flex: 0 1 auto; }
  .title strong { font-size: var(--fs-lg); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title small { color: var(--text-3); white-space: nowrap; }
  .live { display: flex; align-items: center; gap: var(--s2); }
  .miss { color: var(--miss); font-size: var(--fs-sm); }
  .force { font-size: var(--fs-sm); color: var(--text-2); }
  .force.off { color: var(--warn); }

  .stage { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0 var(--s4); }
  .wait { flex: 1; display: grid; place-items: center; }
  .score-bar { padding: var(--s1) 0 var(--s2); }
  .ctl { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
  .zone-pill {
    position: absolute; left: 50%; top: 56px; translate: -50% 0; z-index: 5; display: flex; align-items: center; gap: var(--s2);
    padding: var(--s1) var(--s1) var(--s1) var(--s3); border-radius: var(--r-full); background: var(--panel-hi); box-shadow: var(--shadow);
    font-size: var(--fs-sm); animation: rise var(--t) var(--ease);
  }

  .transport { display: flex; align-items: center; gap: var(--s2); padding: var(--s2) var(--s4) var(--s3); min-width: 0; }
  .clock { font-size: var(--fs-sm); white-space: nowrap; }
  .clock small { color: var(--text-3); font-size: var(--fs-sm); }
  .strips { flex: 1; min-width: 80px; display: flex; flex-direction: column; gap: 2px; }
  .ab { display: flex; align-items: center; gap: 2px; }

  .opts-pop { display: flex; flex-direction: column; gap: var(--s2); padding: var(--s2); }
  .pop-row { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; min-width: 0; }
  .lbl { font-size: var(--fs-xs); color: var(--text-3); margin-top: var(--s1); }
  .chips { display: flex; flex-wrap: wrap; gap: var(--s1); }
  .vol { display: grid; grid-template-columns: 64px 1fr; align-items: center; gap: var(--s2); font-size: var(--fs-sm); color: var(--text-2); }
  .about { font-size: var(--fs-sm); color: var(--text-2); line-height: 1.5; }
</style>
