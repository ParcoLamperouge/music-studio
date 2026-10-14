<script lang="ts">
  import { untrack } from "svelte";
  import { loadNotation } from "../ChordsTab.svelte";
  import { deck, deckSeek, deckToggle } from "../deck.svelte";
  import { fmtClock, playerSeek, playerToggle, songDetail, spotifyClock, type Detail } from "../engine";
  import { keyFromChords, named, type Key } from "../harmony";
  import { waves, wantPeaks } from "../peaks.svelte";
  import { store } from "../store.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Icon from "../ui/Icon.svelte";
  import MasterStrip from "../ui/MasterStrip.svelte";
  import { sectionsFromLyrics } from "../ui/music";

  // Reproductor fijo abajo: la canción cargada (deck) o, si no hay, lo que suena en Spotify. La tira de la canción hace
  // de barra de progreso: pulsar en un estribillo salta a él.
  let { onopen, onclose }: { onopen: (key: string) => void; onclose: () => void } = $props();

  const spotify = $derived(deck.key ? null : store.playing);
  const key = $derived(deck.key ?? spotify?.key ?? null);
  const track = $derived(key ? store.tracks.find((t) => t.key === key) : undefined);
  const title = $derived(track?.title || spotify?.title || key || "");
  const artist = $derived(track?.artist || spotify?.artist || "");

  // reloj de Spotify: interpolado entre lecturas
  let now = $state(0);
  $effect(() => {
    if (!spotify) return;
    const t = setInterval(() => (now = spotifyClock(store.playing)), 250);
    now = spotifyClock(store.playing);
    return () => clearInterval(t);
  });
  const time = $derived(deck.key ? deck.time : now);
  const playing = $derived(deck.key ? deck.playing : !!spotify?.playing);

  // la ficha de la canción, para secciones y acordes
  let detail = $state<Detail | null>(null);
  $effect(() => {
    const k = key;
    void (k && store.rev[k]);
    detail = null;
    if (!k) return;
    untrack(() => wantPeaks(k, !!track?.audio || !!track?.stems));
    songDetail(k).then((d) => k === key && (detail = d), () => {});
  });
  const duration = $derived(deck.key ? deck.duration : spotify?.duration || detail?.duration || 0);
  const sections = $derived(detail?.doc ? sectionsFromLyrics(detail.doc.lines, duration, detail.doc.offset ?? 0) : []);
  const harmony = $derived.by(() => {
    const cs = detail?.chordData?.chords;
    if (!cs?.length) return null;
    const k: Key = keyFromChords(cs);
    return { key: k, chords: named(cs, k, loadNotation()) };
  });

  const toggle = () => (deck.key ? deckToggle() : void playerToggle());
  const seek = (t: number) => (deck.key ? deckSeek(t) : void playerSeek(t));
</script>

<footer class="mini" aria-label="Reproductor">
  <button type="button" class="play" onclick={toggle} aria-label={playing ? "Pausa" : "Reproducir"}>
    <Icon name={playing ? "pause" : "play"} size={16} />
  </button>
  <button type="button" class="who" onclick={() => key && onopen(key)} disabled={!key} title="Abrir la canción">
    <span class="t">{title}</span>
    <span class="a">
      {#if spotify}<Icon name="broadcast" size={12} label="Spotify" />{/if}
      {artist}
    </span>
  </button>
  <div class="strip">
    <MasterStrip compact {duration} {time} {sections} chords={harmony?.chords ?? []} tonality={harmony?.key} energy={key ? waves[key] : null} onseek={seek} />
  </div>
  <span class="clock num">{fmtClock(time)} <span>/ {fmtClock(duration)}</span></span>
  {#if deck.key}<IconButton icon="close" label="Cerrar la canción" size="sm" onclick={onclose} />{/if}
</footer>

<style>
  .mini {
    grid-column: 2; display: flex; align-items: center; gap: var(--s3); height: var(--player-h); padding: 0 var(--s4); min-width: 0;
    background: var(--panel); border-top: 1px solid var(--line); animation: rise var(--t-slow) var(--ease);
  }
  .play {
    display: grid; place-items: center; width: 36px; height: 36px; flex-shrink: 0; border: 0; border-radius: 50%;
    background: var(--text); color: var(--bg); transition: transform var(--t-fast);
  }
  .play:hover { transform: scale(1.06); }
  .who { display: flex; flex-direction: column; align-items: flex-start; width: 200px; flex-shrink: 0; min-width: 0; border: 0; padding: 0; background: none; text-align: left; }
  .who:hover:not(:disabled) .t { text-decoration: underline; text-underline-offset: 3px; }
  .t, .a { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .t { font-weight: 600; }
  .a { display: inline-flex; align-items: center; gap: 4px; color: var(--text-3); font-size: var(--fs-sm); }
  .strip { flex: 1; min-width: 120px; }
  .clock { flex-shrink: 0; font-size: var(--fs-sm); color: var(--text); }
  .clock span { color: var(--text-3); }
</style>
