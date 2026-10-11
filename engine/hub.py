"""Motor de Estudio. Lleva dentro los motores de Letras (letras.py) y StemLab (stemlab.py), que eran apps aparte,
y decide qué reutilizar: lo de más calidad que ya exista se usa, y lo de menos calidad no se saca.

  - Audio: uno por canción (audio/<clave>.wav de Letras); StemLab separa ese mismo fichero (enlace duro, sin copia).
  - Voz: la de StemLab (BS-RoFormer a calidad completa) > la rápida de Letras (2 pasadas, fp16). Si StemLab ya
    separó, Letras usa su voz y no separa; si separa después, la sustituye.
  - Letra de la partitura: la de Letras (Whisper large-v3 + alineado forzado + texto de Genius o corregido a mano)
    > Whisper turbo de StemLab, que solo se usa si la canción no tiene artista y título.
  - Pulsos: los de StemLab si está separada; si no, los mismos sobre el audio de Letras (no hace falta separar).

Pasos idempotentes: cada uno mira lo que ya hay y no repite nada. `plan` dice qué pasos faltan y en qué
recurso corren (gpu / cpu / net); la app los programa: una cosa a la vez en la GPU, el resto en paralelo.

  hub.py <orden> [args]   una orden; eventos JSON lines por stdout, el último `done` o `error`
  hub.py worker           GPU: órdenes JSON por stdin, una tras otra, con el último modelo cargado entre
                          canciones (Whisper, separador compilado). `{"cmd": "flush"}` suelta VRAM y candado.
"""

import fcntl
import gc
import json
import os
import re
import shutil
import signal
import sys
import threading
import time
import traceback
from contextlib import contextmanager, redirect_stdout
from pathlib import Path

HOME = Path.home()
XDG = Path(os.environ.get("XDG_DATA_HOME") or HOME / ".local/share")


import letras as L  # noqa: E402  (fija HSA_OVERRIDE_GFX_VERSION antes de que nada importe torch)
import stemlab as S  # noqa: E402
DATA = Path(os.environ.get("ESTUDIO_DATA") or XDG / "estudio")
EDITS = Path(os.environ.get("LYRIC_EDITS_DATA") or XDG / "lyric-edits")  # proyectos de Lyric Edits, tal cual
REG = DATA / "songs.json"  # canciones sin letra todavía (añadidas o importadas) y enlaces clave -> id de StemLab
WORK = DATA / ".work"
PITCHED = ["vocals", "bass", "guitar", "piano", "other"]
WAV_BPS = 44100 * 4  # WAV de los dos motores: 44.1 kHz, 16 bits, estéreo

emit = L.emit


# ---------------------------------------------------------------- ficheros


def read_json(p, default=None):
    try:
        return json.loads(Path(p).read_text())
    except (OSError, ValueError):
        return default


def write_json(p, data):
    """Atómico: un proceso cortado a mitad no deja un JSON roto (es lo que rompía al reutilizar)."""
    p = Path(p)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f".{p.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1))
    tmp.replace(p)


def link(src, dst):
    """dst = mismo fichero que src (enlace duro: borrar uno no rompe el otro); copia si están en otro disco."""
    src, dst = Path(src), Path(dst)
    if dst.exists() and dst.samefile(src):
        return
    dst.parent.mkdir(parents=True, exist_ok=True)
    tmp = dst.with_name(f".{dst.name}.lnk")
    tmp.unlink(missing_ok=True)
    try:
        os.link(src, tmp)
    except OSError:
        shutil.copyfile(src, tmp)
    tmp.replace(dst)


def wav_seconds(p):
    return max(0, Path(p).stat().st_size - 44) / WAV_BPS


def same_audio(a, b):
    """Mismo audio: el mismo fichero o la misma duración a 20 ms (dos conversiones del mismo vídeo)."""
    try:
        return Path(a).samefile(b) or abs(Path(a).stat().st_size - Path(b).stat().st_size) <= WAV_BPS // 50
    except OSError:
        return False


@contextmanager
def registry():
    """songs.json para escribir; varios procesos en paralelo (red, CPU) lo tocan: candado."""
    DATA.mkdir(parents=True, exist_ok=True)
    with open(DATA / ".songs.lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        reg = read_json(REG, {})
        yield reg
        write_json(REG, reg)


def register(artist, title, **extra):
    key = L.song_key(artist, title)
    with registry() as reg:
        reg[key] = {**reg.get(key, {}), "artist": artist, "title": title, **{k: v for k, v in extra.items() if v}}
    return key


# ---------------------------------------------------------------- estado de una canción


def stem_state(sid):
    """None (sin separar), "complete", "repair" (pistas enteras, falta meta.json: se rehace sin GPU) o "partial"
    (separación cortada: se tira y se repite; antes las apps la reutilizaban y fallaban)."""
    d = S.SONGS / sid if sid else None
    if not d or not d.is_dir():
        return None
    if (d / "mix.wav").exists() and all((d / "stems" / f"{s}.wav").exists() for s in S.STEMS):
        return "complete" if (read_json(d / "meta.json") or {}).get("stems") else "repair"
    return "partial"


def guess_stem(key, title, taken):
    """Canción separada a mano en StemLab (su id sale del nombre del fichero, p. ej. «dna»): mismo título y misma duración."""
    t, wav = S.slugify(title), L.AUDIO / f"{key}.wav"
    if not t or not wav.exists() or not S.SONGS.is_dir():
        return None
    for d in S.SONGS.iterdir():
        if d.name not in taken and (d.name == t or d.name.endswith(f"-{t}") or d.name.startswith(f"{t}-")):
            mix = d / "mix.wav"
            if mix.exists() and abs(mix.stat().st_size - wav.stat().st_size) / wav.stat().st_size < 0.02:
                return d.name
    return None


def resolve(key, reg=None):
    """Clave -> {key, artist, title, duration, doc, stem}. Claves de Letras (artista-título), o «stem:<id>» para
    canciones de StemLab sin artista ni título."""
    reg = read_json(REG, {}) if reg is None else reg
    if key.startswith("stem:"):
        sid = key[5:]
        meta = read_json(S.SONGS / sid / "meta.json") or {}
        if not (S.SONGS / sid).is_dir():
            raise ValueError(f"canción desconocida: {key}")
        return {"key": key, "artist": meta.get("artist", ""), "title": meta.get("title", sid), "duration": 0, "doc": None, "stem": sid}
    r = reg.get(key, {})
    doc = read_json(L.doc_path(key))
    if not doc and not r:
        raise ValueError(f"canción desconocida: {key}")
    src = doc or r
    sid = r.get("stem") or (key if (S.SONGS / key).is_dir() else None)
    return {"key": key, "artist": src.get("artist", ""), "title": src.get("title", ""), "duration": float(src.get("duration") or r.get("duration") or 0),
            "doc": doc, "stem": sid}


def need_letras(s):
    if s["key"].startswith("stem:"):
        raise RuntimeError("esta canción no tiene artista y título: pónselos primero")


def stem_vocals(s, planning=False):
    """Voz de StemLab si está separada y es el mismo audio que el de Letras (al planificar, también si Letras
    aún no tiene audio: el paso de audio enlazará la mezcla de StemLab)."""
    sid, wav = s["stem"], L.AUDIO / f"{s['key']}.wav"
    if stem_state(sid) == "complete" and (same_audio(wav, S.SONGS / sid / "mix.wav") or (planning and not wav.exists())):
        return S.SONGS / sid / "stems" / "vocals.wav"
    return None


def audio_of(s):
    if s["key"].startswith("stem:"):
        return S.SONGS / s["stem"] / "mix.wav"
    wav = L.AUDIO / f"{s['key']}.wav"
    if wav.exists():
        return wav
    mix = S.SONGS / s["stem"] / "mix.wav" if s["stem"] else None
    return mix if mix and mix.exists() else None


CJK = re.compile(L.CJK)
STOP = {
    "es": "que de el la y en los las se no me lo por un una mi te tu yo es con para como pero", "en": "the you and i to me my a it in is that on your we be",
    "fr": "je tu le la les et de un une que ne pas moi toi est dans", "it": "che di il la e non mi ti un una io sei sono per con",
    "pt": "que de o a e não eu você um uma meu se com para", "de": "ich du und der die das nicht ein eine mich dich ist mit",
}


def language(text):
    """Idioma para repartir sílabas (pyphen). ponytail: contar palabras frecuentes basta para 6 idiomas; otro idioma -> "en"."""
    if len(CJK.findall(text)) > len(text) / 4:
        return "ja"
    words = set(L.fold(text).split())
    hits = {lang: len(words & set(ws.split())) for lang, ws in STOP.items()}
    best = max(hits, key=hits.get)
    return best if hits[best] >= 2 else "en"


def letras_words(s):
    """Palabras de la letra de Letras en tiempo del audio ((ini, fin, palabra), idioma), o None."""
    doc = s["doc"]
    if not doc or doc.get("instrumental"):
        return None
    woff = (doc.get("offset") or 0) + (doc.get("word_offset") or 0)
    ws = [(round(w["t"] + woff, 3), round((w.get("end") or w["t"] + 0.3) + woff, 3), w["w"]) for l in doc.get("lines", []) for w in l.get("words") or []]
    return (ws, language(" ".join(l.get("text", "") for l in doc["lines"]))) if ws else None


def projects():
    out = []
    for f in (EDITS / "projects").glob("*.json"):
        p = read_json(f)
        if p and p.get("key"):
            out.append(p)
    return out


def lyrics_summary(doc):
    if not doc:
        return None
    lines = doc.get("lines", [])
    words = any(l.get("words") for l in lines)
    timed = any(l.get("t") is not None for l in lines)
    status = "instrumental" if doc.get("instrumental") else "words" if words else "lines" if timed else "plain" if any(l.get("text") for l in lines) else "empty"
    return {
        "status": status, **{k: doc.get(k) for k in ("source", "times_from", "synced_by", "ai_mode", "edited", "offset", "word_offset", "hidden", "note")},
        "lines": sum(bool(l.get("text")) for l in lines),
        "doubts": sum(any(w.get("p") is not None and w["p"] < 0.5 for w in l.get("words", [])) for l in lines),
    }


def summary(s, edits):
    key, sid = s["key"], s["stem"]
    meta = read_json(S.SONGS / sid / "meta.json") if sid else None
    state = stem_state(sid)
    audio = L.AUDIO / f"{key}.wav"
    vocals = L.AUDIO / f"{key}.vocals.wav"
    files = [p for p in L.AUDIO.glob(f"{key}.*")] if L.AUDIO.is_dir() else []
    beats = (S.SONGS / sid / "beats.json") if sid and (S.SONGS / sid / "beats.json").exists() else L.AUDIO / f"{key}.beats.json"
    mtimes = [p.stat().st_mtime for p in [L.doc_path(key), S.SONGS / sid / "meta.json" if sid else None] if p and p.exists()]
    return {
        "key": key, "artist": s["artist"], "title": s["title"],
        "lyrics": lyrics_summary(s["doc"]),
        "audio": bool(audio_of(s)),
        "vocals": "stemlab" if stem_vocals(s) else "letras" if vocals.exists() else None,
        "stems": state,
        "present": [st["name"] for st in (meta or {}).get("stems", []) if st.get("present")],
        "notes": [st["name"] for st in (meta or {}).get("stems", []) if st.get("score")],
        "bpm": (meta or {}).get("bpm") or (read_json(beats) or {}).get("bpm"),
        "beats": beats.exists(),
        "edits": edits.get(key, 0),
        "bytes": sum(p.stat().st_size for p in files) + (sum(p.stat().st_size for p in (S.SONGS / sid).rglob("*") if p.is_file() and p.stat().st_nlink == 1) if sid and (S.SONGS / sid).is_dir() else 0),
        "modified": max(mtimes, default=0),
        "failed": key in (set(L.FAILED.read_text().split()) if L.FAILED.exists() else ()),  # el prefetch no pudo
    }


def catalog():
    """Todas las canciones de las tres apps, una vez cada una: Letras + lo añadido aquí + StemLab sin enlazar."""
    reg = read_json(REG, {})
    keys = set(reg) | ({f.stem for f in L.LYRICS.glob("*.json")} if L.LYRICS.is_dir() else set())
    songs, taken = [], {r["stem"] for r in reg.values() if r.get("stem")} | keys
    edits = {}
    for p in projects():
        edits[p["key"]] = edits.get(p["key"], 0) + 1
    found = {}
    resolved = []
    for key in sorted(keys):
        try:
            s = resolve(key, reg)
        except ValueError:
            continue
        if not s["stem"]:
            s["stem"] = guess_stem(key, s["title"], taken)
            if s["stem"]:
                taken.add(s["stem"])
                found[key] = s["stem"]
        resolved.append(s)
    if found:  # la próxima vez ya no hace falta adivinar
        with registry() as r:
            for key, sid in found.items():
                s = next(x for x in resolved if x["key"] == key)
                r[key] = {**r.get(key, {}), "artist": s["artist"], "title": s["title"], "stem": sid}
    for s in resolved:
        songs.append(summary(s, edits))
    if S.SONGS.is_dir():
        for d in sorted(S.SONGS.iterdir()):
            if d.is_dir() and not d.name.startswith(".") and d.name not in taken:
                songs.append(summary(resolve(f"stem:{d.name}"), edits))
    emit("done", songs=songs)


def song(key):
    """Todo lo de una canción para la vista: letra, pistas, partituras, pulsos y rutas."""
    s = resolve(key)
    sid, state = s["stem"], stem_state(s["stem"])
    meta = read_json(S.SONGS / sid / "meta.json") if state == "complete" else None
    beats_f = S.SONGS / sid / "beats.json" if sid and (S.SONGS / sid / "beats.json").exists() else L.AUDIO / f"{key}.beats.json"
    edits = {key: sum(p["key"] == key for p in projects())}
    out = summary(s, edits)
    audio = audio_of(s)
    drums = next((st for st in (meta or {}).get("stems", []) if st["name"] == "drums" and st.get("present")), None)
    emit("done", song={
        **out, "doc": s["doc"], "history": len(L.history(key)) if not key.startswith("stem:") else 0,
        "stemlab": S.with_dir(meta) if meta else None,
        "audioPath": str(audio) if audio else None,
        "drumsPath": str(S.SONGS / sid / drums["file"]) if drums else None,
        "beatData": read_json(beats_f),
        "chordData": chords_of(s),
        "duration": round(wav_seconds(audio), 2) if audio else s["duration"],
    })


# ---------------------------------------------------------------- GPU: un modelo cargado, candado compartido


class Gpu:
    """Candado de GPU compartido con Letras y StemLab (el mismo fichero), pero tomado una vez y soltado en `flush`:
    así el modelo puede quedarse cargado entre canciones sin que otra app cargue el suyo encima (8 GB no dan).
    Caché de un solo modelo: al pedir otro, el anterior sale de la VRAM."""

    def __init__(self):
        self.fd = None
        self.name = None
        self.obj = None

    @contextmanager
    def lock(self):
        if self.fd is None:
            L.GPU_LOCK.parent.mkdir(parents=True, exist_ok=True)
            f = open(L.GPU_LOCK, "w")
            try:
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                emit("waiting", label="Esperando a la GPU (la usa otra app)")
                fcntl.flock(f, fcntl.LOCK_EX)
            self.fd = f
        yield

    def cached(self, name, factory):
        if self.name != name:
            self.drop()
            self.obj, self.name = factory(), name
        return self.obj

    def drop(self):
        if self.obj is None:
            return
        self.obj = self.name = None
        gc.collect()
        try:
            import torch

            torch._dynamo.reset()  # el separador compilado guarda referencias al modelo
            torch.cuda.empty_cache()
        except Exception:
            pass

    def release(self):
        self.drop()
        if self.fd:
            self.fd.close()
            self.fd = None


GPU = Gpu()
L.gpu_lock = S.gpu_lock = GPU.lock


def _patch_models():
    """Whisper y MMS_FA de los motores pasan por la caché: el segundo uso no vuelve a cargar pesos."""
    import whisper

    if getattr(whisper.load_model, "_hub", False):
        return
    orig = whisper.load_model

    def load_model(name, device=None, download_root=None, **kw):
        m = GPU.cached(f"whisper-{name}", lambda: orig(name, device="cpu", download_root=download_root, **kw))
        return m.to(device) if device and device != "cpu" else m  # Letras lo pide en CPU y lo sube él en fp16

    load_model._hub = True
    whisper.load_model = load_model
    try:
        from torchaudio.pipelines import MMS_FA

        get = type(MMS_FA).get_model
        object.__setattr__(MMS_FA, "get_model", lambda *a, **k: GPU.cached("mms", lambda: get(MMS_FA, *a, **k)))
    except Exception:
        pass


def separator(name, model, **opts):
    """Separador cargado (y compilado, el de Letras) que sigue en VRAM para la siguiente canción.
    Sin normalizar a 0,9 (lo que trae audio-separator, y usaban Letras y StemLab): bajaba cada pista por separado y
    en canciones altas la suma ya no era la canción."""
    from audio_separator.separator import Separator

    def make():
        out = WORK / name
        with redirect_stdout(sys.stderr):
            sep = Separator(model_file_dir=str(S.MODELS), output_dir=str(out), output_format="WAV", log_level=40,
                            normalization_threshold=1.0, **opts)
            sep.load_model(model_filename=model)
        return sep

    return GPU.cached(name, make)


def run_separator(sep, wav):
    out = Path(sep.output_dir)
    shutil.rmtree(out, ignore_errors=True)  # restos de un corte anterior
    out.mkdir(parents=True)
    with redirect_stdout(sys.stderr):
        return [out / Path(f).name for f in sep.separate(str(wav))]


# ---------------------------------------------------------------- pasos


def audio(key):
    """audio/<clave>.wav de Letras: la mezcla de StemLab si ya está (enlace), si no YouTube."""
    s = resolve(key)
    if key.startswith("stem:") or audio_of(s) == L.AUDIO / f"{key}.wav":
        return emit("done", skipped=True)
    L.AUDIO.mkdir(parents=True, exist_ok=True)
    mix = audio_of(s)
    if mix:
        link(mix, L.AUDIO / f"{key}.wav")
    else:
        L.get_audio(s["artist"], s["title"], "", str(s["duration"]))
    emit("done")


def vocals(key):
    """Voz aislada para la letra: la de StemLab si existe (mejor), si no la rápida de Letras."""
    s = resolve(key)
    need_letras(s)
    dst = L.AUDIO / f"{key}.vocals.wav"
    sv = stem_vocals(s)
    if sv:
        link(sv, dst)
        return emit("done", source="stemlab")
    if dst.exists():
        return emit("done", skipped=True)
    wav = L.AUDIO / f"{key}.wav"
    emit("progress", step=1, total=1, label="Separando la voz (rápida)")
    with L.gpu_lock():
        if dst.exists():  # el prefetch de Letras pudo hacerla mientras esperábamos
            return emit("done", skipped=True)
        # mismos ajustes que Letras: 2 pasadas, torch.compile + autocast (−43 % en una RX 6600)
        sep = separator("sep-fast", L.VOCAL_MODEL, output_single_stem="Vocals", use_torch_compile=True, use_autocast=True,
                        mdxc_params={"segment_size": 256, "override_model_segment_size": False, "batch_size": None, "overlap": 2, "pitch_shift": 0})
        files = run_separator(sep, wav)
    for f in files:
        if "(Vocals)" in f.name:
            shutil.move(f, dst)
        else:
            f.unlink()
    emit("done", source="letras")


def needs_whisper(s, mode):
    """Lo mismo que decide `ai` de Letras: con tiempos por línea de internet (o «lineas») no hace falta Whisper,
    salvo que el audio dure otra cosa que la canción (otra versión: Whisper mide el desfase). «ia»: siempre."""
    if mode == "ia" or audio_unchecked(s):
        return True
    if mode == "lineas":  # solo palabras dentro de cada línea: Whisper no aporta
        return False
    doc = s["doc"] or {}
    timed = any(l.get("t") is not None and l.get("text") for l in doc.get("lines", []))
    if not (timed and (mode == "lineas" or L.online_times(doc))):
        return True
    wav = L.AUDIO / f"{s['key']}.wav"
    return bool(s["duration"]) and wav.exists() and not L.close(wav_seconds(wav), s["duration"])


def audio_unchecked(s):
    """Letra con tiempos de internet (o puestos a mano) y audio sin comprobar que sea su misma versión."""
    doc = s["doc"] or {}
    return any(l.get("t") is not None and l.get("text") for l in doc.get("lines", [])) and not doc.get("audio_checked")


def measure_shift(s):
    """Cuánto va el audio por delante de los tiempos de la letra (s): Whisper oye la letra en el audio, se empareja
    con la escrita (`align` de Letras) y la mediana de las diferencias por línea es el desfase. None si no se fía
    (lo oído no se parece a la letra, o hay pocas líneas)."""
    import numpy as np

    doc = s["doc"]
    heard = [w for seg in read_json(L.AUDIO / f"{s['key']}.{L.WHISPER_MODEL}.words.json", []) for w in seg["words"]]
    lines = [l for l in doc["lines"] if l.get("t") is not None and l.get("text")]
    texts = [l["text"] for l in lines]
    if not heard or L.match_ratio(texts, heard) < 0.3:
        return None
    got = L.align(texts, heard)
    d = [b["t"] - a["t"] for a, b in zip(lines, got) if b.get("words")]
    return float(np.median(d)) if len(d) >= 3 else None


def shift_audio_file(f, d):
    """Recorta los primeros `d` s (d > 0) o pone `-d` s de silencio delante (d < 0), con el mismo formato."""
    import numpy as np
    import soundfile as sf

    info = sf.info(str(f))
    x, sr = sf.read(str(f), dtype="float32", always_2d=True)
    n = int(round(abs(d) * sr))
    x = x[n:] if d > 0 else np.concatenate([np.zeros((n, x.shape[1]), np.float32), x])
    tmp = f.with_name(f".{f.name}.shift.wav")
    sf.write(str(tmp), x, sr, subtype=info.subtype)
    tmp.replace(f)


def shift_times(obj, d, keys=("t", "end")):
    """Resta `d` a todos los tiempos de una estructura JSON (listas de dicts) y quita lo que queda antes de 0."""
    if isinstance(obj, list):
        out = [shift_times(x, d, keys) for x in obj]
        return [x for x in out if not (isinstance(x, dict) and "t" in x and x["t"] is not None and x["t"] < 0)]
    if isinstance(obj, dict):
        return {k: (round(v - d, 3) if k in keys and isinstance(v, (int, float)) else shift_times(v, d, keys)) for k, v in obj.items()}
    return obj


def audio_align(key):
    """El audio local (de YouTube) puede ser otra versión que la de los tiempos de la letra (Spotify): el videoclip con
    su intro, por ejemplo. Entonces la letra, los acordes y los edits no cuadraban. Se mide el desfase con Whisper y se
    mueve el AUDIO (recortando la intro o con silencio delante), con todo lo sacado de él: la letra no se toca, así que
    Spotify y el escritorio siguen igual. Ficheros con enlace duro se reescriben una vez y se vuelven a enlazar."""
    import numpy as np

    s = resolve(key)
    doc = s["doc"]
    if not doc or not audio_unchecked(s):
        return emit("done", skipped=True)
    d = measure_shift(s)
    if d is not None and abs(d) >= 0.25:
        emit("progress", step=1, total=1, label=f"El audio va {d:+.1f} s respecto a la letra: ajustándolo")
        sid = s["stem"] if stem_state(s["stem"]) == "complete" and same_audio(L.AUDIO / f"{key}.wav", S.SONGS / s["stem"] / "mix.wav") else None
        files = [L.AUDIO / f"{key}.wav", L.AUDIO / f"{key}.vocals.wav"]
        if sid:
            files += [S.SONGS / sid / "mix.wav"] + [S.SONGS / sid / "stems" / f"{n}.wav" for n in S.STEMS]
        done = {}
        for f in files:
            if not f.exists():
                continue
            ino = f.stat().st_ino
            if ino in done:
                link(done[ino], f)
            else:
                shift_audio_file(f, d)
                done[ino] = f
        (L.AUDIO / f"{key}.ctc.npz").unlink(missing_ok=True)  # se rehace (paso siguiente)
        words = L.AUDIO / f"{key}.{L.WHISPER_MODEL}.words.json"
        if words.exists():
            write_json(words, shift_times(read_json(words, []), d))
        for f in [L.AUDIO / f"{key}.beats.json", L.AUDIO / f"{key}.chords.json"] + ([S.SONGS / sid / "beats.json", S.SONGS / sid / "chords.json"] if sid else []):
            data = read_json(f)
            if data:
                if "beats" in data:
                    data["beats"] = [round(t - d, 3) for t in data["beats"] if t - d >= 0]
                    data["downbeats"] = [round(t - d, 3) for t in data.get("downbeats", []) if t - d >= 0]
                if "chords" in data:
                    data["chords"] = shift_times(data["chords"], d)
                write_json(f, data)
        if sid:
            for f in (S.SONGS / sid / "scores").glob("*.notes.json"):
                write_json(f, [[round(a - d, 3), round(b - d, 3), p, v] for a, b, p, v in read_json(f, []) if a - d >= 0])
        for f in (EDITS / "projects").glob("*.json"):  # recortes de los edits de esta canción
            p = read_json(f)
            if p and p.get("key") == key:
                p["start"], p["end"] = max(0.0, p["start"] - d), max(0.5, p["end"] - d)
                write_json(f, p)
        L.save({**doc, "audio_checked": True, "audio_shift": round(d, 2)})
        emit("done", shift=round(d, 2))
    else:
        L.save({**doc, "audio_checked": True})
        emit("done", skipped=d is not None, shift=0, unsure=d is None)


def whisper(key, mode=""):
    s = resolve(key)
    need_letras(s)
    out = L.AUDIO / f"{key}.{L.WHISPER_MODEL}.words.json"
    if read_json(out) is not None or not needs_whisper(s, mode):
        return emit("done", skipped=True)
    emit("progress", step=1, total=1, label=f"Whisper {L.WHISPER_MODEL}")
    write_json(out, L.whisper_words(L.AUDIO / f"{key}.vocals.wav"))
    emit("done")


def ctc(key):
    s = resolve(key)
    need_letras(s)
    out = L.AUDIO / f"{key}.ctc.npz"
    if out.exists():
        try:
            import numpy as np

            np.load(out)["em"]
            return emit("done", skipped=True)
        except Exception:
            out.unlink()  # cortado al escribir: se rehace
    emit("progress", step=1, total=1, label="Alineado forzado (MMS)")
    tmp = L.AUDIO / f".{key}.ctc.tmp.npz"
    tmp.unlink(missing_ok=True)
    L.ctc_frames(L.AUDIO / f"{key}.vocals.wav", tmp)
    tmp.replace(out)
    emit("done")


def clean(key):
    """Restos de Letras que rompían la siguiente sincronización: cachés cortadas a mitad y carpetas temporales."""
    words = L.AUDIO / f"{key}.{L.WHISPER_MODEL}.words.json"
    if words.exists() and read_json(words) is None:
        words.unlink()
    tmp = L.AUDIO / f".{key}.vocals"
    if tmp.is_dir() and time.time() - tmp.stat().st_mtime > 3600:  # ponytail: más de 1 h = nadie la está usando
        shutil.rmtree(tmp, ignore_errors=True)


def find(key, force=""):
    s = resolve(key)
    need_letras(s)
    L.find(s["artist"], s["title"], "", str(s["duration"]), force)


def inside_lines(lines, ref):
    """Como `keep_lines` de Letras pero sin fiarse del fin guardado de cada línea (era de la sincronización anterior y,
    con la línea movida, dejaba las palabras amontonadas al final): cada línea empieza donde dice `ref` y sus
    palabras caben hasta el inicio de la siguiente; su fin es cuando la voz calla (el de `refine`)."""
    starts = [l.get("t") for l in ref]
    for i, (line, r) in enumerate(zip(lines, ref)):
        a = r.get("t")
        if a is None:
            continue
        b = next((x for x in starts[i + 1 :] if x is not None and x > a), None) or max(line.get("end") or 0, a + 5)
        line["t"] = a
        prev = a
        ws = line.get("words") or []
        for k, w in enumerate(ws):
            t = a if k == 0 else min(max(w["t"], prev), b)
            dur = max(0.05, (w.get("end") or w["t"]) - w["t"])  # movida, la palabra conserva lo que dura
            w["t"], w["end"] = round(t, 3), round(min(max(w.get("end") or t, t + dur), b), 3)
            prev = t
        line["end"] = round(min(max(line.get("end") or a, ws[-1]["end"] if ws else a), b), 3)
    return lines


def align(key, mode=""):
    """`ai` de Letras con todo ya en caché (voz, Whisper, MMS): solo CPU.

    mode ""     (al añadir o «Hacer todo»): la regla de Letras; con tiempos por línea de internet esos mandan.
    mode "lineas" («Dentro de cada línea»): el inicio de cada línea no se toca (el que tenga ahora, tuyo o de
                internet); el audio coloca cada palabra entre ese inicio y el de la siguiente línea.
    mode "ia"   («Desde el audio»): no usa los tiempos por línea; Whisper sobre tu texto + alineado letra a letra."""
    s = resolve(key)
    need_letras(s)
    clean(key)
    online, shift, keep = L.online_times, L.version_shift, L.keep_lines
    wav = L.AUDIO / f"{key}.wav"
    if mode == "lineas":
        L.online_times = lambda doc: True  # ventana de cada línea exacta y sus inicios se respetan
        L.keep_lines = inside_lines
    elif mode == "ia":
        L.online_times = lambda doc: False
        if not s["duration"] or not wav.exists() or L.close(wav_seconds(wav), s["duration"]):
            # mismo audio que la canción: un desfase medido contra tus tiempos sería arrastrar tus errores
            L.version_shift = lambda ref, lines: 0.0
    try:
        L.ai(s["artist"], s["title"], "", str(s["duration"] or 0), "lineas" if mode == "lineas" else "")
    finally:
        L.online_times, L.version_shift, L.keep_lines = online, shift, keep


def scores_from_disk(d, meta):
    """Las partituras de cada pista según los ficheros: así meta.json no depende de quién escribió el último."""
    for st in meta["stems"]:
        n, f = st["name"], d / "scores" / f"{st['name']}.notes.json"
        if (d / "scores" / f"{n}.musicxml").exists() and f.exists():
            st.update(score=f"scores/{n}.musicxml", midi=f"scores/{n}.mid", roll=f"scores/{n}.notes.json",
                      notes=len(read_json(f, [])), version=int(f.stat().st_mtime))
    return meta


@contextmanager
def meta_lock(sid):
    with open(S.SONGS / sid / ".meta.lock", "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        yield


def balance(d):
    """Que las 6 pistas sumen exactamente la canción. La voz sale de un modelo y los instrumentos de otro: lo que el
    segundo llama voz y el primero no (coros, voces procesadas, efectos) se perdía, y la normalización bajaba cada
    pista por su cuenta. Se deshace esa bajada (ganancia por mínimos cuadrados, solo hacia arriba: la normalización
    solo baja) y lo que no está en ninguna pista va a «Otros». Devuelve el margen de la suma (dB) antes y después."""
    import numpy as np
    import soundfile as sf

    mix, sr = sf.read(str(d / "mix.wav"), dtype="float32", always_2d=True)
    n = len(mix)
    stems = {}
    for name in S.STEMS:
        x = sf.read(str(d / "stems" / f"{name}.wav"), dtype="float32", always_2d=True)[0][:n]
        stems[name] = np.pad(x, ((0, n - len(x)), (0, 0)))
    snr = lambda e: float(10 * np.log10(np.sum(mix**2) / max(np.sum(e**2), 1e-12)))
    before = snr(mix - sum(stems.values()))
    A = np.stack([stems[k][::7].ravel() for k in S.STEMS], 1)
    gains = np.clip(np.linalg.lstsq(A, mix[::7].ravel(), rcond=None)[0], 1.0, 3.0)
    for k, g in zip(S.STEMS, gains):
        stems[k] *= g
    stems["other"] += mix - sum(stems.values())
    for k in S.STEMS:
        tmp = d / "stems" / f".{k}.bal.wav"
        sf.write(str(tmp), np.clip(stems[k], -1, 1), sr, subtype="PCM_16")
        tmp.replace(d / "stems" / f"{k}.wav")
    after = snr(mix - sum(np.clip(v, -1, 1) for v in stems.values()))
    return round(before, 1), round(after, 1)


def rebalance(key):
    """Arregla una canción ya separada (con StemLab o antes de este arreglo) sin volver a separar."""
    s = resolve(key)
    sid = s["stem"]
    if stem_state(sid) != "complete":
        raise RuntimeError("no está separada")
    emit("progress", step=1, total=1, label="Ajustando las pistas")
    d = S.SONGS / sid
    with meta_lock(sid):
        before, after = balance(d)
        meta = read_json(d / "meta.json")
        for st in meta["stems"]:
            st["level"] = round(S.loudest_dbfs(d / st["file"]), 1)
            st["present"] = st["level"] > S.SILENCE_DBFS
        meta["balanced"] = True
        write_json(d / "meta.json", meta)
    emit("done", before=before, after=after)


def repair_meta(sid, s):
    """Pistas completas sin meta.json (cortado justo al final): se rehace sin volver a separar."""
    meta = S.write_meta(sid, read_json(S.SONGS / sid / "meta.json", {}).get("title") or display(s))
    d = S.SONGS / sid
    scores_from_disk(d, meta)
    if (d / "beats.json").exists():
        meta.update(beats="beats.json", bpm=(read_json(d / "beats.json") or {}).get("bpm"))
    meta["artist"] = s["artist"]
    write_json(d / "meta.json", {k: v for k, v in meta.items() if k != "dir"})


def display(s):
    return f"{s['artist']} — {s['title']}" if s["artist"] else s["title"]


def separate(key):
    """Separación de StemLab (voz con su RoFormer + 6 pistas con BS-Roformer-SW) del audio de Letras, con la
    clave de Letras como id. Se arma en una carpeta aparte y se mueve al acabar: nunca queda a medias."""
    s = resolve(key)
    sid = s["stem"] or key
    if stem_state(sid) == "complete":
        return emit("done", skipped=True)
    wav = audio_of(s)
    if not wav:
        raise RuntimeError("no hay audio: falta el paso de audio")
    out, tmp = S.SONGS / sid, S.SONGS / f".{sid}.tmp"
    with S.gpu_lock():
        # mirado otra vez con el candado: otra app (o otra ventana) pudo separarla mientras esperábamos
        state = stem_state(sid)
        if state == "complete":
            return emit("done", skipped=True)
        if state == "repair":
            repair_meta(sid, s)
            return emit("done", repaired=True)
        shutil.rmtree(tmp, ignore_errors=True)
        (tmp / "stems").mkdir(parents=True)
        link(wav, tmp / "mix.wav")
        emit("progress", step=1, total=2, label="Separando la voz")
        for f in run_separator(separator("sep-vocal", S.VOCAL_MODEL), tmp / "mix.wav"):
            if "(Vocals)" in f.name:
                S.to_wav(f, tmp / "stems" / "vocals.wav")
            f.unlink(missing_ok=True)
        emit("progress", step=2, total=2, label="Separando instrumentos")
        # sobre la mezcla original: separar el instrumental ya procesado arrastraría sus artefactos
        for f in run_separator(separator("sep-instr", S.INSTR_MODEL), tmp / "mix.wav"):
            stem = re.search(r"\((\w+)\)[^(]*$", f.name).group(1).lower()
            if stem != "vocals":
                S.to_wav(f, tmp / "stems" / f"{stem}.wav")
            f.unlink(missing_ok=True)
    emit("progress", step=2, total=2, label="Ajustando las pistas")
    balance(tmp)
    if out.exists():  # restos de una separación cortada (se guarda view.json si lo había)
        if (out / "view.json").exists():
            shutil.copy(out / "view.json", tmp / "view.json")
        shutil.rmtree(out)
    tmp.rename(out)
    repair_meta(sid, s)
    with meta_lock(sid):
        meta = read_json(out / "meta.json")
        meta["balanced"] = True
        write_json(out / "meta.json", meta)
    if not key.startswith("stem:"):
        with registry() as reg:
            reg[key] = {**reg.get(key, {}), "artist": s["artist"], "title": s["title"], "stem": sid}
        if (L.AUDIO / f"{key}.vocals.wav").exists():  # la voz rápida de Letras deja paso a la buena
            link(out / "stems" / "vocals.wav", L.AUDIO / f"{key}.vocals.wav")
    emit("done", id=sid)


# pistas -> instrumentos de MuScriptor (restricción dura: no puede sacar otro instrumento en esa pista)
MUSCRIPTOR_INSTRUMENTS = {
    "vocals": ["voice"],
    "bass": ["electric_bass", "acoustic_bass", "contrabass"],
    "guitar": ["acoustic_guitar", "clean_electric_guitar", "distorted_electric_guitar"],
    "piano": ["acoustic_piano", "electric_piano", "organ"],
    "other": None,  # todo menos batería
}
MUSCRIPTOR_LICENSE = "https://huggingface.co/MuScriptor/muscriptor-medium"


def muscriptor_notes(wav, stem):
    """Notas con MuScriptor (Kyutai + Mirelo, 2026; en su prueba F1 multi-instrumento 48 frente a 22 de YourMT3+),
    modelo medium (307 M) en GPU, sobre la pista separada. Mucho más lento que basic-pitch: es la opción precisa."""
    from muscriptor.events import NoteEndEvent, ProgressEvent
    from muscriptor.tokenizer.mt3 import MT3_FULL_PLUS_GROUP_NAMES
    from muscriptor.transcription_model import TranscriptionModel

    def load():
        try:
            return TranscriptionModel.load_model("medium")
        except Exception as e:  # pesos con licencia (CC BY-NC) en Hugging Face: hay que aceptarla y tener sesión
            if any(w in str(e).lower() for w in ("gated", "401", "403", "token", "login", "access")):
                raise RuntimeError(f"MuScriptor necesita permiso: acepta la licencia en {MUSCRIPTOR_LICENSE} y ejecuta "
                                   f"«{Path(sys.executable).parent / 'hf'} auth login» una vez") from e
            raise

    names = MUSCRIPTOR_INSTRUMENTS[stem] or [n for n in MT3_FULL_PLUS_GROUP_NAMES if n != "drums"]
    notes = []
    with L.gpu_lock(), redirect_stdout(sys.stderr):
        model = GPU.cached("muscriptor", load)
        for ev in model.transcribe(str(wav), instruments=names):
            if isinstance(ev, ProgressEvent) and ev.total:
                emit("pct", value=int(ev.completed * 100 / ev.total))
            elif isinstance(ev, NoteEndEvent) and ev.start_event.instrument != "drums":
                notes.append((ev.start_event.start_time, ev.end_time, ev.start_event.pitch, 0.8))
    return sorted(notes)


def write_notes(s, stem, notes):
    """Lo mismo que deja `transcribe` de StemLab (MIDI, MusicXML con la letra, notas para el piano roll), con otras notas."""
    import pretty_midi

    sid = s["stem"]
    out = S.SONGS / sid
    meta = read_json(out / "meta.json")
    cfg = S.TRANSCRIBE[stem]
    lo, hi = cfg["range"]
    notes = [n for n in notes if lo <= n[2] <= hi]
    if cfg["mono"]:
        notes = S.monophonic(notes)
    if not notes:
        raise RuntimeError("no se detectaron notas en esta pista")
    bpm = meta.get("bpm") or S.song_tempo(out / meta["mix"])
    lyrics = {}
    words = letras_words(s) if stem == "vocals" else None
    scores = out / "scores"
    scores.mkdir(exist_ok=True)
    if words:
        lyrics = S.assign_lyrics(notes, *words)
        write_json(scores / "vocals.lyrics.json", {"language": words[1], "words": [list(w) for w in words[0]], "from": "letras"})
    pm = pretty_midi.PrettyMIDI(initial_tempo=bpm)
    inst = pretty_midi.Instrument(program=0, name=cfg["name"])
    inst.notes = [pretty_midi.Note(velocity=int(v * 127), pitch=int(p), start=float(a), end=float(b)) for a, b, p, v in notes]
    pm.instruments.append(inst)
    pm.write(str(scores / f"{stem}.mid"))
    S.notes_to_score(notes, bpm, cfg, meta["title"], lyrics).write("musicxml", fp=str(scores / f"{stem}.musicxml"))
    write_json(scores / f"{stem}.notes.json", [[round(float(a), 3), round(float(b), 3), int(p), round(float(v), 2)] for a, b, p, v in notes])


def notes(key, stem, quality=""):
    """Notas de una pista. Por defecto basic-pitch (CPU, segundos); quality="precise": MuScriptor (GPU, minutos).
    La voz lleva la letra de Letras; Whisper turbo solo si no hay."""
    s = resolve(key)
    sid = s["stem"]
    if stem_state(sid) != "complete":
        raise RuntimeError("primero hay que separar las pistas")
    meta = read_json(S.SONGS / sid / "meta.json")
    if not next((st for st in meta["stems"] if st["name"] == stem), {}).get("present"):
        return emit("done", skipped=True, reason="la pista está en silencio")
    if quality == "precise":
        emit("progress", step=1, total=1, label="Notas precisas (MuScriptor)")
        write_notes(s, stem, muscriptor_notes(S.SONGS / sid / "stems" / f"{stem}.wav", stem))
    else:
        if stem == "vocals":
            words = letras_words(s)
            if words:
                S.sing_lyrics = lambda _vocals: words
            else:
                _patch_models()
        with redirect_stdout(sys.stderr):  # su `done` lleva un meta.json que quizá ya pisó otra pista
            S.transcribe(sid, stem)
    # Las notas de varias pistas se sacan en paralelo y cada una reescribe meta.json entero (gana la última).
    # Al acabar, con candado, se rehace la lista de partituras desde los ficheros: la última en acabar deja todas.
    with meta_lock(sid):
        d = S.SONGS / sid
        meta = scores_from_disk(d, read_json(d / "meta.json"))
        for st in meta["stems"]:
            if st["name"] == stem:
                st["model"] = "muscriptor" if quality == "precise" else "basic-pitch"
        write_json(d / "meta.json", meta)
    emit("done", song=S.with_dir(meta))


def refresh_lyrics(s):
    """scores/vocals.lyrics.json = letra actual de Letras: la partitura de conjunto la reparte otra vez (sin IA)
    cada vez que se monta, así que corregir la letra corrige la partitura."""
    words = letras_words(s)
    f = S.SONGS / s["stem"] / "scores" / "vocals.lyrics.json"
    if not words or not f.parent.is_dir():
        return
    data = {"language": words[1], "words": [list(w) for w in words[0]], "from": "letras"}
    if read_json(f) != data:
        write_json(f, data)


def ensemble(key, *stems):
    s = resolve(key)
    if "vocals" in stems:
        refresh_lyrics(s)
    S.ensemble(s["stem"], *stems)


def beat_track(wav):
    """Beat This! (CPJKU, ISMIR 2024; lo más preciso hoy, MIT): pulsos y primeros tiempos de compás.
    En CPU (~5 s una canción de 3 min en un Ryzen de 12 hilos; en la RX 6600 no gana), así no espera a la GPU.
    El compás (`meter`) es lo más frecuente entre primeros tiempos: 4 en 4/4, 6 en 6/8…"""
    import numpy as np
    from beat_this.inference import File2Beats

    with redirect_stdout(sys.stderr):
        b, d = File2Beats(checkpoint_path="final0", device="cpu", dbn=False)(str(wav))
    b = [round(float(t), 3) for t in b]
    d = [round(float(t), 3) for t in d]
    per = [sum(1 for t in b if d[i] <= t < d[i + 1]) for i in range(len(d) - 1)]
    meter = max(set(per), key=per.count) if per else 4
    bpm = round(60 / float(np.median(np.diff(b)))) if len(b) > 1 else 0
    return {"bpm": bpm, "beats": b, "downbeats": d, "meter": meter, "from": "beat_this"}


def beats(key):
    """Pulsos y compases de la canción (metrónomo, acordes por compás, edits). Sin separar también: van sobre la mezcla."""
    s = resolve(key)
    wav = audio_of(s)
    if not wav:
        raise RuntimeError("no hay audio")
    emit("progress", step=1, total=1, label="Pulsos y compases (Beat This!)")
    data = beat_track(wav)
    if stem_state(s["stem"]) == "complete":
        d = S.SONGS / s["stem"]
        with meta_lock(s["stem"]):
            write_json(d / "beats.json", data)
            meta = read_json(d / "meta.json")
            meta["beats"] = "beats.json"
            meta.setdefault("bpm", data["bpm"])  # si ya hay partituras, su tempo manda (el cursor de la partitura va con él)
            write_json(d / "meta.json", meta)
    else:
        write_json(L.AUDIO / f"{key}.beats.json", data)
    emit("done", bpm=data["bpm"], meter=data["meter"], beats=len(data["beats"]))


QUALITY = {"maj": "", "min": "m", "7": "7", "maj7": "maj7", "min7": "m7", "dim": "dim", "aug": "aug", "hdim7": "m7b5", "dim7": "dim7",
           "9": "9", "maj9": "maj9", "min9": "m9", "11": "11", "13": "13", "sus2": "sus2", "sus4": "sus4", "sus4(b7)": "7sus4",
           "maj6": "6", "min6": "m6", "minmaj7": "mmaj7"}
PITCH = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
DEGREE = {"1": 0, "b2": 1, "2": 2, "#2": 3, "b3": 3, "3": 4, "4": 5, "#4": 6, "b5": 6, "5": 7, "#5": 8, "b6": 8, "6": 9, "bb7": 9, "b7": 10, "7": 11}


def parse_chord(label):
    """Etiqueta de Harte («C:min/b7», «Ab:maj», «N») -> {root, kind, bass} en clases de nota, o None (sin acorde)."""
    if label in ("N", "X", ""):
        return None
    root, _, rest = label.partition(":")
    quality, _, bass = (rest or "maj").partition("/")
    pc = (PITCH[root[0]] + root[1:].count("#") - root[1:].count("b")) % 12
    return {"root": pc, "kind": QUALITY.get(quality, QUALITY.get(quality.split("(")[0], "")), "bass": (pc + DEGREE.get(bass, 0)) % 12}


def chords(key):
    """Acordes del audio con lv-chordia (Jiang et al., ISMIR 2019: ~170 acordes con inversiones, ~81 % en Billboard):
    un conjunto de 5 redes sobre el CQT y un HMM. En GPU, ~16 s una canción de 3 min. No necesita notas ni pistas."""
    s = resolve(key)
    wav = audio_of(s)
    if not wav:
        raise RuntimeError("no hay audio")
    emit("progress", step=1, total=1, label="Acordes (lv-chordia)")
    from lv_chordia.chord_recognition import chord_recognition

    with L.gpu_lock(), redirect_stdout(sys.stderr):
        GPU.drop()  # sus redes son pequeñas y se cargan solas: que no compartan VRAM con lo que hubiera
        segs = chord_recognition(str(wav))
    out = []
    for g in segs:
        c = parse_chord(g["chord"])
        if c:
            out.append({"t": g["start_time"], "end": g["end_time"], **c})
    data = {"chords": out, "from": "lv-chordia"}
    write_json((S.SONGS / s["stem"] / "chords.json") if stem_state(s["stem"]) == "complete" else L.AUDIO / f"{key}.chords.json", data)
    emit("done", chords=len(out))


def chords_of(s):
    for f in [S.SONGS / s["stem"] / "chords.json" if s["stem"] else None, L.AUDIO / f"{s['key']}.chords.json"]:
        if f and f.exists():
            return read_json(f)
    return None


def parse_meta(info):
    """Metadatos de yt-dlp -> (artista, título): los de música, «Artista - Título» del vídeo, o el canal."""
    artist = (info.get("artist") or info.get("creator") or "").split(",")[0].strip()
    title = info.get("track") or ""
    if not (artist and title):
        raw = re.sub(r"\s*[\(\[][^)\]]*(official|video|audio|lyric|letra|visualizer|mv|hd|4k)[^)\]]*[\)\]]", "", info.get("title") or "", flags=re.I)
        if " - " in raw:
            artist, title = (x.strip() for x in raw.split(" - ", 1))
        else:
            artist = re.sub(r"\s*-\s*Topic$|VEVO$", "", info.get("channel") or info.get("uploader") or "").strip()
            title = raw.strip()
    return artist, title


def import_(src, artist="", title=""):
    """Enlace (YouTube y demás de yt-dlp) o fichero -> canción nueva con su audio en Letras."""
    L.AUDIO.mkdir(parents=True, exist_ok=True)
    if S.is_url(src):
        from yt_dlp import YoutubeDL

        emit("progress", step=1, total=2, label="Descargando")
        opts = {"quiet": True, "no_warnings": True, "noprogress": True, "noplaylist": True, "format": "bestaudio/best",
                "outtmpl": str(WORK / "dl" / "%(id)s.%(ext)s")}
        with redirect_stdout(sys.stderr), YoutubeDL(opts) as ydl:
            info = ydl.extract_info(src, download=True)
            got = Path(ydl.prepare_filename(info))
        a, t = parse_meta(info)
        duration = info.get("duration") or 0
    else:
        got = Path(src)
        r = __import__("subprocess").run(["ffprobe", "-v", "error", "-show_entries", "format=duration:format_tags", "-of", "json", str(got)],
                                         capture_output=True, text=True)
        fmt = json.loads(r.stdout or "{}").get("format", {})
        tags = {k.lower(): v for k, v in fmt.get("tags", {}).items()}
        a, t = tags.get("artist", ""), tags.get("title", "")
        if not t:
            name = re.sub(r"^[0-9a-z]+-", "", got.stem) if got.parent == DATA / "uploads" else got.stem
            a, _, t = name.rpartition(" - ")
        duration = float(fmt.get("duration") or 0)
    artist, title = artist or a or "Desconocido", title or t or got.stem
    key = register(artist, title, duration=round(duration))
    emit("progress", step=2, total=2, label="Convirtiendo")
    if not (L.AUDIO / f"{key}.wav").exists():
        L.to_wav(got, L.AUDIO / f"{key}.wav")
    if S.is_url(src) or got.parent == DATA / "uploads":
        got.unlink(missing_ok=True)
    emit("done", key=key, artist=artist, title=title)


def add(artist, title, duration="0"):
    """Canción nueva por artista y título (o lo que suena en Spotify, con su duración: así las fuentes de letras
    sincronizadas solo valen si duran lo mismo)."""
    key = register(artist.strip(), title.strip(), duration=round(float(duration or 0)))
    doc = read_json(L.doc_path(key))
    emit("done", key=key, lyrics=bool(doc), timed=bool(doc and any(l.get("t") is not None for l in doc.get("lines", []))))


def unfail(*keys):
    """Quita canciones de las fallidas del prefetch: el próximo las vuelve a intentar."""
    failed = set(L.FAILED.read_text().split()) if L.FAILED.exists() else set()
    left = failed - set(keys)
    L.FAILED.write_text("".join(f"{k}\n" for k in sorted(left)))
    emit("done", failed=sorted(left))


def prefetch():
    """Sincroniza las canciones de las playlists de playlists.txt (lo lanza el timer de systemd)."""
    L.prefetch()
    emit("done")


def assign(key, artist, title):
    """Pone artista y título a una canción de StemLab sin ellos: pasa a tener clave de Letras."""
    s = resolve(key)
    new = register(artist.strip(), title.strip(), stem=s["stem"])
    if s["stem"] and (S.SONGS / s["stem"] / "meta.json").exists():
        meta = read_json(S.SONGS / s["stem"] / "meta.json")
        write_json(S.SONGS / s["stem"] / "meta.json", {**meta, "artist": artist.strip(), "title": f"{artist.strip()} — {title.strip()}"})
    emit("done", key=new)


def restore(key):
    s = resolve(key)
    need_letras(s)
    L.restore(s["artist"], s["title"])


def delete(key, what="all"):
    """what: audio (cachés de Letras: se vuelven a sacar), stems (pistas y partituras de StemLab), all (todo, edits incluidos)."""
    s = resolve(key)
    if what in ("audio", "all") and not key.startswith("stem:"):
        with redirect_stdout(sys.stderr):
            L.delete(key, "audio" if what == "audio" else "")
    if what in ("stems", "all") and s["stem"] and (S.SONGS / s["stem"]).is_dir():
        with redirect_stdout(sys.stderr):
            S.delete(s["stem"])
        with registry() as reg:
            if key in reg:
                reg[key].pop("stem", None)
    if what == "all":
        with registry() as reg:
            reg.pop(key, None)
        for f in (EDITS / "projects").glob("*.json"):
            if (read_json(f) or {}).get("key") == key:
                f.unlink()
    emit("done", key=key)


def search(query):
    S.search(query)


def paths():
    emit("done", letras=str(L.DATA), stemlab=str(S.DATA), data=str(DATA), edits=str(EDITS), lock=str(L.GPU_LOCK))


# ---------------------------------------------------------------- plan


def step(cmd, res, label, *args, model=None):
    return {"cmd": cmd, "args": list(args), "res": res, "label": label, **({"model": model} if model else {})}


def sync_steps(s, mode=""):
    key = s["key"]
    out = []
    if not (L.AUDIO / f"{key}.wav").exists():
        out.append(step("audio", "cpu" if audio_of(s) else "net", "Audio" if audio_of(s) else "Descargando audio", key))
    if stem_vocals(s, planning=True):
        out.append(step("vocals", "cpu", "Voz de StemLab", key))
    elif not (L.AUDIO / f"{key}.vocals.wav").exists():
        out.append(step("vocals", "gpu", "Separando la voz", key, model="sep-fast"))
    check = not s["doc"] or audio_unchecked(s)  # ¿el audio es la versión de los tiempos de la letra?
    if read_json(L.AUDIO / f"{key}.{L.WHISPER_MODEL}.words.json") is None:
        out.append(step("whisper", "gpu", "Whisper", key, mode, model="whisper"))
    if check:
        out.append(step("audio_align", "cpu", "Audio y letra a la par", key))
    if check or not (L.AUDIO / f"{key}.ctc.npz").exists():
        out.append(step("ctc", "gpu", "Alineado forzado", key, model="mms"))
    out.append(step("align", "cpu", "Palabra a palabra", key, mode))
    return out


def separate_steps(s):
    out = []
    state = stem_state(s["stem"] or s["key"])
    if state == "complete":
        return out
    if not audio_of(s):
        out.append(step("audio", "net", "Descargando audio", s["key"]))
    out.append(step("separate", "cpu" if state == "repair" else "gpu", "Reparando" if state == "repair" else "Separando pistas", s["key"], model="sep"))
    return out


def plan(action, key, *args):
    """Pasos que faltan para `action` con lo que hay ahora. La app los ejecuta en orden; cada paso vuelve a mirar."""
    s = resolve(key)
    if action == "letra":  # buscar (o buscar otra vez) y dejarla palabra a palabra
        need_letras(s)
        steps = [step("find", "net", "Buscando la letra", key, *args)] if not s["doc"] or args[:1] == ("force",) else []
        steps += sync_steps(s)
    elif action == "find":
        need_letras(s)
        steps = [step("find", "net", "Buscando la letra", key, *args)]
    elif action == "sync":
        need_letras(s)
        steps = sync_steps(s, *args)
    elif action == "separate":
        steps = separate_steps(s)
        steps.append(step("beats", "cpu", "Pulsos", key))
    elif action == "notes":
        stem = args[0]
        steps = separate_steps(s)
        if stem == "vocals" and not letras_words(s) and not key.startswith("stem:"):
            if not s["doc"]:
                steps.append(step("find", "net", "Buscando la letra", key))
            steps += sync_steps(s)
        precise = args[1:2] == ("precise",)
        turbo = stem == "vocals" and key.startswith("stem:") and not precise  # sin letra posible: Whisper turbo, en GPU
        model = "muscriptor" if precise else "whisper" if turbo else None
        steps.append(step("notes", "gpu" if model else "cpu", f"Notas{' precisas' if precise else ''} · {stem}", key, stem, *args[1:2],
                          **({"model": model} if model else {})))
    elif action == "autosync":  # lo que suena en Spotify: como Letras, la IA solo si la letra no trae tiempos
        need_letras(s)
        doc = s["doc"] or {}
        timed = any(l.get("t") is not None for l in doc.get("lines", []))
        steps = [] if doc.get("instrumental") or timed else sync_steps(s)
    elif action == "chords":
        steps = ([step("audio", "net", "Descargando audio", key)] if not audio_of(s) else []) + [step("chords", "gpu", "Acordes", key, model="chords")]
    elif action == "beats":
        steps = ([step("audio", "net", "Descargando audio", key)] if not audio_of(s) else []) + [step("beats", "cpu", "Pulsos", key)]
    elif action == "audio":
        steps = [step("audio", "net", "Descargando audio", key)]
    else:
        raise ValueError(f"acción desconocida: {action}")
    emit("done", title=display(s), steps=steps)


# ---------------------------------------------------------------- entrada

COMMANDS = {
    "catalog": catalog, "song": song, "plan": plan, "paths": paths, "search": search, "add": add, "assign": assign, "import": import_,
    "restore": restore, "delete": delete, "ensemble": ensemble, "beats": beats, "audio": audio, "vocals": vocals, "whisper": whisper,
    "ctc": ctc, "find": find, "align": align, "separate": separate, "notes": notes, "chords": chords, "prefetch": prefetch, "unfail": unfail, "rebalance": rebalance, "audio_align": audio_align,
}


def run(cmd, args):
    try:
        if cmd not in COMMANDS:
            raise ValueError(f"orden desconocida: {cmd}")
        if cmd in ("whisper", "ctc", "notes"):
            _patch_models()
        COMMANDS[cmd](*args)
        return True
    except Exception as e:
        traceback.print_exc()
        emit("error", message=f"{type(e).__name__}: {e}" if not isinstance(e, (RuntimeError, ValueError)) else str(e))
        return False


def worker():
    """Órdenes de GPU una tras otra en el mismo proceso: los modelos se quedan cargados entre canciones."""
    emit("ready")
    for line in sys.stdin:
        req = json.loads(line)
        if req["cmd"] == "flush":
            GPU.release()
        else:
            run(req["cmd"], req.get("args", []))
        emit("end")


def orphan_guard():
    """Si la app muere (cerrada a lo bruto, recompilada en desarrollo…), su motor también, con lo que haya lanzado:
    un worker huérfano seguiría con la GPU y su candado, y la siguiente app esperaría por él."""
    parent = os.getppid()

    def watch():
        while os.getppid() == parent:
            time.sleep(1)
        if os.getpgrp() == os.getpid():  # lanzado por la app: grupo propio (ffmpeg, yt-dlp… dentro)
            os.killpg(0, signal.SIGKILL)
        os._exit(1)

    threading.Thread(target=watch, daemon=True).start()


def main():
    cmd, *args = sys.argv[1:] or ["catalog"]
    orphan_guard()
    if cmd == "worker":
        return worker()
    sys.exit(0 if run(cmd, args) else 1)


if __name__ == "__main__":
    main()
