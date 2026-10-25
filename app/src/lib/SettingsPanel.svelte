<script lang="ts">
  import { enqueue, gpuName, paths, prefetchNow, readBytes, run, settingsPath, writeBytes, writeJson } from "./engine";
  import { engineErr, LANGS, t } from "./i18n.svelte";
  import { settings } from "./settings.svelte";
  import { refresh, store } from "./store.svelte";
  import Button from "./ui/Button.svelte";
  import Dialog from "./ui/Dialog.svelte";
  import Field from "./ui/Field.svelte";
  import Icon from "./ui/Icon.svelte";
  import Slider from "./ui/Slider.svelte";
  import Tabs from "./ui/Tabs.svelte";
  import Textarea from "./ui/Textarea.svelte";
  import Toggle from "./ui/Toggle.svelte";

  let { open = $bindable(), onopen }: { open: boolean; onopen: (key: string) => void } = $props();

  type Tab = "general" | "musica" | "ia" | "spotify";
  let tab = $state<Tab>("general");

  const file = () => `${paths.letras}/playlists.txt`;
  let playlists = $state("");
  let saved = $state("");
  let msg = $state("");
  let gpu = $state("");

  $effect(() => {
    if (!open) return;
    readBytes(file()).then(
      (b) => (playlists = saved = new TextDecoder().decode(b)),
      () => (playlists = saved = ""),
    );
    gpuName().then((g) => (gpu = g), () => (gpu = ""));
  });

  async function save() {
    await writeBytes(file(), new TextEncoder().encode(playlists.trim() + "\n"));
    saved = playlists;
    msg = t("Guardadas");
  }
  async function now() {
    if (playlists !== saved) await save();
    msg = "";
    try {
      await prefetchNow();
      msg = t("Prefetch en marcha, en segundo plano");
    } catch (e) {
      msg = t("No arranca el timer: {e}", { e: String(e) });
    }
  }
  let remoteMsg = $state("");
  async function remoteSongs() {
    await writeJson(settingsPath(), $state.snapshot(settings)); // el motor lee la dirección de ahí
    return (await run<{ songs: Record<string, unknown> }>("remote_list", [])).songs;
  }
  async function test() {
    remoteMsg = t("Probando…");
    try {
      const n = Object.keys(await remoteSongs()).length;
      remoteMsg = t(n === 1 ? "Conectado · {n} canción allí" : "Conectado · {n} canciones allí", { n });
    } catch (e) {
      remoteMsg = engineErr(String(e));
    }
  }
  async function syncAll() {
    try {
      const keys = [...new Set([...store.tracks.map((t) => t.key), ...Object.keys(await remoteSongs())])];
      await enqueue("remote", keys);
      remoteMsg = t("En la cola: {n} canciones", { n: keys.length });
    } catch (e) {
      remoteMsg = engineErr(String(e));
    }
  }
  const failed = $derived(store.tracks.filter((t) => t.failed));
  async function retry(keys: string[]) {
    await run("unfail", keys);
    refresh(true);
  }

  let aiMsg = $state("");
  async function aiTest() {
    aiMsg = t("Probando…");
    try {
      const r = await run<{ reply: string }>("ai_test", []);
      aiMsg = t("Responde: {reply}", { reply: r.reply });
    } catch (e) {
      aiMsg = engineErr(String(e));
    }
  }
</script>

<Dialog bind:open title={t("Ajustes")} width={620}>
  <div class="sets">
    <Tabs variant="underline" label={t("Ajustes")} bind:value={tab} options={[
      { value: "general", label: t("General") },
      { value: "musica", label: t("Música") },
      { value: "ia", label: t("IA") },
      { value: "spotify", label: "Spotify" },
    ]} />

    {#if tab === "general"}
      <section>
        <div class="row">
          <span class="lbl">{t("Idioma")}</span>
          <div class="ctl"><Tabs size="sm" label={t("Idioma")} bind:value={settings.lang} options={LANGS} /></div>
        </div>
      </section>

      <section>
        <h3>{t("Reproducción")}</h3>
        <div class="row">
          <span class="lbl">{t("Volumen general")}</span>
          <div class="ctl"><Slider bind:value={settings.masterVolume} label={t("Volumen general")} /></div>
        </div>
        <div class="row">
          <span class="lbl">{t("Velocidad del piano roll")}<small>{t("ventana en segundos")}</small></span>
          <div class="ctl"><Slider bind:value={settings.rollSpeed} min={1} max={6} step={0.5} label={t("Ventana del piano roll")} /></div>
        </div>
        <Toggle bind:checked={settings.scoreFollow}>{t("La partitura sigue la música")}</Toggle>
        <Toggle bind:checked={settings.showMini}>{t("Mezclador pequeño en la canción")}</Toggle>
      </section>
    {:else if tab === "musica"}
      <section>
        <h3>{t("Aprender")}</h3>
        <div class="row">
          <span class="lbl">{t("Latencia teclado a oído")}<small>{t("ms que se restan al juzgar el tiempo")}</small></span>
          <div class="ctl narrow">
            <Field label="ms" type="number" min="0" max="300" step="5" value={String(settings.latencyMs)} oninput={(e) => (settings.latencyMs = Math.max(0, Math.round(+e.currentTarget.value || 0)))} />
          </div>
        </div>
      </section>

      <section>
        <h3>{t("Análisis")}</h3>
        <div class="row">
          <span class="lbl">{t("Notas por defecto")}</span>
          <Tabs size="sm" label={t("Notas por defecto")} bind:value={settings.notes} options={[{ value: "fast", label: t("Rápidas"), title: t("basic-pitch · CPU, segundos por pista") }, { value: "precise", label: t("Precisas"), title: t("MuScriptor · GPU, minutos por pista, mucho mejor en guitarra y piano") }]} />
        </div>
        {#if settings.notes === "precise"}
          <p class="note">
            {t("MuScriptor pide aceptar su licencia (no comercial) en")}
            <a href="https://huggingface.co/MuScriptor/muscriptor-medium" target="_blank" rel="noreferrer">Hugging Face</a>
            {t("y, una vez:")}
            <code>~/Projects/estudio/engine/.venv/bin/hf auth login</code>
          </p>
        {/if}
        {#if gpu}<p class="note gpu"><Icon name="gpu" size={14} /> {gpu}</p>{/if}
      </section>

      <section>
        <h3>{t("Servidor")}</h3>
        <Field label={t("Dirección")} type="url" placeholder="http://127.0.0.1:8765" spellcheck="false" bind:value={settings.remote} />
        <Field label={t("Token")} type="password" placeholder={t("si el servidor lo pide")} bind:value={settings.remoteToken} />
        <div class="acts">
          <Button size="sm" icon="link" disabled={!settings.remote} onclick={test}>{t("Probar")}</Button>
          <Button size="sm" icon="cloud" disabled={!settings.remote} onclick={syncAll}>{t("Sincronizar todo")}</Button>
          {#if remoteMsg}<span class="note">{remoteMsg}</span>{/if}
        </div>
        <p class="note">{t("Lo procesado se guarda allí y otro ordenador lo baja en vez de rehacerlo.")} <code>python3 server/server.py</code></p>
      </section>
    {:else if tab === "ia"}
      <section>
        <h3>{t("IA · LLM")}</h3>
        <Field label={t("Dirección de la API")} type="url" placeholder="https://api.deepseek.com/v1" spellcheck="false" bind:value={settings.ai.url} />
        <Field label={t("Modelo")} placeholder="deepseek-chat" spellcheck="false" bind:value={settings.ai.model} />
        <Field label={t("API key")} type="password" placeholder={t("si la API la pide")} bind:value={settings.ai.key} />
        <div class="acts">
          <Button size="sm" icon="sparkle" disabled={!settings.ai.url || !settings.ai.model} onclick={aiTest}>{t("Probar")}</Button>
          {#if aiMsg}<span class="note">{aiMsg}</span>{/if}
        </div>
        <p class="note">{t("Cualquier API compatible con OpenAI (DeepSeek, Kimi, GLM, OpenRouter, Ollama en local…). La usa la reseña de la partitura embellecida.")}</p>
      </section>
    {:else}
      <section>
        <Toggle bind:checked={settings.spotify}>{t("Sincronizar la letra de lo que suena en Spotify")}</Toggle>
      </section>

      <section>
        <h3>{t("Playlists de Spotify")}</h3>
        <Textarea label={t("Una URL pública por línea")} rows={4} placeholder="https://open.spotify.com/playlist/…" bind:value={playlists} />
        <div class="acts">
          <Button size="sm" disabled={playlists === saved} onclick={save}>{t("Guardar")}</Button>
          <Button size="sm" icon="retry" onclick={now}>{t("Procesar ahora")}</Button>
          {#if msg}<span class="note">{msg}</span>{/if}
        </div>
        <p class="note">{t("Cada 6 h se sincronizan con IA en segundo plano.")}</p>
      </section>

      {#if failed.length}
        <section>
          <h3>{t("Fallaron en el prefetch · {n}", { n: failed.length })}</h3>
          {#each failed as t2 (t2.key)}
            <div class="row">
              <Button variant="ghost" size="sm" onclick={() => ((open = false), onopen(t2.key))}>{t2.title} · {t2.artist}</Button>
              <Button size="sm" icon="retry" onclick={() => retry([t2.key])}>{t("Reintentar")}</Button>
            </div>
          {/each}
          <Button size="sm" icon="retry" onclick={() => retry(failed.map((t2) => t2.key))}>{t("Reintentar todas")}</Button>
        </section>
      {/if}
    {/if}
  </div>
</Dialog>

<style>
  .sets { display: flex; flex-direction: column; }
  .sets :global(.tabs-ui) { margin-bottom: var(--s2); }
  section { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s4) 0; border-top: 1px solid var(--line); align-items: flex-start; }
  section:first-of-type { border-top: 0; padding-top: var(--s2); }
  section > :global(.field) { align-self: stretch; }
  h3 { color: var(--text-2); font-size: var(--fs-sm); font-weight: 500; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: var(--s4); align-self: stretch; min-width: 0; }
  .lbl { display: flex; flex-direction: column; gap: 2px; min-width: 0; font-size: var(--fs-md); }
  .lbl small { color: var(--text-3); font-size: var(--fs-xs); }
  .ctl { width: 220px; flex-shrink: 0; }
  .ctl.narrow { width: 100px; }
  .acts { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s2); }
  .note { font-size: var(--fs-sm); color: var(--text-3); }
  .note a { color: var(--text-2); }
  .gpu { display: flex; align-items: center; gap: var(--s2); }
  code { font-family: var(--mono); font-size: var(--fs-xs); color: var(--text-2); word-break: break-all; }
</style>
