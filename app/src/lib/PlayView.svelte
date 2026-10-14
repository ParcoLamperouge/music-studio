<script lang="ts">
  import { onMount } from "svelte";
  import { loadNotation } from "./ChordsTab.svelte";
  import { paths, writeBytes } from "./engine";
  import { chordName, degree, keyName, noteName } from "./harmony";
  import InputBar from "./InputBar.svelte";
  import { input, pcKey, pcRelease, send, useInput } from "./keys.svelte";
  import { Live } from "./live";
  import { drawBarLabel, drawKeys, keyLayout, keysHeight } from "./Roll.svelte";
  import { settings } from "./settings.svelte";

  let { onback, onsessions }: { onback: () => void; onsessions: () => void } = $props();

  const LO = 21, HI = 108; // piano de 88 teclas
  const latin = loadNotation().latin;
  const store = (k: string, v?: string) => {
    try {
      return v == null ? localStorage.getItem(k) : (localStorage.setItem(k, v), v);
    } catch {
      return null;
    }
  };

  let error = $state(""); // al guardar
  let volume = $state(+(store("estudio.midi.volume") ?? 100));
  let live = new Live();
  let started: Date | null = null;
  let dirty = false;
  let saved = $state("");
  let count = $state(0); // notas tocadas, para la cabecera

  function feed(msg: number[]) {
    if (!live.midi(msg, performance.now() / 1000)) return;
    started ??= live.t0 >= 0 ? new Date() : null;
    dirty = started != null;
    count = live.notes.length + live.sounding.size;
  }

  function setVolume(v: number) {
    volume = v;
    store("estudio.midi.volume", String(v));
    // CC7 (volumen del canal) en el canal del teclado; casi todos los pianos digitales lo obedecen
    send([0xb0 | live.channel, 7, v]).catch((e) => (error = String(e)));
  }

  const stamp = (d: Date) => {
    const z = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
  };

  async function save() {
    if (!started || !dirty) return;
    dirty = false;
    const base = `${paths.data}/sesiones/${stamp(started)}`;
    const { json, mid } = live.snapshot(performance.now() / 1000, input.connected || "teclado del ordenador", started, latin);
    try {
      await writeBytes(`${base}.mid`, mid);
      await writeBytes(`${base}.json`, new TextEncoder().encode(JSON.stringify(json))); // compacto: la mitad de tokens para la IA
      saved = `${base}.mid`;
    } catch (e) {
      dirty = true;
      error = `No se guardó la sesión: ${e}`;
    }
  }

  /** Guardada antes de salir, para que ya salga en la lista. */
  async function toSessions() {
    await save();
    onsessions();
  }

  async function fresh() {
    await save();
    live = new Live();
    started = null;
    saved = "";
    count = 0;
  }

  onMount(() => {
    const stop = useInput(feed);
    const auto = setInterval(save, 15000); // si se cierra la app, como mucho se pierden 15 s
    return () => {
      clearInterval(auto);
      stop();
      void save();
    };
  });

  // ---------------------------------------------------------------- piano roll: las notas salen de la tecla y suben

  let canvas: HTMLCanvasElement;
  let width = $state(0);
  let height = $state(0);
  const keys = $derived(keyLayout(LO, HI, width));

  $effect(() => {
    if (!width || !height) return;
    const H = height;
    const dpr = devicePixelRatio;
    canvas.width = width * dpr;
    canvas.height = H * dpr;
    const g = canvas.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = performance.now() / 1000;
      const t = live.time(now);
      const win = settings.rollSpeed;
      const KEYS_H = keysHeight(keys);
      const rollH = H - KEYS_H;
      const y = (x: number) => rollH - ((t - x) / win) * rollH;
      const k = live.key(now);
      const kk = k ?? { tonic: 0, minor: false };
      const name = (p: number) => noteName(p % 12, kk, latin);
      const bg = g.createLinearGradient(0, 0, 0, rollH);
      bg.addColorStop(0, "#0d0b0a");
      bg.addColorStop(1, "#1a1613");
      g.fillStyle = bg;
      g.fillRect(0, 0, width, rollH);
      g.fillStyle = "#ffffff0d";
      for (const [p, k] of keys) if (p % 12 === 0) g.fillRect(k.x, 0, 1, rollH);

      const bar = (s: number, e: number, p: number, v: number, on: boolean, held = true) => {
        const k = keys.get(p);
        if (!k) return;
        const top = Math.max(0, y(s));
        g.globalAlpha = on ? (held ? 1 : 0.7) : 0.45 + v * 0.45;
        g.shadowBlur = on ? 18 : 0;
        g.beginPath();
        g.roundRect(k.x + 1, top, k.w - 2, Math.max(4, y(e) - top), 4);
        g.fill();
        drawBarLabel(g, k, y(e), y(e) - top, name(p));
      };
      g.fillStyle = g.shadowColor = "#f29d38";
      // ponytail: recorre todas las notas cada frame; en sesiones de horas, empezar por el final y cortar
      for (const [s, e, p, v] of live.notes) if (y(e) > 0) bar(s, e, p, v, false);
      for (const [p, n] of live.sounding) bar(n.t, t, p, n.v, true, n.held);
      g.globalAlpha = 1;
      g.shadowBlur = 0;

      // lo que suena: acorde, notas y tonalidad
      const names = [...live.sounding.keys()].sort((a, b) => a - b).map((p) => name(p) + (Math.floor(p / 12) - 1));
      g.fillStyle = "#15110ed9";
      g.beginPath();
      g.roundRect(12, 12, 300, 112, 12);
      g.fill();
      g.fillStyle = "#f3ead9";
      g.font = "600 32px 'JetBrains Mono', 'JetBrainsMono Nerd Font', 'JetBrains Mono Variable', monospace";
      const c = live.chord;
      const big = c ? chordName(c, kk, { latin, simple: false }) : "—";
      g.fillText(big, 26, 58);
      if (c && k) {
        g.font = "600 16px 'JetBrains Mono Variable', monospace";
        g.fillStyle = "#f3ead9b3";
        g.fillText(degree(c, k), 26 + g.measureText(big).width + 40, 56);
      }
      g.font = "500 12px 'JetBrains Mono Variable', monospace";
      g.fillStyle = "#b9ac98";
      g.fillText(names.join(" ") || (live.t0 < 0 ? "Toca algo" : ""), 26, 84, 272);
      g.fillStyle = "#f29d38";
      g.fillText(k ? keyName(k, latin) : "", 26, 108);
      if (live.pedal) {
        g.fillStyle = "#f29d38";
        g.fillText("● pedal", 240, 108);
      }

      g.fillStyle = "#ffffff55";
      g.fillRect(0, rollH - 2, width, 2);
      drawKeys(g, keys, rollH, KEYS_H, new Map([...live.sounding.keys()].map((p) => [p, "#f29d38"])), name);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  });
</script>

<svelte:window onkeydown={(e) => pcKey(e, live.channel)} onkeyup={(e) => pcKey(e, live.channel)} onblur={() => pcRelease(live.channel)} />

<section class="card play">
  <header>
    <button class="ghost sm" onclick={onback} title="Volver al menú">← Menú</button>
    <InputBar />
    <label title={input.hasOut ? "Volumen del teclado (CC7)" : "Este aparato no tiene salida MIDI: el volumen, en el propio teclado"}>
      Volumen
      <input type="range" min="0" max="127" value={volume} disabled={!input.hasOut} oninput={(e) => setVolume(+e.currentTarget.value)} />
    </label>
    <label title="Cuántos segundos de notas se ven subir">
      Velocidad
      <input type="range" min="1" max="6" step="0.5" value={7 - settings.rollSpeed} oninput={(e) => (settings.rollSpeed = 7 - +e.currentTarget.value)} />
    </label>
    <span class="grow"></span>
    {#if error || input.error}<span class="error-text err" title={error || input.error}>{error || input.error}</span>{/if}
    <span class="mono muted" title={saved}>{count} notas{saved ? " · guardada" : ""}</span>
    <button class="ghost sm" onclick={save} disabled={!count} title="Se guarda sola cada 15 s: .mid para reproducir y .json para la IA">Guardar</button>
    <button class="ghost sm" onclick={toSessions} title="Volver a oír y analizar lo tocado (se guarda esta antes)">Sesiones</button>
    <button class="primary sm" onclick={fresh} disabled={!count} title="Guarda esta y empieza otra">Nueva sesión</button>
  </header>
  <div class="stage" bind:clientWidth={width} bind:clientHeight={height}>
    <canvas bind:this={canvas} style:height="{height}px"></canvas>
  </div>
</section>

<style>
  .play { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0; overflow: hidden; }
  header { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  header label { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: 12px; }
  header label input { width: 90px; }
  .err { font-size: 12px; max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .muted { font-size: 12px; }
  .stage { flex: 1; min-height: 0; overflow: hidden; }
  canvas { width: 100%; display: block; }
</style>
