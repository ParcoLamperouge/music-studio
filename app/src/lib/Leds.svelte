<script lang="ts" module>
  import type { Track } from "./engine";
  import { stageBusy, type Stage } from "./store.svelte";

  export type Led = "on" | "half" | "busy" | "bad" | "off";
  export const STAGES: [Stage, string][] = [["audio", "Audio"], ["letra", "Letra"], ["pistas", "Pistas"], ["notas", "Notas"], ["edits", "Edits"]];

  /** Estado de cada etapa: hecha, a medias, trabajando, rota o sin hacer. */
  export function ledOf(t: Track, stage: Stage): Led {
    if (stageBusy(t.key, stage)) return "busy";
    switch (stage) {
      case "audio":
        return t.audio ? "on" : "off";
      case "letra":
        if (!t.lyrics) return "off";
        if (t.lyrics.status === "words" || t.lyrics.status === "instrumental") return t.lyrics.doubts && !t.lyrics.edited ? "half" : "on";
        return t.lyrics.status === "empty" ? "off" : "half";
      case "pistas":
        return t.stems === "complete" ? "on" : t.stems ? "bad" : "off";
      case "notas":
        return !t.notes.length ? "off" : t.notes.length >= t.present.filter((s) => s !== "drums").length ? "on" : "half";
      case "edits":
        return t.edits ? "on" : "off";
    }
  }

  export function ledTitle(t: Track, stage: Stage, led: Led) {
    if (led === "busy") return "trabajando";
    if (stage === "letra" && t.lyrics) {
      const s = t.lyrics.status;
      return s === "words" ? (t.lyrics.doubts && !t.lyrics.edited ? `palabra a palabra · ${t.lyrics.doubts} dudas` : "palabra a palabra") : s === "lines" ? "solo por líneas" : s === "plain" ? "sin tiempos" : s;
    }
    if (stage === "pistas" && t.stems && t.stems !== "complete") return "separación a medias";
    if (stage === "notas" && t.notes.length) return t.notes.length + " instrumentos";
    if (stage === "edits" && t.edits) return t.edits + (t.edits > 1 ? " edits" : " edit");
    return led === "on" ? "hecho" : "sin hacer";
  }
</script>

<script lang="ts">
  let { track, size = "sm" }: { track: Track; size?: "sm" | "lg" } = $props();
</script>

<span class="leds {size}">
  {#each STAGES as [stage, label] (stage)}
    {@const led = ledOf(track, stage)}
    <i class={led} title="{label}: {ledTitle(track, stage, led)}"></i>
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
