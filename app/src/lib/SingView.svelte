<script lang="ts">
  /** Cantar: la canción sin la voz (o con la original bajita), la letra, y lo que cantas contra la voz original
   * en vivo: micro → AnalyserNode → pitchy (McLeod) en cada fotograma; la puntuación en sing.ts. */
  import { PitchDetector } from "pitchy";
  import { onDestroy } from "svelte";
  import { readJson, songDetail } from "./engine";
  import { noteName, type Note } from "./harmony";
  import { Player } from "./player";
  import { hz2midi, median, offsetAt, phrases, phraseScores, score, scoreFrame, shiftLabel, transposition, type Phrase, type Scored } from "./sing";
  import Transport from "./Transport.svelte";

  let { key, onback }: { key: string; onback: () => void } = $props();

  const player = new Player();
  const N = 2048, CLARITY = 0.85, SMOOTH = 5, OFFS = 900; // ~15 s de diferencias para la transposición
  const PAST = 2.5, FUTURE = 5.5; // segundos visibles a cada lado de «ahora»

  let title = $state("");
  let loading = $state(true);
  let error = $state("");
  let micError = $state("");
  let ref: Note[] = [];
  let ph = $state<Phrase[]>([]);
  let [lo, hi] = [48, 72];
  let playing = $state(false);
  let time = $state(0);
  let duration = $state(0);
  let volume = $state(1);
  let free = $state(false); // transposición libre: se resta la detectada antes de puntuar
  let guide = $state(false); // la voz original, bajita
  let latency = $state(0); // ms extra: lo que tarda el micro en este equipo
  let shift = $state<number | null>(null);
  let now = $state<{ midi: number; err: number; graded: boolean } | null>(null);
  let total = $state<number | null>(null);
  let results = $state<(number | null)[] | null>(null);

  let frames: Scored[] = [];
  let offs: number[] = [];
  let recent: number[] = [];
  let stream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let detector: PitchDetector<Float32Array> | null = null;
  const buf = new Float32Array(N);
  let canvas = $state<HTMLCanvasElement>();
  let raf = 0;

  $effect(() => player.setMaster(volume));
  $effect(() => player.setGain("vocals", guide ? 0.3 : 0));

  (async () => {
    try {
      const d = await songDetail(key);
      title = d.title || key;
      if (!d.stemlab) throw new Error("Esta canción no tiene las pistas separadas: sepárala en Pistas.");
      const dir = d.stemlab.dir;
      const voc = d.stemlab.stems.find((s) => s.name === "vocals");
      if (!voc?.roll) throw new Error("La voz aún no tiene notas: sácalas en Pistas (notas de la voz).");
      ref = (await readJson<Note[]>(`${dir}/${voc.roll}`, [])).sort((a, b) => a[0] - b[0]);
      if (!ref.length) throw new Error("La voz no tiene notas.");
      const ps = ref.map((n) => n[2]).sort((a, b) => a - b);
      [lo, hi] = [ps[Math.floor(ps.length * 0.02)] - 4, ps[Math.ceil(ps.length * 0.98) - 1] + 4]; // sin las notas sueltas extremas
      ph = phrases(ref, d.doc);
      await player.load(d.stemlab.stems.map((s) => ({ name: s.name, path: `${dir}/${s.file}` })));
      player.setGain("vocals", 0);
      duration = player.duration;
      raf = requestAnimationFrame(loop);
      void startMic(); // ya se ve la nota antes de dar al play
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  })();

  async function startMic() {
    if (stream) return true;
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("esta ventana no da acceso al micro");
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
      analyser = player.ctx.createAnalyser(); // el mismo reloj que la canción
      analyser.fftSize = N;
      player.ctx.createMediaStreamSource(stream).connect(analyser); // sin salida: no se oye uno a sí mismo
      detector = PitchDetector.forFloat32Array(N);
      detector.minVolumeDecibels = -45;
      micError = "";
      console.info("[estudio] micro:", stream.getAudioTracks()[0]?.label);
      return true;
    } catch (e) {
      micError = `Sin micro: ${e instanceof Error ? e.message : e}`;
      console.warn("[estudio]", micError);
      return false;
    }
  }

  async function toggle() {
    if (player.playing) {
      player.pause();
      finish();
    } else {
      await startMic();
      results = null;
      player.play();
    }
    playing = player.playing;
  }

  function seek(t: number) {
    player.seek(t);
    frames = frames.filter((f) => f.t < t); // cantar otra vez un trozo sustituye lo de antes
    time = t;
  }

  function again() {
    [frames, offs, shift, total, results] = [[], [], null, null, null];
    seek(0);
  }

  function finish() {
    if (!frames.length) return;
    total = score(frames);
    results = phraseScores(ph, frames);
  }

  function listen() {
    if (!analyser || !detector) return null;
    analyser.getFloatTimeDomainData(buf);
    const [hz, clarity] = detector.findPitch(buf, player.ctx.sampleRate);
    if (clarity < CLARITY || hz < 60 || hz > 1400) {
      recent = [];
      return null;
    }
    recent.push(hz2midi(hz));
    if (recent.length > SMOOTH) recent.shift();
    return median(recent);
  }

  function loop() {
    raf = requestAnimationFrame(loop);
    time = player.time();
    if (playing && !player.playing) ((playing = false), finish()); // se acabó la canción
    const midi = listen();
    if (midi == null) now = null;
    else {
      // lo que entra ahora se cantó oyendo la canción hace un rato: salida + media ventana + lo que se ajuste a mano
      const t = time - (player.ctx.outputLatency || player.ctx.baseLatency || 0) - N / 2 / player.ctx.sampleRate - latency / 1000;
      const f = scoreFrame(ref, { t, midi }, free ? (shift ?? 0) : 0);
      now = f.grade ? { midi, err: f.err, graded: true } : { midi, err: (midi - Math.round(midi)) * 100, graded: false };
      if (player.playing) {
        frames.push(f);
        const o = offsetAt(ref, f);
        if (o != null) {
          offs.push(o);
          if (offs.length > OFFS) offs.shift();
          shift = transposition(offs);
        }
        if (frames.length % 30 === 0) total = score(frames);
      }
    }
    draw();
  }

  // ---------------------------------------------------------------- dibujo

  function draw() {
    const c = canvas;
    if (!c) return;
    const dpr = devicePixelRatio || 1;
    const [w, h] = [c.clientWidth, c.clientHeight];
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) [c.width, c.height] = [Math.round(w * dpr), Math.round(h * dpr)];
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(c);
    const col = (v: string) => css.getPropertyValue(v).trim();
    const t0 = time - PAST, span = PAST + FUTURE;
    const x = (t: number) => ((t - t0) / span) * w;
    const row = h / (hi - lo + 1);
    const y = (m: number) => h - (m - lo + 0.5) * row;

    g.fillStyle = col("--line");
    for (let m = lo; m <= hi; m++) if (m % 12 === 0) g.fillRect(0, y(m), w, 1); // los Do

    const sh = free ? (shift ?? 0) : 0;
    for (const n of ref) {
      if (n[1] < t0 || n[0] > t0 + span) continue;
      const on = n[0] <= time && n[1] >= time;
      g.fillStyle = on ? col("--accent") : col("--text-3");
      g.globalAlpha = on ? 0.9 : 0.45;
      g.beginPath();
      g.roundRect(x(n[0]), y(n[2] + sh) - row * 0.4, Math.max(2, x(n[1]) - x(n[0])), row * 0.8, row * 0.3);
      g.fill();
    }
    g.globalAlpha = 1;

    // lo cantado: junto a la barra con la que se comparó (sin octava); sin referencia, en la octava del medio
    const mid = (lo + hi) / 2;
    const color = { ok: col("--ok"), partial: col("--warn"), bad: col("--bad") };
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      if (f.t < t0) break;
      if (f.t > time) continue;
      const m = f.ref != null ? f.ref + sh + f.err / 100 : f.midi - 12 * Math.round((f.midi - mid) / 12);
      g.fillStyle = f.grade ? color[f.grade] : col("--text-2");
      g.fillRect(x(f.t) - 1.5, y(m) - 1.5, 3, 3);
    }

    g.fillStyle = col("--text");
    g.globalAlpha = 0.5;
    g.fillRect(x(time), 0, 1, h);
    g.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- vista

  const name = (m: number) => noteName(((Math.round(m) % 12) + 12) % 12, { tonic: 0, minor: false }, true) + (Math.floor(Math.round(m) / 12) - 1);
  const lineAt = $derived(ph.findIndex((p) => time >= p.t - 0.6 && time <= p.end + 0.3));
  const line = $derived(lineAt >= 0 ? ph[lineAt] : ph.find((p) => p.t > time));
  const nextLine = $derived(line ? ph[ph.indexOf(line) + 1] : undefined);
  const grade = $derived(now?.graded ? (Math.abs(now.err) <= 50 ? "ok" : Math.abs(now.err) <= 100 ? "partial" : "bad") : "");

  onDestroy(() => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    player.stop();
    void player.ctx.close();
  });
</script>

<section class="card sing">
  <header>
    <button class="ghost sm" onclick={onback} title="Volver a la canción">← Volver</button>
    <span class="kicker">Cantar</span>
    <strong class="title">{title}</strong>
    <span class="grow"></span>
    <button class="chip" class:on={free} onclick={() => (free = !free)} title="Puntúa la melodía aunque la cantes en otro tono">Transposición libre</button>
    <button class="chip" class:on={guide} onclick={() => (guide = !guide)} title="La voz original, bajita, para guiarte">Voz original</button>
    <label class="lat" title="Si lo que cantas sale siempre tarde, súbelo">
      Latencia <input type="number" min="0" max="500" step="10" bind:value={latency} /> ms
    </label>
  </header>

  {#if loading}
    <div class="center"><span class="spinner"></span></div>
  {:else if error}
    <div class="center"><p class="error-text">{error}</p></div>
  {:else}
    <div class="readout">
      <div class="note {grade}">{now ? name(now.midi) : "—"}</div>
      <div class="needle" title="Desafinación en cents (±50 es acierto)">
        <span class="zone"></span>
        {#if now}<span class="tick {grade}" style="left: {50 + Math.max(-100, Math.min(100, now.err)) / 2}%"></span>{/if}
      </div>
      <span class="mono cents">{now ? `${now.err > 0 ? "+" : ""}${Math.round(now.err)} ¢` : ""}</span>
      <span class="grow"></span>
      <span class="chip" title="Tu tono respecto al original (sin contar octavas)">{shiftLabel(shift)}</span>
      {#if total != null}<span class="score mono">{total}</span>{/if}
    </div>
    <canvas bind:this={canvas}></canvas>
    <div class="lyric">
      <p class:dim={lineAt < 0}>{line?.text ?? ""}</p>
      <p class="next">{nextLine?.text ?? ""}</p>
    </div>
    {#if results}
      <div class="results">
        <span class="kicker">Toma: {total ?? "—"} / 100</span>
        <div class="phrases">
          {#each ph as p, i}
            {#if results[i] != null}
              <button class="ph" class:ok={results[i]! >= 75} class:bad={results[i]! < 40} onclick={() => seek(Math.max(0, p.t - 1))} title={p.text || `${Math.round(p.t)} s`}>
                <span class="mono">{results[i]}</span>{p.text ? ` ${p.text.slice(0, 24)}` : ""}
              </button>
            {/if}
          {/each}
        </div>
        <button class="ghost sm" onclick={again}>Otra toma</button>
      </div>
    {/if}
    <p class="hint">{micError || "Con auriculares: si el micro oye la canción, se lía."}</p>
    <Transport {playing} {time} {duration} bind:volume ontoggle={toggle} onseek={seek} />
  {/if}
</section>

<style>
  .sing { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: 10px; padding: 0 0 12px; overflow: hidden; }
  header { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40%; }
  .grow { flex: 1; }
  .chip.on { background: var(--accent-soft); color: var(--accent); }
  .lat { display: flex; align-items: center; gap: 6px; color: var(--text-2); font-size: 12px; }
  .lat input { width: 64px; }
  .center { flex: 1; display: grid; place-items: center; }
  .readout { display: flex; align-items: center; gap: 16px; padding: 0 14px; }
  .note { font-size: 40px; font-weight: 700; min-width: 3.5ch; color: var(--text-2); }
  .ok { color: var(--ok); }
  .partial { color: var(--warn); }
  .bad { color: var(--bad); }
  .needle { position: relative; width: 200px; height: 14px; border-radius: 7px; background: var(--panel-hi); }
  .zone { position: absolute; left: 37.5%; width: 25%; top: 0; bottom: 0; background: color-mix(in srgb, var(--ok) 25%, transparent); border-radius: 7px; }
  .tick { position: absolute; top: -3px; bottom: -3px; width: 3px; margin-left: -1px; background: currentColor; border-radius: 2px; }
  .tick:not(.ok, .partial, .bad) { color: var(--text-2); }
  .cents { width: 6ch; color: var(--text-3); font-size: 12px; }
  .score { font-size: 28px; color: var(--accent); }
  canvas { flex: 1; min-height: 0; width: 100%; display: block; }
  .lyric { text-align: center; padding: 0 14px; }
  .lyric p { margin: 0; font-size: 22px; min-height: 1.3em; }
  .lyric .dim { color: var(--text-3); }
  .lyric .next { font-size: 14px; color: var(--text-3); }
  .results { display: flex; align-items: center; gap: 10px; padding: 0 14px; flex-wrap: wrap; }
  .phrases { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; max-height: 64px; overflow: auto; }
  .ph { font-size: 11px; padding: 2px 8px; border-radius: var(--radius-sm); background: var(--panel-hi); color: var(--text-2); border: 0; }
  .ph.ok span { color: var(--ok); }
  .ph.bad span { color: var(--bad); }
  .hint { margin: 0; padding: 0 14px; }
</style>
