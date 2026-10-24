<script lang="ts">
  import { revealItemInDir } from "@tauri-apps/plugin-opener";
  import { onMount } from "svelte";
  import { toMusicXML } from "./arrange";
  import { loadNotation } from "./ChordsTab.svelte";
  import { writeBytes } from "./engine";
  import { analyze, keyName, noteName } from "./harmony";
  import { t } from "./i18n.svelte";
  import { input, pcKey, pcRelease, useInput } from "./keys.svelte";
  import { toMidi } from "./live";
  import { beatToSec, handOf, pieceArrangement, pieceBeats, pieceDuration, pieceEvents, pieceLength, pieceSeconds, secToBeat, type Piece, type PNote } from "./piece";
  import { pieceDir, pieceToSession, savePiece } from "./pieces.svelte";
  import { loadPiano } from "./piano";
  import { Player, synth, voice } from "./player";
  import Score from "./Score.svelte";
  import { settings } from "./settings.svelte";
  import { ROLL_DEFAULT } from "./rollfx";
  import MidiStatus from "./learn/MidiStatus.svelte";
  import Button from "./ui/Button.svelte";
  import Chip from "./ui/Chip.svelte";
  import Field from "./ui/Field.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import Kbd from "./ui/Kbd.svelte";
  import Menu from "./ui/Menu.svelte";
  import { cssVar } from "./ui/music";
  import PlayButton from "./ui/PlayButton.svelte";
  import Popover from "./ui/Popover.svelte";
  import Slider from "./ui/Slider.svelte";
  import Stepper from "./ui/Stepper.svelte";
  import Tabs from "./ui/Tabs.svelte";
  import Toggle from "./ui/Toggle.svelte";

  /** Editor de piezas: piano roll con el tiempo en horizontal. Notas con el ratón (clic pone, arrastrar mueve o alarga,
   * clic derecho borra) o con el teclado de piano: paso a paso (cada nota con lo que la mantienes, y el cursor avanza) o
   * grabando en tiempo real con metrónomo. Se guarda sola. */
  let { piece, onclose, onpractice, onsessions }: { piece: Piece; onclose: () => void; onpractice: (p: Piece) => void; onsessions: () => void } = $props();

  const latin = loadNotation().latin;
  const LO = 21, HI = 108, KEYS_W = 64, RULER_H = 22, VEL_H = 56; // VEL_H: el carril de la fuerza, abajo
  // las manos, en los colores del piano de Aprender; lo demás, los grises de la interfaz
  const style = { ...ROLL_DEFAULT, ...settings.rollStyle };
  const COLORS = { rh: style.color, lh: style.color2 };
  const C = { bg: cssVar("--bg"), row: cssVar("--panel"), rowB: cssVar("--rail"), lane: cssVar("--rail"), ruler: cssVar("--panel-hi"), text2: cssVar("--text-2"), text3: cssVar("--text-3"), head: cssVar("--accent"), rec: cssVar("--bad") };

  // svelte-ignore state_referenced_locally
  let meta = $state({ title: piece.title, bpm: piece.bpm, meter: piece.meter });
  // svelte-ignore state_referenced_locally
  let notes = $state.raw<PNote[]>(piece.notes.map((n) => ({ ...n })));
  let selected = $state.raw(new Set<PNote>());
  let grid = $state(0.25); // en negras
  let handMode = $state<"auto" | "rh" | "lh">("auto");
  let stepInput = $state(true);
  let metronome = $state(true);
  let quantize = $state(true);
  let showScore = $state(false);
  let playhead = $state(0); // en negras
  let pxBeat = $state(56);
  let rowH = 14;
  let scrollX = $state(0);
  let scrollY = $state((HI - 72) * 14);
  let message = $state("");
  let goSessions = $state(false); // el aviso de «→ Sesión» ofrece ir
  let defaultVel = $state(0.7); // fuerza de las notas nuevas (ratón y teclado del ordenador)

  const spb = $derived(60 / meta.bpm); // segundos por negra
  const current = (): Piece => ({ ...piece, ...meta, notes });

  // ---------------------------------------------------------------- deshacer

  const undo: string[] = [];
  const redo: string[] = [];
  const snap = () => JSON.stringify(notes);
  /** Antes de cada cambio. */
  function remember() {
    undo.push(snap());
    if (undo.length > 200) undo.shift();
    redo.length = 0;
  }
  function restore(from: string[], to: string[]) {
    const s = from.pop();
    if (s == null) return;
    to.push(snap());
    notes = JSON.parse(s);
    selected = new Set();
  }
  const set = (ns: PNote[]) => (notes = ns.sort((a, b) => a.b - b.b || a.p - b.p));

  // ---------------------------------------------------------------- guardar (sola) y tonalidad

  let keyLabel = $state("");
  $effect(() => {
    const pc = { ...current(), notes };
    JSON.stringify(meta);
    const tr = setTimeout(async () => {
      await savePiece(pc);
      const tracks = [{ stem: "piano", notes: pieceSeconds(pc, "rh") }, { stem: "bass", notes: pieceSeconds(pc, "lh") }].filter((x) => x.notes.length);
      keyLabel = tracks.length && notes.length >= 6 ? keyName(analyze(tracks, pieceBeats(pc), pieceDuration(pc) + 1).key, latin) : "";
    }, 700);
    return () => clearTimeout(tr);
  });

  // ---------------------------------------------------------------- sonido

  const player = new Player();
  let playing = $state(false);
  let recording = $state(false);
  let renderedFor = "";

  /** El audio de lo escrito (y el metrónomo). Grabando, con dos minutos de margen tras el final para seguir tocando. */
  async function prepare(extra = 4) {
    const sig = `${snap()}|${meta.bpm}|${metronome}|${extra}`;
    if (sig === renderedFor) return;
    const len = beatToSec(current(), Math.max(pieceLength(current()), playhead)) + extra;
    player.buffers.clear();
    player.duration = 0;
    player.setBuffer("pieza", await synth(pieceSeconds(current()), len));
    const beats = Array.from({ length: Math.ceil(secToBeat(current(), len)) + 1 }, (_, i) => beatToSec(current(), i));
    player.setClicks(beats, (i) => i % meta.meter === 0);
    player.setGain("__click", metronome ? 0.5 : 0);
    renderedFor = sig;
  }

  async function play() {
    if (playing || recording) return stop();
    await prepare();
    player.seek(beatToSec(current(), playhead));
    player.play();
    playing = true;
  }

  function stop() {
    if (recording) finishRecording();
    player.pause();
    playing = recording = false;
  }

  // ---------------------------------------------------------------- notas desde el teclado de piano

  const held = new Map<number, { b: number; t0: number; v: number }>();
  const sustained = new Map<number, { b: number; t0: number; v: number }>(); // grabando: soltadas con el pedal pisado
  let pedal = false;
  let stepAt = 0, stepMax = 0;
  const voices = new Map<number, () => void>();
  const nowBeat = () => (recording && player.playing ? secToBeat(current(), player.time()) : playhead);
  const q = (x: number) => Math.round(x / grid) * grid;
  const handFor = (p: number) => (handMode === "auto" ? handOf(p) : handMode);

  function onMidi(msg: number[]) {
    const [st, p, v] = msg;
    const kind = st & 0xf0;
    const now = performance.now() / 1000;
    if (kind === 0xb0 && p === 64) {
      // pedal: grabando, sostiene lo soltado hasta levantarlo (como en una sesión)
      pedal = v >= 64;
      if (!pedal && recording) for (const k of [...sustained.keys()]) closeRecorded(k, sustained);
      return;
    }
    if (kind === 0x90 && v > 0) {
      if (!input.connected) voices.set(p, voice(player.ctx, p, v / 127)); // sin piano, que suene aquí
      if (recording) {
        if (sustained.has(p)) closeRecorded(p, sustained); // la misma tecla otra vez con el pedal
        held.set(p, { b: Math.max(playhead, nowBeat()), t0: now, v: v / 127 });
      }
      else if (stepInput) {
        if (!held.size) [stepAt, stepMax] = [playhead, 0]; // un acorde empieza donde está el cursor
        held.set(p, { b: stepAt, t0: now, v: v / 127 });
      }
    } else if (kind === 0x80 || kind === 0x90) {
      voices.get(p)?.();
      voices.delete(p);
      const h = held.get(p);
      if (!h) return;
      if (recording) {
        if (pedal) {
          held.delete(p);
          sustained.set(p, h);
        } else closeRecorded(p, held);
      } else {
        held.delete(p);
        // paso a paso: la nota dura lo que la mantuviste (al tempo), y al soltar todo el cursor avanza
        const d = Math.max(grid, q((now - h.t0) / spb));
        addNote({ b: h.b, d, p, v: h.v, hand: handFor(p) });
        stepMax = Math.max(stepMax, d);
        if (!held.size) {
          playhead = stepAt + stepMax;
          follow();
        }
      }
    }
  }

  /** Grabando: la nota `p` acaba ahora. */
  function closeRecorded(p: number, from: Map<number, { b: number; t0: number; v: number }>) {
    const h = from.get(p);
    if (!h) return;
    from.delete(p);
    let b = h.b, d = nowBeat() - h.b;
    if (quantize) [b, d] = [q(b), Math.max(grid, q(d))];
    addNote({ b, d: Math.max(0.05, d), p, v: h.v, hand: handFor(p) });
  }

  function addNote(n: PNote) {
    remember();
    set([...notes, n]);
  }

  async function record() {
    if (recording) return stop();
    if (playing) stop();
    await prepare(120);
    player.setGain("__click", 0.5); // grabando, siempre con metrónomo
    // cuenta de un compás antes de empezar
    const ctx = player.ctx;
    void ctx.resume();
    const t0 = ctx.currentTime + 0.1;
    for (let i = 0; i < meta.meter; i++) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = i === 0 ? 1760 : 1100;
      g.gain.setValueAtTime(0.4, t0 + i * spb);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + i * spb + 0.05);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + i * spb);
      o.stop(t0 + i * spb + 0.06);
    }
    recording = true;
    message = t("Cuenta… y a tocar");
    setTimeout(() => {
      if (!recording) return;
      message = t("Grabando");
      player.seek(beatToSec(current(), playhead));
      player.play();
    }, (meta.meter * spb + 0.1) * 1000);
  }

  function finishRecording() {
    const end = nowBeat();
    for (const k of [...held.keys()]) closeRecorded(k, held);
    for (const k of [...sustained.keys()]) closeRecorded(k, sustained);
    playhead = Math.max(playhead, end);
    message = "";
    player.setGain("__click", metronome ? 0.5 : 0);
  }

  onMount(() => {
    const stopInput = useInput(onMidi);
    void loadPiano().catch(() => {});
    let raf = 0;
    const tick = () => {
      if (player.playing) {
        playhead = secToBeat(current(), player.time());
        if (!recording && player.time() >= player.duration - 0.01) stop();
        follow();
      }
      draw();
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      stopInput();
      for (const off of voices.values()) off();
      player.stop();
      void player.ctx.close();
    };
  });

  // ---------------------------------------------------------------- dibujo

  let canvas: HTMLCanvasElement;
  let width = $state(0);
  let height = $state(0);
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const toX = (b: number) => KEYS_W + (b - scrollX) * pxBeat;
  const toB = (x: number) => (x - KEYS_W) / pxBeat + scrollX;
  const toY = (p: number) => RULER_H + (HI - p) * rowH - scrollY;
  const laneTop = () => height - VEL_H;
  const toP = (y: number) => HI - Math.floor((y - RULER_H + scrollY) / rowH);

  /** Que el cursor se vea al avanzar. */
  function follow() {
    const x = toX(playhead);
    if (x > width - 80) scrollX = playhead - (width - KEYS_W) / pxBeat + 4;
    if (x < KEYS_W) scrollX = Math.max(0, playhead - 2);
  }

  function draw() {
    if (!canvas || !width || !height) return;
    const dpr = devicePixelRatio;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) [canvas.width, canvas.height] = [width * dpr, height * dpr];
    const g = canvas.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = C.bg;
    g.fillRect(0, 0, width, height);
    // filas (las de teclas negras, más oscuras; una línea en cada Do)
    for (let p = HI; p >= LO; p--) {
      const y = toY(p);
      if (y > height || y + rowH < RULER_H) continue;
      g.fillStyle = BLACK.has(p % 12) ? C.rowB : C.row;
      g.fillRect(KEYS_W, y, width, rowH);
      if (p % 12 === 0) {
        g.fillStyle = "#ffffff14";
        g.fillRect(KEYS_W, y + rowH - 1, width, 1);
      }
    }
    // pulsos y compases
    const first = Math.floor(scrollX), last = toB(width) + 1;
    for (let b = first; b <= last; b++) {
      const x = toX(b);
      g.fillStyle = b % meta.meter === 0 ? "#ffffff2e" : "#ffffff10";
      g.fillRect(x, RULER_H, 1, height);
      if (grid < 1 && pxBeat * grid >= 10) {
        g.fillStyle = "#ffffff07";
        for (let s = grid; s < 1 - 1e-6; s += grid) g.fillRect(toX(b + s), RULER_H, 1, height);
      }
    }
    // notas
    g.font = "600 9px 'JetBrains Mono Variable', monospace";
    for (const n of notes) {
      const x = toX(n.b), w = Math.max(3, n.d * pxBeat - 1), y = toY(n.p);
      if (x > width || x + w < KEYS_W || y > height || y + rowH < RULER_H) continue;
      const sel = selected.has(n);
      g.globalAlpha = 0.55 + n.v * 0.45;
      g.fillStyle = COLORS[n.hand];
      g.beginPath();
      g.roundRect(x, y + 1, w, rowH - 2, 3);
      g.fill();
      g.globalAlpha = 1;
      if (sel) {
        g.strokeStyle = "#fff";
        g.lineWidth = 1.5;
        g.stroke();
      }
      if (w > 22) {
        g.fillStyle = "#1c0f05cc";
        g.fillText(noteName(n.p % 12, { tonic: 0, minor: false }, latin) + (Math.floor(n.p / 12) - 1), x + 3, y + rowH - 4);
      }
    }
    // lo que se está tocando ahora (grabando o paso a paso)
    for (const [p, h] of held) {
      const x = toX(h.b), y = toY(p);
      const w = Math.max(4, ((recording ? nowBeat() : h.b + (performance.now() / 1000 - h.t0) / spb) - h.b) * pxBeat);
      g.fillStyle = "#ffffff99";
      g.fillRect(x, y + 1, w, rowH - 2);
    }
    // caja de selección
    if (drag?.mode === "box") {
      g.strokeStyle = C.text2;
      g.setLineDash([4, 3]);
      g.strokeRect(drag.x0, drag.y0, drag.x - drag.x0, drag.y - drag.y0);
      g.setLineDash([]);
    }
    // carril de la fuerza: una barra por nota (las elegidas, en blanco)
    const lt = laneTop();
    g.fillStyle = C.lane;
    g.fillRect(0, lt, width, VEL_H);
    g.fillStyle = "#ffffff1a";
    g.fillRect(0, lt, width, 1);
    for (const n of notes) {
      const x = toX(n.b);
      if (x < KEYS_W || x > width) continue;
      const h = n.v * (VEL_H - 10);
      g.fillStyle = selected.has(n) ? "#ffffff" : COLORS[n.hand];
      g.fillRect(x, lt + VEL_H - 4 - h, 3, h);
      g.fillRect(x - 2, lt + VEL_H - 5 - h, 7, 2);
    }
    g.fillStyle = C.text3;
    g.font = "500 10px 'JetBrains Mono Variable', monospace";
    g.fillText(t("Fuerza"), 8, lt + VEL_H / 2 + 4);
    // teclado a la izquierda
    for (let p = HI; p >= LO; p--) {
      const y = toY(p);
      if (y > laneTop() - rowH || y + rowH < RULER_H) continue;
      const black = BLACK.has(p % 12);
      g.fillStyle = held.has(p) ? COLORS[handFor(p)] : black ? "#15161c" : "#f3f0e8";
      g.fillRect(0, y, black ? KEYS_W * 0.6 : KEYS_W, rowH - (black ? 0 : 1));
      if (!black) {
        g.fillStyle = "#0000008c";
        g.font = "500 9px 'JetBrains Mono Variable', monospace";
        g.fillText(noteName(p % 12, { tonic: 0, minor: false }, latin) + (p % 12 === 0 ? Math.floor(p / 12) - 1 : ""), KEYS_W - 30, y + rowH - 4);
      }
    }
    // regla con los compases y el cursor
    g.fillStyle = C.ruler;
    g.fillRect(0, 0, width, RULER_H);
    g.fillStyle = C.text2;
    g.font = "500 10px 'JetBrains Mono Variable', monospace";
    for (let b = Math.ceil(first / meta.meter) * meta.meter; b <= last; b += meta.meter) if (toX(b) >= KEYS_W) g.fillText(String(b / meta.meter + 1), toX(b) + 3, 15);
    const px = toX(playhead);
    if (px >= KEYS_W) {
      g.fillStyle = recording ? C.rec : C.head;
      g.fillRect(px - 1, 0, 2, height);
    }
  }

  // ---------------------------------------------------------------- ratón

  type Drag =
    | { mode: "move" | "resize"; x0: number; y0: number; x: number; y: number; orig: Map<PNote, { b: number; d: number; p: number }>; changed: boolean; before: string }
    | { mode: "box"; x0: number; y0: number; x: number; y: number; add: boolean }
    | { mode: "ruler"; x0: number; y0: number; x: number; y: number }
    | { mode: "vel"; x0: number; y0: number; x: number; y: number }
    | { mode: "key"; x0: number; y0: number; x: number; y: number; stopVoice: () => void };
  let drag = $state.raw<Drag | null>(null);

  const noteAt = (x: number, y: number) => {
    for (let i = notes.length - 1; i >= 0; i--) {
      const n = notes[i];
      const nx = toX(n.b), nw = Math.max(3, n.d * pxBeat - 1), ny = toY(n.p);
      if (x >= nx && x <= nx + nw && y >= ny && y < ny + rowH) return { n, edge: x >= nx + nw - 6 };
    }
    return null;
  };

  function down(e: PointerEvent) {
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    canvas.setPointerCapture(e.pointerId);
    if (y < RULER_H) {
      playhead = Math.max(0, e.shiftKey ? toB(x) : q(toB(x)));
      if (player.playing && !recording) player.seek(beatToSec(current(), playhead));
      drag = { mode: "ruler", x0: x, y0: y, x, y };
      return;
    }
    if (y >= laneTop()) {
      // carril de la fuerza: arrastrando se pinta la de las notas por las que se pasa
      remember();
      drag = { mode: "vel", x0: x, y0: y, x, y };
      paintVel(x, y);
      return;
    }
    if (x < KEYS_W) {
      drag = { mode: "key", x0: x, y0: y, x, y, stopVoice: voice(player.ctx, toP(y), 0.7) };
      return;
    }
    const hit = noteAt(x, y);
    if (e.button === 2) {
      if (hit) {
        remember();
        set(notes.filter((n) => n !== hit.n && !(selected.has(hit.n) && selected.has(n))));
        selected = new Set();
      }
      return;
    }
    if (hit) {
      if (!selected.has(hit.n)) selected = e.shiftKey || e.ctrlKey ? new Set([...selected, hit.n]) : new Set([hit.n]);
      else if (e.ctrlKey) {
        selected = new Set([...selected].filter((n) => n !== hit.n));
        return;
      }
      const orig = new Map([...selected].map((n) => [n, { b: n.b, d: n.d, p: n.p }]));
      drag = { mode: hit.edge ? "resize" : "move", x0: x, y0: y, x, y, orig, changed: false, before: snap() };
      voices.get(-1)?.();
      voices.set(-1, voice(player.ctx, hit.n.p, hit.n.v));
      return;
    }
    if (e.shiftKey || e.ctrlKey) {
      drag = { mode: "box", x0: x, y0: y, x, y, add: true };
      return;
    }
    // nota nueva en la cuadrícula; arrastrando, se alarga
    const p = toP(y);
    if (p < LO || p > HI) return;
    remember();
    const n: PNote = { b: Math.max(0, Math.floor(toB(x) / grid) * grid), d: grid, p, v: defaultVel, hand: handFor(p) };
    set([...notes, n]);
    selected = new Set([n]);
    drag = { mode: "resize", x0: x, y0: y, x, y, orig: new Map([[n, { b: n.b, d: n.d, p: n.p }]]), changed: true, before: "" };
    voices.get(-1)?.();
    voices.set(-1, voice(player.ctx, p, defaultVel));
  }

  function move(e: PointerEvent) {
    const d = drag;
    if (!d) return;
    const r = canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (d.mode === "ruler") {
      playhead = Math.max(0, e.shiftKey ? toB(x) : q(toB(x)));
      return;
    }
    if (d.mode === "vel") return paintVel(x, y);
    if (d.mode === "box" || d.mode === "key") {
      drag = { ...d, x, y };
      return;
    }
    const db = q(toB(x) - toB(d.x0));
    const dp = toP(y) - toP(d.y0);
    for (const [n, o] of d.orig) {
      if (d.mode === "move") {
        n.b = Math.max(0, o.b + db);
        n.p = Math.min(HI, Math.max(LO, o.p + dp));
      } else n.d = Math.max(grid, q(o.d + toB(x) - toB(d.x0)) || grid);
    }
    if (db || dp || d.mode === "resize") d.changed = true;
    notes = [...notes];
  }

  function up() {
    voices.get(-1)?.();
    voices.delete(-1);
    if (!drag) return;
    if (drag.mode === "box") {
      const [x1, x2] = [Math.min(drag.x0, drag.x), Math.max(drag.x0, drag.x)];
      const [y1, y2] = [Math.min(drag.y0, drag.y), Math.max(drag.y0, drag.y)];
      const inside = notes.filter((n) => toX(n.b) <= x2 && toX(n.b + n.d) >= x1 && toY(n.p) <= y2 && toY(n.p) + rowH >= y1);
      selected = new Set([...selected, ...inside]);
    } else if (drag.mode === "key") drag.stopVoice?.();
    else if ((drag.mode === "move" || drag.mode === "resize") && drag.changed && drag.before) {
      undo.push(drag.before); // lo de antes de arrastrar, para deshacer
      redo.length = 0;
      set([...notes]);
    }
    drag = null;
  }

  /** La fuerza de las notas que empiezan cerca de x (las elegidas si hay alguna ahí), según la altura en el carril. */
  function paintVel(x: number, y: number) {
    const v = Math.min(1, Math.max(0.05, 1 - (y - laneTop() - 4) / (VEL_H - 10)));
    const near = notes.filter((n) => Math.abs(toX(n.b) - x) <= 5);
    const pick = near.some((n) => selected.has(n)) ? near.filter((n) => selected.has(n)) : near;
    for (const n of pick) n.v = v;
    if (pick.length) notes = [...notes];
  }

  /** El control «Fuerza»: la de las notas elegidas o, sin ninguna, la de las nuevas. */
  const velShown = $derived(selected.size ? [...selected].reduce((s, n) => s + n.v, 0) / selected.size : defaultVel);
  function setVel(v: number) {
    if (!selected.size) return void (defaultVel = v);
    for (const n of selected) n.v = v;
    notes = [...notes];
  }

  function wheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey) {
      const r = canvas.getBoundingClientRect();
      const at = toB(e.clientX - r.left);
      pxBeat = Math.min(240, Math.max(12, pxBeat * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      scrollX = Math.max(0, at - (e.clientX - r.left - KEYS_W) / pxBeat);
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) scrollX = Math.max(0, scrollX + (e.deltaX || e.deltaY) / pxBeat);
    else scrollY = Math.min((HI - LO + 1) * rowH - (laneTop() - RULER_H), Math.max(0, scrollY + e.deltaY));
  }

  // ---------------------------------------------------------------- teclado del ordenador

  let clipboard: PNote[] = [];
  function onkey(e: KeyboardEvent) {
    if ((e.target instanceof Element && e.target.closest("input, select, textarea"))) return;
    const sel = [...selected];
    const k = e.key;
    const done = () => e.preventDefault();
    if (e.code === "Space") return (done(), play());
    if (e.ctrlKey || e.metaKey) {
      if (k === "z" && !e.shiftKey) return (done(), restore(undo, redo));
      if (k === "y" || (k === "Z" && e.shiftKey) || (k === "z" && e.shiftKey)) return (done(), restore(redo, undo));
      if (k === "a") return (done(), (selected = new Set(notes)));
      if (k === "c" || k === "x") {
        done();
        const b0 = Math.min(...sel.map((n) => n.b));
        clipboard = sel.map((n) => ({ ...n, b: n.b - b0 }));
        if (k === "x" && sel.length) (remember(), set(notes.filter((n) => !selected.has(n))), (selected = new Set()));
        return;
      }
      if (k === "v" && clipboard.length) {
        done();
        remember();
        const pasted = clipboard.map((n) => ({ ...n, b: n.b + playhead }));
        set([...notes, ...pasted]);
        selected = new Set(pasted);
        playhead += Math.max(...clipboard.map((n) => n.b + n.d));
        return;
      }
      if (k === "q") return (done(), quantizeNotes());
      if (k === "ArrowUp" || k === "ArrowDown") return (done(), shift(0, k === "ArrowUp" ? 12 : -12, 0));
      return;
    }
    if (k === "Delete" || k === "Backspace") {
      done();
      if (sel.length) (remember(), set(notes.filter((n) => !selected.has(n))), (selected = new Set()));
      else if (k === "Backspace") {
        // sin nada elegido: borra el último acorde escrito antes del cursor y vuelve ahí (como al escribir texto)
        const last = Math.max(-1, ...notes.filter((n) => n.b < playhead - 1e-6).map((n) => n.b));
        if (last >= 0) (remember(), set(notes.filter((n) => Math.abs(n.b - last) > 1e-6)), (playhead = last));
      }
      return;
    }
    if (k === "Escape") return (done(), stop(), (selected = new Set()));
    if (k === "Home") return (done(), (playhead = 0), (scrollX = 0));
    if (k === "Tab") return (done(), sel.length && (remember(), sel.forEach((n) => (n.hand = n.hand === "rh" ? "lh" : "rh")), (notes = [...notes])));
    if (k === "ArrowLeft" || k === "ArrowRight") {
      done();
      const dir = k === "ArrowRight" ? grid : -grid;
      if (!sel.length) return (playhead = Math.max(0, playhead + dir));
      return e.shiftKey ? shift(0, 0, dir) : shift(dir, 0, 0);
    }
    if ((k === "ArrowUp" || k === "ArrowDown") && e.altKey) {
      done();
      if (sel.length) (remember(), sel.forEach((n) => (n.v = Math.min(1, Math.max(0.05, n.v + (k === "ArrowUp" ? 0.05 : -0.05))))), (notes = [...notes]));
      return;
    }
    if (k === "ArrowUp" || k === "ArrowDown") return (done(), shift(0, k === "ArrowUp" ? 1 : -1, 0));
    pcKey(e, 0, Math.round(defaultVel * 127)); // el resto, el teclado como piano (fila A–Ñ, Z/X octava)
  }

  function shift(db: number, dp: number, dd: number) {
    const sel = [...selected];
    if (!sel.length) return;
    remember();
    for (const n of sel) {
      n.b = Math.max(0, n.b + db);
      n.p = Math.min(HI, Math.max(LO, n.p + dp));
      n.d = Math.max(grid, n.d + dd);
    }
    set([...notes]);
    if (dp) {
      voices.get(-1)?.();
      voices.set(-1, voice(player.ctx, sel[0].p, 0.7));
      setTimeout(() => (voices.get(-1)?.(), voices.delete(-1)), 250);
    }
  }

  /** Cuadra a la cuadrícula lo elegido (o todo). */
  function quantizeNotes() {
    const targets = selected.size ? [...selected] : notes;
    remember();
    for (const n of targets) {
      const e = q(n.b + n.d);
      n.b = q(n.b);
      n.d = Math.max(grid, e - n.b);
    }
    set([...notes]);
  }

  // ---------------------------------------------------------------- exportar y pasar a otros sitios

  const safeName = $derived(meta.title.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "pieza");
  async function exportAs(kind: "mid" | "musicxml") {
    const pc = current();
    const path = `${pieceDir()}/${safeName}.${kind}`;
    const data = kind === "mid" ? toMidi(pieceEvents(pc), pc.bpm) : new TextEncoder().encode(toMusicXML(pieceArrangement(pc, { tonic: 0, minor: false }), pc.title));
    try {
      await writeBytes(path, data);
      await revealItemInDir(path);
    } catch (e) {
      message = t("No se pudo exportar: {e}", { e: String(e) });
    }
  }

  /** Como sesión del teclado (en Sesiones: su piano roll, sus acordes y el análisis de Claude). */
  async function toSession() {
    try {
      await pieceToSession(current(), latin);
      message = t("Guardada como sesión");
      goSessions = true;
    } catch (e) {
      message = t("No se pudo guardar como sesión: {e}", { e: String(e) });
    }
  }

  // ---------------------------------------------------------------- partitura de lo escrito (de solo lectura)

  let scorePath = $state("");
  $effect(() => {
    if (!showScore) return;
    const pc = { ...current(), notes };
    const tr = setTimeout(async () => {
      const path = `${pieceDir()}/${pc.id}.musicxml`;
      await writeBytes(path, new TextEncoder().encode(toMusicXML(pieceArrangement(pc, { tonic: 0, minor: false }), pc.title)));
      scorePath = `${path}?v=${Date.now()}`; // otra ruta: la partitura se vuelve a montar
    }, 1200);
    return () => clearTimeout(tr);
  });
  const scoreSong = $derived({ id: piece.id, title: meta.title, dir: pieceDir(), mix: "", bpm: meta.bpm, stems: [] });

  const GRIDS: [number, string, string][] = [[1, "♩", "Negra"], [0.5, "♪", "Corchea"], [0.25, "♬", "Semicorchea"], [1 / 3, "3", "Tresillo"]];
  const KEYS: [string, string][] = [
    ["A–Ñ", "teclas blancas (W E T Y U O P, negras)"], ["Z / X", "octava"], ["Clic", "poner nota · arrastrar alarga"], ["Clic dcho.", "borrar"],
    ["Mayús", "elegir varias"], ["← →", "mover · Mayús: alargar"], ["↑ ↓", "semitono · Ctrl: octava"], ["Alt+↑ ↓", "fuerza"], ["Tab", "cambiar de mano"],
    ["Ctrl+Z", "deshacer"], ["Ctrl+Q", "cuadrar"], ["Espacio", "reproducir"],
  ];
  const fmtPos = (b: number) => `${Math.floor(b / meta.meter) + 1}.${Math.floor(b % meta.meter) + 1}`;
</script>

<svelte:window onkeydown={onkey} onkeyup={(e) => !(e.target instanceof Element && e.target.closest("input, select, textarea")) && pcKey(e, 0, Math.round(defaultVel * 127))} onblur={() => pcRelease()} />

{#snippet noControls()}{/snippet}

<section class="editor">
  <header class="head">
    <IconButton icon="back" label={t("Volver (se guarda sola)")} onclick={onclose} />
    <Popover width={300} label={t("La pieza")}>
      {#snippet trigger({ toggle })}
        <button type="button" class="name" onclick={toggle} title={t("Título, tempo y compás")}>
          <strong>{meta.title || t("Sin título")}</strong>
          <span class="num">{meta.bpm} bpm · {meta.meter}/4{keyLabel ? ` · ${keyLabel}` : ""}</span>
        </button>
      {/snippet}
      <div class="opts-pop">
        <Field label={t("Título")} bind:value={meta.title} data-autofocus />
        <span class="lbl">{t("Tempo")}</span>
        <Stepper bind:value={meta.bpm} min={30} max={260} label={t("Tempo")} format={(v) => `${v} bpm`} />
        <span class="lbl">{t("Compás")}</span>
        <Tabs size="sm" label={t("Compás")} bind:value={() => String(meta.meter), (v) => (meta.meter = +v)} options={[2, 3, 4, 5, 6, 7].map((m) => ({ value: String(m), label: `${m}/4` }))} />
      </div>
    </Popover>
    {#if message}<Chip>{#if recording}<span class="rec-dot"></span>{/if}{message}</Chip>{/if}
    {#if goSessions}
      <Button size="sm" variant="ghost" icon="sessions" onclick={onsessions}>{t("Ir a Sesiones")}</Button>
      <IconButton icon="close" size="sm" label={t("Cerrar aviso")} onclick={() => ((goSessions = false), (message = ""))} />
    {/if}
    <span class="fill"></span>
    <span class="pos num" title={t("Compás.pulso del cursor · notas")}>{fmtPos(playhead)} · {notes.length}</span>
    <MidiStatus />
    <Menu align="end" label={t("Exportar")} items={[
      { label: t("Exportar a MIDI"), icon: "download", run: () => exportAs("mid") },
      { label: t("Exportar a MusicXML"), icon: "download", title: "MuseScore…", run: () => exportAs("musicxml") },
      "-",
      { label: t("Pasar a Sesiones"), icon: "sessions", title: t("Piano roll, acordes y análisis de Claude"), run: toSession },
    ]}>
      {#snippet trigger({ toggle })}<IconButton icon="more" label={t("Exportar")} onclick={toggle} />{/snippet}
    </Menu>
    <Button variant="primary" icon="learn" onclick={() => onpractice(current())} disabled={!notes.length}>{t("Practicar")}</Button>
  </header>

  <div class="tools">
    <PlayButton {playing} onclick={play} size={32} />
    <Button variant={recording ? "danger" : "ghost"} icon="record" active={recording} onclick={record} title={t("Grabar en tiempo real: cuenta de un compás y metrónomo")}>{recording ? t("Parar") : t("Grabar")}</Button>
    <span class="sep"></span>
    <Toggle bind:checked={stepInput} title={t("Sin grabar: cada nota que tocas se escribe en el cursor con lo que la mantienes, y el cursor avanza")}>{t("Paso a paso")}</Toggle>
    <Toggle bind:checked={metronome}>{t("Metrónomo")}</Toggle>
    <Toggle bind:checked={quantize} title={t("Al grabar, cuadrar a la cuadrícula")}>{t("Cuadrar")}</Toggle>
    <span class="sep"></span>
    <Tabs size="sm" label={t("Cuadrícula")} bind:value={() => String(GRIDS.findIndex((g) => g[0] === grid)), (v) => (grid = GRIDS[+v][0])}
      options={GRIDS.map(([, label, title], i) => ({ value: String(i), label, title: t(title) }))} />
    <div class="hands" title={t("Mano de las notas nuevas (Tab cambia la de las elegidas)")}>
      <Chip active={handMode === "auto"} onclick={() => (handMode = "auto")}>{t("Auto")}</Chip>
      <Chip active={handMode === "lh"} color={COLORS.lh} onclick={() => (handMode = "lh")}>{t("Izq.")}</Chip>
      <Chip active={handMode === "rh"} color={COLORS.rh} onclick={() => (handMode = "rh")}>{t("Der.")}</Chip>
    </div>
    <label class="vel" title={selected.size ? t("Fuerza de las {n} notas elegidas (Alt+↑↓; o en el carril de abajo)", { n: selected.size }) : t("Fuerza de las notas nuevas")}>
      <span>{t("Fuerza")}{selected.size ? ` (${selected.size})` : ""}</span>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="sl" onpointerdown={() => selected.size && remember()}>
        <Slider value={velShown} min={0.05} max={1} step={0.01} label={t("Fuerza")} oninput={setVel} />
      </span>
      <span class="num">{Math.round(velShown * 127)}</span>
    </label>
    <span class="sep"></span>
    <IconButton icon="undo" label={t("Deshacer")} kbd="Ctrl+Z" size="sm" onclick={() => restore(undo, redo)} />
    <IconButton icon="redo" label={t("Rehacer")} kbd="Ctrl+Y" size="sm" onclick={() => restore(redo, undo)} />
    <Button size="sm" variant="ghost" onclick={quantizeNotes} title={t("Cuadrar a la cuadrícula lo elegido, o todo (Ctrl+Q)")}>{t("Cuadrar")}</Button>
    <span class="fill"></span>
    <IconButton icon="score" label={t("Partitura")} active={showScore} onclick={() => (showScore = !showScore)} />
    <Popover align="end" width={320} label={t("Atajos")}>
      {#snippet trigger({ toggle })}<IconButton icon="help" label={t("Atajos")} onclick={toggle} />{/snippet}
      <dl class="keys">
        {#each KEYS as [k, what] (k)}<dt>{#if k.includes("+")}<Kbd keys={k} />{:else}<kbd>{t(k)}</kbd>{/if}</dt><dd>{t(what)}</dd>{/each}
      </dl>
    </Popover>
  </div>

  <div class="stage" bind:clientWidth={width} bind:clientHeight={height}>
    <canvas bind:this={canvas} style:height="{height}px" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onwheel={wheel} oncontextmenu={(e) => e.preventDefault()}></canvas>
    {#if !notes.length}
      <p class="empty-hint">{t("Toca en el piano (o A–Ñ en el teclado) y cada nota se escribe en el cursor · clic pone una nota")}</p>
    {/if}
  </div>
  {#if showScore && scorePath}
    <div class="score">
      {#key scorePath}
        <Score song={scoreSong} stems={[]} path={scorePath.split("?")[0]} {player} controls={noControls} bind:follow={settings.scoreFollow} title={meta.title} beatAt={(at) => secToBeat(current(), at)} pdfName={safeName} />
      {/key}
    </div>
  {/if}
</section>

<style>
  .editor { flex: 1; min-height: 0; display: flex; flex-direction: column; gap: var(--s2); padding: var(--s2) var(--s4) var(--s4); }
  .head, .tools { display: flex; align-items: center; gap: var(--s2); flex-wrap: wrap; flex-shrink: 0; min-width: 0; }
  .name {
    display: flex; flex-direction: column; align-items: flex-start; min-width: 0; padding: 2px var(--s2); border: 0; border-radius: var(--r-md);
    background: none; color: var(--text); text-align: left; transition: background var(--t-fast);
  }
  .name:hover { background: var(--panel-hi); }
  .name strong { font-size: var(--fs-lg); max-width: 360px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .name span { font-size: var(--fs-xs); color: var(--text-3); }
  .opts-pop { display: flex; flex-direction: column; gap: var(--s2); padding: var(--s2); }
  .lbl { font-size: var(--fs-xs); color: var(--text-3); margin-top: var(--s1); }
  .fill { flex: 1; }
  .pos { font-size: var(--fs-sm); color: var(--text-3); }
  .rec-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--bad); animation: pulse 1s ease-in-out infinite; }
  .sep { width: 1px; height: 18px; background: var(--line); margin: 0 var(--s1); }
  .hands { display: flex; gap: var(--s1); }
  .vel { display: flex; align-items: center; gap: var(--s2); font-size: var(--fs-sm); color: var(--text-2); }
  .vel .sl { width: 90px; display: flex; }
  .vel .num { min-width: 24px; color: var(--text); }
  .stage { flex: 1; min-height: 200px; position: relative; border: 1px solid var(--line); border-radius: var(--r-lg); overflow: hidden; }
  canvas { display: block; width: 100%; touch-action: none; cursor: crosshair; }
  .empty-hint { position: absolute; left: 90px; right: 30px; bottom: 72px; font-size: var(--fs-sm); color: var(--text-3); pointer-events: none; text-align: center; }
  .score { height: 38%; min-height: 200px; display: flex; flex-shrink: 0; }
  .keys { display: grid; grid-template-columns: auto 1fr; gap: 6px var(--s3); margin: 0; padding: var(--s2); font-size: var(--fs-sm); }
  .keys dt { justify-self: end; }
  .keys dd { margin: 0; color: var(--text-2); }
</style>
