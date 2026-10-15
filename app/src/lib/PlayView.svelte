<script lang="ts">
  /** Tocar: lo que llega del teclado MIDI sube por un piano roll grande; encima, el acorde que suena (coloreado por su
   * función), la tonalidad en un círculo de quintas y el rastro de acordes. Se guarda solo como sesión (.mid + .json). */
  import { onMount } from "svelte";
  import { loadNotation } from "./ChordsTab.svelte";
  import { paths, writeBytes } from "./engine";
  import { chordName, keyName, noteName, type Chord, type Key } from "./harmony";
  import { connect, input, pcKey, pcRelease, send, useInput } from "./keys.svelte";
  import { Live } from "./live";
  import { drawBarLabel, drawKeys, keyLayout, keysHeight } from "./Roll.svelte";
  import { settings } from "./settings.svelte";
  import Button from "./ui/Button.svelte";
  import Chip from "./ui/Chip.svelte";
  import ChordChip from "./ui/ChordChip.svelte";
  import FifthsWheel from "./ui/FifthsWheel.svelte";
  import Icon from "./ui/Icon.svelte";
  import Kbd from "./ui/Kbd.svelte";
  import Menu, { type MenuItem } from "./ui/Menu.svelte";
  import { chordFn, cssVar, FN_LABEL } from "./ui/music";
  import Slider from "./ui/Slider.svelte";
  import { tooltip } from "./ui/tooltip";

  let { onsessions }: { onback?: () => void; onsessions: () => void } = $props();

  const LO = 21, HI = 108; // piano de 88 teclas
  const latin = loadNotation().latin;
  const store = (k: string, v?: string) => {
    try {
      return v == null ? localStorage.getItem(k) : (localStorage.setItem(k, v), v);
    } catch {
      return null;
    }
  };

  let error = $state(""); // al guardar
  let volume = $state(+(store("estudio.midi.volume") ?? 100));
  let live = new Live();
  let started: Date | null = null;
  let dirty = false;
  let saved = $state("");
  let count = $state(0); // notas tocadas

  // lo que se ve fuera del canvas: se copia del Live en cada mensaje (la tonalidad, como mucho cada 300 ms)
  let chord = $state.raw<Chord | null>(null);
  let sounding = $state.raw<number[]>([]);
  let pedal = $state(false);
  let history = $state.raw<Chord[]>([]);
  let key = $state.raw<Key | null>(null);
  let keyAt = 0;

  function sync(force = false) {
    const now = performance.now() / 1000;
    chord = live.chord;
    sounding = [...live.sounding.keys()].sort((a, b) => a - b);
    pedal = live.pedal;
    if (history.length !== live.chords.length) history = live.chords.slice();
    if (force || now - keyAt > 0.3) ((key = live.key(now)), (keyAt = now));
  }

  function feed(msg: number[]) {
    if (!live.midi(msg, performance.now() / 1000)) return;
    started ??= live.t0 >= 0 ? new Date() : null;
    dirty = started != null;
    count = live.notes.length + live.sounding.size;
    sync();
  }

  function setVolume(v: number) {
    volume = v;
    store("estudio.midi.volume", String(v));
    // CC7 (volumen del canal) en el canal del teclado; casi todos los pianos digitales lo obedecen
    send([0xb0 | live.channel, 7, v]).catch((e) => (error = String(e)));
  }

  const stamp = (d: Date) => {
    const z = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}_${z(d.getHours())}-${z(d.getMinutes())}-${z(d.getSeconds())}`;
  };

  async function save() {
    if (!started || !dirty) return;
    dirty = false;
    const base = `${paths.data}/sesiones/${stamp(started)}`;
    const { json, mid } = live.snapshot(performance.now() / 1000, input.connected || "teclado del ordenador", started, latin);
    try {
      await writeBytes(`${base}.mid`, mid);
      await writeBytes(`${base}.json`, new TextEncoder().encode(JSON.stringify(json))); // compacto: la mitad de tokens para la IA
      saved = `${base}.mid`;
    } catch (e) {
      dirty = true;
      error = `No se guardó la sesión: ${e}`;
    }
  }

  /** Guardada antes de salir, para que ya salga en la lista. */
  async function toSessions() {
    await save();
    onsessions();
  }

  async function fresh() {
    await save();
    live = new Live();
    started = null;
    saved = "";
    count = 0;
    history = [];
    sync(true);
  }

  onMount(() => {
    const stop = useInput(feed);
    const auto = setInterval(save, 15000); // si se cierra la app, como mucho se pierden 15 s
    const keyTick = setInterval(() => live.t0 >= 0 && sync(true), 1000);
    return () => {
      clearInterval(auto);
      clearInterval(keyTick);
      stop();
      void save();
    };
  });

  // ---------------------------------------------------------------- vista

  const kk = $derived(key ?? { tonic: 0, minor: false });
  const nameOf = (c: Chord) => chordName(c, kk, { latin, simple: false });
  const fn = $derived(chord && key ? chordFn(chord, key) : null);
  const trail = $derived(history.slice(-20));
  const used = $derived.by(() => {
    // peso de cada acorde por lo que ha sonado, para el círculo
    const dur = new Map<string, { root: number; kind: string; d: number }>();
    for (const c of history) {
      const id = `${c.root}${c.kind}`;
      const e = dur.get(id) ?? { root: c.root, kind: c.kind, d: 0 };
      e.d += c.end - c.t;
      dur.set(id, e);
    }
    const max = Math.max(0.01, ...[...dur.values()].map((e) => e.d));
    return [...dur.values()].map((e) => ({ ...e, w: e.d / max }));
  });
  const deviceItems = $derived<MenuItem[]>(
    input.ports.length
      ? input.ports.map((p) => ({ label: p, icon: p === input.connected ? "check" : "midi", run: () => connect(p) }))
      : [{ label: "Ningún teclado MIDI conectado", disabled: true, run: () => {} }],
  );
  const octave = $derived(`${noteName(0, { tonic: 0, minor: false }, latin)}${input.octave / 12 - 1}`);

  // ---------------------------------------------------------------- piano roll: las notas salen de la tecla y suben

  let canvas: HTMLCanvasElement;
  let width = $state(0);
  let height = $state(0);
  const keys = $derived(keyLayout(LO, HI, width));

  $effect(() => {
    if (!width || !height) return;
    const H = height;
    const dpr = devicePixelRatio;
    canvas.width = width * dpr;
    canvas.height = H * dpr;
    const g = canvas.getContext("2d")!;
    const col = { bg: cssVar("--bg"), line: cssVar("--line"), note: cssVar("--stem-piano"), hi: cssVar("--line-hi") };
    const fnCol = new Map<string, string>();
    const fnColor = (f: string) => fnCol.get(f) ?? (fnCol.set(f, cssVar(f.slice(4, -1))), fnCol.get(f)!); // "var(--fn-dom)" → hex
    let raf = 0;

    const draw = () => {
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = performance.now() / 1000;
      const t = live.time(now);
      const win = settings.rollSpeed;
      const KEYS_H = keysHeight(keys);
      const rollH = H - KEYS_H;
      const y = (x: number) => rollH - ((t - x) / win) * rollH;
      const k = key ?? { tonic: 0, minor: false };
      const name = (p: number) => noteName(p % 12, k, latin);
      const lit = live.chord && key ? fnColor(chordFn(live.chord, key).color) : col.note;
      g.fillStyle = col.bg;
      g.fillRect(0, 0, width, rollH);
      g.fillStyle = col.line;
      for (const [p, kx] of keys) if (p % 12 === 0) g.fillRect(kx.x, 0, 1, rollH);

      const bar = (s: number, e: number, p: number, v: number, on: boolean, held = true) => {
        const kx = keys.get(p);
        if (!kx) return;
        const top = Math.max(0, y(s));
        g.globalAlpha = on ? (held ? 1 : 0.7) : 0.35 + v * 0.45;
        g.shadowBlur = on ? 16 : 0;
        g.beginPath();
        g.roundRect(kx.x + 1, top, kx.w - 2, Math.max(4, y(e) - top), 3);
        g.fill();
        drawBarLabel(g, kx, y(e), y(e) - top, name(p));
      };
      g.fillStyle = g.shadowColor = col.note;
      // ponytail: recorre todas las notas cada frame; en sesiones de horas, empezar por el final y cortar
      for (const [s, e, p, v] of live.notes) if (y(e) > 0) bar(s, e, p, v, false);
      g.fillStyle = g.shadowColor = lit;
      for (const [p, n] of live.sounding) bar(n.t, t, p, n.v, true, n.held);
      g.globalAlpha = 1;
      g.shadowBlur = 0;
      g.fillStyle = col.hi;
      g.fillRect(0, rollH - 1, width, 1);
      drawKeys(g, keys, rollH, KEYS_H, new Map([...live.sounding.keys()].map((p) => [p, lit])), name);
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  });
</script>

<svelte:window onkeydown={(e) => pcKey(e, live.channel)} onkeyup={(e) => pcKey(e, live.channel)} onblur={() => pcRelease(live.channel)} />

<section class="play">
  <header class="top">
    <Menu items={deviceItems} label="Teclado MIDI">
      {#snippet trigger({ toggle, open })}
        <Button variant="ghost" icon="midi" active={open} onclick={toggle} title="De qué teclado salen las notas">
          <span class="dot" class:on={!!input.connected}></span>
          <span class="dev">{input.connected || (input.ports.length ? "Elegir teclado" : "Sin teclado MIDI")}</span>
        </Button>
      {/snippet}
    </Menu>
    {#if input.port && !input.connected}<Button size="sm" onclick={() => connect(input.port)}>Conectar</Button>{/if}
    <span class="ctl" use:tooltip={input.hasOut ? "Volumen del teclado (CC7)" : "Este aparato no tiene salida MIDI: el volumen, en el propio teclado"}>
      <Icon name="volume" size={14} />
      <Slider value={volume} min={0} max={127} step={1} label="Volumen del teclado" disabled={!input.hasOut} oninput={setVolume} />
    </span>
    <span class="ctl" use:tooltip={"Velocidad: cuántos segundos de notas se ven subir"}>
      <Icon name="top" size={14} />
      <Slider value={7 - settings.rollSpeed} min={1} max={6} step={0.5} label="Velocidad del roll" oninput={(v) => (settings.rollSpeed = 7 - v)} />
    </span>
    <span class="sp"></span>
    {#if error || input.error}
      <span class="err" use:tooltip={error || input.error}><Icon name="alert" size={14} /> {error || input.error}</span>
    {/if}
    <span class="status num" use:tooltip={saved ? `Guardada en ${saved}` : "Se guarda sola cada 15 s"}>
      {count} notas{#if saved}<Icon name="check" size={13} />{/if}
    </span>
    <Button variant="ghost" size="sm" onclick={save} disabled={!count} title="Se guarda sola cada 15 s: .mid para reproducir y .json para la IA">Guardar</Button>
    <Button variant="ghost" size="sm" icon="sessions" onclick={toSessions} title="Volver a oír y analizar lo tocado (se guarda esta antes)">Sesiones</Button>
    <Button variant="primary" size="sm" icon="plus" onclick={fresh} disabled={!count} title="Guarda esta y empieza otra">Nueva sesión</Button>
  </header>

  <div class="trail" class:fade={trail.length > 6} aria-label="Acordes tocados">
    {#if trail.length || chord}
      {#each trail as c, i (i + history.length - trail.length)}
        {#if key}<ChordChip chord={c} tonality={key} name={nameOf(c)} size="sm" />{:else}<Chip>{nameOf(c)}</Chip>{/if}
        <span class="arrow" aria-hidden="true">›</span>
      {/each}
      {#if chord}
        {#if key}<ChordChip {chord} tonality={key} name={nameOf(chord)} size="sm" active />{:else}<Chip active>{nameOf(chord)}</Chip>{/if}
      {/if}
    {:else}
      <span class="tip">Los acordes que toques aparecen aquí, coloreados por su función.</span>
    {/if}
  </div>

  <div class="stage" bind:clientWidth={width} bind:clientHeight={height}>
    <canvas bind:this={canvas} style:height="{height}px"></canvas>

    {#if count}
    <div class="hud" aria-live="polite">
      <div class="now" style:--c={fn?.color ?? "var(--text)"} class:idle={!chord}>{chord ? nameOf(chord) : "—"}</div>
      {#if fn}
        <div class="fn"><i style:background={fn.color}></i><b>{fn.label}</b> {FN_LABEL[fn.fn]}</div>
      {/if}
      <div class="notes num">{sounding.map((p) => noteName(p % 12, kk, latin) + (Math.floor(p / 12) - 1)).join(" ") || " "}</div>
      {#if pedal}<span class="pedal">Pedal</span>{/if}
    </div>
    {/if}

    <div class="key" use:tooltip={key ? `Tonalidad: ${keyName(key, latin)} (de lo tocado)` : "La tonalidad sale tras unas cuantas notas"}>
      <FifthsWheel tonality={key} chords={used} current={chord} size={168} {latin} />
    </div>

    {#if !count}
      <div class="idle-hint">
        <Icon name="midi" size={28} />
        <strong>Toca algo</strong>
        <span>{input.connected ? `Escuchando ${input.connected}` : "O usa el teclado del ordenador"}</span>
        <dl>
          <dt><Kbd keys="A" /> … <Kbd keys="Ñ" /></dt><dd>blancas</dd>
          <dt><Kbd keys="W" /> <Kbd keys="E" /> <Kbd keys="T" /> …</dt><dd>negras</dd>
          <dt><Kbd keys="Z" /> <Kbd keys="X" /></dt><dd>octava ({octave})</dd>
          <dt><Kbd keys="Espacio" /></dt><dd>pedal</dd>
        </dl>
      </div>
    {/if}
  </div>
</section>

<style>
  .play { display: flex; flex-direction: column; height: 100%; min-height: 0; min-width: 0; overflow: hidden; }
  .top { display: flex; align-items: center; gap: var(--s3); padding: var(--s2) var(--s4); border-bottom: 1px solid var(--line); min-width: 0; flex-wrap: wrap; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-3); flex-shrink: 0; }
  .dot.on { background: var(--ok); }
  .dev { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ctl { display: flex; align-items: center; gap: var(--s2); width: 130px; color: var(--text-3); }
  .sp { flex: 1; }
  .err { display: flex; align-items: center; gap: var(--s1); max-width: 280px; color: var(--bad); font-size: var(--fs-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .status { display: flex; align-items: center; gap: var(--s1); color: var(--text-3); font-size: var(--fs-sm); white-space: nowrap; }

  .trail {
    display: flex; align-items: center; justify-content: flex-end; gap: 6px; height: 44px; padding: 0 var(--s4); flex-shrink: 0;
    overflow: hidden; border-bottom: 1px solid var(--line);
  }
  .trail.fade { mask-image: linear-gradient(to right, transparent, #000 15%); }
  .arrow { color: var(--text-3); }
  .tip { color: var(--text-3); font-size: var(--fs-sm); margin-right: auto; }

  .stage { position: relative; flex: 1; min-height: 0; overflow: hidden; }
  canvas { width: 100%; display: block; }
  .hud {
    position: absolute; top: var(--s4); left: var(--s4); display: flex; flex-direction: column; gap: var(--s1); min-width: 220px; max-width: 45%;
    padding: var(--s3) var(--s5) var(--s4); border-radius: var(--r-lg); background: color-mix(in oklab, var(--panel) 88%, transparent); border: 1px solid var(--line);
  }
  .now { font-size: 72px; font-weight: 800; line-height: 1; letter-spacing: -0.04em; color: var(--c); transition: color var(--t); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .now.idle { color: var(--text-3); }
  .fn { display: flex; align-items: center; gap: var(--s2); color: var(--text-2); font-size: var(--fs-md); }
  .fn i { width: 10px; height: 10px; border-radius: 3px; }
  .fn b { color: var(--text); }
  .notes { color: var(--text-3); font-size: var(--fs-sm); min-height: 1.5em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pedal { align-self: flex-start; padding: 0 var(--s2); border-radius: var(--r-full); border: 1px solid var(--line-hi); color: var(--text); font-size: var(--fs-xs); }
  .key {
    position: absolute; top: var(--s4); right: var(--s4); padding: var(--s2); border-radius: 50%;
    background: color-mix(in oklab, var(--panel) 88%, transparent);
  }
  .idle-hint {
    position: absolute; left: 50%; top: 40%; translate: -50% -50%; display: flex; flex-direction: column; align-items: center; gap: var(--s2);
    color: var(--text-3); text-align: center; pointer-events: none; animation: fade var(--t-slow);
  }
  .idle-hint strong { color: var(--text); font-size: var(--fs-xl); }
  .idle-hint dl { display: grid; grid-template-columns: auto auto; gap: var(--s1) var(--s3); margin: var(--s3) 0 0; font-size: var(--fs-sm); text-align: left; }
  .idle-hint dt { display: flex; align-items: center; gap: var(--s1); justify-content: flex-end; }
  .idle-hint dd { margin: 0; }
</style>
