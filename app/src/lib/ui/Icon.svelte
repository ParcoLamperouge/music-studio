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
    pause: "M6 5h4v14H6z M14 5h4v14h-4z",
  } as const;
  export type IconName = keyof typeof ICONS;
  const FILLED = new Set<IconName>(["play", "pause"]);
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
