<script lang="ts">
  import Editor from "./Editor.svelte";
  import { enqueue, lyricsPath, playerSeek, run, SOURCE_LABEL, spotifyClock, writeJson, type Detail, type Lyrics } from "./engine";
  import { jobOf, jobText, store } from "./store.svelte";

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
    if (doc.synced_by === "ia") return doc.ai_mode === "lineas" ? "IA rápida: palabra a palabra sobre los tiempos de internet" : "IA: Whisper large-v3 + alineado forzado";
    if (words) return "Palabra a palabra";
    return doc.lines.some((l) => l.t != null) ? (doc.edited ? "A mano, por líneas" : "Por líneas (venía así)") : "Sin tiempos";
  });
  const doubts = $derived(doc ? doc.lines.filter((l) => l.words?.some((w) => w.p != null && w.p < 0.5)).length : 0);
  const canFast = $derived(!!doc?.lines.some((l) => l.t != null && l.text));
</script>

{#if stemOnly}
  <div class="empty">
    <h2>¿Qué canción es?</h2>
    <p>Esta viene de StemLab sin artista ni título. Con ellos, Letras busca la letra y la sincroniza con la voz que ya está separada.</p>
    <form class="assign" onsubmit={assign}>
      <input bind:value={artist} placeholder="Artista" />
      <input bind:value={title} placeholder="Canción" />
      <button class="primary" disabled={!artist.trim() || !title.trim()}>Buscar letra</button>
    </form>
    {#if error}<p class="error-text">{error}</p>{/if}
  </div>
{:else if !doc || !lines.some((l) => l.text)}
  <div class="empty">
    <h2>{doc?.instrumental ? "Instrumental" : "Sin letra todavía"}</h2>
    <p>
      Busca en LRCLIB, NetEase, QQ, Kugou y Genius. Si no aparece, Whisper la transcribe. Siempre acaba palabra a palabra, con
      {detail.vocals === "stemlab" || detail.stems === "complete" ? " la voz que ya separó StemLab (sin volver a separar)." : " la voz aislada (si luego separas en StemLab, se usa la suya)."}
    </p>
    {#if active}
      <div class="jobline"><span class="spinner"></span>{jobText(active)}</div>
    {:else}
      <button class="primary" onclick={() => act("letra", doc ? ["force"] : [])}>{job?.status === "error" ? "Reintentar" : "Buscar y sincronizar"}</button>
      {#if job?.status === "error"}<p class="error-text">{job.error}</p>{/if}
    {/if}
  </div>
{:else}
  <div class="wrap">
    <div class="karaoke" bind:this={scroller} onwheel={() => (userScroll = Date.now())} class:dim={!playing && !followSpotify && time === 0}>
      <div class="pad"></div>
      {#each lines as l (l.i)}
        {#if l.text}
          {@const state = l.i === current ? "now" : current >= 0 && l.i < current ? "past" : "next"}
          <button class="line {state}" data-i={l.i} disabled={l.t == null} onclick={() => seekTo(l.t! + off)} ondblclick={ontoggle}>
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

    <aside class="info">
      <div class="card">
        <span class="kicker">Letra{#if followSpotify} · <span class="spot">siguiendo Spotify</span>{/if}</span>
        <p class="big">{syncLabel}</p>
        <dl>
          <dt>Texto</dt><dd>{SOURCE_LABEL[doc.source] ?? doc.source}{doc.edited ? " · corregida" : ""}</dd>
          {#if doc.times_from}<dt>Tiempos</dt><dd>{SOURCE_LABEL[doc.times_from] ?? doc.times_from}</dd>{/if}
          <dt>Voz</dt><dd>{detail.vocals === "stemlab" ? "StemLab (calidad completa)" : detail.vocals === "letras" ? "Letras (rápida)" : "—"}</dd>
          <dt>Líneas</dt><dd class="mono">{lines.filter((l) => l.text).length}</dd>
          <dt>Audio</dt>
          <dd>
            {#if doc.audio_checked}
              misma versión{doc.audio_shift ? ` (ajustado ${doc.audio_shift > 0 ? "−" : "+"}${Math.abs(doc.audio_shift).toFixed(1)} s)` : ""}
            {:else if timed.length}
              <button class="link" disabled={!!active} onclick={() => act("sync", ["lineas"])} title="Whisper comprueba que el audio es la versión de los tiempos de la letra y, si no (videoclip con intro…), lo pone a la par">sin comprobar · comprobar</button>
            {:else}—{/if}
          </dd>
        </dl>
        {#if doubts && !doc.edited}<p class="hint warn">{doubts} líneas con palabras dudosas: revísalas en el editor.</p>{/if}
      </div>

      {#if active}
        <div class="card busy">
          <span class="kicker">Trabajando</span>
          <p>{jobText(active)}</p>
          <div class="bar" class:indet={active.pct == null}><i style:width="{active.pct ?? 0}%"></i></div>
        </div>
      {:else if job?.status === "error"}
        <div class="card"><p class="error-text">{job.error}</p></div>
      {/if}

      <div class="actions">
        <button class="primary sm" onclick={() => (editing = true)}>Editar <kbd>E</kbd></button>
        <button class="ghost sm" disabled={!!active || !canFast} onclick={() => act("sync", ["lineas"])} title="No toca el inicio de ninguna línea: el audio coloca cada palabra entre el inicio de su línea y el de la siguiente. Instantáneo.">Dentro de cada línea</button>
        <button class="ghost sm" disabled={!!active} onclick={() => act("sync", ["ia"])} title="No usa los tiempos por línea: Whisper escucha el audio y alinea tu texto letra a letra. Para arreglar una sincronización liada.">Desde el audio</button>
        <button class="ghost sm" disabled={!!active} onclick={() => confirm("Buscar la letra otra vez en internet. La actual va al historial.") && act("letra", ["force"])}>Buscar otra vez</button>
        <button class="ghost sm" disabled={!!active || !detail.history} onclick={restore} title="Deshace la última sincronización o búsqueda">Volver a la anterior{detail.history > 1 ? ` (${detail.history})` : ""}</button>
      </div>

      <div class="card offsets">
        <span class="kicker">Desfase</span>
        <div class="nudge">
          <span>Todo</span>
          <button class="ghost sm" onclick={() => nudge("offset", -0.1)}>−0.1</button>
          <b class="mono">{off > 0 ? "+" : ""}{off.toFixed(2)} s</b>
          <button class="ghost sm" onclick={() => nudge("offset", 0.1)}>+0.1</button>
        </div>
        <div class="nudge">
          <span>Palabras</span>
          <button class="ghost sm" onclick={() => nudge("word_offset", -0.05)}>−0.05</button>
          <b class="mono">{(doc.word_offset ?? 0) > 0 ? "+" : ""}{(doc.word_offset ?? 0).toFixed(2)} s</b>
          <button class="ghost sm" onclick={() => nudge("word_offset", 0.05)}>+0.05</button>
        </div>
        <small class="hint">Se aplica igual en la partitura y en los edits.</small>
      </div>
      <div class="card desk">
        <span class="kicker">Escritorio y biblioteca</span>
        <label><input type="checkbox" checked={!!doc.hidden} onchange={(e) => patch({ hidden: e.currentTarget.checked })} /> Oculta en el escritorio</label>
        <label><input type="checkbox" checked={!!doc.instrumental} onchange={(e) => patch({ instrumental: e.currentTarget.checked })} /> Instrumental</label>
        <textarea rows="2" placeholder="Nota" value={doc.note ?? ""} onchange={(e) => patch({ note: e.currentTarget.value.trim() || undefined })}></textarea>
      </div>
      {#if error}<p class="error-text">{error}</p>{/if}
    </aside>
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
  .wrap { flex: 1; min-height: 0; display: grid; grid-template-columns: 1fr 300px; gap: 16px; }
  .karaoke {
    min-height: 0; overflow-y: auto; padding: 0 10px; scroll-behavior: smooth;
    mask-image: linear-gradient(transparent, #000 18%, #000 82%, transparent);
  }
  .pad { height: 40%; }
  .line {
    display: block; width: 100%; text-align: left; border: 0; background: none; padding: 5px 4px; margin: 0;
    font-size: 20px; line-height: 1.3; letter-spacing: -0.02em; color: var(--text-3);
    transition: color 0.3s, transform 0.4s var(--ease), opacity 0.3s; transform-origin: left center;
  }
  .line:disabled { cursor: default; }
  .line:hover:not(:disabled) { color: var(--text-2); }
  .line.past { opacity: 0.45; }
  .line.now { color: var(--text); transform: scale(1.08); padding: 12px 4px; font-weight: 600; }
  .dim .line.next { color: var(--text-2); }
  .w {
    background: linear-gradient(90deg, var(--accent) calc(var(--p) * 100%), var(--text) calc(var(--p) * 100%));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .w.doubt { text-decoration: underline wavy color-mix(in srgb, var(--warn) 70%, transparent) 1px; text-underline-offset: 6px; }
  .gap { height: 22px; }

  .info { min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; padding-bottom: 10px; }
  .card.busy { border-color: color-mix(in srgb, var(--accent) 45%, var(--line)); }
  .card.busy p { margin: 4px 0 8px; font-size: 12.5px; }
  .card > .error-text { margin: 0; }
  .big { margin: 4px 0 10px; font-size: 14px; font-weight: 600; line-height: 1.3; }
  dl { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; margin: 0; font-size: 12px; }
  dt { color: var(--text-3); }
  dd { margin: 0; color: var(--text-2); }
  .warn { margin-top: 10px; color: var(--warn); }
  .actions { display: flex; flex-wrap: wrap; gap: 6px; }
  .offsets { display: flex; flex-direction: column; gap: 8px; }
  .nudge { display: grid; grid-template-columns: 64px auto 1fr auto; align-items: center; gap: 6px; font-size: 12px; color: var(--text-2); }
  .nudge b { text-align: center; font-weight: 500; color: var(--text); }
  .spot { color: #1ed760; }
  .desk { display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; }
  .desk label { display: flex; gap: 8px; align-items: center; color: var(--text-2); }
  .desk textarea { resize: vertical; font-size: 12px; }

  .empty { margin: auto; text-align: center; max-width: 560px; padding: 40px 0; }
  .empty h2 { margin-bottom: 8px; }
  .empty p { color: var(--text-3); font-size: 12.5px; margin: 0 0 16px; }
  .jobline { display: inline-flex; gap: 10px; align-items: center; color: var(--text-2); }
  .assign { display: flex; gap: 8px; justify-content: center; }
</style>
