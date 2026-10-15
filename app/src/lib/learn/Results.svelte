<script lang="ts">
  import type { Zone } from "../zones";
  import Button from "../ui/Button.svelte";
  import Icon from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import ProgressRing from "../ui/ProgressRing.svelte";
  import { TIMING } from "../ui/music";
  import Timing from "./Timing.svelte";
  import ZoneBar, { accColor } from "./ZoneBar.svelte";

  // Lo que ha salido, en gráficos: el acierto (anillo), el tiempo (histograma adelantada↔atrasada), la fuerza y el mapa
  // de compases con las zonas difíciles para practicarlas. Con lección: las estrellas y el objetivo.
  let { stats, errs, bars, barTime, duration, zones, lesson, onzone, onretry, onclose, onreset }: {
    stats: { due: number; hits: number; wrong: number; force: number | null; offForce: number };
    errs: number[];
    bars: (number | null)[];
    barTime: (i: number) => number;
    duration: number;
    zones: Zone[];
    lesson?: { goal: number; result: number | null; stars: number; onback: () => void } | null;
    onzone: (z: Zone) => void;
    onretry: () => void;
    onclose: () => void;
    onreset: () => void;
  } = $props();

  const acc = $derived(stats.due + stats.wrong ? stats.hits / (stats.due + stats.wrong) : 0);
  const shown = $derived(lesson?.result ?? acc);
  let confirm = $state(false);
</script>

<div class="res" role="dialog" aria-label="Resultados">
  <header>
    <h2>Resultados</h2>
    <IconButton icon="close" label="Cerrar" onclick={onclose} />
  </header>

  <div class="top">
    <div class="ring">
      <ProgressRing value={shown} size={132} stroke={10} color={accColor(shown)} label="Acierto">
        <strong class="num">{Math.round(shown * 100)}<small>%</small></strong>
      </ProgressRing>
      {#if lesson}
        <span class="stars" aria-label="{lesson.stars} de 3 estrellas">
          {#each [0, 1, 2] as i (i)}<span class:on={i < lesson.stars}><Icon name="star" size={18} /></span>{/each}
        </span>
        <small class="goal" class:ok={shown >= lesson.goal}><Icon name={shown >= lesson.goal ? "check" : "target"} size={12} /> objetivo {Math.round(lesson.goal * 100)} %</small>
      {/if}
    </div>
    <div class="facts">
      <div class="fact"><span class="big num">{stats.hits}<small>/{stats.due}</small></span><span>notas</span></div>
      <div class="fact"><span class="big num" style:color={stats.wrong ? TIMING.miss.color : undefined}>{TIMING.miss.mark} {stats.wrong}</span><span>de más</span></div>
      {#if stats.force != null}
        <div class="fact" title="Fuerza: de media, cuánto más fuerte (+) o flojo (−) que lo que pide (de 127)">
          <span class="big num">{stats.force > 0 ? "+" : ""}{stats.force}</span><span>fuerza{stats.offForce ? ` · ${stats.offForce} fuera` : ""}</span>
        </div>
      {/if}
    </div>
    <div class="tm"><Timing {errs} mode="hist" /></div>
  </div>

  {#if bars.length > 1}
    <section>
      <ZoneBar {bars} {barTime} {duration} time={0} />
      <div class="zones">
        {#each zones as z (z.from)}
          <Button size="sm" icon="loop" onclick={() => onzone(z)} title="{z.tries} notas tocadas ahí">
            c. {z.from + 1}{z.to > z.from ? `–${z.to + 1}` : ""}
            <span class="dot" style:background={accColor(z.acc)}></span><span class="num">{Math.round(z.acc * 100)} %</span>
          </Button>
        {:else}
          <small class="faint">Sin zonas difíciles por ahora.</small>
        {/each}
        <span class="fill"></span>
        <Button size="sm" variant={confirm ? "danger" : "ghost"} icon="trash" onclick={() => (confirm ? ((confirm = false), onreset()) : (confirm = true))}
          title="Borra lo apuntado en este nivel, melodía y manos (lo demás se queda)">{confirm ? "¿Seguro?" : "Reiniciar zonas"}</Button>
      </div>
    </section>
  {/if}

  <footer>
    {#if lesson}<Button icon="course" onclick={lesson.onback}>Volver a la lección</Button>{/if}
    <span class="fill"></span>
    <Button variant="primary" icon="retry" onclick={onretry}>Otra vez</Button>
  </footer>
</div>

<style>
  .res {
    position: absolute; z-index: 30; left: 50%; top: 50%; translate: -50% -50%; width: min(720px, calc(100% - 32px)); max-height: calc(100% - 32px); overflow: auto;
    display: flex; flex-direction: column; gap: var(--s4); padding: var(--s4) var(--s5) var(--s5);
    border-radius: var(--r-lg); background: var(--panel); box-shadow: var(--shadow); animation: rise var(--t-slow) var(--ease);
  }
  header, footer, .zones { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
  header { justify-content: space-between; }
  .top { display: grid; grid-template-columns: auto auto minmax(0, 1fr); gap: var(--s5); align-items: center; }
  .ring { display: flex; flex-direction: column; align-items: center; gap: var(--s2); }
  .ring strong { font-size: var(--fs-2xl); font-weight: 700; }
  .ring strong small { font-size: var(--fs-md); color: var(--text-2); }
  .stars { display: flex; gap: 2px; color: var(--line-hi); }
  .stars .on { color: var(--warn); }
  .stars .on :global(svg) { fill: currentColor; }
  .goal { display: inline-flex; align-items: center; gap: 4px; color: var(--text-3); font-size: var(--fs-xs); }
  .goal.ok { color: var(--ok); }
  .facts { display: flex; flex-direction: column; gap: var(--s3); }
  .fact { display: flex; flex-direction: column; font-size: var(--fs-xs); color: var(--text-3); }
  .big { font-size: var(--fs-xl); color: var(--text); font-weight: 600; line-height: 1.1; }
  .big small { font-size: var(--fs-sm); color: var(--text-3); }
  .tm { min-width: 0; }
  section { display: flex; flex-direction: column; gap: var(--s3); }
  .dot { width: 8px; height: 8px; border-radius: 50%; }
  .faint { color: var(--text-3); }
  .fill { flex: 1; }
  @media (max-width: 640px) { .top { grid-template-columns: 1fr; justify-items: center; } .tm { width: 100%; } }
</style>
