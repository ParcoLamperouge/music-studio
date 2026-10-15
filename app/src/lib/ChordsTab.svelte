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
  import { keyName, leadSheet, named, relative, scaleNotes, type Harmony } from "./harmony";
  import ProgressionSearch from "./ProgressionSearch.svelte";
  import Button from "./ui/Button.svelte";
  import ChordChip from "./ui/ChordChip.svelte";
  import Chip from "./ui/Chip.svelte";
  import EmptyState from "./ui/EmptyState.svelte";
  import Icon from "./ui/Icon.svelte";
  import { barsOf, chordFn, FN_LABEL, type Bar, type Fn, type Section } from "./ui/music";
  import ProgressRing from "./ui/ProgressRing.svelte";
  import Tabs from "./ui/Tabs.svelte";
  import Toggle from "./ui/Toggle.svelte";

  // Acordes: rejilla de compases (color por función) por secciones, o encima de la letra; a la derecha la tonalidad,
  // la leyenda de colores, los acordes de la canción y el buscador de progresiones.
  let { detail, harmony, model, sources, time, duration, sections = [], notation = $bindable(), src, instruments, onsrc, onstemnotes, onseek, oncheck, onopen, busy }: {
    detail: Detail;
    harmony: Harmony | null;
    model: boolean; // acordes de lv-chordia (del audio); si no, de las notas transcritas
    sources: string[]; // pistas con notas de las que salen los acordes
    time: number;
    duration: number;
    sections?: Section[];
    notation: ChordView;
    src: string; // "mix" (toda la canción) o la pista de la que salen acordes y tonalidad
    instruments: { name: string; label: string; notes: boolean; job: string }[]; // job: sacando sus notas, o ""
    onsrc: (stem: string) => void;
    onstemnotes: (stem: string) => void;
    onseek: (t: number) => void;
    oncheck: () => void; // comprobar que el audio es la versión de la letra
    onopen: (key: string, t: number) => void; // abrir otra canción (resultado de buscar la progresión)
    busy: string; // trabajo de acordes o notas en marcha, o ""
  } = $props();

  $effect(() => {
    try {
      localStorage.setItem("estudio.chords", JSON.stringify(notation));
    } catch {}
  });
  let layout = $state<"bars" | "lyrics">("bars");

  const chords = $derived(harmony ? named(harmony.chords, harmony.key, notation) : []);
  type C = (typeof chords)[number];
  const vocab = $derived([...new Map(chords.map((c) => [c.name, c])).values()]);
  const rows = $derived(leadSheet(detail.doc, chords));
  const now = $derived(chords.find((c) => c.t <= time && time < c.end));

  // compases agrupados por sección (de la letra); sin secciones, un solo bloque
  const blocks = $derived.by(() => {
    const out: { label: string; bars: Bar<C>[] }[] = [];
    for (const b of barsOf(chords, detail.beatData, duration || detail.duration)) {
      const s = sections.find((x) => b.t >= x.t - 0.3 && b.t < x.end - 0.3);
      const label = s?.label ?? "";
      const last = out[out.length - 1];
      if (last && last.label === label && (!s || last.bars[0].t >= s.t - 0.3)) last.bars.push(b);
      else out.push({ label, bars: [b] });
    }
    return out;
  });
  const usedFns = $derived(new Set(harmony ? vocab.map((c) => fnOf(c)) : []));
  function fnOf(c: C): Fn {
    return chordFn(c, harmony!.key).fn;
  }

  let sheet: HTMLDivElement | undefined = $state();
  let userScroll = 0;
  $effect(() => {
    const c = now;
    if (!c || !sheet || Date.now() - userScroll < 2500) return;
    sheet.querySelector<HTMLElement>(".cell.on, .cc.active")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  const srcLabel = $derived(instruments.find((x) => x.name === src)?.label ?? "");
</script>

{#if !harmony}
  <EmptyState icon="chords" title={busy ? "Sacando los acordes" : "Sin acordes"}>
    Salen del audio en unos segundos, sin separar.
    {#snippet actions()}
      {#if busy}<span class="job"><ProgressRing value={null} size={16} />{busy}</span>{/if}
    {/snippet}
  </EmptyState>
{:else}
  {@const k = harmony.key}
  <div class="bar-tools">
    <Tabs size="sm" label="De dónde salen los acordes" value={src} onchange={onsrc}
      options={[{ value: "mix", label: "Canción" }, ...instruments.filter((x) => x.notes).map((x) => ({ value: x.name, label: x.label }))]} />
    {#each instruments.filter((x) => !x.notes) as x (x.name)}
      {#if x.job}<Chip title={x.job}>{x.label} …</Chip>{:else}<Chip icon="plus" title="Sacar sus notas para ver sus acordes" onclick={() => onstemnotes(x.name)}>{x.label}</Chip>{/if}
    {/each}
    <span class="spacer"></span>
    <Tabs size="sm" label="Vista" bind:value={layout} options={[{ value: "bars", icon: "grid", title: "Compases" }, { value: "lyrics", icon: "lyrics", title: "Con la letra" }]} />
    <Tabs size="sm" label="Nombres" value={notation.latin ? "latin" : "en"} onchange={(v) => (notation.latin = v === "latin")} options={[{ value: "latin", label: "Do" }, { value: "en", label: "C" }]} />
    <Toggle bind:checked={notation.degrees} title="Grados (I, IV, V7…)">Grados</Toggle>
    <Toggle bind:checked={notation.simple} title="Sin séptimas ni bajos">Simple</Toggle>
  </div>

  {#if detail.doc && !detail.doc.audio_checked && detail.doc.lines.some((l) => l.t != null) && layout === "lyrics"}
    <div class="warn">
      <Icon name="alert" size={14} />
      <span>Si el audio es otra versión, la letra no cuadra con los acordes.</span>
      <Button size="sm" variant="ghost" onclick={oncheck}>Comprobar</Button>
    </div>
  {/if}

  <div class="wrap">
    <div class="sheet" bind:this={sheet} onwheel={() => (userScroll = Date.now())}>
      {#if layout === "bars"}
        {#each blocks as b, i (i)}
          <section class="block">
            {#if b.label}<h3>{b.label}</h3>{/if}
            <div class="grid">
              {#each b.bars as bar (bar.t)}
                {@const on = bar.t <= time && time < bar.end}
                <button type="button" class="cell" class:on onclick={() => onseek(bar.t)} title={bar.chords.map((c) => c.name).join(" · ")}>
                  {#if bar.repeat}
                    <span class="rep" aria-label={bar.chords[0].name}>%</span>
                  {:else}
                    {#each bar.chords as c (c.t)}
                      <ChordChip chord={c} tonality={k} name={c.name} showDegree={notation.degrees} active={now?.t === c.t} size={bar.chords.length > 1 ? "md" : "lg"} />
                    {/each}
                  {/if}
                </button>
              {/each}
            </div>
          </section>
        {/each}
      {:else}
        {#each rows as r, i (i)}
          {#if r.kind === "bars"}
            <div class="row">
              {#if r.label}<h3>{r.label}</h3>{/if}
              {#each r.chords as c (c.t)}
                <ChordChip chord={c} tonality={k} name={c.name} showDegree={notation.degrees} active={now?.t === c.t} onclick={() => onseek(c.t)} />
              {/each}
            </div>
          {:else}
            <div class="row line">
              {#each [...r.words, ...(r.tail.length ? [{ w: "", t: r.tail[0].t, chords: r.tail }] : [])] as w, j (j)}
                <span class="w">
                  <span class="chs">
                    {#each w.chords as c (c.t)}
                      <ChordChip chord={c} tonality={k} name={c.name} showDegree={notation.degrees} active={now?.t === c.t} size="sm" onclick={() => onseek(c.t)} />
                    {/each}
                  </span>
                  <span class="word">{w.w || " "}</span>
                </span>
              {/each}
            </div>
          {/if}
        {/each}
      {/if}
    </div>

    <aside class="side">
      <div class="keybox">
        <span class="label">Tonalidad{src !== "mix" ? ` · ${srcLabel}` : ""}</span>
        <strong>{keyName(k, notation.latin)}</strong>
        <div class="scale">
          {#each scaleNotes(k, notation.latin) as n, i (i)}<span class:tonic={i === 0}>{n}</span>{/each}
        </div>
        <span class="label">Relativa {keyName(relative(k), notation.latin)}</span>
      </div>

      <div class="vocab">
        {#each vocab as c (c.name)}
          <ChordChip chord={c} tonality={k} name={c.name} showDegree active={now?.name === c.name} size="sm" />
        {/each}
      </div>

      <ul class="legend" aria-label="Colores">
        {#each Object.entries(FN_LABEL) as [fn, label] (fn)}
          <li class:dim={!usedFns.has(fn as Fn)}><i class="sw {fn}" style:--c="var(--fn-{fn})"></i>{label}</li>
        {/each}
        <li class="shapes"><i class="sw" style:--c="var(--text-2)"></i>mayor <i class="sw hollow" style:--c="var(--text-2)"></i>menor</li>
      </ul>

      <p class="src" title={model ? "lv-chordia (Jiang et al., ISMIR 2019; ~170 acordes con inversiones)" : ""}>
        <Icon name={model ? "audio" : "notes"} size={12} />
        {src !== "mix" ? `De las notas de ${srcLabel.toLowerCase()}` : model ? "Del audio · revísalo de oído" : `Provisionales, de ${sources.join(", ").toLowerCase()}`}
      </p>
      {#if busy}<span class="job"><ProgressRing value={null} size={14} />{busy}</span>{/if}

      <ProgressionSearch current={detail.key} {onopen} />
    </aside>
  </div>
{/if}

<style>
  .bar-tools { display: flex; flex-wrap: wrap; gap: var(--s2); align-items: center; margin-bottom: var(--s3); flex-shrink: 0; }
  .spacer { flex: 1; }
  .warn {
    display: flex; align-items: center; gap: var(--s2); flex-shrink: 0; margin-bottom: var(--s2); padding: 2px var(--s2);
    border-radius: var(--r-md); color: var(--text-2); font-size: var(--fs-sm); border: 1px solid color-mix(in oklab, var(--warn) 40%, var(--line));
  }
  .warn :global(svg) { color: var(--warn); }
  .job { display: inline-flex; align-items: center; gap: var(--s2); color: var(--text-2); font-size: var(--fs-sm); }

  .wrap { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: var(--s5); }
  .sheet { min-height: 0; overflow-y: auto; padding: 0 var(--s1) var(--s6); container-type: inline-size; }
  .block { margin-bottom: var(--s4); }
  h3 { font-size: var(--fs-sm); font-weight: 500; color: var(--text-2); margin: 0 0 var(--s1); }
  .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 3px; }
  @container (min-width: 760px) { .grid { grid-template-columns: repeat(8, minmax(0, 1fr)); } }
  .cell {
    display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 2px; align-items: stretch; min-width: 0; height: 48px;
    padding: 3px; border: 1px solid var(--line); border-radius: var(--r-md); background: var(--panel); transition: border-color var(--t-fast);
  }
  .cell:hover { border-color: var(--line-hi); }
  .cell.on { border-color: var(--text); }
  .cell :global(.cc) { height: auto; min-width: 0; overflow: hidden; }
  .rep { display: grid; place-items: center; color: var(--text-3); font-size: var(--fs-lg); }

  .row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s1); padding: var(--s2) 0; }
  .row h3 { margin: 0 var(--s2) 0 0; }
  .line { align-items: flex-end; column-gap: 0.6em; row-gap: var(--s2); }
  .w { display: inline-flex; flex-direction: column; align-items: flex-start; gap: 2px; }
  .chs { display: flex; gap: 4px; min-height: 20px; }
  .word { font-size: var(--fs-lg); line-height: 1.2; }

  .side { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--s4); padding-bottom: var(--s4); }
  .keybox { display: flex; flex-direction: column; gap: var(--s1); }
  .keybox strong { font-size: var(--fs-2xl); font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; }
  .label { font-size: var(--fs-xs); color: var(--text-3); }
  .scale { display: grid; grid-template-columns: repeat(7, 1fr); gap: 2px; margin: var(--s1) 0; }
  .scale span { text-align: center; padding: 3px 0; border-radius: var(--r-sm); background: var(--panel); font-size: var(--fs-sm); color: var(--text-2); }
  .scale .tonic { background: var(--panel-hi); color: var(--text); font-weight: 700; box-shadow: inset 0 -2px 0 var(--fn-tonic); }
  .vocab { display: flex; flex-wrap: wrap; gap: var(--s1); }
  .legend { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: var(--s1) var(--s3); font-size: var(--fs-xs); color: var(--text-2); }
  .legend li { display: flex; align-items: center; gap: 6px; }
  .legend .dim { opacity: 0.4; }
  .legend .shapes { grid-column: 1 / -1; color: var(--text-3); }
  .sw { width: 12px; height: 12px; border-radius: 3px; background: var(--c); border: 1.5px solid var(--c); flex-shrink: 0; }
  .sw.hollow { background: transparent; }
  .sw.other { background: transparent; border-style: dashed; }
  .src { display: flex; align-items: center; gap: 6px; color: var(--text-3); font-size: var(--fs-xs); }
</style>
