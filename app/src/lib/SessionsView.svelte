<script lang="ts">
  import { invoke } from "@tauri-apps/api/core";
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { listDir, paths, readBytes, readJson, removeFile } from "./engine";
  import { stamps } from "./live";
  import { Player, synth } from "./player";
  import Roll from "./Roll.svelte";
  import { settings } from "./settings.svelte";
  import Transport from "./Transport.svelte";

  /** Lo que guarda el modo Tocar (live.ts, snapshot). */
  type Session = {
    device: string;
    duration: number;
    key: string | null;
    notes: [number, number, number, number][];
    chords: { t: number; end: number; name: string; deg?: string }[];
    pedal: [number, number][];
  };
  type Item = { name: string; base: string; s: Session | null };

  let { onback }: { onback: () => void } = $props();

  const dir = `${paths.data}/sesiones`;
  let items = $state<Item[]>([]);
  let sel = $state<Item | null>(null);
  const player = new Player();
  let playing = $state(false);
  let time = $state(0);
  let duration = $state(0);
  let loading = $state(false);
  let analysis = $state("");
  let analyzing = $state(false);
  let error = $state("");

  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  /** «2026-10-14_11-48-47» → «14 oct 2026 · 11:48». */
  const when = (name: string) => {
    const [d, h] = name.split("_");
    const date = new Date(`${d}T${(h ?? "").replaceAll("-", ":")}`);
    if (isNaN(+date)) return name;
    return `${date.toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" })} · ${date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}`;
  };

  async function scan() {
    const files = await listDir(dir).catch(() => []);
    const names = files.filter((f) => f.name.endsWith(".json")).map((f) => f.name.slice(0, -5)).sort().reverse();
    items = await Promise.all(names.map(async (name) => ({ name, base: `${dir}/${name}`, s: await readJson<Session | null>(`${dir}/${name}.json`, null) })));
    if (!sel && items[0]) void open(items[0]);
  }

  async function open(it: Item) {
    if (!it.s) return;
    player.stop();
    player.buffers.clear();
    player.duration = 0;
    playing = false;
    time = 0;
    sel = it;
    analysis = "";
    error = "";
    loading = true;
    try {
      const buf = await synth(it.s.notes, it.s.duration);
      if (sel !== it) return; // se eligió otra mientras se sintetizaba
      player.setBuffer("piano", buf);
      duration = it.s.duration;
    } catch (e) {
      error = `No se pudo sintetizar: ${e}`;
    }
    loading = false;
    const md = await readBytes(`${it.base}.analisis.md`).catch(() => null);
    if (sel === it && md) analysis = new TextDecoder().decode(md);
  }

  function toggle() {
    if (player.playing) player.pause();
    else player.play();
    playing = player.playing;
  }

  function seek(t: number) {
    player.seek(t);
    time = t;
  }

  /** Un tiempo del análisis: ir ahí y escucharlo. */
  function jump(t: number) {
    seek(Math.min(t, duration));
    if (!player.playing && !loading) toggle();
  }

  async function analyze() {
    const it = sel;
    if (!it) return;
    analyzing = true;
    error = "";
    try {
      const text = await invoke<string>("analyze_session", { path: `${it.base}.json` });
      if (sel === it) analysis = text;
    } catch (e) {
      if (sel === it) error = String(e);
    }
    analyzing = false;
  }

  async function remove() {
    if (!sel || !confirm(`Borrar la sesión del ${when(sel.name)} (.mid, .json y su análisis). No se puede deshacer.`)) return;
    for (const ext of [".json", ".mid", ".analisis.md"]) await removeFile(sel.base + ext).catch(() => {});
    player.stop();
    playing = false;
    sel = null;
    await scan();
  }

  /** Markdown justo para leer el análisis: títulos, viñetas y párrafos, sin HTML. */
  const blocks = $derived(
    analysis
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => {
        const text = l.replace(/\*\*|`/g, "");
        if (/^#{1,4}\s/.test(text)) return { kind: "h", text: text.replace(/^#+\s*/, "") };
        if (/^\s*[-*]\s/.test(text)) return { kind: "li", text: text.replace(/^\s*[-*]\s*/, "") };
        return { kind: "p", text };
      }),
  );

  // acordes que más suenan
  const top = $derived.by(() => {
    const dur = new Map<string, number>();
    for (const c of sel?.s?.chords ?? []) dur.set(c.name, (dur.get(c.name) ?? 0) + c.end - c.t);
    return [...dur].sort((a, b) => b[1] - a[1]).slice(0, 6);
  });

  $effect(() => player.setMaster(settings.masterVolume));
  onMount(() => {
    void scan();
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
      void player.ctx.close();
    };
  });

  function onkey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).closest("input, textarea, select, button") || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space" && sel && !loading) (e.preventDefault(), toggle());
    else if (e.key === "ArrowLeft") seek(Math.max(0, time - 5));
    else if (e.key === "ArrowRight") seek(Math.min(duration, time + 5));
  }
</script>

<svelte:window onkeydown={onkey} />

{#snippet linked(text: string)}
  {#each stamps(text) as p, i (i)}{#if p.t != null}<button class="ts" onclick={() => jump(p.t!)} title="Ir a {p.text}">{p.text}</button>{:else}{p.text}{/if}{/each}
{/snippet}

{#snippet controls()}
  <Transport {playing} {time} {duration} bind:volume={settings.masterVolume} disabled={loading || !sel} ontoggle={toggle} onseek={seek} />
{/snippet}

<div class="sessions">
  <aside>
    <header>
      <button class="ghost" onclick={onback} title="Volver al menú">← Menú</button>
      <strong>Sesiones</strong>
    </header>
    <div class="list">
      {#each items as it (it.name)}
        <button class="item" class:on={sel?.name === it.name} onclick={() => open(it)} disabled={!it.s}>
          <span>{when(it.name)}</span>
          <small class="mono">
            {#if it.s}{fmt(it.s.duration)} · {it.s.notes.length} notas{it.s.key ? ` · ${it.s.key}` : ""}{:else}no se puede leer{/if}
          </small>
        </button>
      {:else}
        <p class="muted empty">Aún no hay sesiones: se guardan solas al tocar en «Tocar».</p>
      {/each}
    </div>
  </aside>

  <main>
    {#if sel?.s}
      {#key sel.base}
        <Roll {player} {controls} bind:windowSec={settings.rollSpeed} ontoggle={() => {}} chords={sel.s.chords} keyLabel={sel.s.key ?? ""}
          tracks={[{ stem: "piano", name: sel.s.device || "Teclado", color: "#f29d38", path: `${sel.base}.json`, hidden: false }]} />
      {/key}
      <div class="bottom">{@render controls()}</div>
    {:else}
      <div class="welcome"><h1>Tus sesiones,<br /><em>otra vez</em>.</h1></div>
    {/if}
  </main>

  <section class="panel">
    {#if sel?.s}
      <span class="kicker">Sesión</span>
      <h2>{when(sel.name)}</h2>
      <dl class="mono">
        <dt>Duración</dt><dd>{fmt(sel.s.duration)}</dd>
        <dt>Notas</dt><dd>{sel.s.notes.length}</dd>
        <dt>Tonalidad</dt><dd>{sel.s.key ?? "—"}</dd>
        <dt>Pedal</dt><dd>{sel.s.pedal.length} veces</dd>
        <dt>Teclado</dt><dd>{sel.s.device}</dd>
      </dl>
      {#if top.length}
        <span class="kicker">Acordes que más suenan</span>
        <div class="chips">{#each top as [name, d] (name)}<span>{name} <small>{fmt(d)}</small></span>{/each}</div>
        <span class="kicker">Progresión <small>(clic para ir)</small></span>
        <div class="prog">
          {#each sel.s.chords as c, i (i)}
            <button class:now={c.t <= time && time < c.end} onclick={() => seek(c.t)} title="{fmt(c.t)}{c.deg ? ` · ${c.deg}` : ''}">{c.name}</button>
          {/each}
        </div>
      {/if}
      <div class="actions">
        <button class="primary" onclick={analyze} disabled={analyzing}>{analyzing ? "Claude escuchando…" : analysis ? "Analizar otra vez" : "Analizar con Claude"}</button>
        <button class="ghost" onclick={() => sel && revealItemInDir(`${sel.base}.mid`)} title="El .mid se abre en cualquier programa">Carpeta</button>
        <button class="ghost" onclick={remove}>Borrar</button>
      </div>
      {#if analyzing}<div class="bar indet"><i></i></div>{/if}
      {#if error}<p class="error-text">{error}</p>{/if}
      {#if blocks.length}
        <article>
          {#each blocks as b, i (i)}
            {#if b.kind === "h"}<h3>{b.text}</h3>{:else}<p class:li={b.kind === "li"}>{@render linked(b.text)}</p>{/if}
          {/each}
        </article>
      {/if}
    {/if}
  </section>
</div>

<style>
  .sessions { height: 100vh; display: grid; grid-template-columns: 280px 1fr 380px; }
  aside { background: var(--sidebar); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; }
  aside header { display: flex; align-items: center; gap: 12px; padding: 14px; border-bottom: 1px solid var(--line); }
  aside strong { font-family: var(--serif); font-weight: 400; font-size: 24px; }
  .list { overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 2px; }
  .item { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 9px 12px; border-radius: 10px; border: 0; background: none; color: var(--text); text-align: left; }
  .item:hover:not(:disabled) { background: var(--panel); }
  .item.on { background: var(--panel-hi); box-shadow: inset 2px 0 0 var(--accent); }
  .item small { color: var(--text-3); font-size: 11px; }
  .empty { padding: 12px; font-size: 13px; }

  main { min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 12px; padding: 16px 24px; }
  .bottom { flex-shrink: 0; }
  .welcome { margin: auto; }
  .welcome h1 { font-family: var(--serif); font-weight: 400; font-size: 64px; line-height: 0.95; }
  .welcome em { color: var(--accent); }

  .panel { border-left: 1px solid var(--line); background: var(--sidebar); overflow-y: auto; padding: 18px; display: flex; flex-direction: column; gap: 10px; }
  .panel h2 { font-family: var(--serif); font-weight: 400; font-size: 30px; margin: 0; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 14px; margin: 0 0 6px; font-size: 12px; }
  dt { color: var(--text-3); }
  dd { margin: 0; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kicker small { text-transform: none; letter-spacing: 0; font-weight: 400; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips span { padding: 3px 10px; border-radius: 99px; background: var(--accent-soft); color: var(--text); font-size: 13px; }
  .chips small { color: var(--text-3); font-family: var(--mono); font-size: 10.5px; }
  .prog { display: flex; flex-wrap: wrap; gap: 4px; max-height: 160px; overflow-y: auto; }
  .prog button { padding: 2px 8px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); color: var(--text-2); font-family: var(--mono); font-size: 11.5px; }
  .prog button:hover { color: var(--text); border-color: var(--line-hi); }
  .prog button.now { color: #1c0f05; background: var(--accent); border-color: var(--accent); }
  .actions { display: flex; gap: 8px; margin-top: 6px; }
  .panel .error-text { font-size: 12.5px; margin: 0; }
  article { border-top: 1px solid var(--line); padding-top: 6px; font-size: 13.5px; color: var(--text-2); }
  article h3 { font-family: var(--serif); font-weight: 400; font-size: 21px; color: var(--text); margin: 14px 0 4px; }
  article p { margin: 0 0 6px; }
  article .li { padding-left: 14px; position: relative; }
  .ts { padding: 0 3px; border: 0; border-radius: 4px; background: var(--accent-soft); color: var(--accent); font-family: var(--mono); font-size: 0.9em; }
  .ts:hover { background: var(--accent); color: #1c0f05; }
  article .li::before { content: "·"; position: absolute; left: 3px; color: var(--accent); }
</style>
