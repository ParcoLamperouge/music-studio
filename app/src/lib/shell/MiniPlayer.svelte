<script lang="ts">
  import { untrack } from "svelte";
  import { loadNotation } from "../ChordsTab.svelte";
  import { deck, deckSeek, deckToggle } from "../deck.svelte";
  import { fmtClock, playerSeek, playerToggle, songDetail, spotifyClock, type Detail } from "../engine";
  import { keyFromChords, named, type Key } from "../harmony";
  import { waves, wantPeaks } from "../peaks.svelte";
  import { settings } from "../settings.svelte";
  import { store } from "../store.svelte";
  import Slider from "../ui/Slider.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Icon from "../ui/Icon.svelte";
  import MasterStrip from "../ui/MasterStrip.svelte";
  import { sectionsFromLyrics } from "../ui/music";

  // Reproductor fijo abajo: la canción cargada (deck, solo en Biblioteca: `deckOn`) o, si no, lo que suena en Spotify.
  // La tira de la canción hace de barra de progreso: pulsar en un estribillo salta a él.
  let { deckOn, onopen, onplay, onclose }: {
    deckOn: boolean;
    onopen: (key: string) => void;
    onplay: (key: string) => void; // cargar y tocar otra (anterior / siguiente)
    onclose: () => void;
  } = $props();

  const dk = $derived(deckOn ? deck.key : null);
  const spotify = $derived(dk ? null : store.playing);
  const key = $derived(dk ?? spotify?.key ?? null);
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
  const time = $derived(dk ? deck.time : now);
  const playing = $derived(dk ? deck.playing : !!spotify?.playing);

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
  const duration = $derived(dk ? deck.duration : spotify?.duration || detail?.duration || 0);
  const sections = $derived(detail?.doc ? sectionsFromLyrics(detail.doc.lines, duration, detail.doc.offset ?? 0) : []);
  const harmony = $derived.by(() => {
    const cs = detail?.chordData?.chords;
    if (!cs?.length) return null;
    const k: Key = keyFromChords(cs);
    return { key: k, chords: named(cs, k, loadNotation()) };
  });

  const toggle = () => (dk ? deckToggle() : void playerToggle());
  const seek = (t: number) => (dk ? deckSeek(t) : void playerSeek(t));
  // anterior / siguiente: en el orden de la rejilla (o el catálogo); «anterior» pasados 3 s vuelve al principio
  const order = $derived(deck.order.length ? deck.order : store.tracks.map((t) => t.key));
  const at = $derived(dk ? order.indexOf(dk) : -1);
  const prev = () => (time > 3 || at <= 0 ? deckSeek(0) : onplay(order[at - 1]));
  const next = () => at >= 0 && at + 1 < order.length && onplay(order[at + 1]);
</script>

<footer class="mini" aria-label="Reproductor">
  {#if dk}<IconButton icon="prev" label="Anterior" size="sm" onclick={prev} />{/if}
  <button type="button" class="play" onclick={toggle} aria-label={playing ? "Pausa" : "Reproducir"}>
    <Icon name={playing ? "pause" : "play"} size={16} />
  </button>
  {#if dk}<IconButton icon="next" label="Siguiente" size="sm" disabled={at < 0 || at + 1 >= order.length} onclick={next} />{/if}
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
  {#if dk}
    <div class="vol">
      <IconButton icon="volume" label={settings.masterVolume ? "Silenciar" : "Activar sonido"} size="sm" onclick={() => (settings.masterVolume = settings.masterVolume ? 0 : 1)} />
      <Slider bind:value={settings.masterVolume} min={0} max={1.5} label="Volumen" />
    </div>
    <IconButton icon="close" label="Cerrar la canción" size="sm" onclick={onclose} />
  {/if}
</footer>

<style>
  .mini {
    grid-column: 2; display: flex; align-items: center; gap: var(--s2); height: var(--player-h); padding: 0 var(--s4); min-width: 0;
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
  .vol { display: flex; align-items: center; gap: 4px; width: 120px; flex-shrink: 0; }
</style>
