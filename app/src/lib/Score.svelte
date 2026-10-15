<script lang="ts">
  import { openPath } from "@tauri-apps/plugin-opener";
  import { OpenSheetMusicDisplay } from "opensheetmusicdisplay";
  import { untrack, type Snippet } from "svelte";
  import { readBytes, STEM_INFO, writeBytes, type Song, type Stem } from "./engine";
  import { setWindowFullscreen } from "./fullscreen";
  import type { Player } from "./player";
  import Button from "./ui/Button.svelte";
  import IconButton from "./ui/IconButton.svelte";
  import ProgressRing from "./ui/ProgressRing.svelte";
  import StemBadge from "./ui/StemBadge.svelte";
  import Toggle from "./ui/Toggle.svelte";

  let { song, stems, path, player, controls, follow = $bindable(true), title, beatAt, pdfName }: {
    song: Song;
    stems: Stem[]; // instrumentos visibles, un pentagrama cada uno
    path: string; // MusicXML de conjunto que monta el motor
    player: Player;
    controls: Snippet; // transporte, para la pantalla completa
    follow?: boolean; // desplazar la partitura con la reproducción
    title?: string; // en vez de los instrumentos (un arreglo)
    beatAt?: (t: number) => number; // segundo → negras desde el principio de la partitura, si no va a tempo fijo
    pdfName?: string;
  } = $props();

  let container: HTMLDivElement;
  let paper: HTMLDivElement;
  let osmd: OpenSheetMusicDisplay | undefined;
  let xml = "";
  let ready = $state(false);
  let error = $state("");
  let zoom = $state(0.8);
  let fullscreen = $state(false);
  let exporting = $state(false);

  const labels = $derived(stems.map((s) => STEM_INFO[s.name].label).join(" + "));
  const total = $derived(stems.reduce((n, s) => n + (s.notes ?? 0), 0));
  // nombre del pentagrama (lo pone el motor) -> color del instrumento
  const colorOf = $derived(new Map(stems.map((s) => [STEM_INFO[s.name].label, STEM_INFO[s.name].color])));
  const bpm = $derived(song.bpm ?? 120);

  // notas ya pintadas, para despintarlas al saltar hacia atrás o redibujar
  let painted: SVGElement[] = [];
  let lastBeat = -1;

  function paint(el: SVGElement, color: string) {
    el.style.fill = color;
    el.style.stroke = color;
  }

  /** Redibuja (zoom, tamaño) y deja el cursor al principio. */
  function draw() {
    const o = osmd!;
    o.zoom = zoom;
    o.render();
    o.cursor.reset();
    o.cursor.show();
    painted = [];
    lastBeat = -1;
  }

  $effect(() => {
    // solo al montar: el padre lo recrea con {#key} si cambia la partitura; un `song` nuevo
    // (porque acabó otra transcripción) no debe crear un segundo OSMD en el mismo contenedor
    const file = untrack(() => path);
    osmd = new OpenSheetMusicDisplay(container, {
      autoResize: false, // redibujamos nosotros: así el cursor no se pierde
      backend: "svg",
      drawTitle: false,
      drawComposer: false,
      drawPartNames: untrack(() => stems.length > 1),
      drawingParameters: "compacttight",
      followCursor: false,
      cursorsOptions: [{ type: 1, color: "#f29d38", alpha: 1, follow: false }],
    });
    readBytes(file)
      .then((buf) => osmd!.load((xml = new TextDecoder().decode(buf))))
      .then(() => {
        draw();
        ready = true;
      })
      .catch((e) => (error = String(e)));
  });

  // redibujar al cambiar de tamaño (pantalla completa, ventana)
  $effect(() => {
    if (!ready) return;
    let w = paper.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(paper.clientWidth - w) < 20) return;
      w = paper.clientWidth;
      draw();
    });
    ro.observe(paper);
    return () => ro.disconnect();
  });

  // seguir la reproducción: la partitura se generó con el mismo tempo, así que segundo -> pulso es directo
  $effect(() => {
    if (!ready) return;
    let raf = 0;
    const tick = () => {
      const o = osmd!;
      const beat = (beatAt ? beatAt(player.time()) / 4 : (player.time() * bpm) / 240) + 1e-6; // en redondas, como los timestamps de OSMD
      if (beat < lastBeat) {
        for (const el of painted) el.style.fill = el.style.stroke = "";
        painted = [];
        o.cursor.reset();
      }
      let moved = false;
      while (!o.cursor.Iterator.EndReached && o.cursor.Iterator.currentTimeStamp.RealValue <= beat) {
        for (const gn of o.cursor.GNotesUnderCursor()) {
          const color = colorOf.get(gn.sourceNote.ParentStaff.ParentInstrument.Name) ?? "#f29d38";
          const g = (gn as unknown as { getSVGGElement?: () => SVGGElement }).getSVGGElement?.();
          for (const el of g?.querySelectorAll<SVGElement>("path, rect") ?? []) {
            paint(el, color);
            painted.push(el);
          }
        }
        o.cursor.next();
        moved = true;
      }
      lastBeat = beat;
      if (moved && follow) scrollToCursor();
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  });

  /** Desplaza solo el papel (no la página) para que el cursor quede a la vista. */
  function scrollToCursor() {
    const c = osmd?.cursor.cursorElement;
    if (!c) return;
    const top = c.getBoundingClientRect().top - paper.getBoundingClientRect().top + paper.scrollTop;
    if (top < paper.scrollTop + 40 || top + c.clientHeight > paper.scrollTop + paper.clientHeight - 40) {
      paper.scrollTo({ top: top - paper.clientHeight / 3, behavior: "smooth" });
    }
  }

  function setZoom(z: number) {
    zoom = Math.round(Math.min(2, Math.max(0.4, z)) * 10) / 10;
    if (ready) draw();
  }

  function setFullscreen(on: boolean) {
    fullscreen = on;
    setWindowFullscreen(on);
  }
  $effect(() => () => {
    if (fullscreen) setWindowFullscreen(false);
  });

  /** A4 vectorial: OSMD pagina en SVG y svg2pdf pasa cada página a jsPDF. */
  async function exportPdf() {
    exporting = true;
    error = "";
    const div = document.createElement("div");
    div.style.cssText = "position:fixed;left:-10000px;top:0;width:794px"; // ancho A4 a 96 dpi
    document.body.append(div);
    try {
      const [{ jsPDF }] = await Promise.all([import("jspdf"), import("svg2pdf.js")]);
      const o = new OpenSheetMusicDisplay(div, {
        backend: "svg",
        autoResize: false,
        pageFormat: "A4_P",
        pageBackgroundColor: "#FFFFFF",
        drawTitle: true,
        drawComposer: true,
        drawPartNames: false,
      });
      await o.load(xml);
      o.render();
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const w = pdf.internal.pageSize.getWidth();
      const h = pdf.internal.pageSize.getHeight();
      const pages = div.querySelectorAll("svg");
      for (let i = 0; i < pages.length; i++) {
        if (i) pdf.addPage();
        await pdf.svg(pages[i], { x: 0, y: 0, width: w, height: h });
      }
      const out = `${song.dir}/scores/${pdfName ?? stems.map((s) => s.name).join("+")}.pdf`;
      await writeBytes(out, new Uint8Array(pdf.output("arraybuffer")));
      await openPath(out);
    } catch (e) {
      error = `No se pudo exportar: ${e}`;
    } finally {
      div.remove();
      exporting = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && fullscreen && setFullscreen(false)} />

<section class="score" class:fs={fullscreen}>
  <header>
    <div class="title">
      {#each stems as s (s.name)}<StemBadge stem={s.name} dot />{/each}
      <strong>{title ?? labels}</strong>
      {#if !title}<small class="num">{total} notas · {bpm} BPM</small>{/if}
    </div>
    <div class="tools">
      <Toggle bind:checked={follow} title="Desplazar la partitura con la reproducción">Seguir</Toggle>
      <span class="sep"></span>
      <IconButton icon="minus" label="Alejar" size="sm" onclick={() => setZoom(zoom - 0.1)} />
      <span class="zoom num">{Math.round(zoom * 100)}%</span>
      <IconButton icon="plus" label="Acercar" size="sm" onclick={() => setZoom(zoom + 0.1)} />
      <span class="sep"></span>
      <Button size="sm" variant="ghost" icon="download" onclick={exportPdf} disabled={!ready || exporting}>{exporting ? "Exportando…" : "PDF"}</Button>
      <IconButton icon="folder" label="Carpeta (MIDI, MusicXML, PDF)" size="sm" onclick={() => openPath(`${song.dir}/scores`)} />
      <IconButton icon={fullscreen ? "close" : "expand"} label={fullscreen ? "Salir (Esc)" : "Pantalla completa"} size="sm" onclick={() => setFullscreen(!fullscreen)} />
    </div>
  </header>
  {#if error}<p class="error">{error}</p>{/if}
  {#if !ready && !error}<div class="loading"><ProgressRing value={null} size={24} label="Dibujando partitura" /></div>{/if}
  <!-- nunca display:none mientras dibuja: OSMD mide el ancho del contenedor y con 0 no pinta nada -->
  <div class="paper" bind:this={paper}>
    <div bind:this={container}></div>
  </div>
  {#if fullscreen}<footer>{@render controls()}</footer>{/if}
</section>

<style>
  .score {
    flex: 1; min-height: 240px; display: flex; flex-direction: column; overflow: hidden;
    border-radius: var(--r-lg); background: var(--panel); border: 1px solid var(--line);
  }
  header { display: flex; justify-content: space-between; align-items: center; gap: var(--s3); padding: var(--s1) var(--s3); border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .title { display: flex; align-items: center; gap: var(--s2); min-width: 0; }
  .title strong { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .title small { color: var(--text-3); font-size: var(--fs-xs); white-space: nowrap; }
  .tools { display: flex; align-items: center; gap: 2px; }
  .sep { width: 1px; height: 18px; background: var(--line); margin: 0 var(--s2); }
  .zoom { font-size: var(--fs-sm); color: var(--text-2); min-width: 40px; text-align: center; }
  .paper { flex: 1; min-height: 0; background: #f6f0e4; overflow: auto; padding: var(--s2) 0; position: relative; }
  .loading { display: grid; place-items: center; padding: var(--s5); }
  .error { color: var(--bad); padding: var(--s1) var(--s3); font-size: var(--fs-sm); }

  .fs { position: fixed; inset: 0; z-index: 50; margin: 0; border: 0; border-radius: 0; }
  footer { display: flex; flex-direction: column; gap: var(--s2); padding: var(--s3) var(--s4); border-top: 1px solid var(--line); }
</style>
