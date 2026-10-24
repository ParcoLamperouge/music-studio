<script lang="ts">
  import { t } from "../i18n.svelte";

  // Calendario de práctica: una columna por semana (lunes arriba), las últimas `weeks`; cada día practicado, macizo.
  // `days`: fechas AAAA-MM-DD (progress.days en progress.svelte.ts).
  let { days, weeks = 18 }: { days: string[]; weeks?: number } = $props();

  const iso = (d: Date) => d.toLocaleDateString("sv");
  const cells = $derived.by(() => {
    const set = new Set(days);
    const today = new Date();
    const start = new Date(today);
    start.setDate(today.getDate() - ((today.getDay() + 6) % 7) - (weeks - 1) * 7); // lunes de la primera semana
    return Array.from({ length: weeks * 7 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      const k = iso(d);
      return { k, on: set.has(k), future: d > today, today: k === iso(today) };
    });
  });
  const count = $derived(cells.filter((c) => c.on).length);
</script>

<div class="heat" role="img" aria-label={t("{n} días de práctica en las últimas {m} semanas", { n: count, m: weeks })}>
  {#each cells as c (c.k)}
    <i class:on={c.on} class:future={c.future} class:today={c.today} title={c.k}></i>
  {/each}
</div>

<style>
  .heat { display: grid; grid-template-rows: repeat(7, 10px); grid-auto-flow: column; grid-auto-columns: 10px; gap: 3px; width: max-content; }
  i { border-radius: 2px; background: var(--line); }
  .on { background: var(--accent); }
  .future { background: transparent; }
  .today { box-shadow: 0 0 0 1px var(--text-2); }
</style>
