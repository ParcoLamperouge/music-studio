# Running Estudio (music-studio) on macOS

This project was written for Linux + AMD GPUs. This copy has been adapted to run
on macOS (Apple Silicon). Here is what changed and how to run it.

## What was changed (vs. upstream)

All changes are in `engine/pyproject.toml` + a regenerated `engine/uv.lock`:

1. `torch`/`torchaudio` no longer forced to AMD's ROCm index (Linux-only); on
   macOS they come from PyPI (CPU + Apple MPS build).
2. `muscriptor` (precise GPU transcription) is excluded on macOS — it pins an
   old torch and needs a GPU. Transcription uses **basic-pitch** instead
   (CPU, fast, slightly less precise). No other feature was removed.
3. The lockfile is resolved for macOS only.

No source code was modified. `midir` (MIDI keyboard) uses CoreMIDI on macOS and
works natively.

## Prerequisites on this Mac (already installed)

- `uv` (Python env), Node 24 via `fnm`, `cargo`/Rust, `ffmpeg`, Xcode CLT.
- The Python engine lives in `engine/.venv` (already synced — several GB).
- First time you separate a song, the app downloads AI models (~3 GB) into
  `~/.local/share/stemlab/models`. Subsequent runs are offline.

## Run it

```sh
cd /Users/parco/Documents/mine/music/sheetmusic/music-studio/app
fnm exec --using=v24.22.1 -- npm run tauri dev
```

(Or `fnm use v24.22.1` first, then `npm run tauri dev`.)

- Compiles for a few minutes the first time, then the **Estudio** window opens.
- Quit: close the window, or Ctrl+C in the terminal.
- Only one instance can run at a time (file lock in the data folder).

## Languages (English / 简体中文 / Español)

This fork adds full interface language support. Open **Settings (Ajustes)** — the
first row is **Idioma · Language · 语言** — pick Español, English or 简体中文;
the whole UI switches live and the choice persists (settings.json). First run
follows your system language.

Translated: all menus and views, the work queue, engine progress labels and
error messages, the edit-video editor, and the Claude analysis output language.
Left in Spanish on purpose: the piano-course lesson content (Curso) and
exercise/obra texts (a future content-translation pass), and the instrument
names baked into MusicXML/PDF exports.

Developer notes: keys are the Spanish source strings; dictionaries live in
`app/src/lib/locales/{en,zh}.ts`; `src/lib/locales.test.ts` (in `npm test`)
enforces en/zh key parity and `{param}` consistency. Engine/Rust strings are
translated at display time by `engineLabel()`/`engineErr()` templates in
`src/lib/i18n.svelte.ts`.

### Your data lives in

- `~/.local/share/estudio` — main data (override with `ESTUDIO_DATA`)
- `~/.local/share/letras` — lyrics/audio (override with `LETRAS_DATA`)
- `~/.local/share/stemlab` — stems + AI models (`STEMLAB_DATA`)
- `~/.local/share/lyric-edits` — video edits (`LYRIC_EDITS_DATA`)

## Recommended first session (audio → playable piano sheet)

1. Menu → **Aprender** (3rd item, key `3`) is the "learn piano" mode — this is
   the one that turns songs into playable arrangements.
2. From the main menu, **Analizar canciones** → **Añadir** (`N`) to add a song:
   by artist+title, a YouTube link, or drag an audio file into the window.
   Choose what to run after adding (Todo = everything).
3. In the song view, wait for **Pistas** (stems) and **Notas** (notes) to finish.
   On CPU-only, stem separation takes minutes instead of seconds — be patient.
4. Open **Aprender**, pick the song, pick the melody track (default: vocals),
   pick level 1–5 (1 = beginner, 5 = as heard). Play/practice with on-screen
   piano roll or a USB MIDI keyboard.

## What works on macOS and what doesn't

| Feature | Status |
|---|---|
| Add songs (YouTube / files) | ✅ |
| Stem separation (BS-RoFormer) | ✅ but CPU → slow (minutes per song) |
| Lyrics (Whisper) | ✅ CPU |
| Notes / sheet music (basic-pitch) | ✅ CPU, fast |
| Precise notes (MuScriptor) | ❌ excluded (GPU/ROCm-only) |
| Beats (Beat This!) | ✅ CPU |
| Chords (lv-chordia) | ⚠️ marked GPU upstream; try it, may be slow/fail |
| Learn piano (Aprender) | ✅ |
| MIDI keyboard | ✅ CoreMIDI (plug in, auto-connects) |
| Spotify / Playlists integration | ✅ (needs Spotify; Linux prefetch timer N/A) |
| Sync server (`server/server.py`) | ✅ plain Python, cross-platform |

## Spanish cheat sheet (UI + README)

| Spanish | English |
|---|---|
| Añadir | Add (song) |
| Analizar canciones | Analyze songs |
| Aprender | Learn (piano mode) |
| Tocar | Play (live keyboard) |
| Sesiones | Sessions (recordings) |
| Biblioteca | Library |
| Canción | Song |
| Letra | Lyrics |
| Pistas | Tracks / stems |
| Notas | Notes |
| Partitura | Sheet music |
| Acordes | Chords |
| Tonalidad | Key |
| Edits | Video edits |
| Cola | Queue |
| Ajustes | Settings |
|Todo | All / Do everything |
| Búsqueda / Buscar | Search |
| Borrar | Delete |
| Desfases | Offsets (timing adjustments) |
| Fuerza | (Note) velocity |
| Bucle A–B | A–B loop |
| Piezas | Pieces (your own compositions) |
| Principiante | Beginner |
| Pulsos | Beats |
| Compás | Bar / measure |
| Negras | Quarter notes |
| Mano derecha / izquierda | Right / left hand |
| Melodía | Melody |
| Bajo | Bass |
| Voz | Voice/vocals |
| Batería | Drums |
| Piano / Guitarra | Piano / Guitar |

## Updating from upstream

`git pull` will conflict on `engine/pyproject.toml` and `engine/uv.lock`
(both modified for macOS). Easiest: stash your changes, pull, re-apply
the three edits described at the top, and run `uv lock && uv sync` again.
