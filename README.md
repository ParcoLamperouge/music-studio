# Estudio

[English](README.md) | [简体中文](README.zh-CN.md) | [Español](README.es.md)

The music app: every whole song in one place. Word-by-word lyrics (and whatever is playing on Spotify, on its own), separated stems, sheet music with the lyrics underneath, chords, piano roll and video edits, all sharing a common job queue.
Tauri v2 (Rust) + Svelte; the edits editor is Lyric Edits' (React + Remotion).

It replaces **Letras**, **StemLab** and **Lyric Edits** (deprecated): their engines live inside (`engine/letras.py` and
`engine/stemlab.py`, copied from their repos at 816a154 and f5262dc) and `engine/hub.py` ties them together. It uses their
same data folders (lyrics, separated songs, models, edits), so nothing needed migrating, and the desktop lyrics panel
(`eww/scripts/lyrics.sh`) still reads the lyrics from where it always did.

## The higher-quality source wins

- **One audio per song**: `audio/<key>.wav` from Letras. StemLab separates that same file (hard link, no copy) using the
  Letras key as id, so the stems and the lyrics always work on the same audio.
- **Vocals**: StemLab's (BS-RoFormer at full quality) > Letras' fast one (2 passes, fp16). If the song is already
  separated, syncing lyrics doesn't separate anything; if separation happens later, its vocals replace the fast ones.
- **Sheet-music lyrics**: Letras' (Whisper large-v3 + forced alignment, Genius text or hand-corrected, with its offsets)
  instead of Whisper turbo. Fixing the lyrics fixes the sheet music (redistributed again when the score is built, no AI).
  Extracting notes from vocals searches for and syncs the lyrics if missing.
- **Beats**: Beat This! (CPJKU, ISMIR 2024) on the mix, without separating: beats and downbeats (the metronome accents
  the real 1 and detects 6/8; librosa got the tempo wrong and knew nothing about meters). CPU, ~5 s.
- **Chords**: lv-chordia (Jiang et al., ISMIR 2019; ~170 chords with inversions, ~81 % on Billboard) on the audio:
  GPU, ~15 s, no stems or notes needed. Until they're ready, provisional ones from the notes.
- **Notes**: fast with basic-pitch (CPU, seconds) or precise with MuScriptor (Kyutai, 2026; GPU, minutes per stem;
  in its benchmark, multi-instrument F1 of 48 vs YourMT3+'s 22), each stem with its instrument. Chosen by the
  "Default notes" setting or each stem's "Precise" button. MuScriptor requires accepting its (non-commercial) license
  on Hugging Face and `engine/.venv/bin/hf auth login` once.
- **Audio and lyrics from the same version**: lyric timings are Spotify's (LRCLIB…) and the audio comes from YouTube,
  which may be a different version (a music video with an intro). The first time lyrics are synced, Whisper measures the
  offset and the audio is shifted (trims the intro or adds silence), along with everything derived from it (vocals,
  beats, chords, notes, stems, edit trims): the lyrics aren't touched, so Spotify and the desktop stay as they were.
  For songs already done: "check" in the Lyrics tab or "Check audio version" in bulk.
- **Stems that add up to the song**: no per-stem normalization from audio-separator, and whatever neither model puts on
  a stem (backing vocals, processed voices, effects) goes to "Other".
- **Nothing half-done**: separation is built in a separate folder and moved into place when finished; if an old one was
  left half-done it's redone from scratch (whole stems without `meta.json`: the `meta.json` is rebuilt without GPU).
  Letras' caches are written atomically and broken ones are discarded. Songs separated by hand in StemLab ("dna") link
  themselves to the Letras one if title and duration match.

## Queue

- **GPU, one thing at a time** (8 GB of an RX 6600 won't fit two models; a 7700 XT, gfx1101, runs without tweaks),
  in a single process (`hub.py worker`) that keeps the last model loaded between songs: Whisper, the compiled separator
  and MuScriptor aren't reloaded. Among ready steps, the one that uses the already-loaded model wins: in a batch, all
  separations first, then all Whisper… It takes the same GPU lock as Letras and StemLab (their prefetch waits, or it
  waits), and releases it when VRAM has been idle for 15 s.
- **CPU** (basic-pitch notes, beats, alignment; `ESTUDIO_CPU_JOBS`, default cores/4), **network** (searches, downloads;
  4) and **render** (1) run in parallel with the GPU.
- **Dependencies**: "All" = separate → (fetch lyrics meanwhile) → sync with the good vocals → notes per instrument
  (CPU, while the GPU does Whisper) → vocal notes once lyrics are done. A pending lyric request waits for that song's
  separation if one is queued.
- Cancel (kills the process group: ffmpeg, yt-dlp…), move to front, retry, in bulk. The queue is saved to disk
  (`queue.json`) and resumes when the app opens; each step checks what's already there and doesn't repeat work.

## Usage

- **Menu** on open: "Analyze songs" (everything below), "Play", "Sessions" or "Learn" (`1`…`4`; the little house at the
  top goes back).
- **Learn**: a separated song as a piano arrangement (`arrange.ts`), levels 1 (beginner: melody in quarter notes, the
  root in the left hand) to 5 (what it sounds like). Right hand: the melody of the stem you choose (vocals by default),
  clean and quantized to the beats of Beat This!; or, without melody, the chords. Left hand: generated from the chords
  (root, root + fifth, well-voiced triads, bass + chord). Optional transposition to an easy key (then only the drums of
  the song play). It plays over its stems without the part you're playing, with a synthesized guide for the other hand,
  wait mode, A–B loop and hit tracking; in piano roll or sheet music (piano MusicXML, with PDF).
- **My pieces** (in Learn): songs written by hand or imported (MIDI; MusicXML `.musicxml`/`.xml`/`.mxl`), in
  `piezas/<id>.json`, with the same levels (5 is the piece as-is). **Editor** in piano roll: step by step with the piano
  or the keyboard (each note stays at the cursor while you hold it, and the cursor advances) or recording in real time
  with a metronome (the pedal sustains what you release); per-note velocity (bottom lane, "Velocity" control, Alt+↑↓);
  mouse (click places, drag moves or extends, right-click deletes) and keyboard (arrows, Shift+arrows, Ctrl+↑↓ octave,
  Tab switches hands, Delete, Ctrl+Z/Y/A/C/X/V/Q, Space); live sheet music; exports to MIDI and MusicXML; becomes a
  session. MusicXML with repeats, 1st/2nd endings, D.C., D.S., Fine and Coda expanded. Practice at reduced tempo
  (50-100 %): the song's stems are time-stretched without changing pitch (FFmpeg with rubberband; once per song and
  speed, in `$ESTUDIO_DATA/lento/`, ~6 s per stem). With a MIDI keyboard, practice also watches velocity: the key turns
  yellow if the note is right but too loud or too soft, and it tracks on average how much louder or softer you play.
  In Sessions: import MIDI/MusicXML as a session and "Practice in Learn" (the session as a piece). The guide, sessions
  and the computer keyboard sound with Salamander Grand Piano samples (`app/public/piano`, CC BY, 2 MB).
- **Sessions**: two lists. Songs: library songs with separated stems that you add ("＋ Add song"; the list lives in
  `sesiones/canciones.json`), by instruments (volume and M/S, a piano roll for each, chords and progression). Sessions:
  those saved in Play, with the piano roll and transport of the songs (they sound with a synthesized piano), key,
  most-played chords and the progression (click = go there). "Analyze with Claude" (Opus 5.5, medium effort: sections
  with their emotion, progressions with notes and degrees, mistakes) uses Claude Code
  (`claude -p`, the subscription; no tools or your hooks) and leaves `<session>.analisis.md` next to it (~1 min). Also
  for songs on the list, with the instruments you choose (their notes, chords and lyrics;
  `sesiones/canciones/<song>__<stems>.analisis.md`). Claude receives TOON (`toon.ts`: note and chord lists as a table),
  not the JSON.
- **Play**: USB MIDI keyboard (`midir`, ALSA; connects by itself when plugged in — the last one used, or the only one).
  Upside-down piano roll (the bar leaves the key as you play it and rises), sustain pedal, the sounding chord with its
  degree and the key of what you're playing (no AI, `live.ts` with the templates from `harmony.ts`), keyboard volume
  via CC7. To try without a piano, the computer keyboard: A–Ñ row whites, W E T Y U O P blacks, Z/X octave, Space pedal
  (if a piano is connected, it sounds on it). The session autosaves every 15 s to
  `$ESTUDIO_DATA/sesiones/<date>.mid` (plays anywhere) and `.json` (notes, names, chords and pedal, to hand to an AI).

- **Library**: all songs from the three apps. Filters, search (`/`), sorting; selection with checkboxes,
  Ctrl/Shift+click or Ctrl+A, and bulk actions (All, Lyrics, Stems, Notes, beats, delete).
- **Add** (`N`): by artist and title (like Letras), from YouTube and any yt-dlp site, or files (also by dragging them
  onto the window), with what to do afterwards.
- **Song**: cards for each stage (audio, lyrics, stems, notes, edits) with their live job and "Do all". Tabs: Lyrics
  (word-by-word karaoke, Letras editor `E`, search again, back to the previous one, offsets; "Within each line" doesn't
  touch any line's start and the audio places each word up to the next line; "From the audio" doesn't use per-line
  timings: Whisper on your text with letter-by-letter alignment; when adding, on the other hand, internet timings rule
  as in Letras), Stems (mixer, M/S, metronome `M`), Piano roll (with the sounding chord, the next one and the key),
  Sheet music (ensemble, follows playback, PDF), Chords (songbook without rhythm: "Em7" over the word it enters on,
  intro and instrumentals in bars; key and scale written out; C/Do, simplify, degrees; derived from the transcribed
  notes every two beats, no AI) and Edits (create with rules, with Claude or your presets; opens the Lyric Edits
  editor).
- `Space` plays, `←/→` 5 s, `1-5` tabs, `Q` the queue.

- **Spotify** (what Letras did): whatever is playing is searched and, if its lyrics come without timings, it syncs by
  itself, first in the queue. What's playing shows at the top; in its Lyrics tab, without playing here, the lyrics
  follow Spotify's clock and jumping to a line moves it there. Turned off in Settings.
- **Playlists** (Settings): the songs of your public playlists sync every 6 h in the background
  (`estudio-prefetch.timer`, waits if a game is open); "Process now" and retry the failed ones.
- **Desktop**: hidden on the desktop, instrumental and note, in the Lyrics tab.
- **Server** (Settings → Server; in bulk, "Sync with server"): each song's already-processed data (audio, vocals,
  stems, Whisper, alignment, beats, chords, notes, lyrics with their history and edits with their backgrounds) is
  stored in `server/server.py`, and another computer downloads it instead of extracting it again. Sync is
  bidirectional: what's missing on one side comes from the other, and if both sides changed a file the newest wins.
  Audio and stems travel as a block with everything derived from them: if one side has a different audio (another
  version, or trimmed when aligning), the newer block wins whole — Whisper of one audio is never mixed with the other.
  A half-done separation isn't uploaded. Files go by content (sha256): an audio hard-linked in two places is uploaded
  once, and on download it's hard-linked again.

  ```sh
  python3 server/server.py                       # localhost:8765, data in ./store (PORT, HOST, STORE)
  ```

  Beyond localhost it requires `ESTUDIO_TOKEN` (in the app: Settings → Server → Token). No TLS: in the cloud, put it
  behind a proxy with HTTPS (Caddy, Traefik…). Without the app: `ESTUDIO_REMOTE=host:port engine/.venv/bin/python
  engine/hub.py remote_sync <key>`.

From StemLab, the library folders weren't brought over (there are filters and search).

Data: those of the previous apps (`LETRAS_DATA`, `STEMLAB_DATA`, `LYRIC_EDITS_DATA`, same criteria) and its own in
`$ESTUDIO_DATA` or `~/.local/share/estudio` (`songs.json`: songs without lyrics and links with their stems;
`queue.json`; `settings.json`; views). Python: `engine/.venv` (or `ESTUDIO_PYTHON`).

## Development

```sh
cd engine && uv sync
cd ../app && npm install && npm run tauri dev     # port 1440
```

Tests: `cd engine && .venv/bin/python test_hub.py` (and `test_letras.py`, `test_stemlab.py`, `test_remote.py`),
`cd app && npm test && npm run check`,
`cd app/src-tauri && cargo test`. With real data: `ESTUDIO_TEST="todo <key>" cargo test real_job -- --ignored --nocapture`.
Install into the launcher: `./install.sh`.
