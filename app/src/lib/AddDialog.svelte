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
  /** Las acciones que encolar tras añadir. «Todo» ya incluye pistas y letra. */
  export const thenOf = (a: After): string[][] => (a.notes ? [["todo"]] : [...(a.letra ? [["letra"]] : []), ...(a.separate ? [["separate"]] : [])]);
  /** ¿Es un enlace (YouTube, SoundCloud, Bandcamp…) y no una búsqueda? */
  export const isUrl = (s: string) => /^(https?:\/\/|www\.)\S+$/i.test(s.trim());
</script>

<script lang="ts">
  import { open as pickFiles } from "@tauri-apps/plugin-dialog";
  import { enqueue, fmtClock, importSources, run } from "./engine";
  import { t } from "./i18n.svelte";
  import Button from "./ui/Button.svelte";
  import Dialog from "./ui/Dialog.svelte";
  import Field from "./ui/Field.svelte";
  import Icon from "./ui/Icon.svelte";
  import Search from "./ui/Search.svelte";
  import Tabs from "./ui/Tabs.svelte";
  import Toggle from "./ui/Toggle.svelte";

  let { open = $bindable(), onadded }: { open: boolean; onadded: (key?: string) => void } = $props();

  type Result = { url: string; title: string; channel: string; duration: number | null; thumbnail: string | null };
  const MEDIA = ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac", "aiff", "wma", "webm", "mp4", "mkv", "mov"];

  let mode = $state<"link" | "name" | "file">("link");
  let artist = $state("");
  let title = $state("");
  let query = $state("");
  let results = $state<Result[]>([]);
  let picked = $state<string[]>([]);
  let searching = $state(false);
  let busy = $state(false);
  let error = $state("");
  let after = $state(loadAfter());
  let first: HTMLInputElement | undefined = $state();
  const url = $derived(isUrl(query));

  $effect(() => {
    try {
      localStorage.setItem("estudio.after", JSON.stringify(after));
    } catch {}
  });
  $effect(() => {
    void mode;
    if (open) queueMicrotask(() => first?.focus());
  });

  function done(key?: string) {
    open = false;
    error = "";
    onadded(key);
  }
  async function guard(f: () => Promise<void>) {
    busy = true;
    error = "";
    try {
      await f();
    } catch (e) {
      error = String(e);
    } finally {
      busy = false;
    }
  }

  const addByName = () =>
    guard(async () => {
      if (!artist.trim() || !title.trim()) return;
      const { key } = await run<{ key: string }>("add", [artist, title]);
      // por nombre: la letra siempre (es lo que la identifica); el audio sale de YouTube
      const then = thenOf(after);
      if (!then.length) await enqueue("letra", [key]);
      for (const [action] of then) await enqueue(action, [key]);
      artist = title = "";
      done(key);
    });

  function submitLink(e: Event) {
    e.preventDefault();
    if (!query.trim()) return;
    if (url) return void guard(async () => (await importSources([query.trim()], thenOf(after)), (query = ""), done()));
    searching = true;
    error = "";
    run<{ results: Result[] }>("search", [query.trim()])
      .then((r) => ((results = r.results), (picked = results.length === 1 ? [results[0].url] : [])))
      .catch((err) => (error = String(err)))
      .finally(() => (searching = false));
  }

  const importPicked = () => guard(async () => (await importSources(picked, thenOf(after)), (picked = []), done()));

  const chooseFiles = () =>
    guard(async () => {
      const files = await pickFiles({ multiple: true, filters: [{ name: t("Audio o vídeo"), extensions: MEDIA }] });
      if (files?.length) (await importSources(files, thenOf(after)), done());
    });
  const toggle = (u: string) => (picked = picked.includes(u) ? picked.filter((x) => x !== u) : [...picked, u]);
</script>

<Dialog bind:open title={t("Añadir canciones")} width={680}>
  <div class="add">
    <Tabs
      bind:value={mode}
      label={t("Cómo añadir")}
      options={[
        { value: "link", label: t("Enlace o YouTube"), icon: "link" },
        { value: "name", label: t("Por nombre"), icon: "lyrics" },
        { value: "file", label: t("Ficheros"), icon: "upload" },
      ]}
    />

    {#if mode === "link"}
      <form class="row" onsubmit={submitLink}>
        <Search bind:ref={first} bind:value={query} size="lg" placeholder={t("Pega un enlace o busca en YouTube")} />
        <Button size="lg" variant={url ? "primary" : "secondary"} type="submit" disabled={!query.trim() || searching || busy}>
          {url ? t("Importar") : searching ? t("Buscando…") : t("Buscar")}
        </Button>
      </form>
      {#if searching}
        <div class="grid">{#each Array(4) as _, i (i)}<div class="res skel"></div>{/each}</div>
      {:else if results.length}
        <div class="grid">
          {#each results as r (r.url)}
            {@const on = picked.includes(r.url)}
            <button type="button" class="res" class:on aria-pressed={on} onclick={() => toggle(r.url)}>
              <span class="thumb">
                {#if r.thumbnail}<img src={r.thumbnail} alt="" loading="lazy" />{/if}
                {#if r.duration}<span class="dur num">{fmtClock(r.duration)}</span>{/if}
                {#if on}<span class="tick"><Icon name="check" size={14} /></span>{/if}
              </span>
              <span class="rt">{r.title}</span>
              <span class="rc">{r.channel}</span>
            </button>
          {/each}
        </div>
      {:else}
        <p class="tip"><Icon name="link" size={14} /> {t("YouTube, SoundCloud, Bandcamp… o escribe artista y canción.")}</p>
      {/if}
    {:else if mode === "name"}
      <form class="two" onsubmit={(e) => (e.preventDefault(), addByName())}>
        <Field label={t("Artista")} bind:ref={first} bind:value={artist} placeholder="Stela Cole" />
        <Field label={t("Canción")} bind:value={title} placeholder="Stereoqueen" />
        <button type="submit" hidden aria-hidden="true" tabindex="-1"></button>
      </form>
      <p class="tip"><Icon name="lyrics" size={14} /> {t("La letra de LRCLIB, Genius…; el audio, de YouTube.")}</p>
    {:else}
      <div class="drop">
        <Icon name="upload" size={28} />
        <strong>{t("Arrastra audio o vídeo a la ventana")}</strong>
        <Button icon="folder" onclick={chooseFiles} disabled={busy}>{t("Elegir ficheros")}</Button>
        <small>{t("Artista y título, de las etiquetas o de «Artista - Título.mp3».")}</small>
      </div>
    {/if}
    {#if error}<p class="err" role="alert"><Icon name="alert" size={14} /> {error}</p>{/if}
  </div>

  {#snippet footer()}
    <span class="after">{t("Después")}</span>
    <Toggle bind:checked={after.letra} disabled={after.notes}>{t("Letra")}</Toggle>
    <Toggle bind:checked={after.separate} disabled={after.notes}>{t("Pistas")}</Toggle>
    <Toggle bind:checked={after.notes} title={t("Pistas, letra y notas de cada instrumento")}>{t("Todo")}</Toggle>
    <span class="grow"></span>
    {#if mode === "link" && results.length}
      <Button variant="primary" disabled={!picked.length || busy} onclick={importPicked}>{t("Importar {n}", { n: picked.length || "" })}</Button>
    {:else if mode === "name"}
      <Button variant="primary" disabled={!artist.trim() || !title.trim() || busy} onclick={addByName}>{t("Añadir")}</Button>
    {/if}
  {/snippet}
</Dialog>

<style>
  .add { display: flex; flex-direction: column; gap: var(--s4); min-height: 280px; }
  .row { display: flex; gap: var(--s2); align-items: center; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: var(--s3); max-height: 46vh; overflow-y: auto; padding: 2px; }
  .res {
    display: flex; flex-direction: column; gap: 4px; padding: 0 0 var(--s2); border: 0; background: none; text-align: left; min-width: 0;
    border-radius: var(--r-lg); color: var(--text);
  }
  .thumb { position: relative; display: block; aspect-ratio: 16 / 9; border-radius: var(--r-lg); overflow: hidden; background: var(--panel-hi); box-shadow: 0 0 0 1px var(--line); transition: box-shadow var(--t-fast); }
  .thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .res:hover .thumb { box-shadow: 0 0 0 1px var(--line-hi); }
  .res.on .thumb { box-shadow: 0 0 0 2px var(--accent); }
  .dur { position: absolute; right: 6px; bottom: 6px; padding: 0 5px; border-radius: var(--r-sm); background: #000c; color: #fff; font-size: var(--fs-xs); }
  .tick { position: absolute; left: 6px; top: 6px; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: var(--on-accent); }
  .rt { display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: var(--fs-sm); font-weight: 500; line-height: 1.35; }
  .rc { color: var(--text-3); font-size: var(--fs-xs); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .skel { aspect-ratio: 16 / 11; background: var(--panel-hi); animation: pulse 1.2s ease-in-out infinite; }
  .tip { display: flex; align-items: center; gap: var(--s2); color: var(--text-3); font-size: var(--fs-sm); }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: var(--s3); }
  .drop {
    display: flex; flex-direction: column; align-items: center; gap: var(--s3); padding: var(--s6) var(--s4); text-align: center;
    border: 1.5px dashed var(--line-hi); border-radius: var(--r-lg); color: var(--text-2);
  }
  .drop strong { color: var(--text); font-weight: 500; }
  .drop small { color: var(--text-3); font-size: var(--fs-xs); }
  .err { display: flex; align-items: flex-start; gap: var(--s2); color: var(--bad); font-size: var(--fs-sm); }
  .after { color: var(--text-3); font-size: var(--fs-sm); margin-right: var(--s1); }
  .grow { flex: 1; }
</style>
