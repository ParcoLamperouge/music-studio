<script lang="ts">
  import { onMount } from "svelte";
  import { loadNotation } from "./ChordsTab.svelte";
  import { readJson, songDetail, STEM_INFO, viewPath, type Detail } from "./engine";
  import { degree, keyFromChords, keyName, named } from "./harmony";
  import MiniMixer from "./MiniMixer.svelte";
  import { Player } from "./player";
  import Roll from "./Roll.svelte";
  import { settings } from "./settings.svelte";
  import Transport from "./Transport.svelte";

  /** Una canción separada, para tocar encima: pistas con su volumen y M/S, piano roll por instrumento y acordes (lv-chordia).
   * Versión corta de SongView, sin pestañas ni cola. */
  let { key, time = $bindable(0), chords = $bindable([]), keyLabel = $bindable(""), detail = $bindable(null) }: {
    key: string;
    detail?: Detail | null; // la ficha, para quien la use fuera (el análisis)
    time?: number;
    chords?: { t: number; end: number; name: string; deg?: string }[];
    keyLabel?: string;
  } = $props();

  const player = new Player();
  let loading = $state(true);
  let error = $state("");
  let playing = $state(false);
  let duration = $state(0);
  let volume = $state<Record<string, number>>({});
  let muted = $state<Record<string, boolean>>({});
  let solo = $state<Record<string, boolean>>({});
  let rollHidden = $state<Record<string, boolean>>({});

  const stemlab = $derived(detail?.stemlab ?? null);
  const stems = $derived(stemlab?.stems ?? []);
  const audible = (name: string) => (Object.values(solo).some(Boolean) ? solo[name] : !muted[name]);
  const rollTracks = $derived(
    stems
      .filter((s) => s.roll && audible(s.name))
      .map((s) => ({ stem: s.name, name: STEM_INFO[s.name].label, color: STEM_INFO[s.name].color, path: `${stemlab!.dir}/${s.roll}`, hidden: !!rollHidden[s.name] })),
  );

  onMount(() => {
    (async () => {
      try {
        const d = await songDetail(key);
        if (!d.stemlab) throw new Error("Esta canción ya no tiene las pistas separadas");
        // la mezcla que dejaste en Analizar (solo se lee)
        const view = await readJson(viewPath(key), { volume: {}, muted: {}, solo: {} } as Record<string, Record<string, never>>);
        for (const s of d.stemlab.stems) {
          volume[s.name] = view.volume[s.name] ?? 1;
          muted[s.name] = view.muted[s.name] ?? !s.present;
          solo[s.name] = view.solo[s.name] ?? false;
        }
        detail = d;
        await player.load(d.stemlab.stems.map((s) => ({ name: s.name, path: `${d.stemlab!.dir}/${s.file}` })));
        duration = player.duration;
        const cs = d.chordData?.chords;
        if (cs?.length) {
          const k = keyFromChords(cs);
          chords = named(cs, k, loadNotation()).map((c) => ({ ...c, deg: degree(c, k) }));
          keyLabel = keyName(k, loadNotation().latin);
        } else [chords, keyLabel] = [[], ""];
      } catch (e) {
        error = e instanceof Error ? e.message : String(e);
      } finally {
        loading = false;
      }
    })();
    let raf = 0;
    const tick = () => {
      time = player.time();
      if (player.playing && time >= duration) {
        player.stop();
        playing = false;
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      player.stop();
      void player.ctx.close(); // WebKit se queda sin contextos de audio si no se cierran
    };
  });

  $effect(() => player.setMaster(settings.masterVolume));
  $effect(() => {
    if (loading) return;
    for (const s of stems) player.setGain(s.name, audible(s.name) ? (volume[s.name] ?? 1) : 0);
  });

  function toggle() {
    if (loading || error) return;
    if (player.playing) player.pause();
    else player.play();
    playing = player.playing;
  }

  export function seek(t: number, play = false) {
    player.seek(Math.max(0, Math.min(t, duration)));
    time = player.time();
    if (play && !player.playing) toggle();
  }

  function onkey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest("input:not([type=range]), textarea, select, button") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space") toggle();
    else if (e.key === "ArrowLeft") seek(time - 5);
    else if (e.key === "ArrowRight") seek(time + 5);
    else return;
    e.preventDefault();
  }
</script>

<svelte:window onkeydown={onkey} />

{#snippet controls()}
  {#if stems.length}<MiniMixer {stems} bind:volume bind:muted bind:solo />{/if}
  <Transport {playing} {time} {duration} bind:volume={settings.masterVolume} disabled={loading || !!error} ontoggle={toggle} onseek={seek} />
{/snippet}

{#if error}
  <div class="msg"><p class="error-text">{error}</p></div>
{:else if loading}
  <div class="msg"><span class="spinner"></span></div>
{:else}
  <Roll {player} tracks={rollTracks} {controls} bind:windowSec={settings.rollSpeed} ontoggle={(s) => (rollHidden[s] = !rollHidden[s])} {chords} {keyLabel} />
  <div class="bottom">{@render controls()}</div>
{/if}

<style>
  .msg { margin: auto; }
  .bottom { flex-shrink: 0; display: flex; flex-direction: column; gap: 10px; }
</style>
