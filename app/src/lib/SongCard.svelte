<script lang="ts">
  import type { Track } from "./engine";
  import { engineLabel, t } from "./i18n.svelte";
  import { ledOf, ledTitle, STAGES } from "./Leds.svelte";
  import { waves, wantPeaks } from "./peaks.svelte";
  import { live } from "./store.svelte";
  import type { Stage } from "./store.svelte";
  import type { IconName } from "./ui/Icon.svelte";
  import Icon from "./ui/Icon.svelte";
  import ProgressRing from "./ui/ProgressRing.svelte";
  import WaveThumb from "./ui/WaveThumb.svelte";

  // Una canción de la biblioteca: su forma de onda de portada, título, artista y qué tiene hecho (iconos, no texto).
  let { track, picked, picking, current, playing, onclick, onplay, ontoggle }: {
    track: Track;
    picked: boolean;
    picking: boolean; // hay selección: pulsar marca en vez de abrir
    current: boolean; // la cargada en el reproductor
    playing: boolean; // y sonando
    onclick: (e: MouseEvent) => void;
    onplay: () => void; // ▶ / ⏸ sin abrirla
    ontoggle: (e: MouseEvent) => void;
  } = $props();

  const ICON: Record<Stage, IconName> = { audio: "audio", letra: "lyrics", pistas: "stems", notas: "notes", edits: "edits" };
  const job = $derived(live(track.key).find((j) => j.status === "running") ?? live(track.key)[0]);

  let el: HTMLElement;
  $effect(() => {
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      wantPeaks(track.key, track.audio || !!track.stems);
      io.disconnect();
    }, { rootMargin: "200px" });
    io.observe(el);
    return () => io.disconnect();
  });
</script>

<article class="song" class:picked class:current class:playing bind:this={el}>
  <button type="button" class="hit" aria-label={picking ? t("Seleccionar {title}", { title: track.title }) : t("Abrir {title}", { title: track.title })} {onclick}></button>
  <div class="art">
    <WaveThumb peaks={waves[track.key]} height={56} color={current ? "var(--text)" : undefined} />
    {#if track.audio || track.stems}
      <button type="button" class="play" aria-label={playing ? t("Pausar {title}", { title: track.title }) : t("Reproducir {title}", { title: track.title })} onclick={onplay}>
        <Icon name={playing ? "pause" : "play"} size={16} />
      </button>
    {/if}
    {#if job}
      <span class="ring" title={engineLabel(job.waiting || job.label)}>
        <ProgressRing value={job.status === "running" && job.pct != null ? job.pct / 100 : job.status === "running" ? null : 0} size={22} label={engineLabel(job.label)} />
      </span>
    {:else if playing}
      <span class="now" title={t("Sonando")}><Icon name="volume" size={14} label={t("Sonando")} /></span>
    {/if}
  </div>
  <input type="checkbox" class="pick" checked={picked} onclick={ontoggle} aria-label={t("Seleccionar {title}", { title: track.title })} />
  <div class="meta">
    <span class="t">{track.title || track.key}</span>
    <span class="a">{track.artist || t("Sin artista")}</span>
  </div>
  <ul class="status" aria-label={t("Qué tiene hecho")}>
    {#each STAGES as [stage, label] (stage)}
      {@const led = ledOf(track, stage)}
      <li class={led} title="{t(label)}: {ledTitle(track, stage, led)}">
        <Icon name={ICON[stage]} size={14} label="{t(label)}: {ledTitle(track, stage, led)}" />
      </li>
    {/each}
    {#if track.failed}<li class="bad" title={t("La descarga automática falló")}><Icon name="alert" size={14} label={t("Falló")} /></li>{/if}
  </ul>
</article>

<style>
  .song {
    position: relative; display: flex; flex-direction: column; min-width: 0; border-radius: var(--r-lg); background: var(--panel);
    border: 1px solid var(--line); transition: border-color var(--t-fast), background var(--t-fast);
  }
  .song:hover { border-color: var(--line-hi); background: var(--panel-hi); }
  .song.current { border-color: var(--line-hi); }
  .song.picked { border-color: var(--accent); background: var(--accent-soft); }
  .hit { position: absolute; inset: 0; z-index: 1; width: 100%; padding: 0; border: 0; border-radius: inherit; background: none; }
  .art { position: relative; padding: var(--s4) var(--s3) var(--s2); border-bottom: 1px solid var(--line); }
  .ring { position: absolute; top: 6px; right: 6px; display: grid; padding: 3px; border-radius: 50%; background: var(--panel); }
  .now { position: absolute; top: 8px; right: 8px; color: var(--text); }
  .play {
    position: absolute; left: 50%; top: 50%; translate: -50% -50%; z-index: 2; display: grid; place-items: center; width: 40px; height: 40px;
    padding: 0; border: 0; border-radius: 50%; background: var(--text); color: var(--bg); box-shadow: 0 4px 16px #0008;
    opacity: 0; transition: opacity var(--t-fast), transform var(--t-fast);
  }
  .song:hover .play, .play:focus-visible, .current .play { opacity: 1; }
  .current:not(:hover) .play { opacity: 0.85; }
  .play:hover { transform: scale(1.08); }
  .song.playing { border-color: var(--text-3); }
  .pick { position: absolute; top: 8px; left: 8px; z-index: 2; width: 16px; height: 16px; margin: 0; opacity: 0; transition: opacity var(--t-fast); }
  .song:hover .pick, .song.picked .pick, .pick:focus-visible { opacity: 1; }
  :global(.picking) .pick { opacity: 1; }
  .meta { display: flex; flex-direction: column; padding: var(--s2) var(--s3) 0; min-width: 0; }
  .t, .a { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .t { font-weight: 600; }
  .a { color: var(--text-3); font-size: var(--fs-sm); }
  .status { display: flex; gap: 2px; margin: 0; padding: var(--s2) var(--s2) var(--s2); list-style: none; }
  .status li { position: relative; display: grid; place-items: center; width: 22px; height: 20px; border-radius: var(--r-sm); color: var(--text); }
  .status .off { color: var(--text-3); opacity: 0.4; }
  .status .half::after {
    content: ""; position: absolute; right: 1px; bottom: 1px; width: 5px; height: 5px; border-radius: 50%;
    background: var(--panel); box-shadow: inset 0 0 0 1.5px var(--text-2);
  }
  .status .half { color: var(--text-2); }
  .status .busy { color: var(--accent); animation: pulse 1.1s ease-in-out infinite; }
  .status .bad { color: var(--bad); }
</style>
