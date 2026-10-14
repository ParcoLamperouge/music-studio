<script lang="ts" module>
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const isBlack = (p: number) => BLACK.has(p % 12);

  /** x y ancho de cada nota midi en un teclado de `lo` a `hi` que ocupa `width`. */
  export function keyLayout(lo: number, hi: number, width: number) {
    const whites = [];
    for (let p = lo; p <= hi; p++) if (!isBlack(p)) whites.push(p);
    const ww = width / whites.length;
    const map = new Map<number, { x: number; w: number; black: boolean }>();
    let i = 0;
    for (let p = lo; p <= hi; p++) {
      if (isBlack(p)) map.set(p, { x: i * ww - ww * 0.3, w: ww * 0.6, black: true });
      else map.set(p, { x: i++ * ww, w: ww, black: false });
    }
    return map;
  }
</script>

<script lang="ts">
  import { readBytes } from "./engine";
  import type { Snippet } from "svelte";
  import { setWindowFullscreen } from "./fullscreen";
  import type { Player } from "./player";

  type Note = [start: number, end: number, pitch: number, velocity: number];
  type Track = { stem: string; name: string; color: string; path: string; hidden: boolean };

  let { player, tracks, controls, ontoggle, windowSec = $bindable(2.5), chords = [], keyLabel = "" }: {
    player: Player;
    tracks: Track[];
    controls: Snippet; // transporte, para la pantalla completa
    ontoggle: (stem: string) => void;
    windowSec?: number; // segundos visibles por encima del teclado: más = notas más lentas
    chords?: { t: number; end: number; name: string; deg?: string }[]; // cambios de acorde y su grado (de harmony.ts)
    keyLabel?: string; // tonalidad
  } = $props();

  const KEYS_H = 90;
  let fullscreen = $state(false);
  let height = $state(0); // ocupa todo el alto que le dejen (pestaña o pantalla completa)

  function setFullscreen(on: boolean) {
    fullscreen = on;
    setWindowFullscreen(on);
  }
  $effect(() => () => {
    if (fullscreen) setWindowFullscreen(false); // al cerrar el panel en pantalla completa
  });

  let canvas: HTMLCanvasElement;
  let width = $state(0);
  let notes = $state.raw<Record<string, Note[]>>({}); // raw: sin proxy en miles de notas leídas cada frame

  // notas de cada pista (cacheadas por ruta)
  $effect(() => {
    for (const t of tracks) {
      if (notes[t.path]) continue;
      readBytes(t.path).then((buf) => {
        const data = JSON.parse(new TextDecoder().decode(buf));
        notes = { ...notes, [t.path]: Array.isArray(data) ? data : data.notes }; // o una sesión del teclado
      });
    }
  });

  // teclado: de la nota más grave a la más aguda de todas las pistas, en octavas completas
  const range = $derived.by(() => {
    const all = Object.values(notes).flat();
    if (!all.length) return { lo: 48, hi: 83 };
    let lo = Math.min(...all.map((n) => n[2]));
    let hi = Math.max(...all.map((n) => n[2]));
    lo -= lo % 12;
    hi += 11 - (hi % 12);
    if (hi - lo < 35) hi = lo + 35; // mínimo 3 octavas
    return { lo, hi };
  });

  const keys = $derived(keyLayout(range.lo, range.hi, width));

  $effect(() => {
    if (!width || !height) return;
    const HEIGHT = height;
    const dpr = devicePixelRatio;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const g = canvas.getContext("2d")!;
    let raf = 0;

    const draw = () => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = player.time();
      const rollH = HEIGHT - KEYS_H;
      const bg = g.createLinearGradient(0, 0, 0, rollH);
      bg.addColorStop(0, "#0d0b0a");
      bg.addColorStop(1, "#1a1613");
      g.fillStyle = bg;
      g.fillRect(0, 0, width, rollH);

      // guías en cada Do
      g.fillStyle = "#ffffff0d";
      for (const [p, k] of keys) if (p % 12 === 0) g.fillRect(k.x, 0, 1, rollH);

      const active = new Map<number, string>();
      for (const track of tracks) {
        if (track.hidden) continue;
        // ponytail: recorre todas las notas cada frame; con decenas de miles, búsqueda binaria por inicio
        for (const [start, end, pitch, vel] of notes[track.path] ?? []) {
          if (end < t || start > t + windowSec) continue;
          const k = keys.get(pitch);
          if (!k) continue;
          const bottom = rollH * (1 - (start - t) / windowSec);
          const top = rollH * (1 - (end - t) / windowSec);
          const on = start <= t && t < end;
          if (on) active.set(pitch, track.color);
          g.globalAlpha = on ? 1 : 0.55 + vel * 0.45;
          g.shadowColor = track.color;
          g.shadowBlur = on ? 18 : 0;
          g.fillStyle = track.color;
          g.beginPath();
          g.roundRect(k.x + 1, top, k.w - 2, Math.max(4, Math.min(bottom, rollH) - top), 4);
          g.fill();
        }
      }
      g.globalAlpha = 1;
      g.shadowBlur = 0;

      // acordes: cada cambio cae con las notas, y el que suena va arriba a la izquierda
      g.font = "600 13px 'JetBrains Mono Variable', monospace";
      for (const c of chords) {
        if (c.t < t || c.t > t + windowSec) continue;
        const y = rollH * (1 - (c.t - t) / windowSec);
        g.fillStyle = "#f29d3840";
        g.fillRect(0, y, width, 1);
        const deg = c.deg ? ` ${c.deg}` : "";
        g.font = "600 13px 'JetBrains Mono Variable', monospace";
        const nw = g.measureText(c.name).width;
        g.font = "500 11px 'JetBrains Mono Variable', monospace";
        const dw = deg ? g.measureText(deg).width : 0;
        const x = width - nw - dw - 26;
        g.fillStyle = "#15110ee6";
        g.beginPath();
        g.roundRect(x - 8, y - 22, nw + dw + 16, 19, 6);
        g.fill();
        g.font = "600 13px 'JetBrains Mono Variable', monospace";
        g.fillStyle = "#f6b24a";
        g.fillText(c.name, x, y - 8);
        if (deg) {
          g.font = "500 11px 'JetBrains Mono Variable', monospace";
          g.fillStyle = "#b9ac98";
          g.fillText(deg, x + nw, y - 8);
        }
      }
      const cur = chords.find((c) => c.t <= t && t < c.end);
      const nxt = chords.find((c) => c.t > t);
      if (cur || keyLabel) {
        g.fillStyle = "#15110ed9";
        g.beginPath();
        g.roundRect(12, 12, 250, keyLabel ? 104 : 84, 12);
        g.fill();
        g.fillStyle = "#f3ead9";
        g.font = "400 40px 'Instrument Serif', serif";
        const big = cur?.name ?? "—";
        g.fillText(big, 26, 54);
        const after = 26 + g.measureText(big).width + 14;
        g.font = "500 12px 'JetBrains Mono Variable', monospace";
        g.fillStyle = "#b9ac98";
        if (nxt) g.fillText(`→ ${nxt.name}${nxt.deg ? ` (${nxt.deg})` : ""}`, after, 52);
        if (cur?.deg) {
          g.font = "600 16px 'JetBrains Mono Variable', monospace";
          g.fillStyle = "#f3ead9b3";
          g.fillText(cur.deg, 26, 78);
        }
        if (keyLabel) {
          g.font = "500 12px 'JetBrains Mono Variable', monospace";
          g.fillStyle = "#f29d38";
          g.fillText(keyLabel, 26, cur?.deg ? 100 : 80);
        }
      }

      // línea de golpeo
      g.fillStyle = "#ffffff55";
      g.fillRect(0, rollH - 2, width, 2);

      // teclado: blancas y luego negras por encima
      for (const black of [false, true]) {
        for (const [p, k] of keys) {
          if (k.black !== black) continue;
          const lit = active.get(p);
          const h = black ? KEYS_H * 0.62 : KEYS_H;
          g.fillStyle = lit ?? (black ? "#15161c" : "#eceae4");
          g.beginPath();
          g.roundRect(k.x + 0.5, rollH, k.w - 1, h, [0, 0, 4, 4]);
          g.fill();
          if (!black && p % 12 === 0) {
            g.fillStyle = "#00000066";
            g.font = "10px 'JetBrains Mono Variable', monospace";
            g.fillText(`C${Math.floor(p / 12) - 1}`, k.x + 4, rollH + KEYS_H - 8);
          }
        }
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  });
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && fullscreen && setFullscreen(false)} />

<section class="roll" class:fs={fullscreen}>
  <header>
    <div class="legend">
      <strong>Piano roll</strong>
      {#each tracks as t (t.stem)}
        <button class="chip" class:off={t.hidden} onclick={() => ontoggle(t.stem)} title={t.hidden ? "Mostrar" : "Ocultar"}>
          <i style:background={t.color}></i>{t.name}
        </button>
      {/each}
      {#if !tracks.length}<small>Ninguna pista con notas suena ahora (revisa M/S).</small>{/if}
    </div>
    <div class="tools">
      <label title="Cuántos segundos de notas se ven antes de sonar">
        Velocidad
        <input type="range" min="1" max="6" step="0.5" value={7 - windowSec} oninput={(e) => (windowSec = 7 - +e.currentTarget.value)} />
      </label>
      <button class="ghost" onclick={() => setFullscreen(!fullscreen)} title={fullscreen ? "Salir (Esc)" : "Pantalla completa"}>
        {fullscreen ? "Salir" : "Pantalla completa"}
      </button>
    </div>
  </header>
  <div class="stage" bind:clientWidth={width} bind:clientHeight={height}>
    <canvas bind:this={canvas} style:height="{height}px"></canvas>
  </div>
  {#if fullscreen}<footer>{@render controls()}</footer>{/if}
</section>

<style>
  .roll { flex: 1; min-height: 240px; display: flex; flex-direction: column; background: var(--panel); border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
  header { display: flex; justify-content: space-between; align-items: center; padding: 8px 14px; border-bottom: 1px solid var(--line); }
  .legend { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
  .chip {
    display: flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 99px; cursor: pointer;
    border: 1px solid var(--line); background: transparent; color: var(--text-2); font-size: 12px;
  }
  .chip:hover { color: var(--text); }
  .chip.off { opacity: 0.4; text-decoration: line-through; }
  .legend i { width: 9px; height: 9px; border-radius: 50%; }
  .legend small { color: var(--text-3); }
  .tools { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .tools label { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: 12px; }
  .tools label input { width: 90px; }
  .tools button { padding: 5px 12px; }
  canvas { width: 100%; display: block; }

  .fs { position: fixed; inset: 0; z-index: 50; margin: 0; border: 0; border-radius: 0; display: flex; flex-direction: column; }
  .stage { flex: 1; min-height: 0; overflow: hidden; }
  footer { padding: 12px 16px; border-top: 1px solid var(--line); }
</style>
