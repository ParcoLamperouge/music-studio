<script lang="ts" module>
  import { tint } from "./rollfx";

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

  type Keys = ReturnType<typeof keyLayout>;
  const MONO = "'JetBrains Mono Variable', monospace";

  /** Alto del teclado para un ancho de tecla blanca: la proporción de una tecla de verdad (la parte que se ve). */
  export const keysHeight = (keys: Keys) => {
    const white = [...keys.values()].find((k) => !k.black);
    return Math.round(Math.max(80, Math.min(140, (white?.w ?? 20) * 4.3)));
  };

  /** Teclado de piano con el nombre de cada nota sobre su tecla (la octava en los Do): blancas siempre; negras cuando
   * suenan, que no caben las doce a la vez. `lit`: color de las que suenan (se ven hundidas y de ese color). */
  export function drawKeys(g: CanvasRenderingContext2D, keys: Keys, top: number, h: number, lit: Map<number, string>, name: (p: number) => string) {
    const hex = (c?: string) => c && /^#[0-9a-f]{6}/i.test(c);
    const FELT = 4;
    let width = 0;
    for (const k of keys.values()) width = Math.max(width, k.x + k.w);
    g.fillStyle = "#0b0a09";
    g.fillRect(0, top, width, h);
    const y0 = top + FELT, H = h - FELT;
    for (const black of [false, true]) {
      for (const [p, k] of keys) {
        if (k.black !== black) continue;
        const color = lit.get(p);
        if (!black) {
          const x = k.x + 0.5, w = k.w - 1, down = color ? 2 : 0;
          const body = g.createLinearGradient(0, y0, 0, y0 + H);
          if (hex(color)) (body.addColorStop(0, tint(color!, 0.1)), body.addColorStop(1, tint(color!, 0.6)));
          else if (color) (body.addColorStop(0, color), body.addColorStop(1, color));
          else (body.addColorStop(0, "#f3f0e8"), body.addColorStop(0.75, "#fdfcf8"), body.addColorStop(1, "#e7e2d6"));
          g.fillStyle = body;
          g.beginPath();
          g.roundRect(x, y0, w, H - 1 - (color ? 0 : 0), [0, 0, 5, 5]);
          g.fill();
          // la cara de delante (más alta si está subida) y la sombra del fieltro, más honda si está pulsada
          g.fillStyle = color ? "#00000026" : "#0000001f";
          g.fillRect(x, y0 + H - 7 + down, w, 6 - down);
          const shade = g.createLinearGradient(0, y0, 0, y0 + 14 + down * 4);
          shade.addColorStop(0, color ? "#00000066" : "#00000059");
          shade.addColorStop(1, "#00000000");
          g.fillStyle = shade;
          g.fillRect(x, y0, w, 14 + down * 4);
          g.fillStyle = "#00000030"; // junta entre teclas
          g.fillRect(k.x + k.w - 0.5, y0, 1, H - 2);
        } else {
          const bh = H * 0.62, x = k.x + 0.5, w = k.w - 1;
          // sombra sobre las blancas
          g.fillStyle = "#00000047";
          g.beginPath();
          g.roundRect(x + 1.5, y0, w + 1, bh + 4, [0, 0, 3, 3]);
          g.fill();
          const body = g.createLinearGradient(x, 0, x + w, 0);
          body.addColorStop(0, "#09090b");
          body.addColorStop(0.5, "#1d1d22");
          body.addColorStop(1, "#09090b");
          g.fillStyle = body;
          g.beginPath();
          g.roundRect(x, y0, w, bh, [0, 0, 3, 3]);
          g.fill();
          // la cara de arriba, con brillo, y el bisel de delante (más corto si está pulsada)
          const lip = color ? bh * 0.06 : bh * 0.12;
          const face = g.createLinearGradient(0, y0, 0, y0 + bh - lip);
          if (hex(color)) (face.addColorStop(0, tint(color!, 0)), face.addColorStop(1, tint(color!, 0.45)));
          else if (color) (face.addColorStop(0, color), face.addColorStop(1, color));
          else (face.addColorStop(0, "#2a2a30"), face.addColorStop(0.85, "#3c3c44"), face.addColorStop(1, "#4a4a52"));
          g.fillStyle = face;
          g.beginPath();
          g.roundRect(x + w * 0.12, y0, w * 0.76, bh - lip, [0, 0, 2, 2]);
          g.fill();
        }
        if (black && !color) continue;
        const kh = black ? H * 0.62 : H;
        const size = Math.max(7, Math.min(11, k.w * 0.45));
        g.font = `${color ? 700 : 500} ${size}px ${MONO}`;
        let label = name(p) + (p % 12 === 0 ? String(Math.floor(p / 12) - 1) : "");
        if (g.measureText(label).width > k.w - 2) label = name(p); // sin octava si no cabe
        const tw = g.measureText(label).width;
        if (tw > k.w - 1) continue;
        g.fillStyle = color ? "#1c0f05" : "#00000080";
        g.fillText(label, k.x + (k.w - tw) / 2, y0 + kh - (black ? 8 : 12));
      }
    }
  }

  /** Nombre de la nota dentro de su barra, pegado al extremo `y` (el del teclado); en las barras estrechas (teclas
   * negras), en vertical si la barra es larga. */
  export function drawBarLabel(g: CanvasRenderingContext2D, k: { x: number; w: number }, y: number, barH: number, label: string) {
    if (barH < 14 || k.w < 9) return;
    g.save(); // quien dibuja las barras sigue con su color y su letra
    g.font = `700 ${Math.max(7, Math.min(10, k.w * 0.42))}px ${MONO}`;
    g.globalAlpha = 0.8;
    g.shadowBlur = 0;
    g.fillStyle = "#1c0f05";
    const tw = g.measureText(label).width;
    if (tw <= k.w - 3) g.fillText(label, k.x + (k.w - tw) / 2, y - 4);
    else if (barH >= tw + 8) {
      g.translate(k.x + k.w / 2 + 3, y - 4);
      g.rotate(-Math.PI / 2);
      g.fillText(label, 0, 0);
    }
    g.restore();
  }


</script>

<script lang="ts">
  import { loadNotation } from "./ChordsTab.svelte";
  import { readBytes } from "./engine";
  import { noteName, type Key } from "./harmony";
  import type { Snippet } from "svelte";
  import { setWindowFullscreen } from "./fullscreen";
  import type { Player } from "./player";
  import { drawBackground, drawBar, ROLL_DEFAULT, ROLL_PRESETS, RollFx, type RollStyle } from "./rollfx";
  import { settings } from "./settings.svelte";

  type Note = [start: number, end: number, pitch: number, velocity: number];
  type Track = { stem: string; name: string; color: string; path: string; hidden: boolean; notes?: Note[] }; // notes: ya en memoria

  let { player, tracks, controls, ontoggle, windowSec = $bindable(2.5), chords = [], keyLabel = "", tonality, lit, title = "Piano roll", fx = false, tools }: {
    player: Player;
    tracks: Track[];
    controls: Snippet; // transporte, para la pantalla completa
    ontoggle: (stem: string) => void;
    windowSec?: number; // segundos visibles por encima del teclado: más = notas más lentas
    chords?: { t: number; end: number; name: string; deg?: string }[]; // cambios de acorde y su grado (de harmony.ts)
    keyLabel?: string; // tonalidad
    tonality?: Key; // para escribir las notas como en su tonalidad (Sib en Fa mayor, no La#)
    lit?: () => Map<number, string>; // teclas que se iluminan además de lo que suena (lo que toca quien practica)
    title?: string;
    fx?: boolean; // aspecto «de vídeo» (rollfx.ts): un solo color, brillo y chispas; para Aprender
    tools?: Snippet; // controles de quien lo usa, en la barra del roll en vez del título y la leyenda (más sitio para el roll)
  } = $props();

  let styleOpen = $state(false);
  const style = (): RollStyle => ({ ...ROLL_DEFAULT, ...settings.rollStyle });
  const setStyle = (patch: Partial<RollStyle>) => (settings.rollStyle = { ...style(), ...patch });
  /** Con efectos, la primera pista (la derecha) va en el color principal y la segunda (la izquierda) en el otro. */
  const fxColor = (st: RollStyle, i: number) => (i === 0 ? st.color : st.color2);

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
      if (t.notes || notes[t.path]) continue;
      readBytes(t.path).then((buf) => {
        const data = JSON.parse(new TextDecoder().decode(buf));
        notes = { ...notes, [t.path]: Array.isArray(data) ? data : data.notes }; // o una sesión del teclado
      });
    }
  });

  // teclado: de la nota más grave a la más aguda de todas las pistas, en octavas completas
  const range = $derived.by(() => {
    const all = [...Object.values(notes), ...tracks.map((t) => t.notes ?? [])].flat();
    if (!all.length) return { lo: 48, hi: 83 };
    let lo = Math.min(...all.map((n) => n[2]));
    let hi = Math.max(...all.map((n) => n[2]));
    lo -= lo % 12;
    hi += 11 - (hi % 12);
    // al menos 5 octavas, repartidas por los dos lados: con pocas, las teclas salen anchas como de juguete
    for (let below = true; hi - lo < 59; below = !below) {
      if (below && lo >= 33) lo -= 12;
      else if (hi <= 96) hi += 12;
      else if (lo >= 33) lo -= 12;
      else break;
    }
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

    const latin = loadNotation().latin;
    const k0 = tonality ?? { tonic: 0, minor: false };
    const name = (p: number) => noteName(p % 12, k0, latin);
    const effects = fx ? new RollFx() : null;
    let lastT = -1;
    const draw = () => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const t = player.time();
      const KEYS_H = keysHeight(keys);
      const rollH = HEIGHT - KEYS_H;
      const st = style();
      if (effects) drawBackground(g, width, rollH);
      else {
        const bg = g.createLinearGradient(0, 0, 0, rollH);
        bg.addColorStop(0, "#0d0b0a");
        bg.addColorStop(1, "#1a1613");
        g.fillStyle = bg;
        g.fillRect(0, 0, width, rollH);
      }

      // guías en cada Do
      g.fillStyle = effects ? "#ffffff08" : "#ffffff0d";
      for (const [p, k] of keys) if (p % 12 === 0) g.fillRect(k.x, 0, 1, rollH);

      const active = new Map<number, string>();
      if (effects) {
        // las notas en la capa de efectos, que luego se funde con el desvanecido, la línea encendida y las chispas
        const l = effects.begin(width, HEIGHT, dpr);
        const sounding = new Map<number, { x: number; w: number; color: string }>();
        for (const [ti, track] of tracks.entries()) {
          if (track.hidden) continue;
          const color = fxColor(st, ti);
          for (const [start, end, pitch, vel] of track.notes ?? notes[track.path] ?? []) {
            if (end < t || start > t + windowSec) continue;
            const k = keys.get(pitch);
            if (!k) continue;
            const bottom = Math.min(rollH * (1 - (start - t) / windowSec), rollH);
            const top = rollH * (1 - (end - t) / windowSec);
            const on = start <= t && t < end;
            if (on) (active.set(pitch, color), sounding.set(pitch, { ...k, color }));
            drawBar(l, st, k.x, k.w, top, bottom - top, on ? 1 : 0.7 + vel * 0.3, on, color);
            drawBarLabel(l, k, bottom, bottom - Math.max(top, 0), name(pitch));
          }
        }
        effects.compose(g, st, width, rollH, sounding, t !== lastT);
        lastT = t;
      } else for (const track of tracks) {
        if (track.hidden) continue;
        // ponytail: recorre todas las notas cada frame; con decenas de miles, búsqueda binaria por inicio
        for (const [start, end, pitch, vel] of track.notes ?? notes[track.path] ?? []) {
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
          drawBarLabel(g, k, Math.min(bottom, rollH), Math.min(bottom, rollH) - Math.max(top, 0), name(pitch));
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
        g.font = "600 30px 'JetBrains Mono', 'JetBrainsMono Nerd Font', 'JetBrains Mono Variable', monospace";
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

      // línea de golpeo (con efectos, ya va encendida)
      if (!effects) {
        g.fillStyle = "#ffffff55";
        g.fillRect(0, rollH - 2, width, 2);
      }

      if (lit) for (const [p, c] of lit()) active.set(p, c);
      drawKeys(g, keys, rollH, KEYS_H, active, name);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  });
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && fullscreen && setFullscreen(false)} />

<section class="card roll" class:fs={fullscreen}>
  <header>
    {#if tools}
      <div class="legend">
        {@render tools()}
        {#each tracks as t, i (t.stem)}<i class="hand" style:background={fx ? fxColor(style(), i) : t.color} title={t.name}></i>{/each}
      </div>
    {:else}
    <div class="legend">
      <strong>{title}</strong>
      {#each tracks as t (t.stem)}
        <button class="chip" class:off={t.hidden} onclick={() => ontoggle(t.stem)} title={t.hidden ? "Mostrar" : "Ocultar"}>
          <i style:background={fx ? fxColor(style(), tracks.indexOf(t)) : t.color}></i>{t.name}
        </button>
      {/each}
      {#if !tracks.length}<small>Ninguna pista con notas suena ahora (revisa M/S).</small>{/if}
    </div>
    {/if}
    <div class="tools">
      {#if fx}
        <div class="style-wrap">
          <button class="ghost sm" class:on={styleOpen} onclick={() => (styleOpen = !styleOpen)} title="Color, brillo y chispas">Estilo</button>
          {#if styleOpen}
            {@const st = style()}
            <div class="pop style-pop">
              <div class="presets">
                {#each Object.entries(ROLL_PRESETS) as [label, p] (label)}
                  <button class="chip" class:on={st.color === p.color && st.color2 === p.color2 && st.sparkles === p.sparkles} onclick={() => setStyle(p)}>
                    <i style:background={p.color}></i><i style:background={p.color2}></i>{label}
                  </button>
                {/each}
              </div>
              <label>Mano derecha <input type="color" value={st.color} oninput={(e) => setStyle({ color: e.currentTarget.value })} /></label>
              <label>Mano izquierda <input type="color" value={st.color2} oninput={(e) => setStyle({ color2: e.currentTarget.value })} /></label>
              <label>Brillo <input type="range" min="0" max="1" step="0.05" value={st.glow} oninput={(e) => setStyle({ glow: +e.currentTarget.value })} /></label>
              <label title="Cuánto se desvanecen las notas al entrar por arriba">Desvanecido <input type="range" min="0" max="0.9" step="0.05" value={st.fade} oninput={(e) => setStyle({ fade: +e.currentTarget.value })} /></label>
              <label title="Las esquinas de las notas">Redondez <input type="range" min="0" max="1" step="0.05" value={st.round} oninput={(e) => setStyle({ round: +e.currentTarget.value })} /></label>
              <label>Estela
                <select value={st.sparkles} onchange={(e) => setStyle({ sparkles: e.currentTarget.value as RollStyle["sparkles"] })}>
                  <option value="polvo">Polvo brillante</option>
                  <option value="estrellas">Destellos</option>
                  <option value="corazones">Corazones</option>
                  <option value="no">Ninguna</option>
                </select>
              </label>
            </div>
          {/if}
        </div>
      {/if}
      <label title="Velocidad a la que caen las notas: cuántos segundos se ven antes de sonar">
        Caída
        <input type="range" min="1" max="6" step="0.5" value={7 - windowSec} oninput={(e) => (windowSec = 7 - +e.currentTarget.value)} />
      </label>
      <button class="ghost sm" onclick={() => setFullscreen(!fullscreen)} title={fullscreen ? "Salir de pantalla completa (Esc)" : "Pantalla completa"}>
        {fullscreen ? "✕" : "⛶"}
      </button>
    </div>
  </header>
  <div class="stage" bind:clientWidth={width} bind:clientHeight={height}>
    <canvas bind:this={canvas} style:height="{height}px"></canvas>
  </div>
  {#if fullscreen}<footer>{@render controls()}</footer>{/if}
</section>

<style>
  .roll { flex: 1; min-height: 240px; display: flex; flex-direction: column; padding: 0; overflow: hidden; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 6px 12px; border-bottom: 1px solid var(--line); }
  .legend { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .legend strong { font-weight: 600; }
  .legend i { width: 8px; height: 8px; border-radius: 50%; }
  .legend small { color: var(--text-3); font-size: 11.5px; }
  .tools { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .tools label { display: flex; align-items: center; gap: 8px; color: var(--text-2); font-size: 12px; }
  .tools label input { width: 70px; }
  .hand { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
  .style-wrap { position: relative; }
  .style-pop { position: absolute; right: 0; top: calc(100% + 6px); width: 300px; }
  .style-pop label { justify-content: space-between; }
  .style-pop input[type="range"] { width: 150px; }
  .style-pop input[type="color"] { width: 44px; height: 24px; padding: 0; border: 0; background: none; }
  .presets { display: flex; flex-wrap: wrap; gap: 6px; }
  .presets .chip { gap: 3px; }
  .presets i { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
  canvas { width: 100%; display: block; }

  .fs { position: fixed; inset: 0; z-index: 50; margin: 0; border: 0; border-radius: 0; display: flex; flex-direction: column; }
  .stage { flex: 1; min-height: 0; overflow: hidden; }
  footer { padding: 12px 16px; border-top: 1px solid var(--line); }
</style>
