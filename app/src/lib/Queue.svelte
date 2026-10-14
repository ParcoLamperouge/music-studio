<script lang="ts">
  import { actionLabel, cancel, cancelAll, clearFinished, finished, retry, top, type Job, type Res } from "./engine";
  import { jobText, store } from "./store.svelte";

  let { open = $bindable(), gpu, onopen }: { open: boolean; gpu: string; onopen: (key: string) => void } = $props();

  const titleOf = (j: Job) => store.tracks.find((t) => t.key === j.key)?.title || j.title || j.key;
  const running = $derived(store.jobs.filter((j) => j.status === "running"));
  const lane = (r: Res) => running.filter((j) => j.steps[j.cur]?.res === r);
  const pending = $derived(store.jobs.filter((j) => !finished(j) && j.status !== "running"));
  const done = $derived(store.jobs.filter(finished).sort((a, b) => b.finished - a.finished));
  const failed = $derived(done.filter((j) => j.status === "error"));
  let showDone = $state(false);

  const LANES: [Res, string, string][] = [
    ["gpu", "GPU", "Una cosa a la vez: dos modelos no caben en la VRAM"],
    ["cpu", "CPU", "Notas, pulsos y alineado, en paralelo"],
    ["net", "Red", "Búsquedas y descargas, en paralelo"],
    ["render", "Render", "Exportar MP4"],
  ];
  const steps = (j: Job) => j.steps.map((s, i) => ({ ...s, now: i === j.cur && j.status === "running" }));
  const ago = (t: number) => {
    const s = Math.round(Date.now() / 1000 - t);
    return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.round(s / 3600)} h`;
  };
  let clock = $state(Date.now());
  $effect(() => {
    if (!open) return;
    const t = setInterval(() => (clock = Date.now()), 1000);
    return () => clearInterval(t);
  });
  const elapsed = (j: Job) => {
    void clock;
    return j.started ? ago(j.started) : "";
  };
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && open && (open = false)} />

{#if open}
  <button class="scrim" onclick={() => (open = false)} aria-label="Cerrar la cola"></button>
  <aside class="drawer">
    <header>
      <div>
        <span class="kicker">Cola de trabajo</span>
        <h2>{running.length ? `${running.length} en marcha` : pending.length ? "En espera" : "Todo hecho"}</h2>
      </div>
      <button class="icon-btn" onclick={() => (open = false)} aria-label="Cerrar (Esc)">
        <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
      </button>
    </header>

    <section class="lanes">
      {#each LANES as [res, name, hint] (res)}
        {@const jobs = lane(res)}
        {#if res !== "render" || jobs.length}
          <div class="lane" class:active={jobs.length} title={hint}>
            <div class="lane-name">
              <b>{name}</b>
              {#if res === "gpu"}<small>{gpu || "—"}</small>{/if}
            </div>
            <div class="lane-body">
              {#each jobs as j (j.id)}
                <div class="slot">
                  <button class="slot-title" onclick={() => onopen(j.key)}>{titleOf(j)}</button>
                  <span class="slot-label">{j.waiting || j.label}</span>
                  <div class="bar" class:indet={j.pct == null}><i style:width="{j.pct ?? 0}%"></i></div>
                  <span class="mono t">{j.pct != null ? `${Math.round(j.pct)}%` : ""} {elapsed(j)}</span>
                  <button class="icon-btn sm x" onclick={() => cancel([j.id])} title="Cancelar">
                    <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
                  </button>
                </div>
              {:else}
                <span class="idle">libre</span>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    </section>

    <section class="list">
      <div class="list-head">
        <span class="kicker">Pendiente · {pending.length}</span>
        {#if pending.length || running.length}
          <button class="link danger" onclick={() => confirm("¿Cancelar todo lo pendiente y lo que está en marcha?") && cancelAll()}>Cancelar todo</button>
        {/if}
      </div>
      {#each pending as j, i (j.id)}
        <div class="job" style:--d="{Math.min(i, 12) * 20}ms">
          <div class="job-main">
            <button class="job-title" onclick={() => onopen(j.key)}>{titleOf(j)}</button>
            <span class="job-action">{actionLabel(j)}</span>
            <span class="job-state">{jobText(j)}</span>
            {#if j.steps.length}
              <span class="steps">
                {#each steps(j) as s, k (k)}<i class="{s.res} {s.status}" title="{s.label} ({s.res.toUpperCase()})"></i>{/each}
              </span>
            {/if}
          </div>
          <button class="icon-btn" onclick={() => top([j.id])} title="Pasar al principio">
            <svg viewBox="0 0 24 24"><path d="M6 5h12M12 19V9m-5 5 5-5 5 5" /></svg>
          </button>
          <button class="icon-btn" onclick={() => cancel([j.id])} title="Quitar de la cola">
            <svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
      {:else}
        <p class="muted none">Nada esperando.</p>
      {/each}

      {#if failed.length}
        <div class="list-head">
          <span class="kicker bad">Fallaron · {failed.length}</span>
          <button class="link" onclick={() => retry(failed.map((j) => j.id))}>Reintentar todos</button>
        </div>
        {#each failed.slice(0, 30) as j (j.id)}
          <div class="job failed">
            <div class="job-main">
              <button class="job-title" onclick={() => onopen(j.key)}>{titleOf(j)}</button>
              <span class="job-action">{actionLabel(j)}</span>
              <span class="job-state" title={j.error}>{j.error}</span>
            </div>
            <button class="icon-btn" onclick={() => retry([j.id])} title="Reintentar">
              <svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4h4" /></svg>
            </button>
          </div>
        {/each}
      {/if}

      {#if done.length}
        <div class="list-head">
          <button class="link plain" onclick={() => (showDone = !showDone)}>{showDone ? "▾" : "▸"} Terminados · {done.length}</button>
          <button class="link" onclick={clearFinished}>Limpiar</button>
        </div>
        {#if showDone}
          {#each done.filter((j) => j.status !== "error").slice(0, 60) as j (j.id)}
            <div class="job done">
              <div class="job-main">
                <button class="job-title" onclick={() => onopen(j.key)}>{titleOf(j)}</button>
                <span class="job-action">{actionLabel(j)}</span>
                <span class="job-state">{j.status === "canceled" ? "cancelado" : j.label === "Ya estaba hecho" ? "ya estaba hecho" : "hecho"} · hace {ago(j.finished)}</span>
              </div>
            </div>
          {/each}
        {/if}
      {/if}
    </section>
  </aside>
{/if}

<style>
  header { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px 16px 10px; }
  h2 { margin-top: 2px; }

  .lanes { display: flex; flex-direction: column; gap: 4px; padding: 4px 12px 12px; border-bottom: 1px solid var(--line); }
  .lane { display: grid; grid-template-columns: 64px 1fr; gap: 10px; align-items: stretch; padding: 8px 10px; border-radius: var(--radius-sm); background: var(--panel); }
  .lane-name { display: flex; flex-direction: column; justify-content: center; }
  .lane-name b { font-size: 12px; font-weight: 600; color: var(--text-2); }
  .lane.active .lane-name b { color: var(--accent); }
  .lane-name small { color: var(--text-3); font-size: 10.5px; line-height: 1.2; }
  .lane-body { display: flex; flex-direction: column; gap: 8px; min-width: 0; }
  .idle { color: var(--text-3); font-size: 12px; align-self: flex-start; padding: 4px 0; }
  .slot { display: grid; grid-template-columns: 1fr auto; grid-template-rows: auto auto auto; column-gap: 8px; row-gap: 3px; }
  .slot-title { grid-column: 1; text-align: left; border: 0; background: none; padding: 0; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .slot-label { grid-column: 1; color: var(--text-2); font-size: 12px; }
  .slot .bar { grid-column: 1; }
  .slot .t { grid-column: 2; grid-row: 2; font-size: 11px; color: var(--text-3); text-align: right; }
  .slot .x { grid-column: 2; grid-row: 1; justify-self: end; }

  .list { flex: 1; overflow-y: auto; padding: 8px 12px 16px; }
  .list-head { display: flex; justify-content: space-between; align-items: center; padding: 12px 6px 6px; font-size: 12px; }
  .kicker.bad { color: var(--bad); }
  .link.plain { color: var(--text-2); text-decoration: none; }
  .none { padding: 4px 6px; margin: 0; font-size: 12.5px; }
  .job { display: flex; align-items: center; gap: 2px; padding: 6px 8px; border-radius: var(--radius-sm); }
  .job:hover { background: var(--panel); }
  .job-main { flex: 1; min-width: 0; display: grid; grid-template-columns: 1fr auto; column-gap: 8px; }
  .job-title { text-align: left; border: 0; background: none; padding: 0; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .job-title:hover { color: var(--accent); }
  .job-action { color: var(--text-2); font-size: 12px; text-align: right; }
  .job-state { grid-column: 1; color: var(--text-3); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .failed .job-state { color: var(--bad); }
  .done { opacity: 0.6; }
  .steps { grid-column: 2; grid-row: 2; display: flex; gap: 2px; align-items: center; justify-content: flex-end; }
  .steps i { width: 8px; height: 8px; border-radius: 2px; border: 1px solid var(--line-hi); }
  .steps i.gpu { border-color: #a35a2a; }
  .steps i.net { border-radius: 50%; }
  .steps i.done, .steps i.skipped { background: var(--accent); border-color: var(--accent); }
  .steps i.skipped { opacity: 0.4; }
</style>
