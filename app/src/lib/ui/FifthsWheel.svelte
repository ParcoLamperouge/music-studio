<script lang="ts">
  import { keyName, noteName, type Key } from "../harmony";
  import { chordFn, FN_LABEL } from "./music";
  import { t } from "../i18n.svelte";

  // Círculo de quintas: fuera los acordes mayores, dentro sus relativos menores. Con tonalidad, los suyos van en el color
  // de su función (flojo); los que suenan (`chords`, con su peso 0-1), más vivos; el de ahora, lleno y con borde.
  // La tónica lleva un aro. Sin tonalidad, gris.
  let { tonality, chords = [], current = null, size = 180, latin = true }: {
    tonality: Key | null;
    chords?: { root: number; kind: string; w?: number }[];
    current?: { root: number; kind: string } | null;
    size?: number;
    latin?: boolean;
  } = $props();

  const minorish = (kind: string) => /^m(?!aj)|^dim/.test(kind);
  const R = [96, 66, 40]; // radios: fuera, entre anillos, centro
  const pt = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(2)} ${(r * Math.sin(a)).toFixed(2)}`;
  const rad = (i: number, d: number) => ((i * 30 + d - 90) * Math.PI) / 180;
  const sector = (i: number, ro: number, ri: number) =>
    `M${pt(ro, rad(i, -15))}A${ro} ${ro} 0 0 1 ${pt(ro, rad(i, 15))}L${pt(ri, rad(i, 15))}A${ri} ${ri} 0 0 0 ${pt(ri, rad(i, -15))}Z`;

  const k0: Key = { tonic: 0, minor: false };
  const segs = $derived.by(() => {
    const used = new Map<string, number>();
    for (const c of chords) {
      const id = `${minorish(c.kind) ? "m" : "M"}${c.root}`;
      used.set(id, Math.max(used.get(id) ?? 0, c.w ?? 1));
    }
    const cur = current ? `${minorish(current.kind) ? "m" : "M"}${current.root}` : "";
    return Array.from({ length: 12 }, (_, i) => {
      const major = (i * 7) % 12;
      return [
        { i, minor: false, root: major, ro: R[0], ri: R[1] },
        { i, minor: true, root: (major + 9) % 12, ro: R[1], ri: R[2] },
      ].map((s) => {
        const id = `${s.minor ? "m" : "M"}${s.root}`;
        const chord = { root: s.root, kind: s.minor ? "m" : "" };
        const f = tonality ? chordFn(chord, tonality) : null;
        const w = used.get(id);
        const now = id === cur;
        const home = !!tonality && tonality.tonic === s.root && tonality.minor === s.minor;
        const alpha = now ? 1 : w != null ? 0.35 + 0.55 * w : f && !f.borrowed ? 0.16 : 0;
        const name = noteName(s.root, tonality ?? k0, latin) + (s.minor ? "m" : "");
        return { ...s, now, home, alpha, color: f ? f.color : "var(--text)", name, title: f ? `${name} · ${f.label} · ${t(FN_LABEL[f.fn])}` : name };
      });
    }).flat();
  });
  const mid = (s: { i: number; ro: number; ri: number }) => pt((s.ro + s.ri) / 2, rad(s.i, 0)).split(" ");
  const kn = $derived(tonality ? keyName(tonality, latin).split(" ") : null);
</script>

<svg class="wheel" viewBox="-100 -100 200 200" width={size} height={size} role="img" aria-label={kn ? t("Tonalidad: {k}", { k: kn.map((p) => t(p)).join(" ") }) : t("Tonalidad sin detectar")}>
  {#each segs as s (`${s.minor}${s.i}`)}
    {@const [x, y] = mid(s)}
    <g class:now={s.now}>
      <title>{s.title}</title>
      <path d={sector(s.i, s.ro, s.ri)} class="sg" style:--c={s.color} style:--a={s.alpha} />
      {#if s.home}<path d={sector(s.i, s.ro, s.ri)} class="home" />{/if}
      <text {x} {y} class:minor={s.minor} class:lit={s.alpha > 0.6}>{s.name}</text>
    </g>
  {/each}
  <circle r={R[2] - 3} class="hub" />
  {#if kn}
    <text y="-2" class="key">{kn[0]}</text>
    <text y="14" class="mode">{t(kn[1])}</text>
  {:else}
    <text y="4" class="mode">—</text>
  {/if}
</svg>

<style>
  .wheel { display: block; overflow: visible; font-family: var(--mono); }
  .sg { fill: color-mix(in oklab, var(--c) calc(var(--a) * 100%), transparent); stroke: var(--line); stroke-width: 1; transition: fill var(--t); }
  .now .sg { stroke: var(--text); stroke-width: 2; }
  .home { fill: none; stroke: var(--text); stroke-width: 1.5; stroke-dasharray: 3 2; }
  text { fill: var(--text-3); font-size: 10.5px; font-weight: 600; text-anchor: middle; dominant-baseline: central; pointer-events: none; }
  text.minor { font-size: 8.5px; }
  text.lit { fill: var(--on-data); }
  .hub { fill: var(--panel); stroke: var(--line); }
  .key { fill: var(--text); font-size: 15px; font-weight: 700; }
  .mode { fill: var(--text-3); font-size: 9px; }
</style>
