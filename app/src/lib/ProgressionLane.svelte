<script lang="ts">
  import { t } from "./i18n.svelte";
  import type { Key } from "./harmony";
  import { chips, shift, type Step, type SongHit } from "./progression";
  import { chordFn } from "./ui/music";
  import { pinId, preview, type Pin } from "./preview.svelte";

  // La coincidencia como una tira de celdas alineada con la consulta: macizo = igual, hueco discontinuo = parecido
  // (tooltip), tenue y estrecho = acorde de más, punteado vacío = falta. El color es la función en el marco de la consulta.
  let { hit }: { hit: Pin | SongHit } = $props();
  const KINDS = ["", "m", "dim", "aug"];
  const cells = $derived.by(() => {
    const cs = chips(hit, hit.songKey), qk: Key = { tonic: 0, minor: hit.qkey.minor };
    let ci = 0;
    return hit.path.map((s: Step) => {
      if (s.si < 0) return { kind: "miss" as const, name: "·", deg: "", color: "var(--line-hi)", tip: "falta este acorde", i: -1 };
      const c = cs[ci], i = ci++;
      const f = chordFn({ root: shift(s.sc, -hit.tr - hit.qkey.tonic) >> 2, kind: KINDS[s.sc & 3] }, qk);
      return { kind: s.kind, name: c.name, deg: c.deg, color: f.color, tip: `${c.name} · ${c.deg} · ${c.tip}`, i };
    });
  });
  const on = $derived(preview.id === pinId(hit) && !preview.loading);
  const sounding = (i: number) => on && i >= 0 && preview.pos >= hit.ts[i] - hit.t && preview.pos < (hit.ts[i + 1] ?? hit.end) - hit.t;
</script>

<div class="lane" role="list">
  {#each cells as c, n (n)}
    <span class="cell {c.kind}" class:now={sounding(c.i)} style:--c={c.color} title={t(c.tip)} role="listitem">
      <b>{c.name}</b>{#if c.deg}<small>{c.deg}</small>{/if}
    </span>
  {/each}
</div>

<style>
  .lane { display: flex; gap: var(--s1); min-width: 0; overflow-x: auto; padding: 3px 0; }
  .cell {
    flex: 0 0 var(--cw, 84px); display: flex; flex-direction: column; align-items: center; justify-content: center; height: 40px; min-width: 0;
    border: 1.5px solid var(--c); border-radius: var(--r-md); background: var(--c); color: var(--on-data); line-height: 1.15;
    transition: box-shadow var(--t-fast), opacity var(--t-fast);
  }
  b { font-size: var(--fs-md); font-weight: 700; }
  small { font-size: var(--fs-xs); opacity: 0.75; }
  .same, .rel, .far { background: transparent; border-style: dashed; color: var(--c); }
  .far { opacity: 0.6; }
  .extra { flex-basis: 30px; background: transparent; border-color: var(--line-hi); color: var(--text-3); opacity: 0.6; }
  .extra b { font-size: var(--fs-xs); font-weight: 500; }
  .extra small { display: none; }
  .miss { background: transparent; border-style: dotted; border-color: var(--line-hi); color: var(--text-3); }
  .now { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--text); }
</style>
