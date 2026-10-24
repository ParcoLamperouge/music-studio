<script lang="ts">
  import { t } from "../i18n.svelte";

  // Silenciar / solo de una pista: dos botoncitos M y S. Solo va en amarillo de aviso (se oye solo esa).
  let { muted = $bindable(false), solo = $bindable(false), label = "" }: { muted: boolean; solo: boolean; label?: string } = $props();
</script>

<span class="ms">
  <button type="button" class:on={muted} aria-pressed={muted} aria-label={t("Silenciar {label}", { label })} title={t("Silenciar")} onclick={() => (muted = !muted)}>M</button>
  <button type="button" class="s" class:on={solo} aria-pressed={solo} aria-label={t("Solo {label}", { label })} title={t("Solo")} onclick={() => (solo = !solo)}>S</button>
</span>

<style>
  .ms { display: inline-flex; gap: 2px; flex-shrink: 0; }
  button {
    width: 22px; height: 22px; padding: 0; border: 1px solid var(--line-hi); border-radius: var(--r-sm); background: transparent;
    color: var(--text-2); font-size: var(--fs-xs); font-weight: 700; transition: color var(--t-fast), background var(--t-fast), border-color var(--t-fast);
  }
  button:hover { color: var(--text); border-color: var(--text-3); }
  .on { background: var(--text-2); border-color: var(--text-2); color: var(--bg); }
  .s.on { background: var(--warn); border-color: var(--warn); color: var(--on-data); }
</style>
