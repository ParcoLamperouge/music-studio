<script lang="ts">
  import { onMount } from "svelte";
  import { loadNotation } from "./ChordsTab.svelte";
  import { accuracy, KINDS, levelOf, maxLevel, pickItem, pickKind, pool, songQuestions, synthQuestion, type Clip, type Kind, type Question, type SongData, type Sound } from "./ear";
  import { decodeCached } from "./clip";
  import { fmtClock, readJson, songDetail } from "./engine";
  import { chordName, degree, fromModel, keyName, noteName, type Note } from "./harmony";
  import { synth, voice } from "./player";
  import { ear, loadEar, recordEar } from "./progress.svelte";
  import { store } from "./store.svelte";

  /** Entrenador de oído: sesiones de 10 preguntas, sintéticas (intervalos, acordes, grados, progresiones, dictado) o con
   * trozos de las canciones de la biblioteca (grado y tipo del acorde, nota e intervalos de la voz). Lo que se falla
   * vuelve antes (Leitner) y cada tipo sube o baja de nivel solo (ear.ts). */

  const ROUNDS = 10;
  const ALL = Object.keys(KINDS) as Kind[];
  const SYNTH = ALL.filter((k) => !KINDS[k].song);
  const SONG = ALL.filter((k) => KINDS[k].song);
  const notation = loadNotation();
  const withAudio = $derived(store.tracks.filter((t) => t.stems && t.audio));

  let kinds = $state<Kind[]>([]); // los de la sesión en marcha; vacío: eligiendo
  let n = $state(0);
  let right = $state(0);
  let q = $state.raw<Question | null>(null);
  let picked = $state<string | null>(null);
  let typed = $state<number[]>([]); // dictado
  let done = $state(false);
  let busy = $state("");
  let notice = $state("");
  let changes = $state<string[]>([]);
  let inst = $state(true); // acordes de canciones: el instrumento armónico (si lo hay) en vez de la mezcla

  onMount(() => {
    void loadEar();
    return () => (stop(), void ctx?.close());
  });

  // ---------------------------------------------------------------- canciones

  type Loaded = SongData & { paths: Record<string, string>; harmonic: string | null };
  const songs = new Map<string, Promise<Loaded | null>>();
  let qsong = $state.raw<Loaded | null>(null);

  function loadSong(key: string) {
    if (!songs.has(key))
      songs.set(key, (async (): Promise<Loaded | null> => {
        const d = await songDetail(key);
        const cs = d.chordData?.chords;
        if (!d.stemlab || !cs?.length) return null;
        const { dir, stems } = d.stemlab;
        const tracks = await Promise.all(stems.filter((s) => s.roll).map(async (s) => ({ stem: s.name, notes: await readJson<Note[]>(`${dir}/${s.roll}`, []) })));
        const beats = d.beatData?.beats ?? [];
        const h = fromModel(cs, tracks, beats, d.duration);
        return {
          key, title: d.title, artist: d.artist, tonality: h.key, chords: h.chords, beats,
          vocals: tracks.find((t) => t.stem === "vocals")?.notes ?? [],
          harmonic: ["piano", "guitar", "other"].find((x) => stems.some((s) => s.name === x && s.present)) ?? null,
          paths: { mix: d.audioPath ?? `${dir}/${d.stemlab.mix}`, ...Object.fromEntries(stems.map((s) => [s.name, `${dir}/${s.file}`])) },
        };
      })().catch(() => null));
    return songs.get(key)!;
  }

  /** Una pregunta de canción: canciones al azar (antes las que tienen pulsos) hasta dar con una que la tenga. */
  async function songQuestion(kind: Kind, avoid?: string) {
    const vocal = kind === "cancion-nota" || kind === "cancion-intervalo";
    const cands = withAudio
      .filter((t) => !vocal || t.notes.includes("vocals"))
      .map((t) => ({ t, r: Math.random() + (t.beats ? 1 : 0) }))
      .sort((a, b) => b.r - a.r);
    for (const { t } of cands.slice(0, 8)) {
      const s = await loadSong(t.key);
      const qs = s ? songQuestions(kind, s, levelOf(ear, kind)) : [];
      if (!s || !qs.length) continue;
      const item = pickItem(ear, kind, [...new Set(qs.map((x) => x.answer))], Date.now(), Math.random, avoid);
      const pool = qs.filter((x) => x.answer === item);
      qsong = s;
      void buffer(clipPath(pool[0].sound.clip!)); // que vaya decodificando
      return pool[Math.floor(Math.random() * pool.length)];
    }
    return null;
  }

  // ---------------------------------------------------------------- sonido

  let ctx: AudioContext | null = null;
  let srcs: AudioScheduledSourceNode[] = [];
  let playId = 0;

  const buffer = decodeCached;

  function clipPath(c: Clip) {
    const p = qsong?.paths ?? {};
    return c.src === "voz" ? p.vocals : c.src === "acorde" && inst && qsong?.harmonic ? p[qsong.harmonic] : p.mix;
  }

  function stop() {
    for (const s of srcs) s.stop();
    srcs = [];
  }

  async function play(snd: Sound) {
    const id = ++playId;
    stop();
    ctx ??= new AudioContext();
    void ctx.resume();
    try {
      const end = Math.max(0, ...snd.notes.map((x) => x[1]));
      const [nb, cb] = await Promise.all([snd.notes.length ? synth(snd.notes, end) : null, snd.clip ? buffer(clipPath(snd.clip)) : null]);
      if (id !== playId) return;
      const t0 = ctx.currentTime + 0.05;
      if (nb) {
        const s = ctx.createBufferSource();
        s.buffer = nb;
        s.connect(ctx.destination);
        s.start(t0);
        srcs.push(s);
      }
      if (cb && snd.clip) {
        // AudioBufferSourceNode con offset (no <audio>: en WebKitGTK buscar es lento) y fundidos cortos para no chasquear
        const { t, dur } = snd.clip, at = t0 + (snd.at ?? 0), f = 0.03;
        const s = ctx.createBufferSource(), g = ctx.createGain();
        s.buffer = cb;
        s.connect(g).connect(ctx.destination);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(1, at + f);
        g.gain.setValueAtTime(1, at + dur - f);
        g.gain.linearRampToValueAtTime(0, at + dur);
        s.start(at, t, dur);
        srcs.push(s);
      }
    } catch (e) {
      notice = `No se pudo reproducir: ${e instanceof Error ? e.message : e}`;
    }
  }

  // ---------------------------------------------------------------- sesión

  function start(ks: Kind[]) {
    [n, right, done, changes, notice, q] = [0, 0, false, [], "", null];
    kinds = ks;
    void next();
  }

  async function next() {
    picked = null;
    typed = [];
    const prev = q;
    let kind = pickKind(ear, kinds, Math.random, prev?.kind);
    const avoid = prev?.kind === kind ? prev.item : undefined;
    let nq: Question | null = null;
    if (KINDS[kind].song) {
      busy = "Buscando un trozo de canción…";
      nq = await songQuestion(kind, avoid);
      busy = "";
      if (!nq) {
        kinds = kinds.filter((k) => k !== kind);
        notice = `Sin canciones para «${KINDS[kind].title}»: hacen falta pistas separadas, acordes${kind === "cancion-nota" || kind === "cancion-intervalo" ? " y notas de la voz" : ""}.`;
        if (!kinds.length) return void (q = null);
        return next();
      }
    } else {
      const lv = levelOf(ear, kind);
      nq = synthQuestion(kind, pickItem(ear, kind, pool(kind, lv), Date.now(), Math.random, avoid), lv);
    }
    q = nq;
    void play(nq.sound);
  }

  function finish(ok: boolean) {
    const cur = q!;
    if (ok) right++;
    void recordEar(cur.kind, cur.item, ok).then((c) => {
      if (c) changes = [...changes, `${KINDS[cur.kind].title}: ${c === "sube" ? "¡subes" : "bajas"} al nivel ${levelOf(ear, cur.kind)}`];
    });
    if (ok && !cur.from) setTimeout(() => q === cur && advance(), 800);
  }

  function answer(opt: string) {
    if (!q || picked != null) return;
    picked = opt;
    finish(opt === q.answer);
  }

  function key(p: number) {
    if (!q?.seq || picked != null) return;
    ctx ??= new AudioContext();
    const off = voice(ctx, p);
    setTimeout(off, 450);
    typed = [...typed, p];
    if (typed.length === q.seq.length) {
      const ok = typed.every((x, i) => x === q!.seq![i]);
      picked = ok ? "ok" : "mal";
      finish(ok);
    }
  }

  function advance() {
    if (++n >= ROUNDS) {
      done = true;
      stop();
    } else void next();
  }

  function onkey(e: KeyboardEvent) {
    if (!q || done || (e.target as HTMLElement).closest("input, textarea, select")) return;
    if (e.key === "r" || e.key === "R") play(q.sound);
    else if (e.key === "Enter" && picked != null) advance();
    else if (/^[1-9]$/.test(e.key) && q.options[+e.key - 1]) answer(q.options[+e.key - 1]);
  }

  // ---------------------------------------------------------------- presentación

  const BLACK = new Set([1, 3, 6, 8, 10]);
  const kb = $derived.by(() => {
    if (q?.tonic == null) return [];
    const keys = Array.from({ length: 13 }, (_, i) => q!.tonic! + i);
    let w = 0;
    return keys.map((p) => (BLACK.has(p % 12) ? { p, black: true, x: w } : { p, black: false, x: w++ }));
  });
  const name = (p: number, k = { tonic: 0, minor: false }) => noteName(((p % 12) + 12) % 12, k, notation.latin);
  const levelText = (k: Kind) => `nivel ${levelOf(ear, k)}/${maxLevel(k)}`;
  const accText = (k: Kind) => {
    const a = accuracy(ear, k);
    return a == null ? "" : ` · ${Math.round(a * 100)} %`;
  };
</script>

<svelte:window onkeydown={onkey} />

<div class="ear">
  <span class="kicker">Oído</span>
  <h1>Entrenador de oído</h1>

  {#if !kinds.length}
    <p class="muted intro">Diez preguntas por sesión. Lo que falles vuelve antes, y cada tipo sube de nivel al acertar el 85 % de las últimas 20 (y baja por debajo del 60 %). Las de canciones usan trozos de tu biblioteca con acordes: primero suena la cadencia de su tonalidad.</p>
    {#if notice}<p class="hint">{notice}</p>{/if}
    <div class="start">
      <button class="primary" onclick={() => start(withAudio.length ? ALL : SYNTH)}>Sesión recomendada</button>
      <button class="ghost" onclick={() => start(SYNTH)}>Solo sintético</button>
      <button class="ghost" disabled={!withAudio.length} onclick={() => start(SONG)} title={withAudio.length ? "" : "Ninguna canción con audio y pistas separadas"}>Solo canciones</button>
      <span class="grow"></span>
      <div class="seg" title="Qué se oye en las preguntas de acordes de canciones">
        <button class:on={inst} onclick={() => (inst = true)}>Instrumento</button>
        <button class:on={!inst} onclick={() => (inst = false)}>Mezcla</button>
      </div>
    </div>
    <div class="kinds">
      {#each ALL as k (k)}
        <div class="card kind">
          <div>
            <strong>{KINDS[k].title}</strong>
            <small class="muted">{levelText(k)}{accText(k)}</small>
          </div>
          {#if !KINDS[k].song}<small class="muted mono pool">{pool(k, levelOf(ear, k)).join(" · ")}</small>{/if}
          <button class="ghost sm" disabled={KINDS[k].song && !withAudio.length} onclick={() => start([k])}>Practicar</button>
        </div>
      {/each}
    </div>
  {:else if done}
    <div class="card result">
      <strong class="score">{right}/{ROUNDS}</strong>
      <span>{right / ROUNDS >= 0.85 ? "¡Muy bien!" : right / ROUNDS >= 0.6 ? "Vas bien." : "Escucha despacio: el oído se entrena con constancia."}</span>
      {#each changes as c (c)}<span class="chip">{c}</span>{/each}
      <div class="start">
        <button class="primary" onclick={() => start(kinds)}>Otra sesión</button>
        <button class="ghost" onclick={() => ((kinds = []), (done = false), (q = null))}>Elegir otra</button>
      </div>
    </div>
  {:else if busy || !q}
    <p class="muted"><span class="spinner"></span> {busy}</p>
  {:else}
    <div class="card quiz">
      <div class="head">
        <span class="kicker">{KINDS[q.kind].title} · {levelText(q.kind)}</span>
        <small class="muted">{n + 1}/{ROUNDS}</small>
      </div>
      <strong class="prompt">{q.prompt}</strong>
      <div class="row">
        <button class="ghost sm" onclick={() => q && play(q.sound)} title="Repetir (R)">♪ Repetir</button>
        {#if q.from && qsong?.harmonic && q.sound.clip?.src === "acorde"}
          <div class="seg">
            <button class:on={inst} onclick={() => ((inst = true), q && play(q.sound))}>{qsong.harmonic === "piano" ? "Piano" : qsong.harmonic === "guitar" ? "Guitarra" : "Instrumentos"}</button>
            <button class:on={!inst} onclick={() => ((inst = false), q && play(q.sound))}>Mezcla</button>
          </div>
        {/if}
      </div>

      {#if q.seq}
        <div class="kb" style:width="{kb.filter((k) => !k.black).length * 34}px">
          {#each kb as k (k.p)}
            <button class="key" class:black={k.black} style:left="{k.black ? k.x * 34 - 11 : k.x * 34}px" class:typed={typed.includes(k.p)} onclick={() => key(k.p)} aria-label={name(k.p)}>
              {#if !k.black}<span>{name(k.p)}</span>{/if}
            </button>
          {/each}
        </div>
        <div class="row">
          <span class="mono">{typed.map((p) => name(p)).join(" ") || "…"} <small class="muted">({typed.length}/{q.seq.length})</small></span>
          {#if typed.length && picked == null}<button class="ghost sm" onclick={() => (typed = typed.slice(0, -1))}>Borrar</button>{/if}
        </div>
      {:else}
        <div class="opts">
          {#each q.options as o, i (o)}
            <button class="ghost opt" class:ok={picked != null && o === q.answer} class:bad={picked === o && o !== q.answer} onclick={() => answer(o)} title="Tecla {i + 1}">{o}</button>
          {/each}
        </div>
      {/if}

      {#if picked != null}
        <div class="reveal">
          <span class={picked === q.answer || picked === "ok" ? "good" : "wrong"}>{picked === q.answer || picked === "ok" ? "¡Bien!" : "No."}</span>
          {#if q.seq}
            Era: <span class="mono">{q.seq.map((p) => name(p)).join(" ")}</span>
          {:else}
            Era: <strong>{q.answer}</strong>{q.extra ? ` (${q.extra})` : ""}
          {/if}
          {#if q.from}
            <span class="muted">
              · {q.from.chord ? `${chordName(q.from.chord, q.from.key, notation)} (${degree(q.from.chord, q.from.key)}) · ` : ""}{keyName(q.from.key, notation.latin)}
              · {q.from.title} — {q.from.artist} · {fmtClock(q.from.t)}
            </span>
          {/if}
        </div>
        <div class="row">
          {#if q.from}<button class="ghost sm" onclick={() => q?.from && play({ notes: [], clip: q.from.context })}>♪ Con contexto</button>{/if}
          <span class="grow"></span>
          <button class="primary sm" onclick={advance}>{n + 1 >= ROUNDS ? "Terminar" : "Siguiente"} ↵</button>
        </div>
      {/if}
    </div>
    {#if notice}<p class="hint">{notice}</p>{/if}
    <p class="hint">Teclas: 1-9 contestar · R repetir · Enter seguir.</p>
  {/if}
</div>

<style>
  .ear { display: flex; flex-direction: column; gap: 10px; }
  h1 { margin: 2px 0 4px; }
  .intro { margin: 0; max-width: 680px; line-height: 1.6; }
  .start, .row, .head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .head { justify-content: space-between; }
  .grow { flex: 1; }
  .kinds { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 8px; }
  .kind { display: flex; flex-direction: column; gap: 6px; padding: 12px 14px; align-items: flex-start; }
  .kind div { display: flex; flex-direction: column; gap: 2px; }
  .pool { font-size: 11px; line-height: 1.5; }
  .quiz, .result { display: flex; flex-direction: column; gap: 12px; padding: 16px; align-items: flex-start; }
  .quiz .head { align-self: stretch; }
  .prompt { font-weight: 600; font-size: 15px; }
  .score { font-size: 22px; }
  .opts { display: flex; flex-wrap: wrap; gap: 6px; }
  .opt { min-width: 70px; }
  .opt.ok { background: color-mix(in srgb, var(--ok) 25%, var(--panel)); border-color: var(--ok); color: var(--text); }
  .opt.bad { background: color-mix(in srgb, var(--bad) 20%, var(--panel)); border-color: var(--bad); }
  .reveal { line-height: 1.6; }
  .good { color: var(--ok); font-weight: 600; }
  .wrong { color: var(--bad); font-weight: 600; }
  .kb { position: relative; height: 110px; max-width: 100%; }
  .key { position: absolute; top: 0; width: 33px; height: 110px; border-radius: 0 0 4px 4px; background: #eceae4; border: 1px solid #2e2723; display: flex; align-items: flex-end; justify-content: center; padding-bottom: 6px; }
  .key span { font: 600 9px var(--mono); color: #1c0f05; }
  .key.black { width: 22px; height: 68px; background: #15161c; border-color: #000; z-index: 1; }
  .key:hover { filter: brightness(0.92); }
  .key.typed { background: #f6c27e; }
  .key.black.typed { background: #e08a2a; }
</style>
