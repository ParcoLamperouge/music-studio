<script lang="ts">
  import { openPath } from "@tauri-apps/plugin-opener";
  import { enqueue, hasDirector, listDir, paths, readJson, removeFile, type Detail, type Track } from "./engine";
  import { jobOf, jobText, store } from "./store.svelte";

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
</script>

<div class="edits">
  <section class="card new">
    <div>
      <span class="kicker">Nuevo edit</span>
      <h2>Vídeo vertical con la letra, al ritmo</h2>
      <p>
        Estribillo, plantilla según bpm y energía, palabras largas destacadas. Usa la letra palabra a palabra de aquí
        {track.stems === "complete" ? "y la batería separada para los golpes." : "y los pulsos del audio (con pistas, la batería afina los golpes)."}
      </p>
    </div>
    {#if !track.audio}
      <div class="need">
        <p>Necesita el audio.</p>
        {#if audioJob && audioJob.status !== "error"}
          <span class="muted">{jobText(audioJob)}</span>
        {:else}
          <button class="primary" onclick={() => enqueue("audio", [track.key])}>Descargar audio</button>
        {/if}
      </div>
    {:else}
      <div class="modes">
        <div class="seg">
          <button class:on={mode === "auto"} onclick={() => (mode = "auto")} title="Reglas locales">Automático</button>
          <button class:on={mode === "ai"} disabled={!ai} onclick={() => (mode = "ai")} title={ai ? "Claude dirige plantilla, colores y cortes" : "Arranca con ANTHROPIC_API_KEY para usarlo"}>✨ IA</button>
          {#each presets as p (p.id)}
            <button class:on={mode === p.id} onclick={() => (mode = p.id)}>{p.name}</button>
          {/each}
        </div>
        <button class="primary" disabled={!detail?.doc} onclick={create} title={detail?.doc ? "" : "Primero la letra"}>Crear edit</button>
      </div>
    {/if}
  </section>

  <section>
    <div class="head">
      <span class="kicker">Edits de esta canción</span>
      <button class="link" onclick={() => openPath(`${paths.edits}/renders`)}>Carpeta de vídeos</button>
    </div>
    {#if loaded && !projects.length}
      <p class="muted">Ninguno todavía.</p>
    {/if}
    <div class="grid">
      {#each projects as p, i (p.id)}
        <article style:--d="{i * 40}ms">
          <button class="open" onclick={() => go(`project=${encodeURIComponent(p.id)}`)}>
            <span class="poster"><i>{p.style?.template ?? "edit"}</i></span>
            <strong>{p.name}</strong>
            <small class="mono">{clip(p)} · {fmtDate(p.updated)}</small>
          </button>
          <button class="icon-btn sm del" onclick={() => del(p)} title="Borrar">
            <svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V5h4v2m-7 0 1 12h8l1-12" /></svg>
          </button>
        </article>
      {/each}
    </div>
  </section>

  {#if renders.length}
    <section>
      <span class="kicker">Exportados en esta sesión</span>
      {#each renders as j (j.id)}
        <div class="render">
          <span>{j.title}</span>
          {#if j.status === "done"}
            <button class="link" onclick={() => openPath(j.result?.path)}>Abrir MP4</button>
          {:else if j.status === "error"}
            <span class="error-text">{j.error}</span>
          {:else}
            <span class="muted">{jobText(j)}</span>
          {/if}
        </div>
      {/each}
    </section>
  {/if}
</div>

<style>
  .edits { display: flex; flex-direction: column; gap: 20px; padding-bottom: 20px; }
  .new { display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; padding: 16px; }
  h2 { margin: 4px 0 6px; }
  .new p { margin: 0; color: var(--text-3); font-size: 12px; max-width: 560px; }
  .modes { display: flex; flex-direction: column; align-items: flex-end; gap: 10px; }
  .modes .seg { align-self: flex-end; flex-wrap: wrap; }
  .need { text-align: right; }
  .need p { margin: 0 0 8px; }
  .head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; font-size: 12px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
  article { position: relative; }
  .open { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 0; border: 0; background: none; text-align: left; }
  .poster {
    aspect-ratio: 9 / 14; border-radius: var(--radius); display: grid; place-items: end start; padding: 10px; margin-bottom: 6px;
    background: var(--panel); border: 1px solid var(--line); transition: border-color 0.15s;
  }
  .poster i { font-style: normal; font-size: 13px; color: var(--text-2); }
  .open:hover .poster { border-color: var(--accent); }
  .open strong { font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .open small { color: var(--text-3); font-size: 11px; }
  .del { position: absolute; top: 6px; right: 6px; opacity: 0; background: #0009; }
  article:hover .del { opacity: 1; }
  .render { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 12.5px; }
</style>
