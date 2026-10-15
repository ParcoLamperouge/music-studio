<script lang="ts">
  import { openPath } from "@tauri-apps/plugin-opener";
  import { enqueue, hasDirector, listDir, paths, readJson, removeFile, type Detail, type Track } from "./engine";
  import { jobOf, jobText, store } from "./store.svelte";
  import Button from "./ui/Button.svelte";
  import Icon from "./ui/Icon.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import ProgressRing from "./ui/ProgressRing.svelte";
  import Tabs from "./ui/Tabs.svelte";

  // Edits (vídeo vertical con la letra al ritmo): crear uno nuevo y los que ya hay de esta canción, como pósters.
  let { track, detail }: { track: Track; detail: Detail | null } = $props();

  type Project = { id: string; name: string; key: string; start: number; end: number; rate: number; updated: number; style?: { template?: string } };
  type Preset = { id: string; name: string };
  let projects = $state<Project[]>([]);
  let presets = $state<Preset[]>([]);
  let ai = $state(false);
  let mode = $state("auto");
  let loaded = $state(false);

  const dir = () => `${paths.edits}/projects`;
  async function load() {
    const files = (await listDir(dir()).catch(() => [])).filter((f) => f.name.endsWith(".json"));
    const all = await Promise.all(files.map((f) => readJson<Project | null>(`${dir()}/${f.name}`, null)));
    projects = all.filter((p): p is Project => !!p && p.key === track.key).sort((a, b) => b.updated - a.updated);
    loaded = true;
  }
  $effect(() => {
    void store.rev[track.key];
    void load();
  });
  $effect(() => {
    hasDirector().then((v) => {
      ai = v;
      if (v && mode === "auto") mode = "ai";
    });
    readJson<Preset[]>(`${paths.edits}/presets.json`, []).then((p) => (presets = p));
  });

  const go = (q: string) => (location.href = `/edit.html?${q}`);
  const create = () => go(`song=${encodeURIComponent(track.key)}&mode=${encodeURIComponent(mode)}`);
  async function del(p: Project) {
    if (!confirm(`¿Borrar el edit «${p.name}»?`)) return;
    await removeFile(`${dir()}/${p.id}.json`);
    await load();
  }
  const renders = $derived(store.jobs.filter((j) => j.action === "render" && j.key === track.key).sort((a, b) => b.created - a.created));
  const fmtDate = (ms: number) => new Date(ms).toLocaleString("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const clip = (p: Project) => `${Math.round((p.end - p.start) / (p.rate || 1))} s`;
  const audioJob = $derived(jobOf(track.key, ["audio", "import"]));
  const modes = $derived([
    { value: "auto", label: "Automático", title: "Reglas locales: plantilla según bpm y energía" },
    ...(ai ? [{ value: "ai", label: "IA", icon: "sparkle" as const, title: "Claude dirige plantilla, colores y cortes" }] : []),
    ...presets.map((p) => ({ value: p.id, label: p.name })),
  ]);
</script>

<div class="edits">
  <div class="grid">
    <div class="tile new">
      <span class="poster add"><Icon name="edits" size={28} /></span>
      {#if !track.audio}
        {#if audioJob && audioJob.status !== "error"}
          <span class="job"><ProgressRing value={null} size={14} />{jobText(audioJob)}</span>
        {:else}
          <Button variant="primary" size="sm" icon="download" title="Un edit necesita el audio" onclick={() => enqueue("audio", [track.key])}>Descargar audio</Button>
        {/if}
      {:else}
        <Tabs size="sm" options={modes} bind:value={mode} label="Cómo se monta" />
        <Button variant="primary" size="sm" icon="plus" disabled={!detail?.doc} title={detail?.doc ? "Vídeo vertical con la letra, al ritmo" : "Primero la letra"} onclick={create}>Nuevo edit</Button>
      {/if}
    </div>
    {#each projects as p, i (p.id)}
      <article class="tile" style:--d="{i * 30}ms">
        <button type="button" class="open" onclick={() => go(`project=${encodeURIComponent(p.id)}`)}>
          <span class="poster"><Icon name="edits" size={20} /><i>{p.style?.template ?? "edit"}</i></span>
          <strong>{p.name}</strong>
          <small class="num">{clip(p)} · {fmtDate(p.updated)}</small>
        </button>
        <span class="del"><IconButton icon="trash" label="Borrar" size="sm" onclick={() => del(p)} /></span>
      </article>
    {/each}
  </div>
  {#if loaded && !projects.length}<p class="none">Ninguno todavía.</p>{/if}

  {#if renders.length}
    <section class="renders">
      <div class="rhead"><Icon name="download" size={14} /><span>Exportados</span><IconButton icon="folder" label="Carpeta de vídeos" size="sm" onclick={() => openPath(`${paths.edits}/renders`)} /></div>
      {#each renders as j (j.id)}
        <div class="render">
          <span class="rt">{j.title}</span>
          {#if j.status === "done"}
            <Button size="sm" variant="ghost" icon="edits" onclick={() => openPath(j.result?.path)}>Abrir MP4</Button>
          {:else if j.status === "error"}
            <span class="err" title={j.error}><Icon name="alert" size={14} />{j.error}</span>
          {:else}
            <span class="job"><ProgressRing value={j.pct != null && j.status === "running" ? j.pct / 100 : null} size={14} />{jobText(j)}</span>
          {/if}
        </div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .edits { display: flex; flex-direction: column; gap: var(--s5); padding: var(--s2) 0 var(--s5); }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: var(--s4); }
  .tile { position: relative; display: flex; flex-direction: column; gap: var(--s2); min-width: 0; animation: rise var(--t-slow) var(--ease) backwards; animation-delay: var(--d, 0ms); }
  .new { align-items: stretch; }
  .new :global(.tabs-ui) { flex-wrap: wrap; }
  .open { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 0; border: 0; background: none; text-align: left; min-width: 0; }
  .poster {
    aspect-ratio: 9 / 14; border-radius: var(--r-lg); display: flex; flex-direction: column; justify-content: space-between; padding: var(--s3);
    background: var(--panel); border: 1px solid var(--line); color: var(--text-3); transition: border-color var(--t-fast); margin-bottom: var(--s1);
  }
  .poster i { font-style: normal; font-size: var(--fs-md); color: var(--text-2); }
  .poster.add { align-items: center; justify-content: center; border-style: dashed; aspect-ratio: auto; height: 120px; }
  .open:hover .poster { border-color: var(--line-hi); }
  .open strong { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .open small { color: var(--text-3); font-size: var(--fs-xs); }
  .del { position: absolute; top: var(--s2); right: var(--s2); opacity: 0; transition: opacity var(--t-fast); }
  .tile:hover .del, .del:focus-within { opacity: 1; }
  .none { color: var(--text-3); font-size: var(--fs-sm); }
  .renders { display: flex; flex-direction: column; }
  .rhead { display: flex; align-items: center; gap: var(--s2); color: var(--text-2); font-size: var(--fs-sm); margin-bottom: var(--s1); }
  .render { display: flex; justify-content: space-between; align-items: center; gap: var(--s3); padding: var(--s2) 0; border-bottom: 1px solid var(--line); font-size: var(--fs-sm); }
  .rt { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .job { display: inline-flex; align-items: center; gap: var(--s2); color: var(--text-2); font-size: var(--fs-sm); }
  .err { display: inline-flex; align-items: center; gap: 4px; color: var(--bad); max-width: 50%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
