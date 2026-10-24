<script lang="ts">
  import { loadNotation } from "./ChordsTab.svelte";
  import { noteName } from "./harmony";
  import { t } from "./i18n.svelte";
  import { connect, input } from "./keys.svelte";

  /** De qué teclado salen las notas: el MIDI conectado (se elige y se reconecta solo) o el del ordenador. */
  const latin = loadNotation().latin;
</script>

<span class="dot" class:on={!!input.connected}></span>
<select bind:value={input.port} onchange={() => connect(input.port)} disabled={!input.ports.length}>
  {#each input.ports as p (p)}<option value={p}>{p}</option>{/each}
  {#if !input.ports.length}<option value="">{t("Ningún teclado MIDI conectado")}</option>{/if}
</select>
{#if input.port && !input.connected}<button class="ghost sm" onclick={() => connect(input.port)}>{t("Conectar")}</button>{/if}
<span class="pc muted" title={t("Teclado del ordenador: fila A S D F G H J K L Ñ = blancas, W E T Y U O P = negras, Z/X = octava, Espacio = pedal")}>
  ⌨ {t("A–Ñ")} · {t("Z/X octava")} ({noteName(0, { tonic: 0, minor: false }, latin)}{input.octave / 12 - 1}) · {t("Espacio pedal")}
</span>

<style>
  select { max-width: 260px; font-size: 12px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); flex-shrink: 0; }
  .dot.on { background: var(--ok); }
  .pc { font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
</style>
