# Estudio

La app de música: cada canción entera en un sitio. Letra palabra a palabra (y lo que suena en Spotify, sola), pistas
separadas, partitura con la letra debajo, acordes, piano roll y edits para vídeo, con una cola de trabajos común.
Tauri v2 (Rust) + Svelte; el editor de edits es el de Lyric Edits (React + Remotion).

Sustituye a **Letras**, **StemLab** y **Lyric Edits** (deprecadas): sus motores están dentro (`engine/letras.py` y
`engine/stemlab.py`, copiados de sus repos en 816a154 y f5262dc) y `engine/hub.py` los une. Usa sus mismas carpetas
de datos (letras, canciones separadas, modelos, edits), así que no hubo que migrar nada, y el panel de letras del
escritorio (`eww/scripts/lyrics.sh`) sigue leyendo las letras de donde siempre.

## Lo de más calidad manda

- **Un audio por canción**: `audio/<clave>.wav` de Letras. StemLab separa ese mismo fichero (enlace duro, sin copia)
  con la clave de Letras como id, así que las pistas y la letra van siempre sobre el mismo audio.
- **Voz**: la de StemLab (BS-RoFormer a calidad completa) > la rápida de Letras (2 pasadas, fp16). Si la canción ya
  está separada, sincronizar la letra no separa nada; si se separa después, su voz sustituye a la rápida.
- **Letra de la partitura**: la de Letras (Whisper large-v3 + alineado forzado, texto de Genius o corregido a mano,
  con sus desfases) en vez de Whisper turbo. Corregir la letra corrige la partitura (se reparte otra vez al montarla,
  sin IA). Sacar las notas de la voz busca y sincroniza la letra si falta.
- **Pulsos**: Beat This! (CPJKU, ISMIR 2024) sobre la mezcla, sin separar: pulsos y primeros tiempos de compás
  (el metrónomo acentúa el 1 real y detecta 6/8; librosa se equivocaba de tempo y no sabía de compases). CPU, ~5 s.
- **Acordes**: lv-chordia (Jiang et al., ISMIR 2019; ~170 acordes con inversiones, ~81 % en Billboard) sobre el audio:
  GPU, ~15 s, sin necesitar pistas ni notas. Mientras no están, unos provisionales a partir de las notas.
- **Notas**: rápidas con basic-pitch (CPU, segundos) o precisas con MuScriptor (Kyutai, 2026; GPU, minutos por pista;
  en su prueba F1 multi-instrumento 48 frente a 22 de YourMT3+), cada pista con su instrumento. Lo elige el ajuste
  «Notas por defecto» o el botón «Precisas» de cada pista. MuScriptor necesita aceptar su licencia (no comercial) en
  Hugging Face y `engine/.venv/bin/hf auth login` una vez.
- **Audio y letra en la misma versión**: los tiempos de la letra son los de Spotify (LRCLIB…) y el audio sale de YouTube,
  que puede ser otra versión (un videoclip con intro). La primera vez que se sincroniza, Whisper mide el desfase y se
  mueve el audio (recorta la intro o pone silencio), con todo lo sacado de él (voz, pulsos, acordes, notas, pistas,
  recortes de los edits): la letra no se toca, así que Spotify y el escritorio siguen igual. Para las ya hechas:
  «comprobar» en la pestaña Letra o «Comprobar la versión del audio» en bloque.
- **Pistas que suman la canción**: sin la normalización por pista de audio-separator, y lo que ninguno de los dos
  modelos pone en una pista (coros, voces procesadas, efectos) va a «Otros».
- **Nada a medias**: la separación se monta en una carpeta aparte y se mueve al acabar; si una vieja se quedó a medias
  se rehace de cero (pistas enteras sin `meta.json`: se rehace el `meta.json` sin GPU). Las cachés de Letras se
  escriben de forma atómica y las rotas se tiran. Las canciones separadas a mano en StemLab («dna») se enlazan
  solas con la de Letras si título y duración coinciden.

## Cola

- **GPU, una cosa a la vez** (8 GB de una RX 6600 no dan para dos modelos; una 7700 XT, gfx1101, va sin ajustes),
  en un único proceso (`hub.py worker`) que deja el último modelo cargado entre canciones: Whisper, el separador
  compilado y MuScriptor no se recargan. Entre los pasos listos gana el que usa el modelo ya cargado: en una tanda
  van todas las separaciones, luego todo Whisper… Toma el mismo candado de GPU que Letras y StemLab (su prefetch
  espera, o espera él), y lo suelta con la VRAM a los 15 s sin trabajo de GPU.
- **CPU** (notas con basic-pitch, pulsos, alineado; `ESTUDIO_CPU_JOBS`, por defecto núcleos/4), **red** (búsquedas,
  descargas; 4) y **render** (1) en paralelo con la GPU.
- **Dependencias**: «Todo» = separar → (buscar la letra mientras) → sincronizar con la voz buena → notas de cada
  instrumento (CPU, mientras la GPU hace Whisper) → notas de la voz con la letra hecha. Una letra pedida suelta
  espera a la separación de esa canción si hay una en cola.
- Cancelar (mata el grupo de procesos: ffmpeg, yt-dlp…), pasar al principio, reintentar, en bloque. La cola se guarda
  en disco (`queue.json`) y sigue al abrir la app; cada paso mira lo que ya hay y no repite trabajo.

## Uso

- **Menú** al abrir: «Analizar canciones» (todo lo de abajo) o «Tocar» (`1`/`2`; la casita de arriba vuelve).
- **Tocar**: teclado MIDI por USB (`midir`, ALSA; se conecta solo al enchufarlo, el último usado o el único). Piano roll
  al revés (la barra sale de la tecla al tocarla y sube), pedal de resonancia, el acorde que suena con su grado y la
  tonalidad de lo tocado (sin IA, `live.ts` con las plantillas de `harmony.ts`), volumen del teclado por CC7. La sesión
  se guarda sola cada 15 s en `$ESTUDIO_DATA/sesiones/<fecha>.mid` (se reproduce en cualquier sitio) y `.json` (notas,
  nombres, acordes y pedal, para pasárselo a una IA).

- **Biblioteca**: todas las canciones de las tres apps. Filtros, búsqueda (`/`), orden; selección con casillas,
  Ctrl/Mayús+clic o Ctrl+A, y acciones en bloque (Todo, Letra, Pistas, Notas, pulsos, borrar).
- **Añadir** (`N`): por artista y título (como Letras), de YouTube y cualquier web de yt-dlp, o ficheros (también
  arrastrándolos a la ventana), con qué hacer después.
- **Canción**: tarjetas de cada etapa (audio, letra, pistas, notas, edits) con su trabajo en vivo y «Hacer todo».
  Pestañas Letra (karaoke palabra a palabra, editor de Letras `E`, buscar otra vez, volver a la anterior, desfases;
  «Dentro de cada línea» no toca el inicio de ninguna línea y el audio coloca cada palabra hasta la línea siguiente;
  «Desde el audio» no usa los tiempos por línea: Whisper sobre tu texto y alineado letra a letra; al añadir, en cambio, mandan los tiempos de internet como en Letras), Pistas (mezclador, M/S, metrónomo `M`), Piano roll (con el acorde que suena, el siguiente y la tonalidad),
  Partitura (de conjunto, sigue la reproducción, PDF), Acordes (cancionero sin ritmo: «Mim7» encima de la palabra en
  la que entra, intro e instrumentales en compases; tonalidad y escala escritas; Do/C, simplificar, grados; sale de las
  notas transcritas cada dos pulsos, sin IA) y Edits (crear con reglas, con Claude o con tus presets; abre el editor de Lyric Edits).
- `Espacio` reproduce, `←/→` 5 s, `1-5` pestañas, `Q` la cola.

- **Spotify** (lo que hacía Letras): lo que suena se busca y, si su letra no trae tiempos, se sincroniza solo, el
  primero de la cola. Arriba sale qué suena; en su pestaña Letra, sin reproducir aquí, la letra va con el reloj de
  Spotify y saltar a una línea la mueve allí. Se apaga en Ajustes.
- **Playlists** (Ajustes): las canciones de tus playlists públicas se sincronizan cada 6 h en segundo plano
  (`estudio-prefetch.timer`, con un juego abierto espera); «Procesar ahora» y reintentar las fallidas.
- **Escritorio**: oculta en el escritorio, instrumental y nota, en la pestaña Letra.
- **Servidor** (Ajustes → Servidor; en bloque, «Sincronizar con el servidor»): lo ya procesado de cada canción (audio,
  voz, pistas, Whisper, alineado, pulsos, acordes, notas, letra con su historial y edits con sus fondos) se guarda en
  `server/server.py`, y otro ordenador lo baja en vez de volver a sacarlo. Sincronizar es en los dos sentidos: lo que
  falta en un lado sale del otro, y si los dos cambiaron un fichero gana el más nuevo. El audio y las pistas van en
  bloque con todo lo que sale de ellos: si un lado tiene otro audio (otra versión, o recortado al alinearlo), gana
  entero el bloque más nuevo y no se mezcla, por ejemplo, Whisper de un audio con el otro. Una separación a medias no
  se sube. Los ficheros van por contenido (sha256): un audio enlazado en dos sitios se sube una vez, y al bajar se
  vuelve a enlazar.

  ```sh
  python3 server/server.py                       # localhost:8765, datos en ./store (PORT, HOST, STORE)
  ```

  Fuera de localhost pide `ESTUDIO_TOKEN` (en la app: Ajustes → Servidor → Token). No lleva TLS: en la nube, detrás
  de un proxy con HTTPS (Caddy, Traefik…). Sin la app: `ESTUDIO_REMOTE=host:puerto engine/.venv/bin/python
  engine/hub.py remote_sync <clave>`.

De StemLab no se trajeron las carpetas de la biblioteca (hay filtros y búsqueda).

Datos: los de las apps de antes (`LETRAS_DATA`, `STEMLAB_DATA`, `LYRIC_EDITS_DATA`, con su mismo criterio) y lo
propio en `$ESTUDIO_DATA` o `~/.local/share/estudio` (`songs.json`: canciones sin letra y enlaces con las pistas;
`queue.json`; `settings.json`; vistas). Python: `engine/.venv` (o `ESTUDIO_PYTHON`).

## Desarrollo

```sh
cd engine && uv sync
cd ../app && npm install && npm run tauri dev     # puerto 1440
```

Tests: `cd engine && .venv/bin/python test_hub.py` (y `test_letras.py`, `test_stemlab.py`, `test_remote.py`), `cd app && npm test && npm run check`,
`cd app/src-tauri && cargo test`. Con datos reales: `ESTUDIO_TEST="todo <clave>" cargo test real_job -- --ignored --nocapture`.
Instalar en el lanzador: `./install.sh`.
