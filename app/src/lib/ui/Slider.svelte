<script lang="ts">
  // Deslizador (input range nativo, teclado incluido). `color`: relleno de datos (el de una pista); si no, texto.
  let {
    value = $bindable(0),
    min = 0,
    max = 1,
    step = 0.01,
    label,
    color,
    disabled = false,
    oninput,
  }: { value: number; min?: number; max?: number; step?: number; label: string; color?: string; disabled?: boolean; oninput?: (v: number) => void } = $props();
  const pct = $derived(((value - min) / (max - min || 1)) * 100);
</script>

<input
  class="slider"
  type="range"
  {min}
  {max}
  {step}
  {disabled}
  aria-label={label}
  bind:value
  oninput={() => oninput?.(value)}
  style:--p="{pct}%"
  style:--c={color ?? "var(--text-2)"}
/>

<style>
  .slider {
    -webkit-appearance: none; appearance: none; width: 100%; min-width: 48px; height: 16px; margin: 0; padding: 0; background: none; cursor: pointer;
  }
  .slider:disabled { opacity: 0.4; cursor: default; }
  .slider::-webkit-slider-runnable-track {
    height: 4px; border-radius: 2px; background: linear-gradient(to right, var(--c) var(--p), var(--line-hi) var(--p));
  }
  .slider::-webkit-slider-thumb {
    -webkit-appearance: none; width: 12px; height: 12px; margin-top: -4px; border-radius: 50%; background: var(--text); border: 0;
    transition: transform var(--t-fast);
  }
  .slider:hover::-webkit-slider-thumb { transform: scale(1.2); }
  .slider::-moz-range-track { height: 4px; border-radius: 2px; background: var(--line-hi); }
  .slider::-moz-range-progress { height: 4px; border-radius: 2px; background: var(--c); }
  .slider::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: var(--text); border: 0; }
</style>
