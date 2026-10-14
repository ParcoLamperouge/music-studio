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
  };
</script>

<script lang="ts">
  import { onMount } from "svelte";
  import { stars } from "./course";
  import { loadPiano } from "./piano";
  import { voice } from "./player";

  /** Prueba de oído: diez preguntas; cada una se oye (intervalo seguido y luego junto; acorde junto y luego
   * arpegiado) y se contesta con botones. Al acabar, `onresult` con el acierto (0-1). */
  let { quiz, onresult }: { quiz: Quiz; onresult: (acc: number) => void } = $props();

  const ROUNDS = 10;
  const q = $derived(QUIZZES[quiz]);
  let n = $state(0); // pregunta (0…ROUNDS-1)
  let right = $state(0);
  let current = $state<{ root: number; answer: number } | null>(null);
  let picked = $state<number | null>(null);
  let done = $state(false);
  let ctx: AudioContext | null = null;
  onMount(() => () => void ctx?.close());

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
    if (i === current.answer) right++;
    setTimeout(() => {
      if (++n >= ROUNDS) {
        done = true;
        onresult(right / ROUNDS);
      } else ask();
    }, i === current.answer ? 700 : 1600);
  }

  function restart() {
    [n, right, done] = [0, 0, false];
    ask();
  }
</script>

<div class="quiz">
  {#if done}
    <p class="result">
      <strong>{right}/{ROUNDS}</strong>
      <span class="stars">{"★".repeat(stars(right / ROUNDS))}{"☆".repeat(3 - stars(right / ROUNDS))}</span>
      {right / ROUNDS >= 0.85 ? "¡Muy bien!" : right / ROUNDS >= 0.6 ? "Vas bien: repítela otro día y saldrá sola." : "Escucha despacio y repite: el oído se entrena con constancia."}
    </p>
    <button class="ghost" onclick={restart}>Otra vez</button>
  {:else if !current}
    <button class="primary" onclick={ask}>Empezar ({ROUNDS} preguntas)</button>
  {:else}
    <div class="head">
      <span>{q.title} <small class="muted">{n + 1}/{ROUNDS}</small></span>
      <button class="ghost" onclick={play}>♪ Repetir</button>
    </div>
    <div class="opts">
      {#each q.options as o, i (o.label)}
        <button class="ghost opt" class:ok={picked != null && i === current.answer} class:bad={picked === i && i !== current.answer} onclick={() => answer(i)}>{o.label}</button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .quiz { display: flex; flex-direction: column; gap: 10px; padding: 12px; border-radius: 12px; background: var(--bg); border: 1px solid var(--line); }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .opts { display: flex; flex-wrap: wrap; gap: 6px; }
  .opt { min-width: 70px; }
  .opt.ok { background: color-mix(in srgb, #9bd37f 30%, var(--panel)); border-color: #9bd37f; color: var(--text); }
  .opt.bad { background: color-mix(in srgb, #ff7a6b 25%, var(--panel)); border-color: #ff7a6b; }
  .result { margin: 0; display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .stars { color: var(--accent); letter-spacing: 2px; font-size: 16px; }
</style>
