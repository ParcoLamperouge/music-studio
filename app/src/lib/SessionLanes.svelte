<script lang="ts">
  /** Carriles por instrumento (piano roll horizontal de cada pista, en su color) con una fila de acordes coloreados por
   * función encima. Ventana de `span` s alrededor de «ahora», que va a la izquierda; pulsar en un carril salta ahí. */
  import type { Snippet } from "svelte";
  import type { Key, Note } from "./harmony";
  import { chordFn, cssVar, stemColor } from "./ui/music";

  type Lane = { stem: string; label: string; notes: Note[]; muted?: boolean };
  let { lanes, chords = [], tonality, time, span = 12, onseek, head }: {
    lanes: Lane[];
    chords?: { t: number; end: number; root: number; kind: string; name: string }[];
    tonality: Key | null;
    time: number;
    span?: number;
    onseek: (t: number) => void;
    head: Snippet<[Lane]>; // cabecera de cada carril (nombre, M/S, volumen…)
  } = $props();

  const LEAD = 0.2; // parte de la ventana que ya pasó
  let width = $state(0);
  let canvases = $state<HTMLCanvasElement[]>([]);
  let chordCanvas = $state<HTMLCanvasElement>();
  const rowH = $derived(lanes.length === 1 ? 180 : lanes.length <= 3 ? 96 : 68);

  // tesitura de cada pista (sin los extremos sueltos) y su color, calculados una vez
  const meta = $derived(
    lanes.map((l) => {
      const ps = l.notes.map((n) => n[2]).sort((a, b) => a - b);
      const lo = ps.length ? ps[Math.floor(ps.length * 0.02)] - 2 : 48;
      const hi = ps.length ? ps[Math.ceil(ps.length * 0.98) - 1] + 2 : 72;
      return { lo, hi: Math.max(hi, lo + 12), color: cssVar(stemColor(l.stem).slice(4, -1)) };
    }),
  );
  const fnHex = new Map<string, string>();
  const hex = (v: string) => fnHex.get(v) ?? (fnHex.set(v, cssVar(v.slice(4, -1))), fnHex.get(v)!);

  function setup(c: HTMLCanvasElement, h: number) {
    const dpr = devicePixelRatio || 1;
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(h * dpr)) [c.width, c.height] = [Math.round(width * dpr), Math.round(h * dpr)];
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, h);
    return g;
  }

  $effect(() => {
    if (!width) return;
    const t0 = time - span * LEAD;
    const x = (t: number) => ((t - t0) / span) * width;
    const now = x(time);
    const text = cssVar("--text"), line = cssVar("--line"), onData = cssVar("--on-data");

    if (chordCanvas) {
      const g = setup(chordCanvas, 26);
      g.font = "700 11px 'JetBrains Mono Variable', monospace";
      for (const c of chords) {
        if (c.end < t0 || c.t > t0 + span) continue;
        const color = tonality ? hex(chordFn(c, tonality).color) : line;
        const on = c.t <= time && time < c.end;
        const [a, b] = [x(c.t), x(c.end)];
        g.globalAlpha = on ? 1 : c.end < time ? 0.4 : 0.75;
        g.fillStyle = color;
        g.beginPath();
        g.roundRect(a + 1, 3, Math.max(2, b - a - 2), 20, 4);
        g.fill();
        if (b - a > g.measureText(c.name).width + 10) {
          g.fillStyle = onData;
          g.fillText(c.name, a + 6, 17);
        }
      }
      g.globalAlpha = 1;
      g.fillStyle = text;
      g.fillRect(now, 0, 1.5, 26);
    }

    lanes.forEach((l, i) => {
      const c = canvases[i];
      if (!c) return;
      const { lo, hi, color } = meta[i];
      const g = setup(c, rowH);
      const row = (rowH - 8) / (hi - lo + 1);
      const y = (p: number) => rowH - 4 - (p - lo + 1) * row;
      g.fillStyle = line;
      for (let p = Math.ceil(lo / 12) * 12; p <= hi; p += 12) g.fillRect(0, y(p) + row, width, 1); // los Do
      g.fillStyle = g.shadowColor = color;
      // ponytail: recorre todas las notas cada frame; con pistas de decenas de miles, búsqueda binaria por inicio
      for (const [s, e, p, v] of l.notes) {
        if (e < t0 || s > t0 + span) continue;
        const on = s <= time && time <= e;
        g.globalAlpha = (l.muted ? 0.25 : 1) * (on ? 1 : e < time ? 0.35 + v * 0.2 : 0.55 + v * 0.35);
        g.shadowBlur = on && !l.muted ? 10 : 0;
        g.fillRect(x(s), y(p), Math.max(2, x(e) - x(s) - 1), Math.max(2, row - 1));
      }
      g.globalAlpha = 1;
      g.shadowBlur = 0;
      g.fillStyle = text;
      g.fillRect(now, 0, 1.5, rowH);
    });
  });

  function click(e: PointerEvent) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    onseek(Math.max(0, time - span * LEAD + ((e.clientX - r.left) / r.width) * span));
  }
</script>

<div class="lanes">
  <div class="head chords">Acordes</div>
  <div class="cv top" bind:clientWidth={width}>
    <canvas bind:this={chordCanvas} style:height="26px" onpointerdown={click} aria-label="Acordes: pulsa para ir ahí"></canvas>
  </div>
  {#each lanes as l, i (l.stem)}
    <div class="head" style:height="{rowH}px">{@render head(l)}</div>
    <div class="cv lane" style:height="{rowH}px">
      <canvas bind:this={canvases[i]} style:height="{rowH}px" onpointerdown={click} aria-label="{l.label}: pulsa para ir ahí"></canvas>
    </div>
  {/each}
</div>

<style>
  .lanes { display: grid; grid-template-columns: 188px minmax(0, 1fr); border-radius: var(--r-lg); border: 1px solid var(--line); background: var(--panel); overflow: hidden; }
  .head { display: flex; flex-direction: column; justify-content: center; gap: var(--s1); padding: var(--s2) var(--s3); border-right: 1px solid var(--line); border-top: 1px solid var(--line); min-width: 0; }
  .head.chords { flex-direction: row; align-items: center; border-top: 0; color: var(--text-3); font-size: var(--fs-xs); }
  .cv { min-width: 0; border-top: 1px solid var(--line); }
  .cv.top { border-top: 0; }
  .lane { background: var(--bg); }
  canvas { display: block; width: 100%; cursor: pointer; }
</style>
