<script lang="ts">
  /** Cantar: la canción sin la voz (o con la original bajita), la letra, y lo que cantas contra la voz original
   * en vivo: micro → AnalyserNode → pitchy (McLeod) en cada fotograma; la puntuación en sing.ts. */
  import { PitchDetector } from "pitchy";
  import { onDestroy } from "svelte";
  import { fmtClock, readJson, songDetail } from "./engine";
  import { noteName, type Note } from "./harmony";
  import { engineErr, t } from "./i18n.svelte";
  import { Player } from "./player";
  import { hz2midi, median, offsetAt, phrases, phraseScores, score, scoreFrame, shiftLabel, transposition, type Phrase, type Scored } from "./sing";
  import Button from "./ui/Button.svelte";
  import Card from "./ui/Card.svelte";
  import Chip from "./ui/Chip.svelte";
  import EmptyState from "./ui/EmptyState.svelte";
  import Icon from "./ui/Icon.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import { cssVar } from "./ui/music";
  import ProgressRing from "./ui/ProgressRing.svelte";
  import Slider from "./ui/Slider.svelte";
  import Toggle from "./ui/Toggle.svelte";
  import { tooltip } from "./ui/tooltip";

  let { key, onback }: { key: string; onback: () => void } = $props();

  const player = new Player();
  const N = 2048, CLARITY = 0.85, SMOOTH = 5, OFFS = 900; // ~15 s de diferencias para la transposición
  const PAST = 2.5, FUTURE = 5.5; // segundos visibles a cada lado de «ahora»

  let title = $state("");
  let artist = $state("");
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
  let now = $state<{ midi: number; err: number; graded: boolean; at: number | null } | null>(null); // at: altura en el carril
  let total = $state<number | null>(null);
  let results = $state<(number | null)[] | null>(null);
  let summary = $state(false); // el resumen de la toma, encima del carril
  let phraseNow = $state<number | null>(null); // puntuación de la frase que se canta
  let stats = $state({ ok: 0, partial: 0, bad: 0, bias: 0 }); // reparto y desviación media (cents) de la toma

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
      artist = d.artist;
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
      error = engineErr(e instanceof Error ? e.message : String(e));
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
      micError = t("Sin micro: {e}", { e: engineErr(String(e instanceof Error ? e.message : e)) });
      console.warn("[estudio]", micError);
      return false;
    }
  }

  async function toggle() {
    if (loading || error) return;
    if (player.playing) {
      player.pause();
      finish();
    } else {
      await startMic();
      results = null;
      summary = false;
      player.play();
    }
    playing = player.playing;
  }

  function seek(tr: number) {
    player.seek(tr);
    frames = frames.filter((f) => f.t < tr); // cantar otra vez un trozo sustituye lo de antes
    time = tr;
  }

  function again() {
    [frames, offs, shift, total, results, phraseNow] = [[], [], null, null, null, null];
    summary = false;
    seek(0);
  }

  function finish() {
    if (!frames.length) return;
    total = score(frames);
    results = phraseScores(ph, frames);
    const g = frames.filter((f) => f.grade);
    const n = g.length || 1;
    stats = {
      ok: g.filter((f) => f.grade === "ok").length / n,
      partial: g.filter((f) => f.grade === "partial").length / n,
      bad: g.filter((f) => f.grade === "bad").length / n,
      bias: g.reduce((a, f) => a + f.err, 0) / n,
    };
    summary = total != null;
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
      const tr = time - (player.ctx.outputLatency || player.ctx.baseLatency || 0) - N / 2 / player.ctx.sampleRate - latency / 1000;
      const f = scoreFrame(ref, { t: tr, midi }, free ? (shift ?? 0) : 0);
      now = f.grade ? { midi, err: f.err, graded: true, at: f.ref! + (free ? (shift ?? 0) : 0) + f.err / 100 } : { midi, err: (midi - Math.round(midi)) * 100, graded: false, at: null };
      if (player.playing) {
        frames.push(f);
        const o = offsetAt(ref, f);
        if (o != null) {
          offs.push(o);
          if (offs.length > OFFS) offs.shift();
          shift = transposition(offs);
        }
        if (frames.length % 30 === 0) {
          total = score(frames);
          const p = ph[lineAt];
          if (p) {
            const mine: Scored[] = [];
            for (let i = frames.length - 1; i >= 0 && frames[i].t >= p.t - 0.15; i--) if (frames[i].t <= p.end + 0.15) mine.push(frames[i]);
            phraseNow = score(mine);
          }
        }
      }
    }
    draw();
  }

  // ---------------------------------------------------------------- carril

  let col: Record<string, string> | null = null;
  function draw() {
    const c = canvas;
    if (!c) return;
    const dpr = devicePixelRatio || 1;
    const [w, h] = [c.clientWidth, c.clientHeight];
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) [c.width, c.height] = [Math.round(w * dpr), Math.round(h * dpr)];
    col ??= Object.fromEntries(["--line", "--text-3", "--stem-vocals", "--ontime", "--early", "--late", "--pitch", "--text"].map((v) => [v, cssVar(v)]));
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const t0 = time - PAST, span = PAST + FUTURE;
    const x = (t: number) => ((t - t0) / span) * w;
    const row = h / (hi - lo + 1);
    const y = (m: number) => h - (m - lo + 0.5) * row;
    const bh = Math.max(6, Math.min(22, row * 0.8));

    g.fillStyle = col["--line"];
    g.font = "500 10px 'JetBrains Mono Variable', monospace";
    for (let m = lo; m <= hi; m++)
      if (m % 12 === 0) {
        g.fillRect(0, y(m), w, 1);
        g.fillText(`Do${m / 12 - 1}`, 6, y(m) - 4);
      }
    g.fillStyle = col["--line"];

    // la voz original: barras del color de la voz; la que toca ahora, más viva
    const sh = free ? (shift ?? 0) : 0;
    for (const n of ref) {
      if (n[1] < t0 || n[0] > t0 + span) continue;
      const on = n[0] <= time && n[1] >= time;
      g.globalAlpha = on ? 0.95 : n[1] < time ? 0.3 : 0.6;
      g.fillStyle = col["--stem-vocals"];
      g.beginPath();
      g.roundRect(x(n[0]), y(n[2] + sh) - bh / 2, Math.max(3, x(n[1]) - x(n[0])), bh, bh / 2);
      g.fill();
    }
    g.globalAlpha = 1;

    // aciertos: la barra se rellena (verde si está en el centro; cyan / naranja si cerca, por abajo / por arriba)
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      if (f.t < t0) break;
      if (f.t > time || f.ref == null || f.grade === "bad") continue;
      g.fillStyle = f.grade === "ok" ? col["--ontime"] : f.err < 0 ? col["--early"] : col["--late"];
      g.fillRect(x(f.t) - 1.5, y(f.ref + sh) - bh / 2 + 2, 3.5, bh - 4);
    }

    // lo cantado: una línea blanca (junto a la nota con la que se comparó; sin referencia, en la octava del medio)
    const mid = (lo + hi) / 2;
    const at = (f: { midi: number; ref: number | null; err: number }) => (f.ref != null ? f.ref + sh + f.err / 100 : f.midi - 12 * Math.round((f.midi - mid) / 12));
    g.strokeStyle = col["--pitch"];
    g.lineWidth = 2.5;
    g.lineJoin = g.lineCap = "round";
    g.shadowColor = col["--pitch"];
    g.shadowBlur = 6;
    g.beginPath();
    let prev: Scored | null = null;
    for (let i = frames.length - 1; i >= 0; i--) {
      const f = frames[i];
      if (f.t < t0) break;
      if (f.t > time) continue;
      const jump = prev && (prev.t - f.t > 0.12 || Math.abs(at(prev) - at(f)) > 3);
      if (!prev || jump) g.moveTo(x(f.t), y(at(f)));
      else g.lineTo(x(f.t), y(at(f)));
      prev = f;
    }
    g.stroke();
    g.shadowBlur = 0;

    // ahora
    g.fillStyle = col["--text"];
    g.globalAlpha = 0.35;
    g.fillRect(x(time), 0, 1, h);
    g.globalAlpha = 1;
    if (now) {
      const m = now.at ?? now.midi - 12 * Math.round((now.midi - mid) / 12);
      g.fillStyle = col["--pitch"];
      g.shadowColor = col["--pitch"];
      g.shadowBlur = 14;
      g.beginPath();
      g.arc(x(time), y(Math.max(lo, Math.min(hi, m))), 6, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }
  }

  // ---------------------------------------------------------------- vista

  const name = (m: number) => noteName(((Math.round(m) % 12) + 12) % 12, { tonic: 0, minor: false }, true) + (Math.floor(Math.round(m) / 12) - 1);
  const lineAt = $derived(ph.findIndex((p) => time >= p.t - 0.6 && time <= p.end + 0.3));
  const line = $derived(lineAt >= 0 ? ph[lineAt] : ph.find((p) => p.t > time));
  const nextLine = $derived(line ? ph[ph.indexOf(line) + 1] : undefined);
  /** Desafinación: en el centro (±50 ¢), baja (cyan) o alta (naranja). Siempre con su flecha, no solo color. */
  const dev = $derived(
    !now ? null : Math.abs(now.err) <= 50 ? { c: "var(--ontime)", mark: "•", text: "afinado" } : now.err < 0 ? { c: "var(--early)", mark: "↓", text: "bajo" } : { c: "var(--late)", mark: "↑", text: "alto" },
  );
  const scoreColor = (s: number | null) => (s == null ? "var(--text-3)" : s >= 75 ? "var(--ok)" : s >= 40 ? "var(--warn)" : "var(--bad)");
  const pct = (at: number) => `${(Math.max(0, Math.min(at, duration)) / (duration || 1)) * 100}%`;
  const scored = $derived(results ? ph.map((p, i) => ({ p, s: results![i] })).filter((x) => x.s != null) : []);

  function onkey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest("input, textarea, select, button") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space") (e.preventDefault(), void toggle());
    else if (e.key === "ArrowLeft") seek(Math.max(0, time - 5));
    else if (e.key === "ArrowRight") seek(Math.min(duration, time + 5));
  }

  onDestroy(() => {
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((tr) => tr.stop());
    player.stop();
    void player.ctx.close();
  });
</script>

<svelte:window onkeydown={onkey} />

<section class="sing">
  <header class="top">
    <IconButton icon="back" label={t("Volver a la canción")} onclick={onback} side="bottom" />
    <Icon name="mic" size={16} />
    <div class="title">
      <strong>{title}</strong>
      {#if artist}<span>{artist}</span>{/if}
    </div>
    <span class="sp"></span>
    <span use:tooltip={t("Puntúa la melodía aunque la cantes en otro tono")}><Toggle bind:checked={free}>{t("Transposición libre")}</Toggle></span>
    <span use:tooltip={t("La voz original, bajita, para guiarte")}><Toggle bind:checked={guide}>{t("Voz original")}</Toggle></span>
    <span class="lat" use:tooltip={t("Latencia del micro: si lo que cantas sale siempre tarde, súbela")}>
      <Icon name="sessions" size={14} />
      <Slider bind:value={latency} min={0} max={500} step={10} label={t("Latencia del micro (ms)")} />
      <span class="num">{latency} ms</span>
    </span>
  </header>

  {#if loading}
    <div class="center"><ProgressRing value={null} size={36} label={t("Cargando")} /></div>
  {:else if error}
    <EmptyState icon="alert" title={t("No se puede cantar esta")}>
      {error}
      {#snippet actions()}<Button onclick={onback} icon="back">{t("Volver a la canción")}</Button>{/snippet}
    </EmptyState>
  {:else}
    <div class="readout">
      <div class="pitch" style:--c={dev?.c ?? "var(--text-3)"}>
        <span class="note">{now ? name(now.midi) : "—"}</span>
        <span class="dev">{dev ? `${dev.mark} ${t(dev.text)}` : micError ? t("sin micro") : t("canta")}</span>
      </div>
      <div class="gauge" use:tooltip={t("Desafinación en cents: ±50 es acierto")}>
        <div class="track"><span class="zone"></span>{#if now}<span class="needle" style:left="{50 + Math.max(-100, Math.min(100, now.err)) / 2}%"></span>{/if}</div>
        <div class="scale num"><span>−100 ¢</span><b>{now ? `${now.err > 0 ? "+" : ""}${Math.round(now.err)} ¢` : "0 ¢"}</b><span>+100 ¢</span></div>
      </div>
      <span use:tooltip={t("Tu tono respecto al original (sin contar octavas)")}><Chip icon="audio" active={shift != null && shift !== 0}>{shiftLabel(shift)}</Chip></span>
      <span class="sp"></span>
      <div class="ring" use:tooltip={t("Esta frase")}>
        <ProgressRing value={(phraseNow ?? 0) / 100} size={56} stroke={5} color={scoreColor(phraseNow)} label={t("Frase")}><b class="num">{phraseNow ?? "—"}</b></ProgressRing>
        <small>{t("frase")}</small>
      </div>
      <div class="ring" use:tooltip={t("Toda la toma")}>
        <ProgressRing value={(total ?? 0) / 100} size={56} stroke={5} color={scoreColor(total)} label={t("Toma")}><b class="num">{total ?? "—"}</b></ProgressRing>
        <small>{t("toma")}</small>
      </div>
    </div>

    <div class="lane">
      <canvas bind:this={canvas}></canvas>
      <div class="lyric">
        <p class:dim={lineAt < 0}>{line?.text ?? ""}</p>
        <p class="next">{nextLine?.text ?? ""}</p>
      </div>

      {#if summary && total != null}
        <div class="summary">
          <Card>
            <div class="sum">
              <ProgressRing value={total / 100} size={132} stroke={10} color={scoreColor(total)} label={t("Puntuación de la toma")}>
                <span class="big num">{total}</span>
              </ProgressRing>
              <div class="sum-body">
                <h2>{total >= 85 ? t("¡Clavada!") : total >= 65 ? t("Muy bien") : total >= 40 ? t("Vas bien") : t("Otra vuelta")}</h2>
                <div class="split" aria-label={t("Reparto de aciertos")}>
                  <i style:width="{stats.ok * 100}%" style:background="var(--ontime)"></i>
                  <i style:width="{stats.partial * 100}%" style:background="var(--warn)"></i>
                  <i style:width="{stats.bad * 100}%" style:background="var(--miss)"></i>
                </div>
                <div class="legend num">
                  <span><i style:background="var(--ontime)"></i>• {Math.round(stats.ok * 100)}% {t("afinado")}</span>
                  <span><i style:background="var(--warn)"></i>~ {Math.round(stats.partial * 100)}% {t("cerca")}</span>
                  <span><i style:background="var(--miss)"></i>× {Math.round(stats.bad * 100)}% {t("fuera")}</span>
                </div>
                <p class="bias" style:color={Math.abs(stats.bias) < 10 ? "var(--ontime)" : stats.bias < 0 ? "var(--early)" : "var(--late)"}>
                  {Math.abs(stats.bias) < 10 ? t("• Centrado") : stats.bias < 0 ? t("↓ Tiendes a cantar bajo ({n} ¢)", { n: Math.round(stats.bias) }) : t("↑ Tiendes a cantar alto (+{n} ¢)", { n: Math.round(stats.bias) })}
                  <span>· {shiftLabel(shift)}</span>
                </p>
              </div>
            </div>
            {#if scored.length}
              <div class="bars" aria-label={t("Puntuación por frase")}>
                {#each scored as { p, s } (p.t)}
                  <button type="button" class="pbar" style:--h="{Math.max(6, s!)}%" style:--c={scoreColor(s)} onclick={() => ((summary = false), seek(Math.max(0, p.t - 1)))} use:tooltip={`${s} · ${p.text || fmtClock(p.t)}`} aria-label={t("Frase {at}: {s}", { at: fmtClock(p.t), s: s! })}></button>
                {/each}
              </div>
            {/if}
            <div class="sum-actions">
              <Button variant="ghost" onclick={() => (summary = false)}>{t("Seguir")}</Button>
              <Button variant="primary" icon="retry" onclick={again}>{t("Otra toma")}</Button>
            </div>
          </Card>
        </div>
      {/if}
    </div>

    <div class="phrases" aria-label={t("Frases")}>
      {#each ph as p, i (p.t)}
        {@const s = results?.[i] ?? (i === lineAt ? phraseNow : null)}
        <button type="button" class="ph" class:now={i === lineAt} style:left={pct(p.t)} style:width={pct(p.end - p.t)} style:--c={scoreColor(s ?? null)} class:has={s != null} onclick={() => seek(Math.max(0, p.t - 1))} use:tooltip={`${s ?? "—"} · ${p.text || fmtClock(p.t)}`} aria-label={t("Ir a la frase {at}", { at: fmtClock(p.t) })}></button>
      {/each}
      <span class="head" style:left={pct(time)}></span>
    </div>

    <footer class="transport">
      <Button variant="primary" icon={playing ? "pause" : "play"} onclick={toggle} kbd={t("Espacio")}>{playing ? t("Pausa") : t("Cantar")}</Button>
      <span class="clock num">{fmtClock(time)} <span>/ {fmtClock(duration)}</span></span>
      <div class="scrub"><Slider value={time} min={0} max={duration || 1} step={0.1} label={t("Posición")} oninput={seek} /></div>
      <span class="vol"><Icon name="volume" size={14} /><Slider bind:value={volume} min={0} max={1.5} label={t("Volumen")} /></span>
      <span class="tip" class:err={!!micError}>{micError || t("Con auriculares: si el micro oye la canción, se lía.")}</span>
    </footer>
  {/if}
</section>

<style>
  .sing { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; overflow: hidden; }
  .top { display: flex; align-items: center; gap: var(--s3); padding: var(--s2) var(--s4); border-bottom: 1px solid var(--line); flex-wrap: wrap; color: var(--text-2); }
  .title { display: flex; align-items: baseline; gap: var(--s2); min-width: 0; }
  .title strong { color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title span { color: var(--text-3); font-size: var(--fs-sm); white-space: nowrap; }
  .sp { flex: 1; }
  .lat { display: flex; align-items: center; gap: var(--s2); width: 210px; color: var(--text-3); font-size: var(--fs-sm); }
  .lat .num { width: 6ch; text-align: right; }
  .center { flex: 1; display: grid; place-items: center; }

  .readout { display: flex; align-items: center; gap: var(--s5); padding: var(--s3) var(--s5); flex-wrap: wrap; }
  .pitch { display: flex; flex-direction: column; min-width: 4.2ch; }
  .note { font-size: 56px; font-weight: 800; line-height: 1; letter-spacing: -0.04em; color: var(--c); transition: color var(--t-fast); }
  .dev { font-size: var(--fs-sm); color: var(--c); }
  .gauge { display: flex; flex-direction: column; gap: var(--s1); width: 300px; }
  .track {
    position: relative; height: 12px; border-radius: var(--r-full);
    background: linear-gradient(to right, var(--early), color-mix(in oklab, var(--early) 30%, var(--panel-hi)) 35%, var(--panel-hi) 50%, color-mix(in oklab, var(--late) 30%, var(--panel-hi)) 65%, var(--late));
  }
  .zone { position: absolute; left: 37.5%; width: 25%; top: -3px; bottom: -3px; border-radius: var(--r-full); border: 1.5px solid var(--ontime); }
  .needle { position: absolute; top: -6px; bottom: -6px; width: 4px; margin-left: -2px; border-radius: 2px; background: var(--pitch); box-shadow: 0 0 8px var(--pitch); transition: left 60ms linear; }
  .scale { display: flex; justify-content: space-between; font-size: var(--fs-xs); color: var(--text-3); }
  .scale b { color: var(--text); font-weight: 600; }
  .ring { display: flex; flex-direction: column; align-items: center; gap: 2px; }
  .ring b { font-size: var(--fs-lg); }
  .ring small { color: var(--text-3); font-size: var(--fs-xs); }

  .lane { position: relative; flex: 1; min-height: 0; margin: 0 var(--s4); border-radius: var(--r-lg); background: var(--panel); border: 1px solid var(--line); overflow: hidden; }
  canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
  .lyric { position: absolute; left: 0; right: 0; bottom: var(--s4); text-align: center; padding: 0 var(--s5); pointer-events: none; }
  .lyric p { font-size: 26px; font-weight: 600; min-height: 1.3em; text-shadow: 0 2px 12px var(--bg); }
  .lyric .dim { color: var(--text-3); }
  .lyric .next { font-size: var(--fs-lg); font-weight: 400; color: var(--text-3); }

  .summary { position: absolute; inset: 0; display: grid; place-items: center; background: var(--scrim); animation: fade var(--t); padding: var(--s4); }
  .summary > :global(*) { width: min(620px, 100%); animation: rise var(--t-slow) var(--ease); }
  .sum { display: flex; gap: var(--s5); align-items: center; padding: var(--s3) 0; }
  .big { font-size: 40px; font-weight: 800; }
  .sum-body { display: flex; flex-direction: column; gap: var(--s2); flex: 1; min-width: 0; }
  .sum-body h2 { font-size: var(--fs-xl); }
  .split { display: flex; height: 10px; border-radius: var(--r-full); overflow: hidden; background: var(--panel-hi); }
  .legend { display: flex; gap: var(--s3); flex-wrap: wrap; font-size: var(--fs-xs); color: var(--text-2); }
  .legend span { display: flex; align-items: center; gap: var(--s1); }
  .legend i { width: 8px; height: 8px; border-radius: 2px; }
  .bias { font-size: var(--fs-sm); }
  .bias span { color: var(--text-3); }
  .bars { display: flex; align-items: flex-end; justify-content: center; gap: 2px; height: 72px; margin: var(--s3) 0; padding-top: var(--s2); border-top: 1px solid var(--line); }
  .pbar { flex: 1; min-width: 3px; max-width: 28px; height: var(--h); padding: 0; border: 0; border-radius: 2px 2px 0 0; background: var(--c); opacity: 0.85; cursor: pointer; }
  .pbar:hover { opacity: 1; }
  .sum-actions { display: flex; justify-content: flex-end; gap: var(--s2); }

  .phrases { position: relative; height: 14px; margin: var(--s3) var(--s4) 0; border-radius: var(--r-sm); background: var(--panel); flex-shrink: 0; }
  .ph { position: absolute; top: 2px; bottom: 2px; min-width: 2px; padding: 0; border: 0; border-radius: 2px; background: var(--line-hi); cursor: pointer; }
  .ph.has { background: var(--c); }
  .ph.now { outline: 1.5px solid var(--text); }
  .head { position: absolute; top: -3px; bottom: -3px; width: 2px; margin-left: -1px; background: var(--text); pointer-events: none; }

  .transport { display: flex; align-items: center; gap: var(--s3); padding: var(--s3) var(--s4); flex-wrap: wrap; }
  .clock { font-size: var(--fs-sm); white-space: nowrap; }
  .clock span { color: var(--text-3); }
  .scrub { flex: 1; min-width: 120px; }
  .vol { display: flex; align-items: center; gap: var(--s2); width: 120px; color: var(--text-3); }
  .tip { color: var(--text-3); font-size: var(--fs-xs); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tip.err { color: var(--bad); }
</style>
