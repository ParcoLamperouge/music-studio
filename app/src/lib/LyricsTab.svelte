<script lang="ts">
  import Editor from "./Editor.svelte";
  import { enqueue, lyricsPath, playerSeek, run, SOURCE_LABEL, spotifyClock, writeJson, type Detail, type Lyrics } from "./engine";
  import { jobOf, jobText, store } from "./store.svelte";
  import Button from "./ui/Button.svelte";
  import Chip from "./ui/Chip.svelte";
  import EmptyState from "./ui/EmptyState.svelte";
  import Field from "./ui/Field.svelte";
  import Icon from "./ui/Icon.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import Menu, { type MenuItem } from "./ui/Menu.svelte";
  import Popover from "./ui/Popover.svelte";
  import ProgressRing from "./ui/ProgressRing.svelte";
  import Textarea from "./ui/Textarea.svelte";
  import Toggle from "./ui/Toggle.svelte";

  // Letra a lo grande, palabra a palabra; las herramientas (sincronizar, desfase, ficha) en una barra discreta arriba.
  let { detail, time, playing, editing = $bindable(), onseek, ontoggle, onrenamed }: {
    detail: Detail;
    time: number; // tiempo del audio
    playing: boolean;
    editing: boolean;
    onseek: (t: number) => void;
    ontoggle: () => void;
    onrenamed: (key: string) => void;
  } = $props();

  const key = $derived(detail.key);
  // la que suena en Spotify, sin reproducir aquí: la letra va con el reloj de Spotify (como Letras) y saltar la mueve allí
  const followSpotify = $derived(store.playing?.key === detail.key && !playing);
  let spotTime = $state(0);
  $effect(() => {
    if (!followSpotify) return;
    let raf = 0;
    const tick = () => {
      spotTime = spotifyClock(store.playing);
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  });
  const now = $derived(followSpotify ? spotTime : time);
  const seekTo = (x: number) => (followSpotify ? void playerSeek(x) : onseek(x));
  const doc = $derived(detail.doc);
  // tiempos de Letras + desfase = tiempo del audio (lo mismo que Lyric Edits)
  const off = $derived(doc?.offset ?? 0);
  const woff = $derived(off + (doc?.word_offset ?? 0));
  const lines = $derived((doc?.lines ?? []).map((l, i) => ({ ...l, i })));
  const timed = $derived(lines.filter((l) => l.t != null && l.text));
  const current = $derived.by(() => {
    let k = -1;
    for (const l of timed) if (l.t! + off <= now + 0.05) k = l.i;
    return k;
  });
  const job = $derived(jobOf(key, ["letra", "find", "sync"]));
  const active = $derived(job && job.status !== "error" ? job : null);
  const stemOnly = $derived(key.startsWith("stem:"));

  let artist = $state("");
  let title = $state("");
  let error = $state("");
  let scroller: HTMLDivElement | undefined = $state();
  let userScroll = 0;

  // la línea que suena, al centro (salvo si acabas de desplazarte tú)
  $effect(() => {
    const i = current;
    if (i < 0 || !scroller || Date.now() - userScroll < 2500) return;
    scroller.querySelector<HTMLElement>(`[data-i="${i}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  });

  /** 0..1: cuánto se ha cantado de una palabra (barrido de color). */
  function sung(w: { t: number; end?: number }, next?: { t: number }) {
    const a = w.t + woff;
    const b = (w.end ?? next?.t ?? w.t + 0.4) + woff;
    return now <= a ? 0 : now >= b ? 1 : (now - a) / Math.max(0.05, b - a);
  }

  async function patch(change: Partial<Lyrics>) {
    if (doc) await writeJson(lyricsPath(key), { ...doc, ...change });
  }
  const nudge = (field: "offset" | "word_offset", by: number) => patch({ [field]: Math.round(((doc?.[field] ?? 0) + by) * 100) / 100 });

  /** Guardar desde el editor: la letra es la suya, lo demás (desfase, nota…) lo que hay en disco. */
  async function save(d: Lyrics) {
    await writeJson(lyricsPath(key), { ...d, offset: doc?.offset, word_offset: doc?.word_offset, note: doc?.note, hidden: doc?.hidden });
  }
  async function act(action: string, args: string[] = []) {
    error = "";
    try {
      await enqueue(action, [key], args);
    } catch (e) {
      error = String(e);
    }
  }
  async function restore() {
    try {
      await run("restore", [key]);
    } catch (e) {
      error = String(e);
    }
  }
  async function assign(e: Event) {
    e.preventDefault();
    try {
      const r = await run<{ key: string }>("assign", [key, artist, title]);
      await enqueue("letra", [r.key]);
      onrenamed(r.key);
    } catch (err) {
      error = String(err);
    }
  }

  const syncLabel = $derived.by(() => {
    if (!doc) return "";
    if (doc.instrumental) return "Instrumental";
    const words = doc.lines.some((l) => l.words?.length);
    if (doc.synced_by === "ia") return doc.ai_mode === "lineas" ? "IA rápida" : "IA palabra a palabra";
    if (words) return "Palabra a palabra";
    return doc.lines.some((l) => l.t != null) ? (doc.edited ? "A mano, por líneas" : "Por líneas") : "Sin tiempos";
  });
  const doubts = $derived(doc ? doc.lines.filter((l) => l.words?.some((w) => w.p != null && w.p < 0.5)).length : 0);
  const canFast = $derived(!!doc?.lines.some((l) => l.t != null && l.text));
  const syncItems = $derived<MenuItem[]>([
    { label: "Dentro de cada línea", icon: "lyrics", disabled: !!active || !canFast, title: "Respeta el inicio de cada línea y coloca las palabras con el audio. Instantáneo.", run: () => act("sync", ["lineas"]) },
    { label: "Desde el audio", icon: "sparkle", disabled: !!active, title: "Whisper escucha y alinea tu texto: para una sincronización liada.", run: () => act("sync", ["ia"]) },
    ...(doc && !doc.audio_checked && timed.length
      ? [{ label: "Comprobar la versión del audio", icon: "audio" as const, disabled: !!active, title: "Si el audio es otra versión (videoclip con intro…), lo pone a la par", run: () => act("sync", ["lineas"]) }]
      : []),
    "-",
    { label: "Buscar otra vez", icon: "search", disabled: !!active, run: () => confirm("Buscar la letra otra vez en internet. La actual va al historial.") && act("letra", ["force"]) },
    { label: `Volver a la anterior${detail.history > 1 ? ` (${detail.history})` : ""}`, icon: "undo", disabled: !!active || !detail.history, run: restore },
  ]);
  function toggled(e: Event) {
    const input = e.target as HTMLInputElement;
    const field = input.closest<HTMLElement>("[data-field]")?.dataset.field;
    if (field === "hidden" || field === "instrumental") patch({ [field]: input.checked });
  }
  const fmtOff =(v: number) => `${v > 0 ? "+" : ""}${v.toFixed(2)} s`;
</script>

{#if stemOnly}
  <EmptyState icon="lyrics" title="¿Qué canción es?">
    Con artista y título se busca la letra y se sincroniza con la voz ya separada.
    {#snippet actions()}
      <form class="assign" onsubmit={assign}>
        <Field label="Artista" bind:value={artist} />
        <Field label="Canción" bind:value={title} />
        <Button variant="primary" type="submit" icon="search" disabled={!artist.trim() || !title.trim()}>Buscar letra</Button>
      </form>
      {#if error}<p class="err">{error}</p>{/if}
    {/snippet}
  </EmptyState>
{:else if !doc || !lines.some((l) => l.text)}
  <EmptyState icon="lyrics" title={doc?.instrumental ? "Instrumental" : "Sin letra"}>
    Se busca en internet (o la transcribe Whisper) y se sincroniza palabra a palabra.
    {#snippet actions()}
      {#if active}
        <span class="job"><ProgressRing value={active.pct != null ? active.pct / 100 : null} size={16} />{jobText(active)}</span>
      {:else}
        <Button variant="primary" icon={job?.status === "error" ? "retry" : "search"} onclick={() => act("letra", doc ? ["force"] : [])}>{job?.status === "error" ? "Reintentar" : "Buscar y sincronizar"}</Button>
        {#if job?.status === "error"}<p class="err">{job.error}</p>{/if}
      {/if}
    {/snippet}
  </EmptyState>
{:else}
  <div class="lyrics">
    <div class="tools">
      <Chip icon={doc.synced_by === "ia" ? "sparkle" : "lyrics"} title="{SOURCE_LABEL[doc.source] ?? doc.source}{doc.times_from ? ` · tiempos de ${SOURCE_LABEL[doc.times_from] ?? doc.times_from}` : ''}">{syncLabel}</Chip>
      {#if doubts && !doc.edited}<Chip icon="alert" title="Líneas con palabras dudosas: revísalas en el editor" onclick={() => (editing = true)} count={doubts}>Dudas</Chip>{/if}
      {#if followSpotify}<Chip icon="broadcast" title="La letra sigue a Spotify">Spotify</Chip>{/if}
      {#if active}<span class="job"><ProgressRing value={active.pct != null && active.status === "running" ? active.pct / 100 : null} size={16} />{jobText(active)}</span>{/if}
      {#if job?.status === "error"}<span class="err" title={job.error}><Icon name="alert" size={14} /> Falló</span>{/if}
      {#if error}<span class="err" title={error}><Icon name="alert" size={14} /> {error}</span>{/if}
      <span class="spacer"></span>
      <Menu items={syncItems} align="end" label="Sincronizar">
        {#snippet trigger({ toggle, open })}<Button size="sm" variant="ghost" icon="sparkle" active={open} onclick={toggle}>Sincronizar</Button>{/snippet}
      </Menu>
      <Popover align="end" width={260} label="Desfase">
        {#snippet trigger({ toggle, open })}<IconButton icon="wait" label="Desfase" size="sm" active={open || !!off || !!doc.word_offset} onclick={toggle} />{/snippet}
        <div class="pane">
          {#each [["offset", "Todo", 0.1], ["word_offset", "Palabras", 0.05]] as const as [field, label, step] (field)}
            <div class="nudge">
              <span>{label}</span>
              <IconButton icon="minus" label="−{step} s" size="sm" onclick={() => nudge(field, -step)} />
              <b class="num">{fmtOff(doc[field] ?? 0)}</b>
              <IconButton icon="plus" label="+{step} s" size="sm" onclick={() => nudge(field, step)} />
            </div>
          {/each}
          <small>También en la partitura y los edits.</small>
        </div>
      </Popover>
      <Popover align="end" width={280} label="Ficha de la letra">
        {#snippet trigger({ toggle, open })}<IconButton icon="info" label="Ficha" size="sm" active={open} onclick={toggle} />{/snippet}
        <div class="pane">
          <dl>
            <dt>Texto</dt><dd>{SOURCE_LABEL[doc.source] ?? doc.source}{doc.edited ? " · corregida" : ""}</dd>
            {#if doc.times_from}<dt>Tiempos</dt><dd>{SOURCE_LABEL[doc.times_from] ?? doc.times_from}</dd>{/if}
            <dt>Voz</dt><dd>{detail.vocals === "stemlab" ? "StemLab" : detail.vocals === "letras" ? "Letras (rápida)" : "—"}</dd>
            <dt>Líneas</dt><dd class="num">{lines.filter((l) => l.text).length}</dd>
            <dt>Audio</dt><dd>{doc.audio_checked ? `misma versión${doc.audio_shift ? ` (${doc.audio_shift > 0 ? "−" : "+"}${Math.abs(doc.audio_shift).toFixed(1)} s)` : ""}` : "sin comprobar"}</dd>
          </dl>
          <!-- el cambio de cada interruptor sube hasta aquí -->
          <div class="toggles" role="group" onchange={toggled}>
            <span data-field="hidden"><Toggle checked={!!doc.hidden} title="No sale en el escritorio">Oculta en el escritorio</Toggle></span>
            <span data-field="instrumental"><Toggle checked={!!doc.instrumental}>Instrumental</Toggle></span>
          </div>
          <Textarea label="Nota" rows={2} value={doc.note ?? ""} onchange={(e) => patch({ note: e.currentTarget.value.trim() || undefined })} />
        </div>
      </Popover>
      <Button size="sm" variant="secondary" icon="edit" kbd="E" onclick={() => (editing = true)}>Editar</Button>
    </div>

    <div class="karaoke" bind:this={scroller} onwheel={() => (userScroll = Date.now())} class:idle={!playing && !followSpotify && time === 0}>
      <div class="pad"></div>
      {#each lines as l (l.i)}
        {#if l.text}
          {@const state = l.i === current ? "now" : current >= 0 && l.i < current ? "past" : "next"}
          <button type="button" class="line {state}" data-i={l.i} disabled={l.t == null} onclick={() => seekTo(l.t! + off)} ondblclick={ontoggle}>
            {#if l.words?.length && state === "now"}
              {#each l.words as w, j (j)}
                <span class="w" style:--p={sung(w, l.words[j + 1])} class:doubt={w.p != null && w.p < 0.5}>{w.w}</span>{" "}
              {/each}
            {:else}
              {l.text}
            {/if}
          </button>
        {:else}
          <div class="gap" data-i={l.i}></div>
        {/if}
      {/each}
      <div class="pad"></div>
    </div>
  </div>

  {#if editing}
    {#key `${doc.key}:${doc.lines.length}:${doc.synced_by}:${detail.history}`}
      <Editor
        {doc}
        now={now - off}
        job={active ? { label: jobText(active) } : null}
        otherSong=""
        history={detail.history}
        onsave={save}
        onai={async (d) => (await save(d), act("sync", ["ia"]))}
        onfast={async (d) => (await save(d), act("sync", ["lineas"]))}
        onrestore={restore}
        onseek={(t) => seekTo(t + off)}
        onclose={() => (editing = false)}
      />
    {/key}
  {/if}
{/if}

<style>
  .lyrics { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .tools { display: flex; align-items: center; gap: var(--s1); flex-wrap: wrap; flex-shrink: 0; }
  .spacer { flex: 1; }
  .job { display: inline-flex; align-items: center; gap: var(--s2); color: var(--text-2); font-size: var(--fs-sm); min-width: 0; }
  .err { display: inline-flex; align-items: center; gap: 4px; color: var(--bad); font-size: var(--fs-sm); max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .assign { display: flex; gap: var(--s2); align-items: flex-end; }

  .pane { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s2); }
  .pane small { color: var(--text-3); font-size: var(--fs-xs); }
  .nudge { display: grid; grid-template-columns: 1fr auto 76px auto; align-items: center; gap: var(--s1); font-size: var(--fs-sm); color: var(--text-2); }
  .nudge b { text-align: center; font-weight: 600; color: var(--text); }
  .toggles { display: flex; flex-direction: column; gap: var(--s2); }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px var(--s3); margin: 0; font-size: var(--fs-sm); }
  dt { color: var(--text-3); }
  dd { margin: 0; color: var(--text-2); }

  .karaoke {
    flex: 1; min-height: 0; overflow-y: auto; padding: 0 var(--s4); scroll-behavior: smooth;
    mask-image: linear-gradient(transparent, #000 15%, #000 85%, transparent);
  }
  .pad { height: 42%; }
  .line {
    display: block; width: 100%; max-width: 980px; margin: 0 auto; text-align: center; border: 0; background: none; padding: 6px var(--s2);
    font-size: 22px; font-weight: 500; line-height: 1.3; letter-spacing: -0.02em; color: var(--text-3);
    transition: color var(--t-slow), transform var(--t-slow) var(--ease), opacity var(--t-slow);
  }
  .line:disabled { cursor: default; }
  .line:hover:not(:disabled) { color: var(--text-2); }
  .line.past { opacity: 0.4; }
  .line.now { color: var(--text); font-size: 34px; font-weight: 700; padding: var(--s3) var(--s2); }
  .idle .line.next { color: var(--text-2); }
  .w {
    background: linear-gradient(90deg, var(--accent) calc(var(--p) * 100%), var(--text) calc(var(--p) * 100%));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .w.doubt { text-decoration: underline wavy color-mix(in oklab, var(--warn) 70%, transparent) 1px; text-underline-offset: 8px; }
  .gap { height: 28px; }
</style>
