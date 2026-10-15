<script lang="ts">
  import IconButton from "./IconButton.svelte";

  // Número con − y + (y rueda o flechas encima): tempo, latencia, semitonos. `format` pinta el valor («+2», «90 bpm»).
  let { value = $bindable(0), min = -Infinity, max = Infinity, step = 1, label, format = String, onchange }: {
    value: number;
    min?: number;
    max?: number;
    step?: number;
    label: string;
    format?: (v: number) => string;
    onchange?: (v: number) => void;
  } = $props();

  function set(v: number) {
    const n = Math.max(min, Math.min(max, Math.round(v / step) * step));
    if (n === value) return;
    value = n;
    onchange?.(n);
  }
  function key(e: KeyboardEvent) {
    const d = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -1 : 0;
    if (d) (e.preventDefault(), set(value + d * step));
  }
</script>

<span
  class="stepper"
  role="spinbutton"
  tabindex="0"
  aria-label={label}
  aria-valuenow={value}
  aria-valuetext={format(value)}
  onkeydown={key}
  onwheel={(e) => (e.preventDefault(), set(value - Math.sign(e.deltaY) * step))}
>
  <IconButton icon="minus" size="sm" label="Menos" disabled={value <= min} onclick={() => set(value - step)} tabindex={-1} />
  <span class="v num">{format(value)}</span>
  <IconButton icon="plus" size="sm" label="Más" disabled={value >= max} onclick={() => set(value + step)} tabindex={-1} />
</span>

<style>
  .stepper {
    display: inline-flex; align-items: center; gap: 2px; height: 28px; padding: 0 2px; flex-shrink: 0;
    border: 1px solid var(--line); border-radius: var(--r-md); background: var(--bg); outline-offset: 2px;
  }
  .v { min-width: 52px; text-align: center; font-size: var(--fs-sm); color: var(--text); white-space: nowrap; }
</style>
