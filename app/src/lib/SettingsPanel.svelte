<script lang="ts">
  import { enqueue, paths, prefetchNow, readBytes, run, settingsPath, writeBytes, writeJson } from "./engine";
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
  let remoteMsg = $state("");
  async function remoteSongs() {
    await writeJson(settingsPath(), $state.snapshot(settings)); // el motor lee la dirección de ahí
    return (await run<{ songs: Record<string, unknown> }>("remote_list", [])).songs;
  }
  async function test() {
    remoteMsg = "Probando…";
    try {
      const n = Object.keys(await remoteSongs()).length;
      remoteMsg = `Conectado · ${n} canci${n === 1 ? "ón" : "ones"} allí`;
    } catch (e) {
      remoteMsg = `${e}`;
    }
  }
  async function syncAll() {
    try {
      const keys = [...new Set([...store.tracks.map((t) => t.key), ...Object.keys(await remoteSongs())])];
      await enqueue("remote", keys);
      remoteMsg = `En la cola: ${keys.length} canciones`;
    } catch (e) {
      remoteMsg = `${e}`;
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
  <aside class="drawer panel">
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
      <h3>Servidor</h3>
      <p class="hint">
        Lo ya procesado (audio, pistas, Whisper, acordes, notas, letra y edits) se guarda allí, y en otro ordenador se baja
        en vez de volver a sacarlo. Si las dos copias cambiaron, gana la más nueva. Se arranca con
        <code>python3 server/server.py</code> desde el repo (variables PORT y ESTUDIO_TOKEN).
      </p>
      <input type="url" placeholder="http://127.0.0.1:8765" bind:value={settings.remote} spellcheck="false" />
      <input type="password" placeholder="Token (si el servidor lo pide)" bind:value={settings.remoteToken} />
      <div class="actions">
        <button class="ghost" disabled={!settings.remote} onclick={test}>Probar</button>
        <button class="primary" disabled={!settings.remote} onclick={syncAll}>Sincronizar todo</button>
        {#if remoteMsg}<span class="muted">{remoteMsg}</span>{/if}
      </div>
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
            <button class="ghost sm" onclick={() => retry([t.key])}>Reintentar</button>
          </div>
        {/each}
        <button class="ghost" onclick={() => retry(failed.map((t) => t.key))}>Reintentar todas</button>
      </section>
    {/if}
  </aside>
{/if}

<style>
  .panel { width: min(480px, 100vw); overflow-y: auto; padding: 0 18px 24px; }
  header { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px 0 6px; }
  h2 { margin-top: 2px; }
  section { padding: 14px 0; border-top: 1px solid var(--line); display: flex; flex-direction: column; gap: 8px; }
  section > .seg { align-self: flex-start; }
  .row { display: flex; gap: 10px; align-items: flex-start; color: var(--text-2); font-size: 12.5px; }
  .row input { margin-top: 3px; }
  .hint a { color: var(--accent); }
  code { font-family: var(--mono); font-size: 11.5px; color: var(--text-2); word-break: break-all; }
  input[type="url"], input[type="password"], textarea { width: 100%; font-size: 12px; }
  textarea { resize: vertical; }
  .actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .actions .muted { font-size: 12px; }
  .failed { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .failed .link { text-decoration: none; color: var(--text); text-align: left; }
</style>
