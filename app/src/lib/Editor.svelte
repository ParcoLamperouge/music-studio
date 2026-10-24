<script lang="ts">
  import { t } from "./i18n.svelte";
  import { doubtful, fmtTime, parseTime, type Line, type Lyrics, type Word } from "./engine";

  let {
    doc,
    now,
    job,
    otherSong,
    history,
    onsave,
    onai,
    onfast,
    onrestore,
    onseek,
    onclose,
  }: {
    doc: Lyrics;
    now: number;
    job: { label: string; step?: number; total?: number } | null;
    otherSong: string; // la IA está ocupada con otra canción
    history: number; // versiones anteriores guardadas
    onsave: (d: Lyrics) => void;
    onai: (d: Lyrics) => void;
    onfast: (d: Lyrics) => void;
    onrestore: () => void;
    onseek: (t: number) => void;
    onclose: () => void;
  } = $props();

  // copia propia: nada se toca hasta Guardar (el padre recrea el editor con {#key} si cambia doc)
  // svelte-ignore state_referenced_locally
  let lines = $state<Line[]>(structuredClone($state.snapshot(doc.lines)));
  let dirty = $state(false);
  let tap = $state(-1); // línea que marcará el próximo Espacio; -1 = modo tap apagado
  let paste = $state<string | null>(null);
  let open = $state(-1); // línea con sus palabras desplegadas
  let rows: HTMLDivElement;

  const busy = $derived(!!job);
  const doubts = $derived(lines.filter((l) => doubtful(l).length).length);
  const touch = () => (dirty = true);
  function setText(l: Line, text: string) {
    l.text = text;
    delete l.words; // los tiempos por palabra ya no valen
    touch();
  }
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  /** Mover la línea mueve sus palabras con ella; quitarle el tiempo las quita. */
  function setT(l: Line, v: number | null) {
    const d = v != null && l.t != null ? v - l.t : null;
    l.t = v;
    if (d == null) {
      delete l.end;
      delete l.words;
    } else {
      if (l.end != null) l.end = r3(Math.max(0, l.end + d));
      for (const w of l.words ?? []) {
        w.t = r3(Math.max(0, w.t + d));
        if (w.end != null) w.end = r3(Math.max(w.t, w.end + d));
      }
    }
    touch();
  }
  /** Tiempo de una palabra (su fin se mueve igual). La primera manda en el inicio de la línea. */
  function setWordT(l: Line, w: Word, v: number | null) {
    if (v == null) return;
    v = r3(Math.max(0, v));
    if (w.end != null) w.end = r3(Math.max(v, w.end + v - w.t));
    w.t = v;
    if (l.words![0] === w) l.t = v;
    touch();
  }
  function insert(k: number) {
    lines.splice(k + 1, 0, { t: null, text: "" });
    touch();
  }
  function remove(k: number) {
    lines.splice(k, 1);
    touch();
  }
  function shift(by: number) {
    for (const l of lines) {
      if (l.t != null) l.t = Math.max(0, Math.round((l.t + by) * 1000) / 1000);
      if (l.end != null) l.end = Math.max(0, l.end + by);
      for (const w of l.words ?? []) {
        w.t = Math.max(0, w.t + by);
        if (w.end != null) w.end = Math.max(0, w.end + by);
      }
    }
    touch();
  }
  /** Texto pegado: una línea por renglón. Si el número de líneas no cambia, conserva los tiempos. */
  function applyPaste() {
    const texts = paste!.split("\n").map((tx) => tx.trim());
    const keep = texts.length === lines.length;
    lines = texts.map((text, k) => (keep && lines[k].text === text ? lines[k] : { t: keep ? lines[k].t : null, text }));
    paste = null;
    touch();
  }
  function result(): Lyrics {
    const out = $state.snapshot(lines) as Line[];
    const synced = out.some((l) => l.t != null);
    if (out.every((l) => l.t != null)) out.sort((a, b) => a.t! - b.t!);
    return { ...$state.snapshot(doc), lines: out, synced, edited: true, source: doc.source || "manual" };
  }
  function save() {
    onsave(result());
    dirty = false;
  }

  function onkey(e: KeyboardEvent) {
    if (tap < 0 || (e.target as HTMLElement).closest("input, textarea")) return;
    if (e.code === "Space") {
      e.preventDefault();
      e.stopPropagation();
      setT(lines[tap], Math.round(now * 100) / 100);
      tap = Math.min(tap + 1, lines.length - 1);
    } else if (e.code === "Backspace") {
      e.preventDefault();
      tap = Math.max(0, tap - 1);
    }
  }
  $effect(() => {
    if (tap >= 0) (rows?.children[tap] as HTMLElement)?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
</script>

<svelte:window onkeydowncapture={onkey} />

<aside class="drawer">
  <header>
    <h2>{t("Editar letra")}</h2>
    <button class="icon-btn sm" onclick={onclose} title={t("Cerrar (E)")}>✕</button>
  </header>

  <div class="tools">
    <button class="primary sm" disabled={!dirty} onclick={save}>{t("Guardar")}</button>
    <button class="ghost sm" onclick={() => (paste = lines.map((l) => l.text).join("\n"))}>{t("Pegar / editar texto")}</button>
    <button class="ghost sm" class:on={tap >= 0} onclick={() => (tap = tap >= 0 ? -1 : Math.max(0, lines.findIndex((l) => l.t == null)))}>
      {tap >= 0 ? t("Parar tap") : t("Sincronizar a mano")}
    </button>
    <button class="ghost sm" disabled={busy || !lines.some((l) => l.text)} onclick={() => { const d = result(); dirty = false; onai(d); }}
      title={t("Guarda y alinea tu texto escuchando el audio (Whisper), sin usar los tiempos por línea.")}>
      {busy ? t("Sincronizando…") : t("Desde el audio")}
    </button>
    <button class="ghost sm" disabled={busy || !lines.some((l) => l.t != null && l.text)} onclick={() => { const d = result(); dirty = false; onfast(d); }}
      title={t("Guarda y coloca las palabras con el audio sin tocar el inicio de ninguna línea (los que ves aquí).")}>
      {t("Dentro de cada línea")}
    </button>
    <button class="ghost sm" disabled={busy || !history} onclick={onrestore}
      title={t("Deshace la última sincronización con IA ({n} guardadas).", { n: history })}>
      {t(history > 1 ? "Volver a la anterior ({n})" : "Volver a la anterior", history > 1 ? { n: history } : undefined)}
    </button>
    <span class="nudge">
      {t("Todo")}
      <button class="ghost sm" onclick={() => shift(-0.1)}>−0.1 s</button>
      <button class="ghost sm" onclick={() => shift(0.1)}>+0.1 s</button>
    </span>
  </div>

  {#if job}
    <p class="hint busy">
      {otherSong ? t("La IA está con «{song}»; cuando acabe sigue con esta.", { song: otherSong }) : job.total ? t("IA: {label} ({step}/{total})…", { label: job.label, step: job.step!, total: job.total }) : t("IA: {label}…", { label: job.label })}
    </p>
  {/if}

  {#if doc.source === "ia" && !doc.edited}
    <p class="hint warn">
      {t("Transcrita por IA: revísala.")}{doubts ? ` ${t("{n} líneas con palabras dudosas marcadas en amarillo (▶ para oírlas).", { n: doubts })}` : ""}
    </p>
  {/if}

  {#if tap >= 0}
    <p class="hint">{t("Reproduce la canción y pulsa")} <kbd>{t("Espacio")}</kbd> {t("justo cuando empiece cada línea resaltada.")} <kbd>⌫</kbd> {t("vuelve una atrás.")}</p>
  {/if}

  {#if paste != null}
    <div class="paste">
      <textarea bind:value={paste} rows="16" placeholder={t("Una línea de la letra por renglón. Renglón vacío = pausa.")}></textarea>
      <div class="tools">
        <button class="primary sm" onclick={applyPaste}>{t("Aplicar")}</button>
        <button class="ghost sm" onclick={() => (paste = null)}>{t("Cancelar")}</button>
      </div>
    </div>
  {/if}

  <div class="rows" bind:this={rows}>
    {#each lines as l, k (k)}
      <div class="row" class:doubt={doubtful(l).length} title={doubtful(l).length ? t("La IA no tiene claro: {words}", { words: doubtful(l).join(", ") }) : undefined} class:tapnext={k === tap} class:playing={l.t != null && l.t <= now && (lines[k + 1]?.t ?? Infinity) > now}>
        <input class="time" value={fmtTime(l.t)} placeholder="--:--" onchange={(e) => setT(l, parseTime(e.currentTarget.value))} />
        <button class="icon-btn sm" title={t("Poner el tiempo actual")} onclick={() => setT(l, Math.round(now * 100) / 100)}>⏱</button>
        <button class="icon-btn sm" title={t("Ir aquí")} disabled={l.t == null} onclick={() => onseek(l.t!)}>▶</button>
        <input class="text" value={l.text} oninput={(e) => setText(l, e.currentTarget.value)} />
        <button class="icon-btn sm" class:on={open === k} disabled={!l.words?.length} title={t("Tiempo de cada palabra")} onclick={() => (open = open === k ? -1 : k)}>⋯</button>
        <button class="icon-btn sm" title={t("Línea debajo")} onclick={() => insert(k)}>＋</button>
        <button class="icon-btn sm" title={t("Borrar")} onclick={() => remove(k)}>✕</button>
      </div>
      {#if open === k && l.words?.length}
        <div class="words">
          {#each l.words as w, j (j)}
            <div class="word" class:now={w.t <= now && (w.end ?? l.words[j + 1]?.t ?? Infinity) > now} class:doubt={w.p != null && w.p < 0.5}>
              <b>{w.w}</b>
              <button class="icon-btn sm" title="−0.05 s" onclick={() => setWordT(l, w, w.t - 0.05)}>−</button>
              <input class="wt" value={fmtTime(w.t)} onchange={(e) => setWordT(l, w, parseTime(e.currentTarget.value))} />
              <button class="icon-btn sm" title="+0.05 s" onclick={() => setWordT(l, w, w.t + 0.05)}>+</button>
              <button class="icon-btn sm" title={t("Poner el tiempo actual")} disabled={!now} onclick={() => setWordT(l, w, now)}>⏱</button>
              <button class="icon-btn sm" title={t("Ir aquí")} onclick={() => onseek(w.t)}>▶</button>
            </div>
          {/each}
        </div>
      {/if}
    {:else}
      <p class="hint">{t("Sin letra. Pega el texto o añade líneas.")}</p>
      <button class="ghost sm" onclick={() => insert(-1)}>＋ {t("Añadir línea")}</button>
    {/each}
  </div>
</aside>

<style>
  aside { width: min(560px, 100vw); gap: 10px; padding: 16px; z-index: 30; border-left-color: var(--line-hi); }
  header { display: flex; justify-content: space-between; align-items: center; }
  input { padding: 3px 7px; }
  .tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .nudge { margin-left: auto; display: flex; align-items: center; gap: 4px; font-size: 12px; color: var(--text-2); }
  .rows { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 2px; }
  .row { display: flex; gap: 2px; align-items: center; padding: 2px 4px; border-radius: var(--radius-sm); }
  .row.playing { background: var(--panel-hi); }
  .row.doubt { box-shadow: inset 2px 0 var(--warn); }
  .row.doubt .text { border-color: color-mix(in srgb, var(--warn) 50%, transparent); }
  .row.tapnext { background: var(--accent-soft); outline: 1px solid var(--accent); }
  .hint.busy { color: var(--accent); }
  .hint.warn { color: var(--warn); }
  .words { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px 4px 8px 78px; }
  .word { display: flex; align-items: center; gap: 1px; padding: 2px 4px 2px 8px; border-radius: var(--radius-sm); background: var(--panel); font-size: 12px; }
  .word b { margin-right: 2px; font-weight: 500; }
  .word .icon-btn { width: 20px; height: 20px; }
  .word.now { outline: 1px solid var(--accent); }
  .word.doubt b { color: var(--warn); }
  .wt { width: 62px; font-variant-numeric: tabular-nums; }
  .time { width: 72px; font-size: 12px; font-variant-numeric: tabular-nums; }
  .text { flex: 1; }
  .paste textarea { width: 100%; resize: vertical; }
</style>
