<script lang="ts">
  import { paths, prefetchNow, readBytes, run, writeBytes } from "./engine";
  import { settings } from "./settings.svelte";
  import { refresh, store } from "./store.svelte";

  let { open = $bindable(), onopen }: { open: boolean; onopen: (key: string) => void } = $props();

  const file = () => `${paths.letras}/playlists.txt`;
  let playlists = $state("");
  let saved = $state("");
  let msg = $state("");

  $effect(() => {
    if (!open) return;
    readBytes(file()).then(
      (b) => (playlists = saved = new TextDecoder().decode(b)),
      () => (playlists = saved = ""),
    );
  });

  async function save() {
    await writeBytes(file(), new TextEncoder().encode(playlists.trim() + "\n"));
    saved = playlists;
    msg = "Guardadas";
  }
  async function now() {
    if (playlists !== saved) await save();
    msg = "";
    try {
      await prefetchNow();
      msg = "Prefetch en marcha (en segundo plano; la cola de aquí espera a la GPU si hace falta)";
    } catch (e) {
      msg = `No arranca el timer: ${e}`;
    }
  }
  const failed = $derived(store.tracks.filter((t) => t.failed));
  async function retry(keys: string[]) {
    await run("unfail", keys);
    refresh(true);
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && open && (open = false)} />

{#if open}
  <button class="scrim" onclick={() => (open = false)} aria-label="Cerrar ajustes"></button>
  <aside class="panel">
    <header>
      <div><span class="kicker">Estudio</span><h2>Ajustes</h2></div>
      <button class="icon-btn" onclick={() => (open = false)} aria-label="Cerrar (Esc)"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg></button>
    </header>

    <section>
      <h3>Spotify</h3>
      <label class="row">
        <input type="checkbox" bind:checked={settings.spotify} />
        <span>Lo que suena se busca y, si su letra no trae tiempos, se sincroniza solo (primero en la cola). El escritorio la enseña al momento.</span>
      </label>
    </section>

    <section>
      <h3>Notas por defecto</h3>
      <div class="seg">
        <button class:on={settings.notes === "fast"} onclick={() => (settings.notes = "fast")}>Rápidas · basic-pitch</button>
        <button class:on={settings.notes === "precise"} onclick={() => (settings.notes = "precise")}>Precisas · MuScriptor</button>
      </div>
      <p class="hint">
        Rápidas: CPU, segundos por pista. Precisas: GPU, minutos por pista y mucho mejores (sobre todo guitarra y piano).
        MuScriptor pide aceptar su licencia (no comercial) en
        <a href="https://huggingface.co/MuScriptor/muscriptor-medium" target="_blank">Hugging Face</a> y, una vez, en una terminal:
        <code>~/Projects/estudio/engine/.venv/bin/hf auth login</code>
      </p>
    </section>

    <section>
      <h3>Playlists de Spotify</h3>
      <p class="hint">Una URL por línea (públicas). Cada 6 h se sincronizan sus canciones con IA en segundo plano; con un juego abierto espera.</p>
      <textarea bind:value={playlists} rows="5" placeholder="https://open.spotify.com/playlist/…"></textarea>
      <div class="actions">
        <button class="ghost" disabled={playlists === saved} onclick={save}>Guardar</button>
        <button class="primary" onclick={now}>Procesar ahora</button>
        {#if msg}<span class="muted">{msg}</span>{/if}
      </div>
    </section>

    {#if failed.length}
      <section>
        <h3>Fallaron en el prefetch · {failed.length}</h3>
        {#each failed as t (t.key)}
          <div class="failed">
            <button class="link" onclick={() => ((open = false), onopen(t.key))}>{t.title} <span class="muted">· {t.artist}</span></button>
            <button class="ghost" onclick={() => retry([t.key])}>Reintentar</button>
          </div>
        {/each}
        <button class="ghost" onclick={() => retry(failed.map((t) => t.key))}>Reintentar todas</button>
      </section>
    {/if}
  </aside>
{/if}

<style>
  .scrim { position: fixed; inset: 0; background: #0006; border: 0; z-index: 40; backdrop-filter: blur(2px); }
  .panel {
    position: fixed; top: 0; right: 0; bottom: 0; width: min(480px, 100vw); z-index: 41; overflow-y: auto; padding: 0 22px 30px;
    background: var(--sidebar); border-left: 1px solid var(--line); box-shadow: -30px 0 60px -20px #000c; animation: slide 0.3s var(--ease);
  }
  @keyframes slide { from { transform: translateX(30px); opacity: 0; } }
  header { display: flex; justify-content: space-between; align-items: flex-start; padding: 20px 0 6px; }
  h2 { margin: 2px 0 0; font-family: var(--serif); font-weight: 400; font-size: 30px; }
  section { padding: 16px 0; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 10px; }
  h3 { margin: 0; font-size: 13px; font-weight: 600; letter-spacing: 0.02em; }
  .row { display: flex; gap: 10px; align-items: flex-start; color: var(--text-2); font-size: 13px; }
  .row input { margin-top: 3px; }
  .hint { margin: 0; color: var(--text-3); font-size: 12.5px; }
  .hint a { color: var(--accent); }
  code { font-family: var(--mono); font-size: 11.5px; color: var(--text-2); word-break: break-all; }
  textarea { width: 100%; resize: vertical; font-family: var(--mono); font-size: 12px; }
  .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .actions .muted { font-size: 12px; }
  .seg { display: flex; border: 1px solid var(--line); border-radius: 9px; overflow: hidden; align-self: flex-start; }
  .seg button { padding: 6px 11px; border: 0; background: transparent; color: var(--text-2); font-size: 12.5px; }
  .seg button + button { border-left: 1px solid var(--line); }
  .seg button.on { background: var(--accent-soft); color: var(--text); }
  .failed { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .failed .link { text-decoration: none; color: var(--text); text-align: left; }
  .failed .ghost { padding: 4px 10px; font-size: 12px; }
</style>
