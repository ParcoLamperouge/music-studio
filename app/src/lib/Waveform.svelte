<script lang="ts">
  import { peaks } from "./player";

  let { buffer, color, dim = false, onseek }: {
    buffer: AudioBuffer;
    color: string;
    dim?: boolean;
    onseek: (fraction: number) => void;
  } = $props();

  let canvas: HTMLCanvasElement;
  let width = $state(0);
  const HEIGHT = 64;

  $effect(() => {
    if (!width) return;
    const dpr = devicePixelRatio;
    canvas.width = width * dpr;
    canvas.height = HEIGHT * dpr;
    const g = canvas.getContext("2d")!;
    g.scale(dpr, dpr);
    const bars = Math.floor(width / 3);
    const p = peaks(buffer, bars);
    const norm = Math.max(...p, 0.01);
    g.fillStyle = color;
    g.globalAlpha = dim ? 0.25 : 0.9;
    for (let i = 0; i < bars; i++) {
      const h = Math.max(1, (p[i] / norm) * (HEIGHT - 6));
      g.beginPath();
      g.roundRect(i * 3, (HEIGHT - h) / 2, 2, h, 1);
      g.fill();
    }
  });

  function click(e: MouseEvent) {
    const r = canvas.getBoundingClientRect();
    onseek((e.clientX - r.left) / r.width);
  }
</script>

<div class="wave" bind:clientWidth={width}>
  <canvas bind:this={canvas} style:height="{HEIGHT}px" onclick={click}></canvas>
</div>

<style>
  .wave { width: 100%; }
  canvas { width: 100%; display: block; cursor: pointer; }
</style>
