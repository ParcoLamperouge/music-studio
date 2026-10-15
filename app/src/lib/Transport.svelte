<script lang="ts">
  import type { Snippet } from "svelte";
  import { fmtClock } from "./engine";
  import IconButton from "./ui/IconButton.svelte";
  import PlayButton from "./ui/PlayButton.svelte";
  import Slider from "./ui/Slider.svelte";

  // Transporte: reproducir, ±5 s, reloj, posición y volumen general. `children`: botones extra a la derecha.
  let { playing, time, duration, volume = $bindable(1), disabled = false, ontoggle, onseek, children }: {
    playing: boolean;
    time: number;
    duration: number;
    volume?: number; // volumen general 0..1.5
    disabled?: boolean;
    ontoggle: () => void;
    onseek: (t: number) => void;
    children?: Snippet;
  } = $props();

  let beforeMute = 1;
  function toggleMute() {
    if (volume > 0) [beforeMute, volume] = [volume, 0];
    else volume = beforeMute || 1;
  }
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    volume = Math.min(1.5, Math.max(0, Math.round((volume - Math.sign(e.deltaY) * 0.05) * 100) / 100));
  };
</script>

<div class="transport">
  <PlayButton {playing} {disabled} onclick={ontoggle} />
  <IconButton icon="chevron-left" label="−5 s" kbd="←" size="sm" {disabled} onclick={() => onseek(Math.max(0, time - 5))} />
  <IconButton icon="chevron-right" label="+5 s" kbd="→" size="sm" {disabled} onclick={() => onseek(Math.min(duration, time + 5))} />
  <span class="clock num">{fmtClock(time)}<span>/{fmtClock(duration)}</span></span>
  <div class="scrub"><Slider value={time} max={duration || 1} label="Posición" color="var(--text)" {disabled} oninput={onseek} /></div>
  <div class="master" onwheel={wheel}>
    <IconButton icon={volume ? "volume" : "close"} label={volume ? "Silenciar todo" : "Activar sonido"} size="sm" onclick={toggleMute} />
    <Slider bind:value={volume} max={1.5} label="Volumen general" />
  </div>
  {@render children?.()}
</div>

<style>
  .transport {
    display: flex; align-items: center; gap: var(--s2); min-width: 0; padding: var(--s2) var(--s3);
    border-radius: var(--r-lg); background: var(--panel); border: 1px solid var(--line);
  }
  .clock { font-size: var(--fs-sm); white-space: nowrap; color: var(--text); }
  .clock span { color: var(--text-3); margin-left: 2px; }
  .scrub { flex: 1; min-width: 80px; }
  .master { display: flex; align-items: center; gap: 2px; width: 120px; flex-shrink: 0; }
</style>
