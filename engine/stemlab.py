"""Motor de StemLab. Cada feature es un subcomando; habla con la app por JSON lines en stdout.

    engine.py separate <audio|url>  separa en pistas (cualquier formato de ffmpeg o URL de yt-dlp)
    engine.py search <texto|url>   busca en YouTube
    engine.py transcribe <song_id> <pista>  notas -> MusicXML + MIDI en scores/
    engine.py fix <song_id>      reconvierte mezcla y pistas a WAV que la app pueda reproducir
    engine.py ensemble <song_id> <pista>...  partitura conjunta de pistas ya transcritas
    engine.py beats <song_id>      pulsos para el metrónomo
    engine.py delete <song_id>     borra la canción del disco
    engine.py list               canciones ya procesadas
"""
import fcntl
import json
import os
import time
import re
import subprocess
import sys
import unicodedata
from contextlib import contextmanager, redirect_stdout
from pathlib import Path

# torch ROCm solo trae kernels gfx1030: las demás RDNA2 (RX 6600 = gfx1032, 6700 = gfx1031…) no salen
# como GPU sin hacerse pasar por gfx1030. Tiene que estar antes de importar torch.
if any(re.search(r"^gfx_target_version 1003(0[1-9]|[1-9]\d)$", p.read_text(), re.M)
       for p in Path("/sys/class/kfd/kfd/topology/nodes").glob("*/properties")):
    os.environ.setdefault("HSA_OVERRIDE_GFX_VERSION", "10.3.0")

# la app pasa STEMLAB_DATA; a mano, el mismo criterio que la app
DATA = Path(
    os.environ.get("STEMLAB_DATA")
    or ("/data/stemlab" if Path("/data/stemlab").is_dir() else Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "stemlab")
)
SONGS = DATA / "songs"
MODELS = DATA / "models"
DOWNLOADS = DATA / "downloads"

VOCAL_MODEL = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
INSTR_MODEL = "BS-Roformer-SW.ckpt"  # 6 pistas; guitarra y piano mucho más limpios que htdemucs_6s
STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"]
SILENCE_DBFS = -45  # pista con RMS máximo por debajo de esto = el instrumento no está


def emit(event, **data):
    print(json.dumps({"event": event, **data}), flush=True)


def slugify(name):
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", name).strip("-").lower() or "cancion"


def to_wav(src, dst):
    """Cualquier cosa que lea ffmpeg (audio o vídeo) -> WAV PCM 16-bit estéreo 44.1 kHz.
    Es el único formato que WebKitGTK decodifica seguro y el que esperan los modelos."""
    src, dst = Path(src), Path(dst)
    tmp = dst.with_name(f".{dst.stem}.tmp.wav")  # src y dst pueden ser el mismo fichero
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-i", str(src), "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(tmp)],
        capture_output=True,
        text=True,
    )
    if r.returncode != 0:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"ffmpeg no pudo leer {src.name}: {r.stderr.strip().splitlines()[-1:]}")
    tmp.replace(dst)
    if src != dst and src.parent == dst.parent and src.stem == dst.stem:
        src.unlink()  # misma pista en otro formato: sobra


@contextmanager
def gpu_lock():
    """Una sola separación en la GPU a la vez, venga de donde venga (varias ventanas, recargas...).
    Dos a la vez agotan la VRAM; el kernel suelta el candado si el proceso muere."""
    DATA.mkdir(parents=True, exist_ok=True)
    with open(DATA / ".gpu.lock", "w") as f:
        try:
            fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            emit("waiting", label="Esperando a la GPU")
            fcntl.flock(f, fcntl.LOCK_EX)
        yield


def loudest_dbfs(path):
    """RMS del bloque de 5 s más fuerte: un solo de guitarra de 10 s cuenta como presente."""
    import numpy as np
    import soundfile as sf

    loudest = 0.0
    for block in sf.blocks(str(path), blocksize=44100 * 5):
        loudest = max(loudest, float(np.sqrt(np.mean(np.square(block)))))
    return float(20 * np.log10(loudest + 1e-12))


def write_meta(song_id, title):
    out = SONGS / song_id
    stems = []
    for s in STEMS:
        level = round(loudest_dbfs(out / "stems" / f"{s}.wav"), 1)
        stems.append({"name": s, "file": f"stems/{s}.wav", "level": level, "present": level > SILENCE_DBFS})
    meta = {"id": song_id, "title": title, "mix": "mix.wav", "stems": stems}
    (out / "meta.json").write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    return with_dir(meta)


def is_url(s):
    return s.startswith(("http://", "https://"))


def search(query):
    """Busca en YouTube; con una URL devuelve ese único vídeo."""
    from yt_dlp import YoutubeDL

    target = query if is_url(query) else f"ytsearch15:{query}"
    with YoutubeDL({"quiet": True, "no_warnings": True, "extract_flat": "in_playlist", "noplaylist": True}) as ydl:
        info = ydl.extract_info(target, download=False)
    results = []
    for e in info.get("entries") or [info]:
        thumbs = e.get("thumbnails") or [{}]
        results.append({
            "url": e.get("webpage_url") or e.get("url") or f"https://www.youtube.com/watch?v={e['id']}",
            "title": e.get("title") or "",
            "channel": e.get("channel") or e.get("uploader") or "",
            "duration": e.get("duration"),
            "thumbnail": e.get("thumbnail") or thumbs[-1].get("url"),
        })
    emit("done", results=results)


def download(url):
    """Mejor audio disponible a DOWNLOADS. Emite pct mientras baja."""
    from yt_dlp import YoutubeDL

    def hook(d):
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if d["status"] == "downloading" and total:
            emit("pct", value=int(d.get("downloaded_bytes", 0) * 100 / total))

    DOWNLOADS.mkdir(parents=True, exist_ok=True)
    opts = {
        "quiet": True, "no_warnings": True, "noprogress": True, "noplaylist": True,
        "format": "bestaudio/best", "progress_hooks": [hook],
        "outtmpl": str(DOWNLOADS / "%(id)s.%(ext)s"),
    }
    with YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        return Path(ydl.prepare_filename(info)), info.get("title") or info["id"]


def separate(src):
    total = 4 if is_url(src) else 3
    step = 0

    def progress(label):
        nonlocal step
        step += 1
        emit("progress", step=step, total=total, label=label)

    if is_url(src):
        progress("Descargando")
        src, title = download(src)
    else:
        src = Path(src).resolve()
        title = src.stem
    song_id = slugify(title)
    out = SONGS / song_id
    stems_dir = out / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)
    progress("Convirtiendo")
    mix = out / "mix.wav"
    to_wav(src, mix)
    if src.parent == DOWNLOADS:
        src.unlink()  # ya está en mix.wav

    from audio_separator.separator import Separator

    def run(model, audio, label):
        progress(label)
        sep = Separator(model_file_dir=str(MODELS), output_dir=str(stems_dir), output_format="WAV", log_level=40)
        sep.load_model(model_filename=model)
        return [stems_dir / Path(f).name for f in sep.separate(str(audio))]

    with gpu_lock():
        # 1) voz con el RoFormer especializado en voz (más limpia que la del modelo de 6 pistas)
        for f in run(VOCAL_MODEL, mix, "Separando voz"):
            if "(Vocals)" in f.name:
                to_wav(f, stems_dir / "vocals.wav")
            f.unlink()

        # 2) instrumentos con BS-Roformer-SW sobre la mezcla original: separar el instrumental
        #    ya procesado arrastraría sus artefactos. Su pista de voz sobra.
        for f in run(INSTR_MODEL, mix, "Separando instrumentos"):
            stem = re.search(r"\((\w+)\)[^(]*$", f.name).group(1).lower()
            if stem != "vocals":
                to_wav(f, stems_dir / f"{stem}.wav")
            f.unlink()

    emit("done", song=write_meta(song_id, title))


# Por pista: rango de notas MIDI, si se lee como melodía (una nota a la vez), clef e instrumento.
TRANSCRIBE = {
    "vocals": {"range": (40, 84), "mono": True, "name": "Voz", "instrument": "Vocalist"},
    "bass": {"range": (28, 67), "mono": True, "name": "Bajo", "instrument": "ElectricBass"},
    "guitar": {"range": (40, 88), "mono": False, "name": "Guitarra", "instrument": "ElectricGuitar"},
    "piano": {"range": (21, 108), "mono": False, "name": "Piano", "instrument": "Piano"},
    "other": {"range": (28, 100), "mono": False, "name": "Otros", "instrument": "Instrument"},
}
GRID = 4  # subdivisiones por negra: semicorcheas


def monophonic(notes):
    """Una nota a la vez: entre notas solapadas gana la más fuerte (los armónicos de la voz salen como notas extra).
    ponytail: O(n²), sobra para canciones de minutos; con miles de notas, ordenar e ir con un barrido."""
    kept = []
    for n in sorted(notes, key=lambda n: -n[3]):
        if all(n[1] <= k[0] or n[0] >= k[1] for k in kept):
            kept.append(n)
    return sorted(kept)


def song_tempo(mix):
    import librosa
    import numpy as np

    y, sr = librosa.load(str(mix), sr=22050, mono=True, duration=120)
    bpm = float(np.atleast_1d(librosa.beat.beat_track(y=y, sr=sr)[0])[0])
    while bpm < 70:  # librosa a veces da la mitad o el doble
        bpm *= 2
    while bpm > 180:
        bpm /= 2
    return round(bpm)


def sing_lyrics(vocals):
    """Whisper sobre la voz aislada -> ([(inicio s, fin s, palabra)], idioma). En GPU."""
    import torch
    import whisper

    with gpu_lock(), redirect_stdout(sys.stderr):
        device = "cuda" if torch.cuda.is_available() else "cpu"  # sin GPU va, pero mucho más lento
        model = whisper.load_model("turbo", device=device, download_root=str(MODELS / "whisper"))
        r = model.transcribe(str(vocals), word_timestamps=True, condition_on_previous_text=False)
        del model
        torch.cuda.empty_cache()
    words = [(w["start"], w["end"], w["word"].strip()) for seg in r["segments"] for w in seg["words"] if w["word"].strip()]
    return words, r["language"]


def syllables(word, lang):
    """'canciones' -> ['can', 'cio', 'nes']. Sin diccionario para el idioma: la palabra entera."""
    import pyphen

    code = pyphen.language_fallback(lang)
    core = word.strip(".,;:!?¡¿\"()")
    if not code or len(core) < 3:
        return [word]
    parts = pyphen.Pyphen(lang=code, left=1, right=1).inserted(core).split("-")
    parts[0] = word[: word.index(core)] + parts[0] if core in word else parts[0]  # puntuación delante/detrás
    parts[-1] += word[word.index(core) + len(core):] if core in word else ""
    return parts


def assign_lyrics(notes, words, lang):
    """Reparte las sílabas de cada palabra entre las notas que suenan mientras se canta.
    Devuelve {índice de nota: (texto, syllabic)} con syllabic en single/begin/middle/end (MusicXML).
    Más notas que sílabas: el resto es melisma. Menos: las sílabas sobrantes van juntas en la última."""
    out = {}
    last = -1
    for start, end, word in words:
        cands = [i for i, n in enumerate(notes) if i > last and start - 0.15 <= n[0] < end]
        if not cands:  # basic-pitch no vio nota justo ahí: la más cercana libre
            near = [i for i, n in enumerate(notes) if i > last and abs(n[0] - start) < 0.3]
            cands = near[:1]
        if not cands:
            continue
        syl = syllables(word, lang)
        if len(syl) > len(cands):
            syl = syl[: len(cands) - 1] + ["".join(syl[len(cands) - 1 :])]
        for j, text in enumerate(syl):
            kind = "single" if len(syl) == 1 else "begin" if j == 0 else "end" if j == len(syl) - 1 else "middle"
            out[cands[j]] = (text, kind)
        last = cands[len(syl) - 1]
    return out


def notes_to_part(notes, bpm, cfg, lyrics=None):
    """Notas (inicio s, fin s, midi, ...) de un instrumento -> pentagrama music21 cuantizado a GRID.
    `lyrics`: {índice de nota: (texto, syllabic)}, se escribe bajo cada nota."""
    from music21 import chord, instrument, meter, note, stream

    lyrics = lyrics or {}
    q = lambda t: round(float(t) * bpm / 60 * GRID) / GRID  # segundos -> negras en la rejilla
    groups = {}
    sung = {}  # onset -> sílaba
    for i, (start, end, pitch, *_) in enumerate(notes):
        on, off = q(start), q(end)
        groups.setdefault(on, []).append((int(pitch), max(off - on, 1 / GRID)))  # music21 no acepta np.int64
        if i in lyrics and on not in sung:
            sung[on] = lyrics[i]
    onsets = sorted(groups)

    part = stream.Part()
    inst = getattr(instrument, cfg["instrument"])()
    inst.partName = part.partName = cfg["name"]  # la app lo usa para colorear cada pentagrama
    part.insert(0, inst)
    part.insert(0, meter.TimeSignature("4/4"))
    for i, on in enumerate(onsets):
        pitches = sorted({p for p, _ in groups[on]})
        dur = min(d for _, d in groups[on])
        if i + 1 < len(onsets):  # sin solapes: una sola voz legible
            dur = min(dur, onsets[i + 1] - on)
        el = note.Note(pitches[0]) if len(pitches) == 1 else chord.Chord(pitches)
        el.quarterLength = dur
        if on in sung:
            text, kind = sung[on]
            el.lyrics.append(note.Lyric(text=text, syllabic=kind))
        part.insert(on, el)
    return part


def build_score(parts, bpm, title):
    """[(notas, cfg, lyrics)] -> partitura con un pentagrama por instrumento, alineados por compás."""
    from music21 import metadata, stream, tempo

    score = stream.Score()
    score.metadata = metadata.Metadata(title=title, composer=" · ".join(cfg["name"] for _, cfg, _ in parts))
    built = [notes_to_part(n, bpm, cfg, ly) for n, cfg, ly in parts]
    built[0].insert(0, tempo.MetronomeMark(number=bpm))
    for part in built:
        score.insert(0, part)
    try:
        key = score.analyze("key")  # armadura común: menos alteraciones sueltas
        for part in built:
            part.insert(0, key.__class__(key.tonic, key.mode))
    except Exception:
        pass
    return score.makeNotation()


def notes_to_score(notes, bpm, cfg, title, lyrics=None):
    return build_score([(notes, cfg, lyrics)], bpm, title)


def ensemble(song_id, *stems):
    """Partitura de varios instrumentos ya transcritos (sin IA: usa las notas guardadas)."""
    out = SONGS / song_id
    meta = json.loads((out / "meta.json").read_text())
    by_name = {s["name"]: s for s in meta["stems"]}
    parts = []
    for stem in stems:
        info = by_name.get(stem) or {}
        if not info.get("roll"):
            raise ValueError(f"{stem} no tiene notas: sácalas desde el mezclador")
        notes = json.loads((out / info["roll"]).read_text())
        lyrics = None
        lyr_file = out / "scores" / f"{stem}.lyrics.json"
        if lyr_file.exists():
            lyr = json.loads(lyr_file.read_text())
            lyrics = assign_lyrics(notes, lyr["words"], lyr["language"])
        parts.append((notes, TRANSCRIBE[stem], lyrics))
    path = out / "scores" / f"view-{'+'.join(stems)}.musicxml"
    build_score(parts, meta.get("bpm") or 120, meta["title"]).write("musicxml", fp=str(path))
    emit("done", path=str(path))


def transcribe(song_id, stem):
    from basic_pitch import ICASSP_2022_MODEL_PATH
    from basic_pitch.inference import Model, predict

    out = SONGS / song_id
    meta_path = out / "meta.json"
    meta = json.loads(meta_path.read_text())
    cfg = TRANSCRIBE[stem]
    lo, hi = cfg["range"]

    total = 4 if stem == "vocals" else 3
    emit("progress", step=1, total=total, label="Detectando tempo")
    bpm = meta.get("bpm") or song_tempo(out / meta["mix"])

    emit("progress", step=2, total=total, label="Detectando notas")
    with redirect_stdout(sys.stderr):  # basic-pitch imprime por stdout, que es nuestro canal
        _, midi, notes = predict(
            str(out / "stems" / f"{stem}.wav"),
            Model(ICASSP_2022_MODEL_PATH),
            minimum_note_length=100 if cfg["mono"] else 60,
            minimum_frequency=440 * 2 ** ((lo - 69) / 12),
            maximum_frequency=440 * 2 ** ((hi - 69) / 12),
            midi_tempo=bpm,
        )
    notes = [n for n in notes if lo <= n[2] <= hi]
    if cfg["mono"]:
        notes = monophonic(notes)
    if not notes:
        raise RuntimeError("no se detectaron notas en esta pista")

    lyrics = {}
    if stem == "vocals":
        emit("progress", step=3, total=total, label="Transcribiendo letra")
        words, lang = sing_lyrics(out / "stems" / "vocals.wav")
        lyrics = assign_lyrics(notes, words, lang)
        (out / "scores").mkdir(exist_ok=True)
        (out / "scores" / "vocals.lyrics.json").write_text(
            json.dumps({"language": lang, "words": [[round(a, 2), round(b, 2), w] for a, b, w in words]}, ensure_ascii=False)
        )
        meta["language"] = lang

    emit("progress", step=total, total=total, label="Escribiendo partitura")
    scores = out / "scores"
    scores.mkdir(exist_ok=True)
    midi.write(str(scores / f"{stem}.mid"))
    notes_to_score(notes, bpm, cfg, meta["title"], lyrics).write("musicxml", fp=str(scores / f"{stem}.musicxml"))
    # tiempos reales (sin cuantizar) para el piano roll: [inicio s, fin s, nota midi, intensidad]
    roll = [[round(float(a), 3), round(float(b), 3), int(p), round(float(v), 2)] for a, b, p, v, *_ in notes]
    (scores / f"{stem}.notes.json").write_text(json.dumps(roll))

    meta["bpm"] = bpm
    for s in meta["stems"]:
        if s["name"] == stem:
            s["score"] = f"scores/{stem}.musicxml"
            s["midi"] = f"scores/{stem}.mid"
            s["roll"] = f"scores/{stem}.notes.json"
            s["notes"] = len(notes)
            s["version"] = int(time.time())  # la app recarga la partitura cuando cambia
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    emit("done", song=with_dir(meta))


def fix(song_id):
    out = SONGS / song_id
    meta = json.loads((out / "meta.json").read_text())
    to_wav(out / meta["mix"], out / "mix.wav")
    for s in meta["stems"]:
        to_wav(out / s["file"], out / "stems" / f"{s['name']}.wav")
    emit("done", song=write_meta(song_id, meta["title"]))


def with_dir(meta):
    return {**meta, "dir": str(SONGS / meta["id"])}


def beats(song_id):
    """Pulsos de la canción (segundos) para el metrónomo. CPU, unos segundos; se guarda en beats.json."""
    import librosa
    import numpy as np

    out = SONGS / song_id
    meta_path = out / "meta.json"
    meta = json.loads(meta_path.read_text())
    y, sr = librosa.load(str(out / meta["mix"]), sr=22050, mono=True)
    tempo, times = librosa.beat.beat_track(y=y, sr=sr, units="time")
    bpm = round(float(np.atleast_1d(tempo)[0]))
    (out / "beats.json").write_text(json.dumps({"bpm": bpm, "beats": [round(float(t), 3) for t in times]}))
    meta["beats"] = "beats.json"
    meta.setdefault("bpm", bpm)  # si ya hay partituras, su tempo manda
    meta_path.write_text(json.dumps(meta, indent=2, ensure_ascii=False))
    emit("done", song=with_dir(meta), bpm=bpm, beats=len(times))


def delete(song_id):
    """Borra la canción entera (mezcla, pistas, partituras)."""
    import shutil

    target = (SONGS / song_id).resolve()
    if target.parent != SONGS.resolve() or not target.is_dir():  # nada de "../" ni rutas raras
        raise ValueError(f"canción desconocida: {song_id}")
    shutil.rmtree(target)
    emit("done", deleted=song_id)


def list_songs():
    songs = [with_dir(json.loads(p.read_text())) for p in sorted(SONGS.glob("*/meta.json"))]
    emit("done", songs=songs)


def main():
    cmd, *args = sys.argv[1:] or ["list"]
    commands = {"separate": separate, "fix": fix, "list": list_songs, "search": search, "transcribe": transcribe, "delete": delete, "ensemble": ensemble, "beats": beats}
    try:
        if cmd not in commands:
            raise ValueError(f"subcomando desconocido: {cmd}")
        commands[cmd](*args)
    except Exception as e:
        emit("error", message=f"{type(e).__name__}: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
