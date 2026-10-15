<script lang="ts" module>
  // Un solo juego de iconos de trazo (24×24, 1.75, extremos redondos). `play` y `pause` van rellenos.
  export const ICONS = {
    library: "M4 3h16a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M7.5 7v10 M11.5 7v10 M15 7.2l2.5 9.6",
    learn: "M4 4h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z M9 14v6 M15 14v6 M7.5 4v10h3V4 M13.5 4v10h3V4",
    course: "M22 9.5 12 4.5l-10 5 10 5 10-5z M6 11.5V16c3 2.5 9 2.5 12 0v-4.5 M22 9.5v5",
    midi: "M3 8h18a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z M6 8v6 M10 8v6 M14 8v6 M18 8v6 M12 8V4.5a1.5 1.5 0 0 1 3 0V5",
    sessions: "M3 12a9 9 0 1 0 2.8-6.5 M3 4v4h4 M12 7.5V12l3 2",
    ear: "M6 8.5a6.5 6.5 0 1 1 13 0c0 6-6 6-6 10a3.5 3.5 0 1 1-7 0 M15.5 8.5a3 3 0 0 0-6 0v.5a2 2 0 1 1 0 4",
    progressions: "M2.5 8h5v8h-5z M9.5 8h5v8h-5z M16.5 8h5v8h-5z",
    settings:
      "M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
    queue: "M4 6h16 M4 12h9 M4 18h6 M16 15v6l5-3z",
    search: "M11 4.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13z M20.5 20.5 16 16",
    plus: "M12 5v14 M5 12h14",
    close: "M6 6l12 12 M18 6 6 18",
    check: "M5 12.5l4.5 4.5L19 7",
    more: "M5 12h.01 M12 12h.01 M19 12h.01",
    "chevron-left": "M15 6l-6 6 6 6",
    "chevron-right": "M9 6l6 6-6 6",
    "chevron-down": "M6 9l6 6 6-6",
    back: "M19 12H5 M11 6l-6 6 6 6",
    top: "M6 5h12 M12 19V9 M7 14l5-5 5 5",
    retry: "M4 12a8 8 0 1 0 2.4-5.7 M4 4v4h4",
    trash: "M4 7h16 M10 11v6 M14 11v6 M6 7l1 13h10l1-13 M9 7V4h6v3",
    link: "M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1",
    upload: "M12 15V4 M7 9l5-5 5 5 M5 20h14",
    folder: "M3 6a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z",
    mic: "M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3z M5 11a7 7 0 0 0 14 0 M12 18v3",
    audio: "M3 11v2 M7 8v8 M11 4v16 M15 7v10 M19 10v4",
    lyrics: "M4 6h16 M4 10h16 M4 14h10 M4 18h7",
    stems: "M12 3 2 8l10 5 10-5z M2 13l10 5 10-5 M2 17.5l10 5 10-5",
    notes: "M9 18V5l11-2v13 M9 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0z M20 16a3 3 0 1 1-6 0a3 3 0 1 1 6 0z",
    chords: "M6 3h12v18H6z M10 3v18 M14 3v18 M6 9h12 M6 15h12",
    edits: "M3 5h18v14H3z M10 9.5v5l4-2.5z",
    sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 15.5l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7z",
    gpu: "M7 7h10v10H7z M10 3v4 M14 3v4 M10 17v4 M14 17v4 M3 10h4 M3 14h4 M17 10h4 M17 14h4",
    alert: "M12 9v4 M12 16.5h.01 M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    volume: "M4 9v6h4l5 4V5L8 9H4z M16 9.5a3.5 3.5 0 0 1 0 5 M18.5 7a7 7 0 0 1 0 10",
    sort: "M7 4v16 M3 16l4 4 4-4 M17 20V4 M13 8l4-4 4 4",
    select: "M4 4h16v16H4z M8 12l3 3 5-6",
    broadcast: "M12 12h.01 M8.5 8.5a5 5 0 0 0 0 7 M15.5 15.5a5 5 0 0 0 0-7 M5.6 5.6a9 9 0 0 0 0 12.8 M18.4 18.4a9 9 0 0 0 0-12.8",
    cloud: "M7 18a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 9.5a4 4 0 0 1-.5 8.5z",
    hidden: "M3 3l18 18 M10.6 6.1A9.8 9.8 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-2.4 3 M6.6 6.6C4.3 8.1 3 12 3 12s4 6 9 6a9 9 0 0 0 4.4-1.1",
    play: "M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z",
    prev: "M6 5v14 M18 6v12l-9-6z",
    next: "M18 5v14 M6 6v12l9-6z",
    pause: "M6 5h4v14H6z M14 5h4v14h-4z",
    // Aprender, Curso, Oído
    loop: "M17 2l3 3-3 3 M4 11V9a4 4 0 0 1 4-4h12 M7 22l-3-3 3-3 M20 13v2a4 4 0 0 1-4 4H4",
    wait: "M6 3h12 M6 21h12 M7 3c0 5 10 5 10 9s-10 4-10 9 M17 3c0 5-10 5-10 9s10 4 10 9",
    score: "M3 6h18 M3 10h18 M3 14h18 M3 18h18 M14 18V6",
    roll: "M4 4v16h16 M8 8h4 M10 12h6 M7 16h5 M15 6h4",
    sliders: "M4 6h10 M18 6h2 M4 12h2 M10 12h10 M4 18h12 M20 18h0 M14 4v4 M6 10v4 M16 16v4",
    undo: "M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3",
    redo: "M15 14l5-5-5-5 M20 9H9a5 5 0 0 0 0 10h3",
    record: "M12 6a6 6 0 1 0 0 12a6 6 0 1 0 0-12z",
    download: "M12 4v11 M7 10l5 5 5-5 M5 20h14",
    edit: "M4 20h4L19 9l-4-4L4 16z M13 7l4 4",
    flame: "M12 22a7 7 0 0 0 7-7c0-4-3-6-4-10-2 2-3 4-3 6-1-1-2-2-2-4-3 2-5 5-5 8a7 7 0 0 0 7 7z",
    star: "M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z",
    target: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 12h.01",
    grid: "M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h6v6h-6z",
    metronome: "M9 3h6l4 18H5z M12 17l5-11 M8 17h8",
    keyboard: "M3 6h18v12H3z M7 10h.01 M11 10h.01 M15 10h.01 M7 14h10",
    minus: "M5 12h14",
    eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6z",
    help: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6 M12 17h.01",
    // Canción
    expand: "M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5",
    info: "M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 11v5 M12 7.5h.01",
  } as const;
  export type IconName = keyof typeof ICONS;
  const FILLED = new Set<IconName>(["play", "pause", "record"]);
</script>

<script lang="ts">
  let { name, size = 16, label }: { name: IconName; size?: number; label?: string } = $props();
</script>

<svg
  viewBox="0 0 24 24"
  width={size}
  height={size}
  class:filled={FILLED.has(name)}
  role={label ? "img" : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : "true"}
><path d={ICONS[name]} /></svg>

<style>
  svg { flex-shrink: 0; fill: none; stroke: currentColor; stroke-width: 1.75; stroke-linecap: round; stroke-linejoin: round; display: block; }
  .filled { fill: currentColor; stroke: none; }
</style>
