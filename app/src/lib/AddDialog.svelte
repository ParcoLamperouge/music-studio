<script lang="ts" module>
  /** Qué hacer con lo añadido: se guarda para la próxima vez (también para arrastrar ficheros). */
  export type After = { letra: boolean; separate: boolean; notes: boolean };
  export function loadAfter(): After {
    try {
      return { letra: true, separate: false, notes: false, ...JSON.parse(localStorage.getItem("estudio.after") ?? "{}") };
    } catch {
      return { letra: true, separate: false, notes: false };
    }
  }
  /** Las acciones que encolar tras añadir. «Notas» ya incluye pistas y letra («todo»). */
  export const thenOf = (a: After): string[][] => (a.notes ? [["todo"]] : [...(a.letra ? [["letra"]] : []), ...(a.separate ? [["separate"]] : [])]);
</script>

<script lang="ts">
  import { open as pickFiles } from "@tauri-apps/plugin-dialog";
  import { enqueue, importSources, run } from "./engine";

  let { open = $bindable(), onadded }: { open: boolean; onadded: (key?: string) => void } = $props();

  type Result = { url: string; title: string; channel: string; duration: number | null; thumbnail: string | null };
  const MEDIA = ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac", "aiff", "wma", "webm", "mp4", "mkv", "mov"];

  let mode = $state<"name" | "youtube" | "file">("name");
  let artist = $state("");
  let title = $state("");
  let query = $state("");
  let results = $state<Result[]>([]);
  let picked = $state<string[]>([]);
  let searching = $state(false);
  let error = $state("");
  let after = $state(loadAfter());
  let first: HTMLInputElement | undefined = $state();

  $effect(() => {
    try {
      localStorage.setItem("estudio.after", JSON.stringify(after));
    } catch {}
  });
  $effect(() => {
    if (open) queueMicrotask(() => first?.focus());
  });

  function close() {
    open = false;
    error = "";
  }

  async function addByName(e: Event) {
    e.preventDefault();
    if (!artist.trim() || !title.trim()) return;
    try {
      const { key } = await run<{ key: string }>("add", [artist, title]);
      // por nombre: la letra siempre (es lo que lo identifica); el audio sale de YouTube
      const then = thenOf(after);
      if (!then.length) await enqueue("letra", [key]);
      for (const [action] of then) await enqueue(action, [key]);
      artist = title = "";
      close();
      onadded(key);
    } catch (err) {
      error = String(err);
    }
  }

  async function search(e: Event) {
    e.preventDefault();
    if (!query.trim()) return;
    searching = true;
    error = "";
    try {
      results = (await run<{ results: Result[] }>("search", [query.trim()])).results;
      picked = results.length === 1 ? [results[0].url] : [];
    } catch (err) {
      error = String(err);
    } finally {
      searching = false;
    }
  }

  async function importPicked() {
    await importSources(picked, thenOf(after));
    picked = [];
    close();
    onadded();
  }

  async function chooseFiles() {
    const files = await pickFiles({ multiple: true, filters: [{ name: "Audio o vídeo", extensions: MEDIA }] });
    if (!files?.length) return;
    await importSources(files, thenOf(after));
    close();
    onadded();
  }

  const dur = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && open && close()} />

{#if open}
  <div class="backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && close()}>
    <div class="dialog" role="dialog" aria-modal="true" aria-label="Añadir canciones">
      <header>
        <h2>Añadir canciones</h2>
        <button class="icon-btn" onclick={close} aria-label="Cerrar"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
      </header>

      <nav class="modes">
        <button class:on={mode === "name"} onclick={() => (mode = "name")}>Por nombre</button>
        <button class:on={mode === "youtube"} onclick={() => (mode = "youtube")}>YouTube o enlace</button>
        <button class:on={mode === "file"} onclick={() => (mode = "file")}>Ficheros</button>
      </nav>

      <div class="body">
        {#if mode === "name"}
          <form onsubmit={addByName}>
            <p class="hint">Busca la letra (LRCLIB, Genius…) y el audio en YouTube, como Letras.</p>
            <div class="two">
              <label>Artista<input bind:this={first} bind:value={artist} placeholder="Stela Cole" /></label>
              <label>Canción<input bind:value={title} placeholder="Stereoqueen" /></label>
            </div>
            <button class="primary" disabled={!artist.trim() || !title.trim()}>Añadir</button>
          </form>
        {:else if mode === "youtube"}
          <form class="row" onsubmit={search}>
            <input bind:this={first} bind:value={query} placeholder="Busca o pega un enlace (YouTube, SoundCloud, Bandcamp…)" />
            <button class="ghost" disabled={searching}>{searching ? "Buscando…" : "Buscar"}</button>
          </form>
          <div class="results">
            {#each results as r (r.url)}
              {@const on = picked.includes(r.url)}
              <button class="result" class:on onclick={() => (picked = on ? picked.filter((u) => u !== r.url) : [...picked, r.url])}>
                {#if r.thumbnail}<img src={r.thumbnail} alt="" loading="lazy" />{:else}<span class="thumb"></span>{/if}
                <span class="r-title">{r.title}</span>
                <span class="r-meta">{r.channel}{r.duration ? ` · ${dur(r.duration)}` : ""}</span>
                <span class="check">{on ? "✓" : ""}</span>
              </button>
            {:else}
              {#if searching}<div class="loading"><span class="spinner"></span> Buscando en YouTube…</div>{/if}
            {/each}
          </div>
          {#if results.length}
            <button class="primary" disabled={!picked.length} onclick={importPicked}>Importar {picked.length || ""}</button>
          {/if}
        {:else}
          <div class="drop">
            <p>Arrastra audio o vídeo a cualquier parte de la ventana,</p>
            <button class="primary" onclick={chooseFiles}>o elige ficheros</button>
            <small>Artista y título salen de las etiquetas o de «Artista - Título.mp3».</small>
          </div>
        {/if}
        {#if error}<p class="error-text">{error}</p>{/if}
      </div>

      <footer>
        <span class="kicker">Después</span>
        <label><input type="checkbox" bind:checked={after.letra} disabled={after.notes} /> Letra palabra a palabra</label>
        <label><input type="checkbox" bind:checked={after.separate} disabled={after.notes} /> Separar pistas</label>
        <label title="Pistas, letra y notas de cada instrumento, en el orden que menos GPU gasta"><input type="checkbox" bind:checked={after.notes} /> Todo (con partitura)</label>
      </footer>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; z-index: 60; display: grid; place-items: center; background: #0008; backdrop-filter: blur(4px); animation: fade 0.2s; }
  @keyframes fade { from { opacity: 0; } }
  .dialog {
    width: min(640px, calc(100vw - 32px)); max-height: calc(100vh - 60px); display: flex; flex-direction: column;
    background: var(--sidebar); border: 1px solid var(--line-hi); border-radius: 18px; box-shadow: 0 40px 100px -20px #000;
    animation: rise 0.3s var(--ease);
  }
  header { display: flex; justify-content: space-between; align-items: center; padding: 20px 22px 8px; }
  h2 { margin: 0; font-family: var(--serif); font-weight: 400; font-size: 32px; }
  .modes { display: flex; gap: 4px; padding: 0 22px; border-bottom: 1px solid var(--line); }
  .modes button { padding: 10px 12px; border: 0; border-bottom: 2px solid transparent; background: none; color: var(--text-2); margin-bottom: -1px; }
  .modes button.on { color: var(--text); border-bottom-color: var(--accent); }
  .body { padding: 18px 22px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; min-height: 180px; }
  .hint { margin: 0 0 12px; color: var(--text-2); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
  label { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text-2); }
  .row { display: flex; gap: 8px; }
  .row input { flex: 1; }
  .results { display: flex; flex-direction: column; gap: 4px; max-height: 340px; overflow-y: auto; }
  .result {
    display: grid; grid-template-columns: 88px 1fr 20px; grid-template-rows: auto auto; column-gap: 12px; align-items: center;
    padding: 6px; border-radius: 10px; border: 1px solid transparent; background: none; text-align: left;
  }
  .result:hover { background: var(--panel); }
  .result.on { border-color: color-mix(in srgb, var(--accent) 55%, transparent); background: var(--accent-soft); }
  .result img, .thumb { grid-row: 1 / 3; width: 88px; height: 50px; object-fit: cover; border-radius: 6px; background: var(--panel-hi); }
  .r-title { font-weight: 560; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .r-meta { grid-column: 2; color: var(--text-3); font-size: 12px; }
  .check { grid-row: 1 / 3; grid-column: 3; color: var(--accent); font-weight: 700; }
  .loading { display: flex; gap: 10px; align-items: center; color: var(--text-2); padding: 20px 4px; }
  .drop {
    display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 34px 20px; text-align: center;
    border: 1.5px dashed var(--line-hi); border-radius: 14px; color: var(--text-2);
  }
  .drop p { margin: 0; }
  .drop small { color: var(--text-3); }
  footer { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; padding: 14px 22px 18px; border-top: 1px solid var(--line); }
  footer label { flex-direction: row; align-items: center; gap: 6px; font-size: 13px; color: var(--text); }
  form > .primary, .body > .primary { align-self: flex-start; }
</style>
