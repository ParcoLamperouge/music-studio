<script lang="ts" module>
  import type { Notation } from "./harmony";

  export type ChordView = Notation & { degrees: boolean };
  export function loadNotation(): ChordView {
    try {
      return { latin: true, simple: false, degrees: false, ...JSON.parse(localStorage.getItem("estudio.chords") ?? "{}") };
    } catch {
      return { latin: true, simple: false, degrees: false };
    }
  }
</script>

<script lang="ts">
  import type { Detail } from "./engine";
  import ProgressionSearch from "./ProgressionSearch.svelte";
  import { degree, keyName, leadSheet, named, relative, scaleNotes, type Harmony } from "./harmony";

  let { detail, harmony, model, sources, time, notation = $bindable(), src, instruments, onsrc, onstemnotes, onseek, onnotes, oncheck, onopen, busy }: {
    detail: Detail;
    harmony: Harmony | null;
    model: boolean; // acordes de lv-chordia (del audio); si no, de las notas transcritas
    sources: string[]; // pistas con notas de las que salen los acordes
    time: number;
    notation: ChordView;
    src: string; // "mix" (toda la canción) o la pista de la que salen acordes y tonalidad
    instruments: { name: string; label: string; notes: boolean; job: string }[]; // job: sacando sus notas, o ""
    onsrc: (stem: string) => void;
    onstemnotes: (stem: string) => void;
    onseek: (t: number) => void;
    onnotes: () => void; // (sin uso con acordes del modelo)
    oncheck: () => void; // comprobar que el audio es la versión de la letra
    onopen: (key: string, t: number) => void; // abrir otra canción (resultado de buscar la progresión)
    busy: string; // trabajo de notas en marcha, o ""
  } = $props();

  $effect(() => {
    try {
      localStorage.setItem("estudio.chords", JSON.stringify(notation));
    } catch {}
  });

  type C = ReturnType<typeof named>[number] & { deg: string };
  const chords = $derived<C[]>(harmony ? named(harmony.chords, harmony.key, notation).map((c) => ({ ...c, deg: degree(c, harmony.key) })) : []);
  const vocab = $derived([...new Map(chords.map((c) => [c.name, c])).values()]);
  const rows = $derived(leadSheet(detail.doc, chords));

  const now = $derived(chords.find((c) => c.t <= time && time < c.end));
  const label = (c: C) => c.name;

  let sheet: HTMLDivElement | undefined = $state();
  let userScroll = 0;
  $effect(() => {
    const c = now;
    if (!c || !sheet || Date.now() - userScroll < 2500) return;
    sheet.querySelector<HTMLElement>(`[data-t="${c.t}"]`)?.closest<HTMLElement>(".row")?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
</script>

<div class="src">
  <div class="seg">
    <button class:on={src === "mix"} onclick={() => onsrc("mix")}>Toda la canción</button>
    {#each instruments.filter((x) => x.notes) as x (x.name)}
      <button class:on={src === x.name} onclick={() => onsrc(x.name)}>{x.label}</button>
    {/each}
  </div>
  {#each instruments.filter((x) => !x.notes) as x (x.name)}
    <button class="chip add" disabled={!!x.job} onclick={() => onstemnotes(x.name)} title="Sacar sus notas para ver sus acordes y su tonalidad">
      {x.job ? `${x.label}: ${x.job}` : `＋ ${x.label}`}
    </button>
  {/each}
</div>

{#if !harmony}
  <div class="empty">
    <h2>{busy ? "Sacando los acordes…" : "Sin acordes todavía"}</h2>
    <p>Salen del audio con lv-chordia (unos 15 s en la GPU): no hace falta separar ni sacar notas.</p>
    {#if busy}<p class="muted">{busy}</p>{/if}
  </div>
{:else}
  {@const k = harmony.key}
  {#if detail.doc && !detail.doc.audio_checked && detail.doc.lines.some((l) => l.t != null)}
    <div class="warn-bar">
      Los acordes van con el audio y la letra con sus tiempos de internet: si el audio es otra versión (un videoclip con
      intro), no cuadran.
      <button class="link" onclick={oncheck}>Comprobar la versión del audio</button>
    </div>
  {/if}
  <div class="wrap">
    <div class="sheet" bind:this={sheet} onwheel={() => (userScroll = Date.now())}>
      {#each rows as r, i (i)}
        {#if r.kind === "bars"}
          <div class="row bars">
            {#if r.label}<span class="kicker">{r.label}</span>{/if}
            {#each r.chords as c (c.t)}
              <button class="bar-chord" class:now={now?.t === c.t} data-t={c.t} onclick={() => onseek(c.t)}>
                <b>{label(c)}</b>{#if notation.degrees}<small>{c.deg}</small>{/if}
              </button>
            {/each}
          </div>
        {:else}
          <div class="row line">
            {#each r.words as w, j (j)}
              <span class="w" class:has={w.chords.length}>
                <span class="chs">
                  {#each w.chords as c (c.t)}
                    <button class="ch" class:now={now?.t === c.t} data-t={c.t} onclick={() => onseek(c.t)}>
                      {label(c)}{#if notation.degrees}<small>{c.deg}</small>{/if}
                    </button>
                  {/each}
                </span>
                <span class="word">{w.w}</span>
              </span>
            {/each}
            {#if r.tail.length}
              <span class="w has">
                <span class="chs">
                  {#each r.tail as c (c.t)}
                    <button class="ch" class:now={now?.t === c.t} data-t={c.t} onclick={() => onseek(c.t)}>{label(c)}{#if notation.degrees}<small>{c.deg}</small>{/if}</button>
                  {/each}
                </span>
                <span class="word">&nbsp;</span>
              </span>
            {/if}
          </div>
        {/if}
      {/each}
    </div>

    <aside class="info">
      <div class="card key">
        <span class="kicker">Tonalidad{src !== "mix" ? ` · ${instruments.find((x) => x.name === src)?.label}` : ""}</span>
        <h3>{keyName(k, notation.latin)}</h3>
        <div class="scale">
          {#each scaleNotes(k, notation.latin) as n, i (i)}<span class="chip" class:on={i === 0}>{n}</span>{/each}
        </div>
        <p class="hint">Relativa: {keyName(relative(k), notation.latin)} · escala {k.minor ? "menor natural" : "mayor"}</p>
      </div>

      <div class="card">
        <span class="kicker">Acordes de la canción</span>
        <div class="vocab">
          {#each vocab as c (c.name)}
            <span class="chip" class:on={now?.name === c.name}>{c.name}{#if notation.degrees}<small>{c.deg}</small>{/if}</span>
          {/each}
        </div>
      </div>

      <ProgressionSearch current={detail.key} {onopen} />

      <div class="card opts">
        <div class="seg">
          <button class:on={notation.latin} onclick={() => (notation.latin = true)}>Do Re Mi</button>
          <button class:on={!notation.latin} onclick={() => (notation.latin = false)}>C D E</button>
        </div>
        <label><input type="checkbox" bind:checked={notation.simple} /> Simplificar (sin séptimas ni bajos)</label>
        <label><input type="checkbox" bind:checked={notation.degrees} /> Grados (I, IV, V7…)</label>
      </div>

      {#if src !== "mix"}
        <p class="hint">
          De las notas de {instruments.find((x) => x.name === src)?.label.toLowerCase()}, sin IA: lo que toca ese instrumento solo (su nota
          más grave hace de bajo), no la canción entera. Revísalo de oído.
        </p>
      {:else if model}
        <p class="hint">Del audio con lv-chordia (Jiang et al., ISMIR 2019; ~170 acordes con inversiones). Es automático: revísalo de oído.</p>
      {:else}
        <p class="hint">
          Provisionales, de las notas de {sources.join(", ").toLowerCase()}, mientras lv-chordia saca los del audio.
        </p>
      {/if}
      {#if busy}<p class="hint">{busy}</p>{/if}
    </aside>
  </div>
{/if}

<style>
  .src { flex-shrink: 0; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px; }
  .src .chip:disabled { opacity: 0.6; }
  .warn-bar {
    flex-shrink: 0; margin-bottom: 10px; padding: 6px 10px; border-radius: var(--radius-sm); font-size: 12px; color: var(--text-3);
    border: 1px solid color-mix(in srgb, var(--warn) 35%, var(--line));
  }
  .warn-bar .link { margin-left: 6px; }
  .wrap { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 300px; gap: 16px; }
  .sheet { min-height: 0; overflow-y: auto; padding: 4px 8px 40px; }
  .row { padding: 6px 0 10px; }
  .line { display: flex; flex-wrap: wrap; align-items: flex-end; column-gap: 0.6em; row-gap: 6px; }
  .w { display: inline-flex; flex-direction: column; align-items: flex-start; }
  .chs { display: flex; gap: 6px; min-height: 20px; }
  .ch, .bar-chord {
    border: 0; background: none; padding: 0 2px; font-weight: 700; font-size: 13px; color: var(--accent);
    border-radius: 4px; transition: background 0.15s, color 0.15s; white-space: nowrap;
  }
  .ch:hover, .bar-chord:hover { background: var(--accent-soft); }
  .ch.now, .bar-chord.now { background: var(--accent); color: var(--on-accent); }
  .ch small, .bar-chord small, .chip small { margin-left: 4px; font-size: 10px; font-weight: 500; opacity: 0.7; }
  .word { font-size: 16px; line-height: 1.2; color: var(--text); }
  .bars { display: flex; flex-wrap: wrap; align-items: center; gap: 0; }
  .bars .kicker { margin-right: 12px; }
  .bar-chord { padding: 4px 12px; border-left: 1px solid var(--line-hi); border-radius: 0; font-size: 14px; }
  .bar-chord:last-child { border-right: 1px solid var(--line-hi); }

  .info { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-bottom: 10px; }
  .key h3 { margin: 2px 0 10px; font-size: 20px; }
  .scale, .vocab { display: flex; gap: 4px; flex-wrap: wrap; }
  .vocab { margin-top: 8px; }
  .key .hint { margin-top: 10px; }
  .opts { display: flex; flex-direction: column; gap: 10px; font-size: 12.5px; }
  .opts label { display: flex; gap: 8px; align-items: center; color: var(--text-2); }
  .opts .seg { align-self: flex-start; }
  .empty { margin: auto; text-align: center; max-width: 520px; padding: 40px 0; }
  .empty h2 { margin-bottom: 8px; }
  .empty p { color: var(--text-3); font-size: 12.5px; margin: 0 0 16px; }
</style>
