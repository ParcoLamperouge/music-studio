<script lang="ts">
  import { onMount } from "svelte";
  import { loadNotation } from "./ChordsTab.svelte";
  import { accuracy, KINDS, levelOf, maxLevel, pickItem, pickKind, pool, songQuestions, synthQuestion, type Clip, type Kind, type Question, type SongData, type Sound } from "./ear";
  import { decodeCached } from "./clip";
  import { fmtClock, readJson, songDetail } from "./engine";
  import { chordName, degree, fromModel, keyName, noteName, type Key, type Note } from "./harmony";
  import { synth, voice } from "./player";
  import { ear, loadEar, recordEar } from "./progress.svelte";
  import { store } from "./store.svelte";
  import { ROLL_DEFAULT } from "./rollfx";
  import { settings } from "./settings.svelte";
  import Answer from "./ui/Answer.svelte";
  import Button from "./ui/Button.svelte";
  import ChordChip from "./ui/ChordChip.svelte";
  import Chip from "./ui/Chip.svelte";
  import EmptyState from "./ui/EmptyState.svelte";
  import Icon from "./ui/Icon.svelte";
  import ProgressRing from "./ui/ProgressRing.svelte";
  import Tabs from "./ui/Tabs.svelte";

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
  let marks = $state<boolean[]>([]); // acierto de cada pregunta de la sesión
  const right = $derived(marks.filter(Boolean).length);
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
    [n, marks, done, changes, notice, q] = [0, [], false, [], "", null];
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
    marks = [...marks, ok];
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
  const ringColor = (a: number | null) => (a == null ? "var(--line-hi)" : a >= 0.85 ? "var(--ok)" : a >= 0.6 ? "var(--warn)" : "var(--bad)");
  const pressColor = $derived({ ...ROLL_DEFAULT, ...settings.rollStyle }.color);

  /** Un grado («V», «ii°», «bVII») como acorde en `k`, para pintarlo por su función: el que degree() llama así. */
  const C_MAJOR: Key = { tonic: 0, minor: false };
  function romanChord(label: string, k: Key) {
    const kind = label.endsWith("°") ? "dim" : label.replace(/^[b#]/, "")[0] === label.replace(/^[b#]/, "")[0].toLowerCase() ? "m" : "";
    for (let root = 0; root < 12; root++) {
      const c = { root, kind, bass: root, t: 0, end: 0 };
      if (degree(c, k) === label) return c;
    }
    return null;
  }
  /** Las respuestas que son acordes (grados, progresiones): cada grado, un acorde coloreado. */
  const chordsOf = (kind: Kind, opt: string, k: Key) =>
    kind === "progresion" || kind === "cancion-grado" ? opt.split("–").map((r) => ({ r, c: romanChord(r, kind === "progresion" ? C_MAJOR : k) })) : null;
</script>

<svelte:window onkeydown={onkey} />

{#snippet levelDots(k: Kind)}
  <span class="lv" title="Nivel {levelOf(ear, k)} de {maxLevel(k)}" aria-label="Nivel {levelOf(ear, k)} de {maxLevel(k)}">
    {#each Array(maxLevel(k)) as _, i (i)}<i class:on={i < levelOf(ear, k)}></i>{/each}
  </span>
{/snippet}

{#snippet sessionDots()}
  <span class="dots" aria-label="Pregunta {n + 1} de {ROUNDS}">
    {#each Array(ROUNDS) as _, i (i)}<i class:ok={marks[i] === true} class:bad={marks[i] === false} class:now={i === n && !done}></i>{/each}
  </span>
{/snippet}

<section class="ear">
  {#if !kinds.length}
    <header class="head">
      <h1>Oído</h1>
      <span class="fill"></span>
      <Tabs size="sm" label="Acordes de canciones" bind:value={() => (inst ? "i" : "m"), (v) => (inst = v === "i")}
        options={[{ value: "i", label: "Instrumento", title: "Acordes de canciones: el piano o la guitarra, si los hay" }, { value: "m", label: "Mezcla", title: "Acordes de canciones: la mezcla" }]} />
    </header>
    <div class="start">
      <Button variant="primary" size="lg" icon="play" onclick={() => start(withAudio.length ? ALL : SYNTH)}>Sesión recomendada</Button>
      <Button size="lg" variant="ghost" onclick={() => start(SYNTH)}>Solo sintético</Button>
      <Button size="lg" variant="ghost" disabled={!withAudio.length} onclick={() => start(SONG)} title={withAudio.length ? "Trozos de tu biblioteca" : "Ninguna canción con audio y pistas separadas"}>Solo canciones</Button>
    </div>
    {#if notice}<p class="notice"><Icon name="alert" size={14} /> {notice}</p>{/if}
    <div class="kinds">
      {#each ALL as k (k)}
        {@const a = accuracy(ear, k)}
        {@const off = KINDS[k].song && !withAudio.length}
        <article class="kind" class:off>
          <button type="button" class="hit" disabled={off} aria-label="Practicar {KINDS[k].title}" onclick={() => start([k])}></button>
          <ProgressRing value={a ?? 0} size={52} stroke={4} color={ringColor(a)} label="Acierto reciente">
            <span class="num">{a == null ? "–" : Math.round(a * 100)}</span>
          </ProgressRing>
          <div class="kt">
            <strong>{KINDS[k].title.replace(" · canciones", "")}</strong>
            <span class="row">{#if KINDS[k].song}<Icon name="library" size={12} />{/if}{@render levelDots(k)}</span>
            {#if !KINDS[k].song}<small class="pool">{pool(k, levelOf(ear, k)).join(" · ")}</small>{/if}
          </div>
        </article>
      {/each}
    </div>
    <p class="foot">10 preguntas · lo que fallas vuelve antes · sube de nivel al 85 % de las últimas 20</p>
  {:else if done}
    <div class="result">
      <ProgressRing value={right / ROUNDS} size={140} stroke={10} color={ringColor(right / ROUNDS)} label="Acierto">
        <strong class="num">{right}<small>/{ROUNDS}</small></strong>
      </ProgressRing>
      {@render sessionDots()}
      {#each changes as c (c)}<Chip icon={c.includes("sube") ? "top" : "chevron-down"}>{c}</Chip>{/each}
      <div class="start">
        <Button variant="primary" icon="retry" onclick={() => start(kinds)}>Otra sesión</Button>
        <Button variant="ghost" icon="grid" onclick={() => ((kinds = []), (done = false), (q = null))}>Elegir otra</Button>
      </div>
    </div>
  {:else if busy || !q}
    <EmptyState icon="ear" title={busy || "Preparando…"}>{#snippet actions()}<ProgressRing value={null} size={24} />{/snippet}</EmptyState>
  {:else}
    {@const a = accuracy(ear, q.kind)}
    <header class="qhead">
      <Button size="sm" variant="ghost" icon="back" onclick={() => ((kinds = []), (q = null), stop())}>Oído</Button>
      <span class="kind-now">
        <ProgressRing value={a ?? 0} size={22} stroke={2.5} color={ringColor(a)} label="Acierto reciente" />
        <strong>{KINDS[q.kind].title}</strong>
        {@render levelDots(q.kind)}
      </span>
      <span class="fill"></span>
      {@render sessionDots()}
    </header>

    <div class="stage">
      <button type="button" class="listen" onclick={() => q && play(q.sound)} aria-label="Repetir (R)" title="Repetir (R)">
        <Icon name="volume" size={36} />
        <kbd>R</kbd>
      </button>
      <p class="prompt">{q.prompt}</p>
      {#if q.from && qsong?.harmonic && q.sound.clip?.src === "acorde"}
        <Tabs size="sm" label="Qué suena" bind:value={() => (inst ? "i" : "m"), (v) => ((inst = v === "i"), q && play(q.sound))}
          options={[{ value: "i", label: qsong.harmonic === "piano" ? "Piano" : qsong.harmonic === "guitar" ? "Guitarra" : "Instrumentos" }, { value: "m", label: "Mezcla" }]} />
      {/if}

      {#if q.seq}
        <div class="kb" style:--k={pressColor} style:width="{kb.filter((k) => !k.black).length * 44}px">
          {#each kb as k (k.p)}
            {@const at = typed.indexOf(k.p)}
            <button type="button" class="key" class:black={k.black} style:left="{k.black ? k.x * 44 - 14 : k.x * 44}px" class:typed={at >= 0}
              class:ok={picked != null && q.seq.includes(k.p)} onclick={() => key(k.p)} aria-label={name(k.p)}>
              <span>{at >= 0 ? at + 1 : k.black ? "" : name(k.p)}</span>
            </button>
          {/each}
        </div>
        <div class="typed">
          {#each q.seq as _, i (i)}<span class="slot num" class:filled={typed[i] != null}>{typed[i] != null ? name(typed[i]) : ""}</span>{/each}
          {#if typed.length && picked == null}<Button size="sm" variant="ghost" icon="undo" onclick={() => (typed = typed.slice(0, -1))}>Borrar</Button>{/if}
        </div>
      {:else}
        <div class="opts" style:--cols={q.options.length <= 4 ? q.options.length : q.options.length <= 8 ? 4 : 6}>
          {#each q.options as o, i (o)}
            {@const cs = chordsOf(q.kind, o, q.from?.key ?? C_MAJOR)}
            <Answer kbd={i < 9 ? String(i + 1) : undefined} onclick={() => answer(o)} disabled={picked != null}
              state={picked == null ? "idle" : o === q.answer ? "right" : picked === o ? "wrong" : "dim"}>
              {#if cs}
                {#each cs as x, j (j)}
                  {#if x.c}<ChordChip chord={x.c} tonality={q.kind === "progresion" ? C_MAJOR : (q.from?.key ?? C_MAJOR)} name={x.r} showDegree={false} size={cs.length > 1 ? "md" : "lg"} />{:else}{x.r}{/if}
                {/each}
              {:else}{o}{/if}
            </Answer>
          {/each}
        </div>
      {/if}

      {#if picked != null}
        {@const good = picked === q.answer || picked === "ok"}
        <div class="reveal" class:good>
          <Icon name={good ? "check" : "close"} size={18} />
          <span>
            {#if q.seq}<span class="num">{q.seq.map((p) => name(p)).join(" ")}</span>
            {:else}<strong>{q.answer}</strong>{q.extra ? ` · ${q.extra}` : ""}{/if}
          </span>
          {#if q.from}
            <small class="from">
              {q.from.chord ? `${chordName(q.from.chord, q.from.key, notation)} (${degree(q.from.chord, q.from.key)}) · ` : ""}{keyName(q.from.key, notation.latin)}
              · {q.from.title} — {q.from.artist} · {fmtClock(q.from.t)}
            </small>
            <Button size="sm" variant="ghost" icon="audio" onclick={() => q?.from && play({ notes: [], clip: q.from.context })}>Con contexto</Button>
          {/if}
          <span class="fill"></span>
          <Button variant="primary" kbd="↵" onclick={advance}>{n + 1 >= ROUNDS ? "Terminar" : "Siguiente"}</Button>
        </div>
      {/if}
      {#if notice}<p class="notice"><Icon name="alert" size={14} /> {notice}</p>{/if}
    </div>
  {/if}
</section>

<style>
  .ear { display: flex; flex-direction: column; gap: var(--s4); min-height: 100%; max-width: 1080px; width: 100%; margin: 0 auto; }
  .fill { flex: 1; }
  .head, .start, .qhead, .row { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
  .notice { display: flex; align-items: center; gap: var(--s2); color: var(--warn); font-size: var(--fs-sm); }
  .foot { font-size: var(--fs-xs); color: var(--text-3); }

  .kinds { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: var(--s3); }
  .kind {
    position: relative; display: flex; align-items: center; gap: var(--s3); padding: var(--s3) var(--s4); min-width: 0;
    border-radius: var(--r-lg); background: var(--panel); border: 1px solid var(--line); transition: border-color var(--t-fast), background var(--t-fast);
  }
  .kind:hover:not(.off) { border-color: var(--line-hi); background: var(--panel-hi); }
  .kind.off { opacity: 0.45; }
  .hit { position: absolute; inset: 0; z-index: 1; padding: 0; border: 0; border-radius: inherit; background: none; }
  .kind .num { font-size: var(--fs-sm); color: var(--text); }
  .kt { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
  .kt strong { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row { color: var(--text-3); gap: 6px; }
  .pool { font-size: var(--fs-xs); color: var(--text-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .lv { display: inline-flex; gap: 3px; }
  .lv i { width: 10px; height: 4px; border-radius: 2px; background: var(--line-hi); }
  .lv .on { background: var(--text); }

  .dots { display: flex; gap: 5px; }
  .dots i { width: 10px; height: 10px; border-radius: 50%; background: var(--line-hi); }
  .dots .now { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--text-2); }
  .dots .ok { background: var(--ok); }
  .dots .bad { background: var(--bad); }

  .result { display: flex; flex-direction: column; align-items: center; gap: var(--s4); margin: auto; }
  .result strong { font-size: var(--fs-2xl); }
  .result strong small { font-size: var(--fs-md); color: var(--text-2); }

  .kind-now { display: inline-flex; align-items: center; gap: var(--s2); min-width: 0; }
  .stage { display: flex; flex-direction: column; align-items: center; gap: var(--s4); padding-top: var(--s4); }
  .listen {
    position: relative; display: grid; place-items: center; width: 112px; height: 112px; border-radius: 50%; border: 1px solid var(--line-hi);
    background: var(--panel); color: var(--text); transition: background var(--t-fast), transform var(--t-fast);
  }
  .listen:hover { background: var(--panel-hi); transform: scale(1.03); }
  .listen kbd { position: absolute; bottom: 14px; }
  .prompt { color: var(--text-2); text-align: center; }
  .opts { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: var(--s2); width: 100%; }

  .kb { position: relative; height: 160px; max-width: 100%; }
  .key {
    position: absolute; top: 0; width: 43px; height: 160px; border-radius: 0 0 6px 6px; background: #f3f0e8; border: 1px solid #00000059;
    display: flex; align-items: flex-end; justify-content: center; padding-bottom: 10px; transition: background var(--t-fast);
  }
  .key span { font: 700 11px var(--mono); color: #1c0f05; }
  .key.black { width: 28px; height: 98px; background: #1d1d22; border-color: #000; z-index: 1; }
  .key.black span { color: #fff; }
  .key:hover { filter: brightness(0.93); }
  .key.typed { background: var(--k); }
  .key.ok { box-shadow: inset 0 -5px 0 var(--ok); }
  .typed { display: flex; align-items: center; gap: var(--s2); }
  .slot { display: grid; place-items: center; width: 44px; height: 32px; border-radius: var(--r-md); border: 1px dashed var(--line-hi); font-size: var(--fs-sm); }
  .slot.filled { border-style: solid; background: var(--panel-hi); }

  .reveal {
    display: flex; align-items: center; gap: var(--s3); flex-wrap: wrap; width: 100%; padding: var(--s3) var(--s4); border-radius: var(--r-lg);
    background: color-mix(in oklab, var(--bad) 10%, var(--panel)); color: var(--bad); animation: rise var(--t) var(--ease);
  }
  .reveal.good { background: color-mix(in oklab, var(--ok) 10%, var(--panel)); color: var(--ok); }
  .reveal span, .reveal strong { color: var(--text); }
  .from { color: var(--text-2); font-size: var(--fs-sm); }
</style>
