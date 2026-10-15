<script lang="ts" module>
  import type { Quiz } from "./course";

  type Option = { label: string; iv: number[] }; // iv: semitonos desde la nota de abajo (el primero, 0)
  export const QUIZZES: Record<Quiz, { title: string; chord: boolean; options: Option[] }> = {
    "intervalos-basicos": {
      title: "¿Qué intervalo es?", chord: false,
      options: [{ label: "2.ª", iv: [0, 2] }, { label: "3.ª", iv: [0, 4] }, { label: "5.ª", iv: [0, 7] }, { label: "8.ª", iv: [0, 12] }],
    },
    intervalos: {
      title: "¿Qué intervalo es?", chord: false,
      options: [
        ["2.ª m", 1], ["2.ª M", 2], ["3.ª m", 3], ["3.ª M", 4], ["4.ª", 5], ["Tritono", 6],
        ["5.ª", 7], ["6.ª m", 8], ["6.ª M", 9], ["7.ª m", 10], ["7.ª M", 11], ["8.ª", 12],
      ].map(([label, n]) => ({ label: label as string, iv: [0, n as number] })),
    },
    "mayor-menor": { title: "¿Mayor o menor?", chord: true, options: [{ label: "Mayor", iv: [0, 4, 7] }, { label: "Menor", iv: [0, 3, 7] }] },
    acordes: {
      title: "¿Qué acorde es?", chord: true,
      options: [{ label: "Mayor", iv: [0, 4, 7] }, { label: "Menor", iv: [0, 3, 7] }, { label: "Disminuido", iv: [0, 3, 6] }, { label: "Aumentado", iv: [0, 4, 8] }],
    },
    septimas: {
      title: "¿Qué acorde es?", chord: true,
      options: [{ label: "maj7", iv: [0, 4, 7, 11] }, { label: "7", iv: [0, 4, 7, 10] }, { label: "m7", iv: [0, 3, 7, 10] }, { label: "m7(b5)", iv: [0, 3, 6, 10] }],
    },
  };
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { stars } from "./course";
  import { loadPiano } from "./piano";
  import { voice } from "./player";
  import Answer from "./ui/Answer.svelte";
  import Button from "./ui/Button.svelte";
  import Icon from "./ui/Icon.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import ProgressRing from "./ui/ProgressRing.svelte";

  /** Prueba de oído del curso: diez preguntas; cada una se oye (intervalo seguido y luego junto; acorde junto y luego
   * arpegiado) y se contesta con botones (o 1-9; R repite). Al acabar, `onresult` con el acierto (0-1). */
  let { quiz, onresult }: { quiz: Quiz; onresult: (acc: number) => void } = $props();

  const ROUNDS = 10;
  const q = $derived(QUIZZES[quiz]);
  let n = $state(0); // pregunta (0…ROUNDS-1)
  let marks = $state<boolean[]>([]);
  let current = $state<{ root: number; answer: number } | null>(null);
  let picked = $state<number | null>(null);
  let done = $state(false);
  let ctx: AudioContext | null = null;
  onMount(() => () => void ctx?.close());
  const right = $derived(marks.filter(Boolean).length);

  function ask() {
    current = { root: 55 + Math.floor(Math.random() * 12), answer: Math.floor(Math.random() * q.options.length) };
    picked = null;
    void play();
  }

  async function play() {
    if (!current) return;
    ctx ??= new AudioContext();
    void ctx.resume();
    await loadPiano().catch(() => {});
    const ps = q.options[current.answer].iv.map((i) => current!.root + i);
    const hit = (group: number[], at: number, len: number) =>
      setTimeout(() => {
        const stops = group.map((p) => voice(ctx!, p, 0.7));
        setTimeout(() => stops.forEach((s) => s()), len);
      }, at);
    if (q.chord) {
      hit(ps, 0, 1300);
      ps.forEach((p, i) => hit([p], 1500 + i * 350, 330));
    } else {
      ps.forEach((p, i) => hit([p], i * 600, 560));
      hit(ps, 1350, 1100);
    }
  }

  function answer(i: number) {
    if (picked != null || !current) return;
    picked = i;
    marks = [...marks, i === current.answer];
    setTimeout(() => {
      if (++n >= ROUNDS) {
        done = true;
        onresult(right / ROUNDS);
      } else ask();
    }, i === current.answer ? 700 : 1600);
  }

  function restart() {
    [n, marks, done] = [0, [], false];
    ask();
  }

  function onkey(e: KeyboardEvent) {
    if (!current || done || (e.target as HTMLElement).closest("input, textarea, select")) return;
    if (e.key === "r" || e.key === "R") void play();
    else if (/^[1-9]$/.test(e.key) && q.options[+e.key - 1]) answer(+e.key - 1);
  }
</script>

<svelte:window onkeydown={onkey} />

<div class="quiz">
  {#if done}
    <div class="result">
      <ProgressRing value={right / ROUNDS} size={72} stroke={6} color={right / ROUNDS >= 0.85 ? "var(--ok)" : right / ROUNDS >= 0.6 ? "var(--warn)" : "var(--bad)"}>
        <strong class="num">{right}/{ROUNDS}</strong>
      </ProgressRing>
      <span class="stars" aria-label="{stars(right / ROUNDS)} de 3 estrellas">
        {#each [0, 1, 2] as i (i)}<span class:on={i < stars(right / ROUNDS)}><Icon name="star" size={18} /></span>{/each}
      </span>
      <Button icon="retry" onclick={restart}>Otra vez</Button>
    </div>
  {:else if !current}
    <Button variant="primary" icon="ear" onclick={ask}>Empezar · {ROUNDS} preguntas</Button>
  {:else}
    <div class="head">
      <IconButton icon="volume" label="Repetir" kbd="R" onclick={play} />
      <strong>{q.title}</strong>
      <span class="fill"></span>
      <span class="dots" aria-label="Pregunta {n + 1} de {ROUNDS}">
        {#each Array(ROUNDS) as _, i (i)}<i class:ok={marks[i] === true} class:bad={marks[i] === false} class:now={i === n}></i>{/each}
      </span>
    </div>
    <div class="opts" style:--cols={Math.min(q.options.length, 4)}>
      {#each q.options as o, i (o.label)}
        <Answer kbd={String(i + 1)} onclick={() => answer(i)} disabled={picked != null}
          state={picked == null ? "idle" : i === current.answer ? "right" : picked === i ? "wrong" : "dim"}>{o.label}</Answer>
      {/each}
    </div>
  {/if}
</div>

<style>
  .quiz { display: flex; flex-direction: column; gap: var(--s3); padding: var(--s3); border-radius: var(--r-lg); background: var(--bg); align-self: stretch; }
  .head { display: flex; align-items: center; gap: var(--s2); }
  .fill { flex: 1; }
  .opts { display: grid; grid-template-columns: repeat(var(--cols), minmax(0, 1fr)); gap: var(--s2); }
  .dots { display: flex; gap: 4px; }
  .dots i { width: 8px; height: 8px; border-radius: 50%; background: var(--line-hi); }
  .dots .now { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3px var(--text-2); }
  .dots .ok { background: var(--ok); }
  .dots .bad { background: var(--bad); }
  .result { display: flex; align-items: center; gap: var(--s4); flex-wrap: wrap; }
  .result strong { font-size: var(--fs-sm); }
  .stars { display: flex; gap: 2px; color: var(--line-hi); }
  .stars .on { color: var(--warn); }
  .stars .on :global(svg) { fill: currentColor; }
</style>
