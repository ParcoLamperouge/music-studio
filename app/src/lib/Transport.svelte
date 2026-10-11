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

<div class="transport">
  <button class="play" onclick={ontoggle} {disabled} aria-label={playing ? "Pausa" : "Reproducir"}>
    {#if playing}
      <svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
    {:else}
      <svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" /></svg>
    {/if}
  </button>
  <button class="skip" onclick={() => onseek(Math.max(0, time - 5))} {disabled} title="-5 s">−5</button>
  <button class="skip" onclick={() => onseek(Math.min(duration, time + 5))} {disabled} title="+5 s">+5</button>
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
    <button class="spk" onclick={toggleMute} aria-label={volume ? "Silenciar todo" : "Activar sonido"}>
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
  .transport {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; background: var(--panel); border: 1px solid var(--line); border-radius: 14px;
  }
  .play {
    width: 44px; height: 44px; border-radius: 50%; border: 0; display: grid; place-items: center;
    background: var(--accent-grad); color: white; cursor: pointer; flex-shrink: 0;
    box-shadow: 0 6px 20px -6px var(--accent);
  }
  .play svg { width: 20px; height: 20px; fill: currentColor; }
  .play:disabled, .skip:disabled { opacity: 0.4; cursor: default; }
  .skip {
    width: 34px; height: 30px; border-radius: 8px; border: 1px solid var(--line); background: transparent;
    color: var(--text-2); font-size: 11px; font-weight: 600; cursor: pointer; flex-shrink: 0;
  }
  .skip:hover:not(:disabled) { color: var(--text); }
  .clock { font-variant-numeric: tabular-nums; font-size: 14px; min-width: 92px; }
  .muted { color: var(--text-3); }
  .scrub { flex: 1; min-width: 80px; }
  .master { display: flex; align-items: center; gap: 4px; flex-shrink: 0; }
  .master input { width: 90px; }
  .spk { width: 30px; height: 30px; display: grid; place-items: center; border: 0; background: none; color: var(--text-2); cursor: pointer; }
  .spk:hover { color: var(--text); }
  .spk svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .transport :global(.ghost.active) { color: var(--text); border-color: var(--accent); }
  .transport :global(.ghost:disabled) { opacity: 0.4; cursor: default; }
</style>
