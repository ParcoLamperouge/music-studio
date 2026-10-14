<script lang="ts">
  import { Channel, invoke } from "@tauri-apps/api/core";
  import { onMount } from "svelte";
  import { loadNotation } from "./ChordsTab.svelte";
  import { paths, writeBytes, writeJson } from "./engine";
  import { chordName, degree, keyName, noteName } from "./harmony";
  import { Live } from "./live";
  import { keyLayout } from "./Roll.svelte";
  import { settings } from "./settings.svelte";

  let { onback }: { onback: () => void } = $props();

  const KEYS_H = 90;
  const LO = 21, HI = 108; // piano de 88 teclas
  const latin = loadNotation().latin;
  const store = (k: string, v?: string) => {
    try {
      return v == null ? localStorage.getItem(k) : (localStorage.setItem(k, v), v);
    } catch {
      return null;
    }
  };

  let ports = $state<string[]>([]);
  let port = $state("");
  let connected = $state("");
  let hasOut = $state(false);
  let error = $state("");
  let failed = ""; // no reintentar solo uno que no abre
  let volume = $state(+(store("estudio.midi.volume") ?? 100));
  let live = new Live();
  let started: Date | null = null;
  let dirty = false;
  let saved = $state("");
  let count = $state(0); // notas tocadas, para la cabecera

  async function scan() {
    try {
      ports = await invoke<string[]>("midi_ports");
    } catch (e) {
      error = String(e);
      return;
    }
    if (connected && !ports.includes(connected)) {
      connected = "";
      error = "Se desconectó el teclado";
      void invoke("midi_close");
    }
    // al enchufarlo (o al abrir): el último usado, o el único que hay
    if (!connected) {
      const last = store("estudio.midi");
      const pick = ports.find((p) => p === last) ?? (ports.length === 1 ? ports[0] : "");
      if (pick && pick !== failed) void connect(pick);
      else if (!port) port = ports[0] ?? "";
    }
  }

  async function connect(name: string) {
    port = name;
    error = "";
    const ch = new Channel<number[]>();
    ch.onmessage = (msg) => {
      if (!live.midi(msg, performance.now() / 1000)) return;
      started ??= live.t0 >= 0 ? new Date() : null;
      dirty = started != null;
      count = live.notes.length + live.sounding.size;
    };
    try {
      hasOut = await invoke<boolean>("midi_open", { name, on: ch });
      connected = name;
      failed = "";
      store("estudio.midi", name);
    } catch (e) {
      connected = "";
      failed = name;
      error = String(e);
    }
  }

  function setVolume(v: number) {
    volume = v;
    store("estudio.midi.volume", String(v));
    // CC7 (volumen del canal) en el canal del teclado; casi todos los pianos digitales lo obedecen
    invoke("midi_send", { msg: [0xb0 | live.channel, 7, v] }).catch((e) => (error = String(e)));
  }

  const stamp = (d: Date) => {
    const z = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
  };

  async function save() {
    if (!started || !dirty) return;
    dirty = false;
    const base = `${paths.data}/sesiones/${stamp(started)}`;
    const { json, mid } = live.snapshot(performance.now() / 1000, connected || port, started, latin);
    try {
      await writeBytes(`${base}.mid`, mid);
      await writeJson(`${base}.json`, json);
      saved = `${base}.mid`;
    } catch (e) {
      dirty = true;
      error = `No se guardó la sesión: ${e}`;
    }
  }

  async function fresh() {
    await save();
    live = new Live();
    started = null;
    saved = "";
    count = 0;
  }

  onMount(() => {
    void scan();
    const poll = setInterval(scan, 2000); // enchufar y desenchufar el USB en marcha
    const auto = setInterval(save, 15000); // si se cierra la app, como mucho se pierden 15 s
    return () => {
      clearInterval(poll);
      clearInterval(auto);
      void save().then(() => invoke("midi_close"));
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
      const rollH = H - KEYS_H;
      const y = (x: number) => rollH - ((t - x) / win) * rollH;
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
      };
      g.fillStyle = g.shadowColor = "#f29d38";
      // ponytail: recorre todas las notas cada frame; en sesiones de horas, empezar por el final y cortar
      for (const [s, e, p, v] of live.notes) if (y(e) > 0) bar(s, e, p, v, false);
      for (const [p, n] of live.sounding) bar(n.t, t, p, n.v, true, n.held);
      g.globalAlpha = 1;
      g.shadowBlur = 0;

      // lo que suena: acorde, notas y tonalidad
      const k = live.key(now);
      const kk = k ?? { tonic: 0, minor: false };
      const names = [...live.sounding.keys()].sort((a, b) => a - b).map((p) => noteName(p % 12, kk, latin) + (Math.floor(p / 12) - 1));
      g.fillStyle = "#15110ed9";
      g.beginPath();
      g.roundRect(12, 12, 300, 112, 12);
      g.fill();
      g.fillStyle = "#f3ead9";
      g.font = "400 44px 'Instrument Serif', serif";
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
      for (const black of [false, true]) {
        for (const [p, kb] of keys) {
          if (kb.black !== black) continue;
          const h = black ? KEYS_H * 0.62 : KEYS_H;
          g.fillStyle = live.sounding.has(p) ? "#f29d38" : black ? "#15161c" : "#eceae4";
          g.beginPath();
          g.roundRect(kb.x + 0.5, rollH, kb.w - 1, h, [0, 0, 4, 4]);
          g.fill();
          if (!black && p % 12 === 0) {
            g.fillStyle = "#00000066";
            g.font = "10px 'JetBrains Mono Variable', monospace";
            g.fillText(`C${Math.floor(p / 12) - 1}`, kb.x + 3, rollH + KEYS_H - 8);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  });
</script>

<section class="play">
  <header>
    <button class="ghost" onclick={onback} title="Volver al menú">← Menú</button>
    <span class="dot" class:on={!!connected}></span>
    <select bind:value={port} onchange={() => connect(port)} disabled={!ports.length}>
      {#each ports as p (p)}<option value={p}>{p}</option>{/each}
      {#if !ports.length}<option value="">Ningún teclado MIDI conectado</option>{/if}
    </select>
    {#if port && !connected}<button class="ghost" onclick={() => connect(port)}>Conectar</button>{/if}
    <label title={hasOut ? "Volumen del teclado (CC7)" : "Este aparato no tiene salida MIDI: el volumen, en el propio teclado"}>
      Volumen
      <input type="range" min="0" max="127" value={volume} disabled={!hasOut} oninput={(e) => setVolume(+e.currentTarget.value)} />
    </label>
    <label title="Cuántos segundos de notas se ven subir">
      Velocidad
      <input type="range" min="1" max="6" step="0.5" value={7 - settings.rollSpeed} oninput={(e) => (settings.rollSpeed = 7 - +e.currentTarget.value)} />
    </label>
    <span class="grow"></span>
    {#if error}<span class="error-text err" title={error}>{error}</span>{/if}
    <span class="mono muted" title={saved}>{count} notas{saved ? " · guardada" : ""}</span>
    <button class="ghost" onclick={save} disabled={!count} title="Se guarda sola cada 15 s: .mid para reproducir y .json para la IA">Guardar</button>
    <button class="primary" onclick={fresh} disabled={!count} title="Guarda esta y empieza otra">Nueva sesión</button>
  </header>
  <div class="stage" bind:clientWidth={width} bind:clientHeight={height}>
    <canvas bind:this={canvas} style:height="{height}px"></canvas>
  </div>
</section>

<style>
  .play { flex: 1; min-height: 0; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  header { display: flex; align-items: center; gap: 10px; padding: 8px 14px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  header label { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: 12px; }
  header label input { width: 90px; }
  select { max-width: 280px; font-size: 12px; padding: 5px 8px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); }
  .dot.on { background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .grow { flex: 1; }
  .err { font-size: 12px; max-width: 280px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .muted { font-size: 12px; }
  .stage { flex: 1; min-height: 0; overflow: hidden; }
  canvas { width: 100%; display: block; }
</style>
