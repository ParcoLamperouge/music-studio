# UI de Estudio — sistema de diseño

Oscuro sobrio, casi monocromo, todo en JetBrains Mono. **El color es solo para datos musicales**; la interfaz es gris
con un único acento, magenta (`--accent`), para foco, selección y la acción principal (una por pantalla). Nada rosa,
nada de degradados en botones, nada de emoji (iconos de `Icon`).

## Tokens (`src/app.css`)
- Superficies: `--bg --rail --panel --panel-hi --line --line-hi --scrim`. Texto: `--text --text-2 --text-3` (≥4.5:1).
- Acento: `--accent --accent-soft --accent-line --on-accent`. Estado: `--ok --bad --warn`.
- Acordes por función: `--fn-tonic` (I) `--fn-sub` (ii, IV) `--fn-dom` (V, vii°) `--fn-vi` `--fn-iii` `--fn-other` (prestado); texto encima `--on-data`.
- Pistas: `--stem-vocals|drums|bass|guitar|piano|other|mix` (en hex también en `engine.ts STEM_INFO` para canvas: cambiar los dos).
- Tiempo/afinación: `--early` (←, cyan) `--ontime` `--late` (→, naranja) `--miss` (×) `--pitch` (línea blanca).
- Tipo `--fs-xs…--fs-2xl` (11–28px) · espacio `--s1…--s7` (4–48px) · radios `--r-sm --r-md --r-lg --r-full`.
- Movimiento `--t-fast` 120 · `--t` 160 · `--t-slow` 200 ms, `--ease`; `prefers-reduced-motion` los pone a 0.
- Armazón `--rail-w` 56px, `--player-h` 64px.

## Primitivas (`src/lib/ui/`)
| | props |
|---|---|
| `Button` | `variant` primary/secondary/ghost/danger · `size` sm/md/lg · `icon` · `kbd` · `active` · atributos de button |
| `IconButton` | `icon` `label` (aria + tooltip) · `kbd` · `side` · `size` sm/md/lg · `active` |
| `Icon` | `name` (ver `ICONS`) · `size` · `label` (si no, aria-hidden). Añadir iconos ahí, mismo trazo |
| `Tabs` | `options [{value,label?,icon?,count?,title?}]` · `bind:value` · `variant` segmented/underline · `size` |
| `Chip` | `active` `count` `icon` `color` (punto de datos) `onclick` (sin él es etiqueta) |
| `Card` | `pad` none/sm/md · `selected` |
| `Search` | `bind:value` `bind:ref` `kbd` `size` sm/md/lg + atributos de input |
| `Field` | `label` `bind:value` `bind:ref` + atributos de input |
| `Textarea` | `label` `bind:value` + atributos de textarea |
| `Slider` | `bind:value` `min` `max` `step` `label` `color` |
| `Toggle` | `bind:checked` `disabled` `title`, texto como hijo |
| `Popover` | `bind:open` `side` bottom/top/right · `align` · `width` · snippet `trigger({open,toggle})` |
| `Menu` | `items: MenuItem[]` (`{label,icon?,kbd?,danger?,disabled?,run}` o `"-"`) · `trigger` como Popover |
| `Dialog` | `bind:open` `title` `width` · snippet `footer`. `<dialog>` nativo: Esc, foco, fondo |
| `tooltip` | acción: `use:tooltip={"texto"}` o `{text,kbd,side}` |
| `ProgressRing` | `value` 0–1 o null (indeterminado) · `size` `stroke` `color` · hijo en el centro |
| `EmptyState` | `icon` `title`, una frase como hijo, snippet `actions` (la acción que lo arregla) |
| `Kbd` | `keys="Ctrl+K"` |
| `ChordChip` | `chord {root,kind}` `tonality` `name` · `showDegree` `active` `size` `onclick` |
| `StemBadge` | `stem` · `muted` · `dot` |
| `WaveThumb` | `peaks` (0–1) · `bars` `color` `progress` `height` |
| `MasterStrip` | `duration` `time` `onseek` · `sections` `chords` (+`tonality`) `energy` · `compact`/`big` · `loop` + `onloop` (Mayús+arrastrar) |
| `PlayButton` | `playing` `disabled` `size` `onclick`: el redondo de cada transporte |
| `MuteSolo` | `bind:muted` `bind:solo` `label`: M/S de una pista |
| `Heatmap` | `days` (AAAA-MM-DD, `progress.days`) · `weeks` |
| `FifthsWheel` | círculo de quintas: `tonality` (o null) · `chords [{root,kind,w?}]` (peso 0–1) · `current` · `size` `latin`. Color por función, tónica con aro |
| `Stepper` | `bind:value` `min` `max` `step` `label` `format` `onchange`: número con −/+ (rueda y flechas): tempo, latencia, semitonos |
| `Answer` | `state` idle/right/wrong/dim · `kbd` · `onclick`, hijo = la respuesta: botón grande de prueba (oído) |

## Datos (`ui/music.ts`, `peaks.svelte.ts`, `deck.svelte.ts`)
- `chordFn(chord, key)` → `{fn,label,color,minor,borrowed}` (sobre `harmony.degree`); `chordColor`; `FN_LABEL`.
- `barsOf(chords, beatData, duration)` → compases `{t,end,chords,repeat}` (rejilla de acordes).
- `stemColor(stem)` → `var(--stem-…)`; `cssVar("--fn-tonic")` para canvas; `TIMING` (color + símbolo + texto).
- `sectionsFromLyrics(lines, duration, offset)` → secciones (Intro/Estrofa/Estribillo/Inst./Final) desde la letra.
- `wantPeaks(key, hasAudio)` + `waves[key]`: onda RMS cacheada en `data/peaks/`, calculada en segundo plano.
- `deck` / `attachDeck` / `deckToggle` / `deckSeek`: la canción cargada, que controla el mini-reproductor.

## Reglas
1. Nada de estilos locales de botones, campos, pestañas, menús ni modales: usa las primitivas. Si falta una variante, añádela aquí.
2. No uses las clases viejas (`.primary .ghost .chip .tabs .seg .card .pop .menu .item .icon-btn…`, en `src/legacy.css`) ni sus nombres en clases nuevas: chocan. Al rehacer la última vista que las use, borra `legacy.css`.
3. Color solo para datos (acordes, pistas, tiempo, afinación, práctica). Nunca el color solo: añade forma, símbolo o texto.
4. Menos texto: iconos con tooltip, estados vacíos de una frase con su acción. Texto en español.
5. Layout: `min-width: 0` en hijos flex/grid con texto, `overflow` explícito, transiciones 120–200 ms con los tokens.
6. Armazón (`App.svelte`, `shell/`): cada vista ocupa el centro (`flex: 1; min-height: 0`), sin `100vh`; volver = la barra de iconos.
