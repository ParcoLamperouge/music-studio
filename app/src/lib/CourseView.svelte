<script lang="ts">
  import { onMount, tick } from "svelte";
  import { LESSONS, practiceSteps, STAGES, stars, type Area, type Lesson, type Practice } from "./course";
  import EarQuiz from "./EarQuiz.svelte";
  import { EXERCISES } from "./exercises";
  import { t } from "./i18n.svelte";
  import KeyDiagram from "./KeyDiagram.svelte";
  import { OBRAS } from "./obras";
  import { bestOf, courseDone, lessonDone, lessonStars, loadProgress, markOpened, nextLesson, progress, record, streak } from "./progress.svelte";
  import { midiOf, SONGS } from "./songs";
  import Button from "./ui/Button.svelte";
  import Chip from "./ui/Chip.svelte";
  import Heatmap from "./ui/Heatmap.svelte";
  import Icon, { type IconName } from "./ui/Icon.svelte";
  import ProgressRing from "./ui/ProgressRing.svelte";
  import Tabs from "./ui/Tabs.svelte";

  /** El curso: un mapa de lecciones (la ruta por etapas, o por temas) con el progreso de cada una, la racha y el
   * calendario; cada lección, su teoría y su práctica en una línea de pasos. */
  let { onpractice }: { onback: () => void; onpractice: (lesson: string, step: number) => void } = $props();

  let view = $state<"ruta" | "temas">("ruta");
  let lesson = $state<Lesson | null>(null);
  let quizOpen = $state<number | null>(null);
  let main: HTMLElement;

  onMount(async () => {
    await loadProgress();
    // vuelve de practicar a la lección de la que salió, al paso que se estaba practicando
    const params = new URLSearchParams(location.search);
    const l = LESSONS.find((x) => x.id === params.get("leccion"));
    if (!l) return;
    open(l);
    if (params.get("paso")) {
      await tick();
      document.getElementById(`paso-${params.get("paso")}`)?.scrollIntoView({ block: "center" });
    }
  });

  function open(l: Lesson | null) {
    lesson = l;
    quizOpen = null;
    if (l) void markOpened(l.id);
    main?.scrollTo({ top: 0 });
  }

  const byId = (id: string) => LESSONS.find((l) => l.id === id)!;
  const AREAS = [...new Set(LESSONS.map((l) => l.area))] as Area[];
  const groups = $derived(
    view === "ruta"
      ? STAGES.map((s, i) => ({ label: `${i + 1} · ${s}`, list: LESSONS.filter((l) => l.stage === i + 1) }))
      : AREAS.map((a) => ({ label: a, list: LESSONS.filter((l) => l.area === a) })),
  );
  const next = $derived.by(() => (void progress.results, nextLesson()));
  const pct = $derived.by(() => (void progress.results, courseDone()));
  const days = $derived.by(() => (void progress.days, streak()));

  /** Cuántas prácticas de la lección llegan a su objetivo (0-1). */
  function passed(l: Lesson) {
    void progress.results;
    const ps = practiceSteps(l);
    return ps.length ? ps.filter(([s, i]) => (bestOf(l.id, i) ?? 0) >= (s.goal ?? 0.85)).length / ps.length : lessonDone(l) ? 1 : 0;
  }

  /** Texto con **negritas**, sin HTML. */
  const parts = (tr: string) => tr.split("**").map((s, i) => ({ s, b: i % 2 === 1 }));

  function describe(p: Practice): [IconName, string] {
    if (p.kind === "ejercicio") return ["learn", `${EXERCISES.find((e) => e.id === p.id)?.title ?? p.id}${p.key ? ` · ${p.key}` : ""}`];
    if (p.kind === "cancion") return ["notes", SONGS.find((s) => s.id === p.id)?.title ?? p.id];
    if (p.kind === "obra") {
      const o = OBRAS.find((x) => x.id === p.id);
      return ["score", o ? `${o.composer}: ${o.title}` : t("Obra")];
    }
    return ["ear", t("Prueba de oído")];
  }
  const hands = (p: Practice) => ("hands" in p && p.hands ? { rh: t("derecha"), lh: t("izquierda"), both: t("dos manos") }[p.hands] : "");
  const ringColor = (best: number | undefined, goal: number) => (best == null ? "var(--line-hi)" : best >= goal ? "var(--ok)" : "var(--warn)");
</script>

{#snippet starRow(n: number, size = 12)}
  <span class="stars" aria-label={t("{n} de 3 estrellas")}>{#each [0, 1, 2] as i (i)}<span class:on={i < n}><Icon name="star" {size} /></span>{/each}</span>
{/snippet}

<section class="course" bind:this={main}>
  {#if !lesson}
    <header class="hero">
      <div class="big">
        <ProgressRing value={pct} size={88} stroke={7} label={t("Curso hecho")}><strong class="num">{Math.round(pct * 100)}<small>%</small></strong></ProgressRing>
        <div class="who">
          <h1>{t("Curso")}</h1>
          <span class="streak" title={t("Días seguidos practicando")}><Icon name="flame" size={16} /> <b class="num">{days}</b> {days === 1 ? t("1 día seguido") : t("{n} días seguidos", { n: days })}</span>
          {#if next}<Button variant="primary" icon="play" onclick={() => open(next)} title={t("La siguiente recomendada")}>{next.title}</Button>{/if}
        </div>
      </div>
      <div class="cal" title={t("Días con práctica")}><Heatmap days={progress.days} weeks={20} /></div>
    </header>

    <div class="order"><Tabs bind:value={view} variant="underline" options={[{ value: "ruta", label: t("Ruta") }, { value: "temas", label: t("Por temas") }]} label={t("Orden")} /></div>

    <div class="map">
      {#each groups as g (g.label)}
        {@const done = g.list.filter((l) => passed(l) >= 1).length}
        <section class="stage" class:all={done === g.list.length}>
          <h2>{g.label} <small class="num">{done}/{g.list.length}</small></h2>
          <ol class="path">
            {#each g.list as l (l.id)}
              {@const p = passed(l)}
              <li>
                <button type="button" class="node" class:next={next?.id === l.id} class:done={p >= 1} onclick={() => open(l)} title={l.summary}>
                  <ProgressRing value={p} size={52} stroke={4} color={p >= 1 ? "var(--ok)" : next?.id === l.id ? "var(--accent)" : "var(--text-2)"} label={l.title}>
                    {#if p >= 1}<Icon name="check" size={20} />{:else if next?.id === l.id}<Icon name="play" size={16} />{:else}<span class="num">{LESSONS.indexOf(l) + 1}</span>{/if}
                  </ProgressRing>
                  <span class="t">{l.title}</span>
                  {@render starRow(lessonStars(l), 10)}
                </button>
              </li>
            {/each}
          </ol>
        </section>
      {/each}
      <p class="foot">{t("Nada está bloqueado: abre las lecciones en el orden que quieras. Estrellas: 70 · 85 · 95 %.")}</p>
    </div>
  {:else}
    {@const idx = LESSONS.indexOf(lesson)}
    <article class="lesson">
      <nav class="crumb">
        <Button size="sm" variant="ghost" icon="back" onclick={() => open(null)}>{t("Curso")}</Button>
        <span class="eyebrow">{t("Etapa {n}", { n: lesson.stage })} · {STAGES[lesson.stage - 1]} · {lesson.area}</span>
      </nav>
      <header class="lh">
        <ProgressRing value={passed(lesson)} size={56} stroke={5} color={passed(lesson) >= 1 ? "var(--ok)" : "var(--accent)"} label={t("Lección")}>
          {@render starRow(lessonStars(lesson), 9)}
        </ProgressRing>
        <div>
          <h1>{lesson.title}</h1>
          <p class="summary">{lesson.summary}</p>
        </div>
      </header>
      {#if lesson.requires?.length || lesson.related?.length}
        <div class="links">
          {#each lesson.requires ?? [] as r (r)}
            <Chip icon={lessonDone(byId(r)) ? "check" : "back"} onclick={() => open(byId(r))} title={t("Conviene antes")}>{byId(r).title}</Chip>
          {/each}
          {#each lesson.related ?? [] as r (r)}
            <Chip icon="link" onclick={() => open(byId(r))} title={t("Se complementa con")}>{byId(r).title}</Chip>
          {/each}
        </div>
      {/if}

      <ol class="steps">
        {#each lesson.steps as step, i (i)}
          {#if "t" in step}
            <li class="step theory">
              <span class="pin"></span>
              <div class="body">
                <p>{#each parts(step.t) as x, j (j)}{#if x.b}<strong>{x.s}</strong>{:else}{x.s}{/if}{/each}</p>
                {#if step.keys?.length}<KeyDiagram keys={step.keys.map(midiOf)} together={step.together} />{/if}
              </div>
            </li>
          {:else}
            {@const best = (void progress.results, bestOf(lesson.id, i))}
            {@const goal = step.goal ?? 0.85}
            {@const [icon, what] = describe(step.p)}
            <li class="step practice" id="paso-{i}" class:passed={(best ?? 0) >= goal}>
              <span class="pin ring">
                <ProgressRing value={best ?? 0} size={36} stroke={3.5} color={ringColor(best, goal)} label={t("Tu mejor")}>
                  {#if (best ?? 0) >= goal}<Icon name="check" size={14} />{:else}<Icon name={icon} size={13} />{/if}
                </ProgressRing>
              </span>
              <div class="body tcard">
                <div class="ph">
                  <strong>{step.title}</strong>
                  {@render starRow(stars(best))}
                  <span class="fill"></span>
                  <small class="num" title={t("Tu mejor / objetivo")}>{best != null ? `${Math.round(best * 100)} %` : "–"} / {Math.round(goal * 100)} %</small>
                </div>
                <small class="desc"><Icon name={icon} size={12} /> {what}{hands(step.p) ? ` · ${hands(step.p)}` : ""}</small>
                {#if step.p.kind === "oido"}
                  {#if quizOpen === i}
                    <EarQuiz quiz={step.p.quiz} onresult={(acc) => lesson && record(lesson.id, i, acc)} />
                  {:else}
                    <div><Button variant={best == null ? "primary" : "secondary"} icon="ear" onclick={() => (quizOpen = i)}>{t("Hacer la prueba")}</Button></div>
                  {/if}
                {:else}
                  <div><Button variant={best == null || best < goal ? "primary" : "secondary"} icon="play" onclick={() => lesson && onpractice(lesson.id, i)}>{t("Practicar")}</Button></div>
                {/if}
              </div>
            </li>
          {/if}
        {/each}
      </ol>

      <nav class="pager">
        {#if idx > 0}<Button variant="ghost" icon="chevron-left" onclick={() => open(LESSONS[idx - 1])}>{LESSONS[idx - 1].title}</Button>{/if}
        <span class="fill"></span>
        {#if idx < LESSONS.length - 1}<Button variant="ghost" onclick={() => open(LESSONS[idx + 1])}>{LESSONS[idx + 1].title} <Icon name="chevron-right" /></Button>{/if}
      </nav>
    </article>
  {/if}
</section>

<style>
  .course { height: 100%; min-height: 0; overflow-y: auto; padding: var(--s5) var(--s6) var(--s7); }
  .fill { flex: 1; }
  .stars { display: inline-flex; gap: 1px; color: var(--line-hi); }
  .stars .on { color: var(--warn); }
  .stars .on :global(svg) { fill: currentColor; }

  .hero { display: flex; align-items: center; justify-content: space-between; gap: var(--s5); flex-wrap: wrap; }
  .big { display: flex; align-items: center; gap: var(--s4); min-width: 0; }
  .big strong { font-size: var(--fs-xl); }
  .big strong small { font-size: var(--fs-sm); color: var(--text-2); }
  .who { display: flex; flex-direction: column; align-items: flex-start; gap: var(--s2); min-width: 0; }
  .streak { display: inline-flex; align-items: center; gap: 6px; color: var(--text-2); font-size: var(--fs-sm); }
  .streak b { color: var(--text); font-size: var(--fs-lg); }
  .cal { overflow-x: auto; max-width: 100%; }
  .order { display: flex; margin: var(--s5) 0 var(--s2); }

  .map { display: grid; grid-template-columns: repeat(auto-fill, minmax(440px, 1fr)); gap: var(--s5) var(--s6); }
  .foot { grid-column: 1 / -1; }
  .stage h2 { font-size: var(--fs-md); color: var(--text-2); font-weight: 500; margin-bottom: var(--s3); }
  .stage h2 small { color: var(--text-3); margin-left: var(--s2); }
  .stage.all h2 small { color: var(--ok); }
  .path { position: relative; display: flex; flex-wrap: wrap; gap: var(--s2) var(--s1); margin: 0; padding: 0; list-style: none; }
  .path li { position: relative; width: 120px; }
  /* el camino: una línea por detrás de los anillos, de uno al siguiente */
  .path li:not(:last-child)::after { content: ""; position: absolute; top: 31px; left: calc(50% + 30px); width: calc(100% - 56px); height: 2px; background: var(--line); }
  .node {
    display: flex; flex-direction: column; align-items: center; gap: 6px; width: 100%; padding: var(--s1) var(--s1) var(--s2); border: 0;
    border-radius: var(--r-lg); background: none; color: var(--text-2); transition: background var(--t-fast), color var(--t-fast);
  }
  .node:hover { background: var(--panel); color: var(--text); }
  .node.done, .node.next { color: var(--text); }
  .node.done :global(.in) { color: var(--ok); }
  .node.next :global(.in) { color: var(--accent); }
  .node .t { font-size: var(--fs-sm); text-align: center; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .node .num { font-size: var(--fs-sm); color: var(--text-3); }
  .foot { font-size: var(--fs-xs); color: var(--text-3); }

  .lesson { max-width: 860px; margin: 0 auto; display: flex; flex-direction: column; gap: var(--s4); }
  .crumb { display: flex; align-items: center; gap: var(--s3); margin-left: calc(-1 * var(--s2)); }
  .eyebrow { font-size: var(--fs-xs); color: var(--text-3); }
  .lh { display: flex; align-items: center; gap: var(--s4); }
  .lh h1 { font-size: var(--fs-2xl); }
  .summary { color: var(--text-2); margin-top: var(--s1); }
  .links { display: flex; flex-wrap: wrap; gap: var(--s1); }

  .steps { position: relative; margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: var(--s3); }
  .steps::before { content: ""; position: absolute; left: 17px; top: 8px; bottom: 8px; width: 2px; background: var(--line); }
  .step { position: relative; display: grid; grid-template-columns: 36px minmax(0, 1fr); gap: var(--s3); align-items: start; }
  .pin { justify-self: center; margin-top: 8px; width: 10px; height: 10px; border-radius: 50%; background: var(--line-hi); box-shadow: 0 0 0 4px var(--bg); }
  .pin.ring { width: auto; height: auto; margin-top: var(--s2); background: var(--bg); }
  .theory p { line-height: 1.75; color: var(--text); }
  .theory strong { font-weight: 700; color: var(--text); background: var(--panel-hi); padding: 0 3px; border-radius: var(--r-sm); }
  .tcard { display: flex; flex-direction: column; gap: var(--s2); padding: var(--s3) var(--s4); border-radius: var(--r-lg); background: var(--panel); border: 1px solid var(--line); }
  .passed .tcard { border-color: color-mix(in oklab, var(--ok) 40%, var(--line)); }
  .ph { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; }
  .ph small { color: var(--text-2); font-size: var(--fs-sm); }
  .desc { display: inline-flex; align-items: center; gap: 6px; color: var(--text-3); font-size: var(--fs-sm); }
  .pager { display: flex; gap: var(--s2); margin-top: var(--s4); }
</style>
