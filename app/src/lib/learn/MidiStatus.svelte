<script lang="ts">
  import { loadNotation } from "../ChordsTab.svelte";
  import { noteName } from "../harmony";
  import { t } from "../i18n.svelte";
  import { connect, input } from "../keys.svelte";
  import Button from "../ui/Button.svelte";
  import Menu from "../ui/Menu.svelte";

  // De qué teclado salen las notas: el MIDI (elegir y conectar) o el del ordenador. Un punto verde si hay MIDI.
  const latin = loadNotation().latin;
  const items = $derived(
    input.ports.length
      ? input.ports.map((p) => ({ label: p, icon: (p === input.connected ? "check" : undefined) as "check" | undefined, run: () => connect(p) }))
      : [{ label: t("Ningún teclado MIDI conectado"), disabled: true, run: () => {} }],
  );
  const pcHelp = $derived(t("Teclado del ordenador: A–Ñ blancas, W E T Y U O P negras, Z/X octava (ahora {k}), Espacio pedal", { k: `${noteName(0, { tonic: 0, minor: false }, latin)}${input.octave / 12 - 1}` }));
</script>

<Menu {items} label={t("Teclado MIDI")} align="end">
  {#snippet trigger({ toggle })}
    <Button size="sm" variant="ghost" onclick={toggle} title={input.connected ? t("Teclado: {k}", { k: input.connected }) : pcHelp}>
      <span class="dot" class:on={!!input.connected}></span>
      <span class="name">{input.connected || t("Teclado del ordenador")}</span>
    </Button>
  {/snippet}
</Menu>

<style>
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); flex-shrink: 0; }
  .dot.on { background: var(--ok); box-shadow: 0 0 0 3px color-mix(in oklab, var(--ok) 25%, transparent); }
  .name { max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
</style>
