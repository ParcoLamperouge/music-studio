"""Tests del motor de Estudio sin red ni GPU: `python test_hub.py` (con el venv de StemLab)."""

import os
import tempfile
from pathlib import Path

tmp = Path(tempfile.mkdtemp())
os.environ.update(LETRAS_DATA=str(tmp / "letras"), STEMLAB_DATA=str(tmp / "stemlab"), ESTUDIO_DATA=str(tmp / "estudio"), LYRIC_EDITS_DATA=str(tmp / "edits"))

import hub  # noqa: E402

L, S = hub.L, hub.S

# idioma para las sílabas
assert hub.language("You can't go to school in that dress, unless you're covering your legs") == "en"
assert hub.language("Que no me digas que la vida es para mí con el corazón") == "es"
assert hub.language("ずっと君のことを想っている") == "ja"
assert hub.language("zzz qqq") == "en"

# artista y título de YouTube
assert hub.parse_meta({"artist": "Stela Cole", "track": "Stereoqueen"}) == ("Stela Cole", "Stereoqueen")
assert hub.parse_meta({"title": "UPSAHL - Lunatic (Official Video)", "channel": "UPSAHL"}) == ("UPSAHL", "Lunatic")
assert hub.parse_meta({"title": "Villain", "channel": "Bella Poarch - Topic"}) == ("Bella Poarch", "Villain")

# canción añadida: registro con su clave de Letras
key = hub.register("Cloudy June", "DNA", duration=185)
assert key == "cloudy-june-dna" and hub.resolve(key)["duration"] == 185

# separación a medias = "partial"; pistas enteras sin meta = "repair"; con meta = "complete"
d = S.SONGS / key
(d / "stems").mkdir(parents=True)
assert hub.stem_state(key) == "partial"
wav = b"RIFF" + b"\0" * 40 + b"\1\2" * 44100
L.AUDIO.mkdir(parents=True)
(L.AUDIO / f"{key}.wav").write_bytes(wav)
hub.link(L.AUDIO / f"{key}.wav", d / "mix.wav")
assert (d / "mix.wav").samefile(L.AUDIO / f"{key}.wav")  # enlace duro: sin copia
for s in S.STEMS:
    (d / "stems" / f"{s}.wav").write_bytes(wav)
assert hub.stem_state(key) == "repair"
hub.write_json(d / "meta.json", {"id": key, "title": "DNA", "stems": [{"name": s, "file": f"stems/{s}.wav", "present": True} for s in S.STEMS]})
assert hub.stem_state(key) == "complete"

# borrar una pista separada: wav fuera, las pistas midi derivadas caen con ella, y la canción sigue «complete»
hub.write_json(d / "meta.json", {"id": key, "title": "DNA", "stems": [{"name": s, "file": f"stems/{s}.wav", "present": True} for s in S.STEMS],
                                "tracks": [{"name": "piano.opt1", "kind": "midi", "of": "piano", "roll": "rolls/piano.opt1.roll", "score": None}]})
(d / "rolls").mkdir()
(d / "rolls" / "piano.opt1.roll").write_text("[]")
hub.stem_delete(key, "piano")
assert not (d / "stems" / "piano.wav").exists() and not (d / "rolls" / "piano.opt1.roll").exists()
meta = hub.read_json(d / "meta.json")
assert meta["tracks"] == [] and next(st for st in meta["stems"] if st["name"] == "piano")["present"] is False
assert hub.stem_state(key) == "complete"  # las pistas present:false no la marcan como partial
try:
    hub.stem_delete(key, "trombone")
    assert False
except ValueError:
    pass

# la voz de StemLab manda (mismo audio) y el plan de la letra no separa ni carga la GPU para ella
s = hub.resolve(key)
assert s["stem"] == key and hub.stem_vocals(s) == d / "stems" / "vocals.wav"
L.save({"key": key, "artist": "Cloudy June", "title": "DNA", "source": "lrclib", "synced": True, "instrumental": False, "offset": 0.5, "word_offset": 0.1,
        "lines": [{"t": 1.0, "end": 2.0, "text": "you can't go", "words": [{"t": 1.0, "end": 1.2, "w": "you"}, {"t": 1.3, "w": "can't"}]}]})
s = hub.resolve(key)
steps = hub.sync_steps(s)
assert [x["cmd"] for x in steps][:1] == ["vocals"] and steps[0]["res"] == "cpu", steps
# letra con tiempos y audio sin comprobar: Whisper una vez (¿es la misma versión?); comprobado y de su duración, sin Whisper
assert hub.needs_whisper({**s, "duration": 0}, "") and "audio_align" in [x["cmd"] for x in hub.sync_steps(s)]
assert not hub.needs_whisper({**s, "duration": 0, "doc": {**s["doc"], "audio_checked": True}}, "")
assert hub.needs_whisper({**s, "doc": {**s["doc"], "source": "ia"}}, "")  # sin tiempos fiables: Whisper

# palabras para la partitura: en tiempo del audio (desfase + desfase de palabras)
ws, lang = hub.letras_words(s)
assert ws[0] == (1.6, 1.8, "you") and lang == "en", ws

# una caché cortada a mitad se tira (antes rompía la siguiente sincronización)
bad = L.AUDIO / f"{key}.{L.WHISPER_MODEL}.words.json"
bad.write_text("[{")
hub.clean(key)
assert not bad.exists()

# «dentro de cada línea»: inicios intactos; palabras entre el inicio y la línea siguiente, aunque el fin guardado sea viejo
ref = [{"t": 2.0, "end": 2.5, "text": "a b c"}, {"t": 6.0, "text": "d"}]
got = hub.inside_lines([{"t": 1.0, "end": 5.5, "text": "a b c", "words": [{"t": 1.0, "end": 1.5, "w": "a"}, {"t": 3.0, "end": 3.4, "w": "b"}, {"t": 7.0, "end": 7.5, "w": "c"}]},
                        {"t": 6.2, "end": 7.0, "text": "d", "words": [{"t": 6.2, "end": 7.0, "w": "d"}]}], ref)
assert [l["t"] for l in got] == [2.0, 6.0], got
assert [(w["t"], w["end"]) for w in got[0]["words"]] == [(2.0, 2.5), (3.0, 3.4), (6.0, 6.0)] and got[0]["end"] == 6.0, got[0]
chk = {**s, "doc": {**s["doc"], "audio_checked": True}}
assert hub.needs_whisper(chk, "ia") and not hub.needs_whisper(chk, "lineas") and hub.needs_whisper(s, "lineas")

# etiquetas de lv-chordia (Harte) -> raíz, tipo y bajo
assert hub.parse_chord("C:min/b7") == {"root": 0, "kind": "m", "bass": 10}
assert hub.parse_chord("Ab:maj") == {"root": 8, "kind": "", "bass": 8}
assert hub.parse_chord("F#:hdim7") == {"root": 6, "kind": "m7b5", "bass": 6}
assert hub.parse_chord("G:sus4(b7)")["kind"] == "7sus4" and hub.parse_chord("C:maj/3")["bass"] == 4
assert hub.parse_chord("N") is None

# mover el audio: tiempos de cachés, recortando lo que queda antes de 0
assert hub.shift_times([{"t": 1.0, "end": 2.0}, {"t": 15.0, "end": 16.0, "root": 3}], 13.0) == [{"t": 2.0, "end": 3.0, "root": 3}]
import numpy as np, soundfile as sf
f = tmp / "x.wav"
sf.write(str(f), np.ones((44100 * 3, 2), np.float32) * 0.5, 44100, subtype="PCM_16")
hub.shift_audio_file(f, 1.0)
assert abs(sf.info(str(f)).duration - 2.0) < 0.01 and sf.info(str(f)).subtype == "PCM_16"
hub.shift_audio_file(f, -0.5)
x, _ = sf.read(str(f))
assert abs(len(x) / 44100 - 2.5) < 0.01 and x[:100].max() == 0 and x[-1].max() > 0.4

# compás a mano: reescribe los downbeats en beats.json (la única fuente, motor y app leen igual)
hub.write_json(d / "beats.json", {"bpm": 120, "beats": [1 + i * 0.5 for i in range(24)], "downbeats": [1 + i * 2 for i in range(6)], "meter": 4, "from": "beat_this"})
hub.meter_set(f"stem:{key}", "3", "1")
bi = hub.read_json(d / "beats.json")
assert bi["meter"] == 3 and bi["meterFrom"] == "manual"
assert bi["downbeats"][:3] == [1.5, 3.0, 4.5], bi["downbeats"]  # fase un pulso adelante, cada 3
hub.meter_set(f"stem:{key}", "", "-1")  # y de vuelta: la rejilla reescrita vota estable
bi = hub.read_json(d / "beats.json")
assert bi["meter"] == 3 and bi["downbeats"][:3] == [1.0, 2.5, 4.0], bi["downbeats"]

# el roll sale con el compás (y la mano) al día, venga de un stem de 4 columnas o de un cambio de compás
tl = hub.B.Timeline.from_beats([1 + i * 0.5 for i in range(24)], [1.0, 2.5], 3)
rows = hub.B.refresh_bars([[1.2, 1.4, 60, 0.5, 99, "lh"], [1.5, 2.0, 64, 0.6]], tl)
assert rows[0][4] == 0 and rows[0][5] == "lh" and rows[1][4] == 0 and rows[1][5] == "rh", rows

print("hub ok")
