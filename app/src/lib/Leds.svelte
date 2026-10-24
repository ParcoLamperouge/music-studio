<script lang="ts" module>
  import type { Track } from "./engine";
  import { t } from "./i18n.svelte";
  import { stageBusy, type Stage } from "./store.svelte";

  export type Led = "on" | "half" | "busy" | "bad" | "off";
  export const STAGES: [Stage, string][] = [["audio", "Audio"], ["letra", "Letra"], ["pistas", "Pistas"], ["notas", "Notas"], ["edits", "Edits"]];

  /** Estado de cada etapa: hecha, a medias, trabajando, rota o sin hacer. */
  export function ledOf(tr: Track, stage: Stage): Led {
    if (stageBusy(tr.key, stage)) return "busy";
    switch (stage) {
      case "audio":
        return tr.audio ? "on" : "off";
      case "letra":
        if (!tr.lyrics) return "off";
        if (tr.lyrics.status === "words" || tr.lyrics.status === "instrumental") return tr.lyrics.doubts && !tr.lyrics.edited ? "half" : "on";
        return tr.lyrics.status === "empty" ? "off" : "half";
      case "pistas":
        return tr.stems === "complete" ? "on" : tr.stems ? "bad" : "off";
      case "notas":
        return !tr.notes.length ? "off" : tr.notes.length >= tr.present.filter((s) => s !== "drums").length ? "on" : "half";
      case "edits":
        return tr.edits ? "on" : "off";
    }
  }

  export function ledTitle(tr: Track, stage: Stage, led: Led) {
    if (led === "busy") return t("trabajando");
    if (stage === "letra" && tr.lyrics) {
      const s = tr.lyrics.status;
      return s === "words"
        ? tr.lyrics.doubts && !tr.lyrics.edited
          ? t("palabra a palabra · {n} dudas", { n: tr.lyrics.doubts })
          : t("palabra a palabra")
        : s === "lines"
          ? t("solo por líneas")
          : s === "plain"
            ? t("sin tiempos")
            : s;
    }
    if (stage === "pistas" && tr.stems && tr.stems !== "complete") return t("separación a medias");
    if (stage === "notas" && tr.notes.length) return t("{n} instrumentos", { n: tr.notes.length });
    if (stage === "edits" && tr.edits) return t(tr.edits > 1 ? "{n} edits" : "{n} edit", { n: tr.edits });
    return led === "on" ? t("hecho") : t("sin hacer");
  }
</script>

<script lang="ts">
  let { track, size = "sm" }: { track: Track; size?: "sm" | "lg" } = $props();
</script>

<span class="leds {size}">
  {#each STAGES as [stage, label] (stage)}
    {@const led = ledOf(track, stage)}
    <i class={led} title="{t(label)}: {ledTitle(track, stage, led)}"></i>
  {/each}
</span>

<style>
  .leds { display: inline-flex; gap: 3px; align-items: center; }
  i { width: 12px; height: 4px; border-radius: 2px; background: var(--line-hi); transition: background var(--t); }
  .lg i { width: 20px; }
  i.on { background: var(--ok); }
  i.half { background: linear-gradient(90deg, var(--warn) 50%, var(--line-hi) 50%); }
  i.busy { background: var(--accent); animation: pulse 1.1s ease-in-out infinite; }
  i.bad { background: var(--bad); }
</style>
