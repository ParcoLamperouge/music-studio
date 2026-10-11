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
  import { degree, keyName, leadSheet, named, relative, scaleNotes, type Harmony } from "./harmony";

  let { detail, harmony, model, sources, time, notation = $bindable(), onseek, onnotes, oncheck, busy }: {
    detail: Detail;
    harmony: Harmony | null;
    model: boolean; // acordes de lv-chordia (del audio); si no, de las notas transcritas
    sources: string[]; // pistas con notas de las que salen los acordes
    time: number;
    notation: ChordView;
    onseek: (t: number) => void;
    onnotes: () => void; // (sin uso con acordes del modelo)
    oncheck: () => void; // comprobar que el audio es la versión de la letra
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
        <span class="kicker">Tonalidad</span>
        <h3>{keyName(k, notation.latin)}</h3>
        <div class="scale">
          {#each scaleNotes(k, notation.latin) as n, i (i)}<span class:tonic={i === 0}>{n}</span>{/each}
        </div>
        <p class="muted">Relativa: {keyName(relative(k), notation.latin)} · escala {k.minor ? "menor natural" : "mayor"}</p>
      </div>

      <div class="card">
        <span class="kicker">Acordes de la canción</span>
        <div class="vocab">
          {#each vocab as c (c.name)}
            <span class="chip" class:now={now?.name === c.name}>{c.name}{#if notation.degrees}<small>{c.deg}</small>{/if}</span>
          {/each}
        </div>
      </div>

      <div class="card opts">
        <div class="seg">
          <button class:on={notation.latin} onclick={() => (notation.latin = true)}>Do Re Mi</button>
          <button class:on={!notation.latin} onclick={() => (notation.latin = false)}>C D E</button>
        </div>
        <label><input type="checkbox" bind:checked={notation.simple} /> Simplificar (sin séptimas ni bajos)</label>
        <label><input type="checkbox" bind:checked={notation.degrees} /> Grados (I, IV, V7…)</label>
      </div>

      {#if model}
        <p class="note">Del audio con lv-chordia (Jiang et al., ISMIR 2019; ~170 acordes con inversiones). Es automático: revísalo de oído.</p>
      {:else}
        <p class="note">
          Provisionales, de las notas de {sources.join(", ").toLowerCase()}, mientras lv-chordia saca los del audio.
        </p>
      {/if}
      {#if busy}<p class="muted note">{busy}</p>{/if}
    </aside>
  </div>
{/if}

<style>
  .warn-bar { flex-shrink: 0; margin-bottom: 10px; padding: 8px 12px; border-radius: 10px; font-size: 12.5px; color: var(--text-2);
    border: 1px solid color-mix(in srgb, #ffc23d 40%, var(--line)); background: color-mix(in srgb, #ffc23d 7%, var(--panel)); }
  .warn-bar .link { margin-left: 6px; }
  .wrap { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 300px; gap: 18px; }
  .sheet { min-height: 0; overflow-y: auto; padding: 4px 8px 40px; }
  .row { padding: 6px 0 10px; }
  .line { display: flex; flex-wrap: wrap; align-items: flex-end; column-gap: 0.32em; row-gap: 6px; }
  .w { display: inline-flex; flex-direction: column; align-items: flex-start; }
  .chs { display: flex; gap: 6px; min-height: 22px; }
  .ch, .bar-chord {
    border: 0; background: none; padding: 0 2px; font-family: var(--mono); font-weight: 650; font-size: 14px; color: var(--accent);
    border-radius: 5px; transition: background 0.15s, color 0.15s; white-space: nowrap;
  }
  .ch:hover, .bar-chord:hover { background: var(--accent-soft); }
  .ch.now, .bar-chord.now { background: var(--accent); color: #1c0f05; box-shadow: 0 0 18px -4px var(--accent); }
  .ch small, .bar-chord small, .chip small { margin-left: 4px; font-size: 10px; font-weight: 500; opacity: 0.7; }
  .word { font-family: var(--serif); font-size: 24px; line-height: 1.1; color: var(--text); }
  .bars { display: flex; flex-wrap: wrap; align-items: center; gap: 0; }
  .bars .kicker { margin-right: 12px; }
  .bar-chord { padding: 6px 14px; border-left: 1px solid var(--line-hi); border-radius: 0; font-size: 15px; }
  .bar-chord:last-child { border-right: 1px solid var(--line-hi); }

  .info { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding-bottom: 10px; }
  .card { padding: 12px 14px; border-radius: 12px; background: var(--panel); border: 1px solid var(--line); }
  .key h3 { margin: 2px 0 10px; font-family: var(--serif); font-weight: 400; font-size: 34px; line-height: 1; }
  .scale { display: flex; gap: 4px; flex-wrap: wrap; }
  .scale span { padding: 3px 8px; border-radius: 7px; border: 1px solid var(--line-hi); font-size: 13px; }
  .scale .tonic { border-color: var(--accent); color: var(--accent); }
  .key p { margin: 10px 0 0; font-size: 12.5px; }
  .vocab { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 8px; }
  .chip { padding: 3px 9px; border-radius: 99px; border: 1px solid var(--line-hi); font-family: var(--mono); font-size: 12.5px; transition: all 0.15s; }
  .chip.now { border-color: var(--accent); background: var(--accent-soft); color: var(--text); }
  .opts { display: flex; flex-direction: column; gap: 10px; font-size: 13px; }
  .opts label { display: flex; gap: 8px; align-items: center; color: var(--text-2); }
  .seg { display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; align-self: flex-start; }
  .seg button { padding: 4px 11px; border: 0; background: transparent; color: var(--text-2); font-size: 12px; }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button.on { background: var(--panel-hi); color: var(--text); font-weight: 600; }
  .note { margin: 0; font-size: 12px; color: var(--text-3); }
  .empty { margin: auto; text-align: center; max-width: 520px; padding: 40px 0; }
  .empty h2 { margin: 0 0 8px; font-family: var(--serif); font-weight: 400; font-size: 34px; }
  .empty p { color: var(--text-2); margin: 0 0 18px; }
</style>
