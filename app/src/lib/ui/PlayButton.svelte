<script lang="ts">
  import Icon from "./Icon.svelte";
  import { t } from "../i18n.svelte";

  // Reproducir / pausa: el botón redondo y macizo de cada transporte (uno por pantalla).
  let { playing, disabled = false, size = 36, onclick }: { playing: boolean; disabled?: boolean; size?: number; onclick: () => void } = $props();
</script>

<button
  type="button"
  class="play"
  style:width="{size}px"
  style:height="{size}px"
  {disabled}
  aria-label={playing ? t("Pausa") : t("Reproducir")}
  title={playing ? t("Pausa (Espacio)") : t("Reproducir (Espacio)")}
  {onclick}
>
  <Icon name={playing ? "pause" : "play"} size={Math.round(size * 0.44)} />
</button>

<style>
  .play {
    display: grid; place-items: center; flex-shrink: 0; padding: 0; border: 0; border-radius: 50%;
    background: var(--text); color: var(--bg); transition: transform var(--t-fast), opacity var(--t-fast);
  }
  .play:hover:not(:disabled) { transform: scale(1.06); }
  .play:disabled { opacity: 0.35; }
</style>
