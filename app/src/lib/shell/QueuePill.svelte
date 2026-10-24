<script lang="ts">
  import { actionLabel, cancel, cancelAll, clearFinished, finished, retry, top, type Job, type Res } from "../engine";
  import { engineLabel, t } from "../i18n.svelte";
  import { jobText, store } from "../store.svelte";
  import Icon, { type IconName } from "../ui/Icon.svelte";
  import IconButton from "../ui/IconButton.svelte";
  import Popover from "../ui/Popover.svelte";
  import ProgressRing from "../ui/ProgressRing.svelte";
  import Button from "../ui/Button.svelte";

  // La cola de trabajo como pastilla flotante (abajo a la derecha) con un anillo de progreso; al pulsarla, el detalle.
  // Solo se ve si hay algo en marcha o algo falló.
  let { open = $bindable(false), gpu, raised = false, onopen }: {
    open?: boolean;
    gpu: string;
    raised?: boolean; // hay mini-reproductor debajo
    onopen: (key: string) => void;
  } = $props();

  const titleOf = (j: Job) => store.tracks.find((t) => t.key === j.key)?.title || j.title || j.key;
  const running = $derived(store.jobs.filter((j) => j.status === "running"));
  const pending = $derived(store.jobs.filter((j) => !finished(j) && j.status !== "running"));
  const done = $derived(store.jobs.filter(finished).sort((a, b) => b.finished - a.finished));
  const failed = $derived(done.filter((j) => j.status === "error"));
  const ok = $derived(done.filter((j) => j.status !== "error"));
  const lead = $derived(running.find((j) => j.steps[j.cur]?.res === "gpu") ?? running[0]);
  const ring = $derived(lead?.pct != null ? lead.pct / 100 : running.length ? null : 0);
  let showDone = $state(false);

  const LANE: Record<Res, [IconName, string]> = { gpu: ["gpu", "GPU"], cpu: ["gpu", "CPU"], net: ["cloud", "Red"], render: ["edits", "Render"] };
  const ago = (t2: number) => {
    const s = Math.round(Date.now() / 1000 - t2);
    return s < 60 ? t("{n} s", { n: s }) : s < 3600 ? t("{n} min", { n: Math.round(s / 60) }) : t("{n} h", { n: Math.round(s / 3600) });
  };
  const go = (key: string) => ((open = false), onopen(key));
</script>

{#if running.length || pending.length || failed.length || open}
  <div class="dock" class:raised>
    <Popover bind:open side="top" align="end" width={400} label={t("Cola de trabajo")}>
      {#snippet trigger({ toggle })}
        <button type="button" class="pill" class:alert={!running.length && !pending.length && failed.length} onclick={toggle} aria-expanded={open}>
          {#if running.length || pending.length}
            <ProgressRing value={ring} size={20} label={t("Progreso")} />
            <span class="what">{lead ? `${engineLabel(lead.waiting || lead.label)} · ${titleOf(lead)}` : t("En espera")}</span>
            <b class="num">{running.length + pending.length}</b>
          {:else}
            <Icon name="alert" size={16} />
            <span class="what">{failed.length} {failed.length === 1 ? t("falló") : t("fallaron")}</span>
          {/if}
          <kbd>Q</kbd>
        </button>
      {/snippet}

      <div class="q">
        <header>
          <strong>{t("Cola")}</strong>
          <span class="gpu" title={t("La GPU hace una cosa a la vez; CPU y red, en paralelo")}><Icon name="gpu" size={13} />{gpu || "GPU"}</span>
          <span class="grow"></span>
          {#if running.length || pending.length}
            <Button size="sm" variant="ghost" onclick={() => confirm(t("¿Cancelar todo lo pendiente y lo que está en marcha?")) && cancelAll()}>{t("Cancelar todo")}</Button>
          {/if}
        </header>

        {#each running as j (j.id)}
          {@const [icon, lane] = LANE[j.steps[j.cur]?.res ?? "cpu"]}
          <div class="job run">
            <ProgressRing value={j.pct != null ? j.pct / 100 : null} size={28} stroke={2.5}>
              <Icon name={icon} size={12} label={t(lane)} />
            </ProgressRing>
            <button type="button" class="main" onclick={() => go(j.key)}>
              <span class="t">{titleOf(j)}</span>
              <span class="s">{engineLabel(j.waiting || j.label)}{j.pct != null ? ` · ${Math.round(j.pct)} %` : ""}</span>
            </button>
            <IconButton icon="close" label={t("Cancelar")} size="sm" onclick={() => cancel([j.id])} />
          </div>
        {/each}

        {#if pending.length}
          <h3>{t("En espera")} <span class="num">{pending.length}</span></h3>
          {#each pending.slice(0, 40) as j (j.id)}
            <div class="job">
              <span class="steps" aria-hidden="true">
                {#each j.steps as s, k (k)}<i class:gpu={s.res === "gpu"} class:did={s.status === "done" || s.status === "skipped"}></i>{/each}
              </span>
              <button type="button" class="main" onclick={() => go(j.key)}>
                <span class="t">{titleOf(j)}</span>
                <span class="s">{t(actionLabel(j))} · {jobText(j)}</span>
              </button>
              <IconButton icon="top" label={t("Pasar al principio")} size="sm" onclick={() => top([j.id])} />
              <IconButton icon="close" label={t("Quitar")} size="sm" onclick={() => cancel([j.id])} />
            </div>
          {/each}
        {/if}

        {#if failed.length}
          <h3 class="bad"><Icon name="alert" size={13} /> {t("Fallaron")} <span class="num">{failed.length}</span>
            <span class="grow"></span><Button size="sm" variant="ghost" icon="retry" onclick={() => retry(failed.map((j) => j.id))}>{t("Reintentar")}</Button>
          </h3>
          {#each failed.slice(0, 20) as j (j.id)}
            <div class="job">
              <span class="x" aria-hidden="true">×</span>
              <button type="button" class="main" onclick={() => go(j.key)} title={j.error}>
                <span class="t">{titleOf(j)}</span>
                <span class="s err">{t(actionLabel(j))} · {j.error}</span>
              </button>
              <IconButton icon="retry" label={t("Reintentar")} size="sm" onclick={() => retry([j.id])} />
            </div>
          {/each}
        {/if}

        {#if ok.length}
          <h3>
            <button type="button" class="fold" onclick={() => (showDone = !showDone)} aria-expanded={showDone}>
              <Icon name={showDone ? "chevron-down" : "chevron-right"} size={12} /> {t("Terminados")} <span class="num">{ok.length}</span>
            </button>
            <span class="grow"></span><Button size="sm" variant="ghost" onclick={clearFinished}>{t("Limpiar")}</Button>
          </h3>
          {#if showDone}
            {#each ok.slice(0, 40) as j (j.id)}
              <div class="job dim">
                <Icon name="check" size={14} />
                <button type="button" class="main" onclick={() => go(j.key)}>
                  <span class="t">{titleOf(j)}</span>
                  <span class="s">{t(actionLabel(j))} · {t(j.status === "canceled" ? "cancelado hace {ago}" : "hecho hace {ago}", { ago: ago(j.finished) })}</span>
                </button>
              </div>
            {/each}
          {/if}
        {/if}

        {#if !running.length && !pending.length && !failed.length && !ok.length}
          <p class="none">{t("Nada en la cola.")}</p>
        {/if}
      </div>
    </Popover>
  </div>
{/if}

<style>
  .dock { position: fixed; right: var(--s4); bottom: var(--s4); z-index: 50; transition: bottom var(--t) var(--ease); }
  .dock.raised { bottom: calc(var(--player-h) + var(--s3)); }
  .pill {
    display: flex; align-items: center; gap: var(--s2); height: 36px; max-width: 340px; padding: 0 var(--s2) 0 var(--s2);
    border: 1px solid var(--line-hi); border-radius: var(--r-full); background: var(--panel); color: var(--text); box-shadow: var(--shadow);
    font-size: var(--fs-sm); animation: rise var(--t-slow) var(--ease);
  }
  .pill:hover { background: var(--panel-hi); }
  .pill.alert { color: var(--bad); }
  .what { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-2); }
  .pill b { font-weight: 700; }

  .q { display: flex; flex-direction: column; gap: 2px; padding: var(--s1); }
  header { display: flex; align-items: center; gap: var(--s2); padding: var(--s1) var(--s1) var(--s2); }
  header strong { font-size: var(--fs-lg); }
  .gpu { display: inline-flex; align-items: center; gap: 4px; color: var(--text-3); font-size: var(--fs-xs); white-space: nowrap; overflow: hidden; }
  .grow { flex: 1; }
  h3 {
    display: flex; align-items: center; gap: 6px; margin: var(--s2) 0 0; padding: 0 var(--s1); min-height: 28px;
    font-size: var(--fs-xs); font-weight: 600; color: var(--text-3); text-transform: uppercase; letter-spacing: 0.04em;
  }
  h3.bad { color: var(--bad); }
  h3 .num { font-weight: 400; }
  .fold { display: inline-flex; align-items: center; gap: 6px; border: 0; background: none; padding: 0; color: inherit; font: inherit; letter-spacing: inherit; text-transform: inherit; }
  .job { display: flex; align-items: center; gap: var(--s2); padding: 4px var(--s1); border-radius: var(--r-md); min-width: 0; }
  .job:hover { background: var(--panel-hi); }
  .job.run { padding: 6px var(--s1); }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; border: 0; background: none; padding: 0; text-align: left; }
  .t { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
  .s { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-3); font-size: var(--fs-sm); }
  .s.err { color: var(--bad); }
  .dim { color: var(--text-3); }
  .x { width: 14px; text-align: center; color: var(--bad); font-weight: 700; }
  .steps { display: flex; gap: 2px; width: 28px; flex-wrap: wrap; justify-content: center; }
  .steps i { width: 6px; height: 6px; border-radius: 50%; border: 1px solid var(--line-hi); }
  .steps i.gpu { border-radius: 1px; }
  .steps i.did { background: var(--text-2); border-color: var(--text-2); }
  .none { padding: var(--s3) var(--s1); color: var(--text-3); }
</style>
