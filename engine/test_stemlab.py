"""uv run python test_engine.py"""
import stemlab as engine

# voz: entre notas solapadas gana la más fuerte; las que no solapan se quedan
notes = [(0.0, 1.0, 60, 0.9), (0.2, 0.8, 72, 0.3), (1.0, 2.0, 62, 0.5)]
assert [n[2] for n in engine.monophonic(notes)] == [60, 62]

# 120 bpm: 0.5 s = una negra; 4 negras = un compás de 4/4 lleno
score = engine.notes_to_score([(i * 0.5, i * 0.5 + 0.5, 60 + i, 0.5) for i in range(4)], 120, engine.TRANSCRIBE["piano"], "t")
measures = score.parts[0].getElementsByClass("Measure")
assert len(measures) == 1, len(measures)
assert [n.pitch.midi for n in measures[0].notes] == [60, 61, 62, 63]
assert all(n.quarterLength == 1 for n in measures[0].notes)

# letra: sílabas repartidas por nota, con su tipo para MusicXML
assert engine.syllables("canciones,", "es") == ["can", "cio", "nes,"]
assert engine.syllables("yo", "es") == ["yo"]
notes = [(0.0, 0.3, 60, 1), (0.3, 0.6, 62, 1), (0.6, 0.9, 64, 1), (0.9, 1.2, 65, 1), (1.5, 2.0, 67, 1)]
words = [(0.0, 0.9, "canciones"), (1.5, 2.0, "yo")]
got = engine.assign_lyrics(notes, words, "es")
assert got == {0: ("can", "begin"), 1: ("cio", "middle"), 2: ("nes", "end"), 4: ("yo", "single")}, got
# menos notas que sílabas: lo que sobra va junto en la última
assert engine.assign_lyrics(notes[:2], [(0.0, 0.6, "canciones")], "es") == {0: ("can", "begin"), 1: ("ciones", "end")}
# y llega a la partitura
score = engine.notes_to_score(notes, 120, engine.TRANSCRIBE["vocals"], "t", got)
sung = [(n.lyric, n.lyrics[0].syllabic) for n in score.recurse().notes if n.lyrics]
assert sung == [("can", "begin"), ("cio", "middle"), ("nes", "end"), ("yo", "single")], sung

# borrar: solo carpetas de canción, nunca rutas que salgan de songs/
(engine.SONGS / "zz-test-borrar" / "stems").mkdir(parents=True, exist_ok=True)
engine.delete("zz-test-borrar")
assert not (engine.SONGS / "zz-test-borrar").exists()
for bad in ["..", "../models", "", "no-existe-zz"]:
    try:
        engine.delete(bad)
        raise AssertionError(f"borró {bad!r}")
    except ValueError:
        pass

# partitura de conjunto: un pentagrama por instrumento, con su nombre (la app colorea por él), mismos compases
voz = [(0.0, 0.5, 64, 1), (0.5, 1.0, 65, 1)]
bajo = [(0.0, 2.0, 40, 1)]
score = engine.build_score([(voz, engine.TRANSCRIBE["vocals"], {0: ("la", "single")}), (bajo, engine.TRANSCRIBE["bass"], None)], 120, "t")
assert [p.partName for p in score.parts] == ["Voz", "Bajo"]
assert len(score.parts[0].getElementsByClass("Measure")) == len(score.parts[1].getElementsByClass("Measure")) == 1
assert [n.lyric for n in score.parts[0].recurse().notes] == ["la", None]
print("ok")
