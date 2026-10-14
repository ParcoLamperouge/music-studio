<script lang="ts">
  import type { Snippet } from "svelte";

  let { playing, time, duration, volume = $bindable(1), disabled = false, ontoggle, onseek, children }: {
    playing: boolean;
    time: number;
    duration: number;
    volume?: number; // volumen general 0..1.5
    disabled?: boolean;
    ontoggle: () => void;
    onseek: (t: number) => void;
    children?: Snippet; // botones extra a la derecha
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

  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
</script>

<div class="card transport">
  <button class="play" onclick={ontoggle} {disabled} aria-label={playing ? "Pausa" : "Reproducir"}>
    {#if playing}
      <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
    {:else}
      <svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
    {/if}
  </button>
  <button class="ghost sm" onclick={() => onseek(Math.max(0, time - 5))} {disabled} title="-5 s">−5</button>
  <button class="ghost sm" onclick={() => onseek(Math.min(duration, time + 5))} {disabled} title="+5 s">+5</button>
  <span class="clock">{fmt(time)} <span class="muted">/ {fmt(duration)}</span></span>
  <input
    class="scrub"
    type="range"
    min="0"
    max={duration || 1}
    step="0.01"
    value={time}
    oninput={(e) => onseek(+e.currentTarget.value)}
    {disabled}
  />
  <div class="master" onwheel={wheel} title="Volumen general: {Math.round(volume * 100)}%">
    <button class="icon-btn" onclick={toggleMute} aria-label={volume ? "Silenciar todo" : "Activar sonido"}>
      <svg viewBox="0 0 24 24">
        <path d="M4 9v6h4l5 4V5L8 9H4z" />
        {#if volume === 0}<path d="m17 9 5 6m0-6-5 6" />
        {:else}<path d="M16 9.5a3.5 3.5 0 0 1 0 5" />{#if volume > 0.6}<path d="M18.5 7a7 7 0 0 1 0 10" />{/if}{/if}
      </svg>
    </button>
    <input type="range" min="0" max="1.5" step="0.01" bind:value={volume} aria-label="Volumen general" />
  </div>
  {@render children?.()}
</div>

<style>
  .transport { display: flex; align-items: center; gap: 10px; padding: 8px 12px; }
  .play {
    width: 36px; height: 36px; border-radius: 50%; border: 0; display: grid; place-items: center; flex-shrink: 0;
    background: var(--accent); color: var(--on-accent); transition: filter 0.15s;
  }
  .play:hover:not(:disabled) { filter: brightness(1.1); }
  .play svg { width: 16px; height: 16px; fill: currentColor; }
  .play:disabled { opacity: 0.4; }
  .clock { font-variant-numeric: tabular-nums; font-size: 12.5px; white-space: nowrap; }
  .scrub { flex: 1; min-width: 80px; }
  .master { display: flex; align-items: center; gap: 2px; flex-shrink: 0; }
  .master input { width: 80px; }
  .master svg { width: 18px; height: 18px; }
</style>
