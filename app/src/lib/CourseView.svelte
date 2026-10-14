<script lang="ts">
  import { onMount, tick } from "svelte";
  import { LESSONS, practiceSteps, STAGES, stars, type Area, type Lesson, type Practice } from "./course";
  import EarQuiz from "./EarQuiz.svelte";
  import { EXERCISES } from "./exercises";
  import KeyDiagram from "./KeyDiagram.svelte";
  import { OBRAS } from "./obras";
  import { bestOf, courseDone, lessonDone, lessonStars, loadProgress, markOpened, nextLesson, progress, record, streak } from "./progress.svelte";
  import { midiOf, SONGS } from "./songs";

  /** El curso: la ruta de 0 a experto (o por temas), con teoría y práctica en cada lección. */
  let { onback, onpractice }: { onback: () => void; onpractice: (lesson: string, step: number) => void } = $props();

  let view = $state<"ruta" | "temas">("ruta");
  let lesson = $state<Lesson | null>(null);
  let quizOpen = $state<number | null>(null);
  let main: HTMLElement;

  onMount(async () => {
    await loadProgress();
    // vuelve de practicar a la lección de la que salió
    const params = new URLSearchParams(location.search);
    open(LESSONS.find((l) => l.id === params.get("leccion")) ?? nextLesson() ?? LESSONS[0]);
    // y al paso que se estaba practicando, para seguir desde ahí
    if (params.get("paso")) {
      await tick();
      document.getElementById(`paso-${params.get("paso")}`)?.scrollIntoView({ block: "center" });
    }
  });

  function open(l: Lesson) {
    lesson = l;
    quizOpen = null;
    void markOpened(l.id);
    main?.scrollTo({ top: 0 });
  }

  const byId = (id: string) => LESSONS.find((l) => l.id === id)!;
  const AREAS = $derived([...new Set(LESSONS.map((l) => l.area))] as Area[]);
  const next = $derived.by(() => (void progress.results, nextLesson()));
  const pct = $derived.by(() => (void progress.results, Math.round(courseDone() * 100)));
  const days = $derived.by(() => (void progress.days, streak()));

  /** Texto con **negritas**, sin HTML. */
  const parts = (t: string) => t.split("**").map((s, i) => ({ s, b: i % 2 === 1 }));

  function describe(p: Practice) {
    if (p.kind === "ejercicio") return `Ejercicio · ${EXERCISES.find((e) => e.id === p.id)?.title ?? p.id}${p.key ? ` · ${p.key}` : ""}`;
    if (p.kind === "cancion") return `Canción · ${SONGS.find((s) => s.id === p.id)?.title ?? p.id}`;
    if (p.kind === "obra") {
      const o = OBRAS.find((x) => x.id === p.id);
      return o ? `Obra · ${o.composer}: ${o.title}` : "Obra";
    }
    return "Prueba de oído";
  }
  const hands = (p: Practice) => ("hands" in p && p.hands ? { rh: "derecha", lh: "izquierda", both: "manos juntas" }[p.hands] : "");
</script>

<div class="course">
  <aside>
    <header>
      <button class="ghost" onclick={onback} title="Volver al menú">← Menú</button>
      <strong>Curso</strong>
    </header>
    <div class="stats">
      <span title="Días seguidos practicando">🔥 {days} {days === 1 ? "día" : "días"}</span>
      <span title="Lecciones hechas">{pct} %</span>
      {#if next}<button class="primary small" onclick={() => open(next)} title={next.title}>Continuar</button>{/if}
    </div>
    <div class="bar"><i style:width="{pct}%"></i></div>
    <div class="tabs">
      <button class:on={view === "ruta"} onclick={() => (view = "ruta")}>Ruta</button>
      <button class:on={view === "temas"} onclick={() => (view = "temas")}>Por temas</button>
    </div>
    <div class="list">
      {#if view === "ruta"}
        {#each STAGES as stage, si (stage)}
          <span class="kicker group">{si + 1} · {stage}</span>
          {#each LESSONS.filter((l) => l.stage === si + 1) as l (l.id)}
            {@render item(l)}
          {/each}
        {/each}
      {:else}
        {#each AREAS as area (area)}
          <span class="kicker group">{area}</span>
          {#each LESSONS.filter((l) => l.area === area) as l (l.id)}
            {@render item(l)}
          {/each}
        {/each}
      {/if}
    </div>
  </aside>

  {#snippet item(l: Lesson)}
    {@const done = (void progress.results, lessonDone(l))}
    <button class="item" class:on={lesson?.id === l.id} class:done onclick={() => open(l)}>
      <span class="check">{done ? "✓" : next?.id === l.id ? "→" : ""}</span>
      <span class="name">{l.title}</span>
      <span class="st">{"★".repeat(lessonStars(l))}</span>
    </button>
  {/snippet}

  <main bind:this={main}>
    {#if lesson}
      <span class="kicker">Etapa {lesson.stage} · {STAGES[lesson.stage - 1]} · {lesson.area}</span>
      <h1>{lesson.title}</h1>
      <p class="summary">{lesson.summary}</p>
      {#if lesson.requires?.length || lesson.related?.length}
        <p class="links">
          {#if lesson.requires?.length}
            Conviene antes:
            {#each lesson.requires as r (r)}<button class="chip" class:done={lessonDone(byId(r))} onclick={() => open(byId(r))}>{byId(r).title}</button>{/each}
          {/if}
          {#if lesson.related?.length}
            Se complementa con:
            {#each lesson.related as r (r)}<button class="chip" onclick={() => open(byId(r))}>{byId(r).title}</button>{/each}
          {/if}
        </p>
      {/if}

      {#each lesson.steps as step, i (i)}
        {#if "t" in step}
          <section class="card theory">
            <p>{#each parts(step.t) as x, j (j)}{#if x.b}<strong>{x.s}</strong>{:else}{x.s}{/if}{/each}</p>
            {#if step.keys?.length}<KeyDiagram keys={step.keys.map(midiOf)} together={step.together} />{/if}
          </section>
        {:else}
          {@const best = (void progress.results, bestOf(lesson.id, i))}
          {@const goal = step.goal ?? 0.85}
          <section class="card practice" id="paso-{i}" class:passed={(best ?? 0) >= goal}>
            <div class="ph">
              <span class="badge">{step.p.kind === "oido" ? "Oído" : "Práctica"}</span>
              <strong>{step.title}</strong>
              <span class="stars" title={best != null ? `Mejor: ${Math.round(best * 100)} %` : "Sin hacer"}>{"★".repeat(stars(best))}{"☆".repeat(3 - stars(best))}</span>
            </div>
            <p class="muted desc">{describe(step.p)}{hands(step.p) ? ` · ${hands(step.p)}` : ""} · objetivo {Math.round(goal * 100)} %{best != null ? ` · tu mejor: ${Math.round(best * 100)} %` : ""}</p>
            {#if step.p.kind === "oido"}
              {#if quizOpen === i}
                <EarQuiz quiz={step.p.quiz} onresult={(acc) => lesson && record(lesson.id, i, acc)} />
              {:else}
                <button class="primary" onclick={() => (quizOpen = i)}>Hacer la prueba</button>
              {/if}
            {:else}
              <button class="primary" onclick={() => lesson && onpractice(lesson.id, i)}>Practicar</button>
            {/if}
          </section>
        {/if}
      {/each}

      {@const idx = LESSONS.indexOf(lesson)}
      <nav class="pager">
        {#if idx > 0}<button class="ghost" onclick={() => open(LESSONS[idx - 1])}>← {LESSONS[idx - 1].title}</button>{/if}
        <span class="grow"></span>
        {#if idx < LESSONS.length - 1}<button class="ghost" onclick={() => open(LESSONS[idx + 1])}>{LESSONS[idx + 1].title} →</button>{/if}
      </nav>
      <p class="muted foot">{practiceSteps(lesson).length} prácticas · las estrellas salen de tu mejor resultado (★ 70 %, ★★ 85 %, ★★★ 95 %). Nada está bloqueado: abre las lecciones en el orden que quieras.</p>
    {/if}
  </main>
</div>

<style>
  .course { height: 100vh; display: grid; grid-template-columns: 300px 1fr; }
  aside { background: var(--sidebar); border-right: 1px solid var(--line); display: flex; flex-direction: column; min-height: 0; gap: 8px; }
  aside header { display: flex; align-items: center; gap: 12px; padding: 14px; border-bottom: 1px solid var(--line); }
  aside strong { font-family: var(--serif); font-weight: 400; font-size: 24px; }
  .stats { display: flex; align-items: center; gap: 12px; padding: 0 14px; font-size: 13px; color: var(--text-2); }
  .stats .small { margin-left: auto; padding: 4px 12px; font-size: 12.5px; }
  aside .bar { margin: 0 14px; height: 4px; }
  .tabs { display: flex; margin: 0 10px; padding: 3px; border-radius: 10px; background: var(--bg); border: 1px solid var(--line); }
  .tabs button { flex: 1; padding: 5px 8px; border: 0; border-radius: 7px; background: none; color: var(--text-2); font-size: 12.5px; }
  .tabs button.on { background: var(--panel-hi); color: var(--text); }
  .list { overflow-y: auto; padding: 0 8px 12px; display: flex; flex-direction: column; gap: 1px; }
  .group { padding: 12px 8px 4px; }
  .item { display: grid; grid-template-columns: 16px 1fr auto; align-items: center; gap: 6px; padding: 6px 10px; border-radius: 9px; border: 0; background: none; color: var(--text-2); text-align: left; font-size: 13px; }
  .item:hover { background: var(--panel); color: var(--text); }
  .item.on { background: var(--panel-hi); color: var(--text); box-shadow: inset 2px 0 0 var(--accent); }
  .item.done .name { color: var(--text); }
  .check { color: var(--ok); font-size: 12px; }
  .st { color: var(--accent); font-size: 11px; letter-spacing: 1px; }

  main { overflow-y: auto; padding: 28px 44px 60px; max-width: 980px; }
  h1 { font-family: var(--serif); font-weight: 400; font-size: 44px; margin: 6px 0 4px; }
  .summary { margin: 0 0 12px; color: var(--text-2); font-size: 15px; }
  .links { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: 12.5px; color: var(--text-3); margin: 0 0 18px; }
  .chip { padding: 2px 10px; border-radius: 99px; border: 1px solid var(--line); background: var(--panel); color: var(--text-2); font-size: 12px; }
  .chip.done { border-color: color-mix(in srgb, var(--ok) 50%, var(--line)); }
  .card { margin: 12px 0; padding: 16px 18px; border-radius: 14px; border: 1px solid var(--line); background: var(--panel); }
  .theory p { margin: 0; font-size: 15px; line-height: 1.65; }
  .theory strong { color: var(--accent); font-weight: 600; }
  .practice { border-color: color-mix(in srgb, var(--accent) 35%, var(--line)); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
  .practice.passed { border-color: color-mix(in srgb, var(--ok) 50%, var(--line)); }
  .ph { display: flex; align-items: center; gap: 10px; width: 100%; }
  .badge { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.08em; padding: 2px 8px; border-radius: 99px; background: var(--accent-soft); color: var(--accent); }
  .ph .stars { margin-left: auto; color: var(--accent); letter-spacing: 2px; }
  .desc { margin: 0; font-size: 12.5px; }
  .pager { display: flex; gap: 10px; margin-top: 24px; }
  .grow { flex: 1; }
  .foot { font-size: 12px; margin-top: 18px; }
</style>
