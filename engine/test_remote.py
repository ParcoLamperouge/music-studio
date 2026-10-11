"""Servidor de Estudio de ida y vuelta: dos «ordenadores» (carpetas temporales) y server.py de verdad en medio."""
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).parent
KEY = "artista-cancion"
STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"]
tmp = Path(tempfile.mkdtemp())
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
port = sock.getsockname()[1]
sock.close()
server = subprocess.Popen([sys.executable, HERE.parent / "server/server.py"], env={**os.environ, "PORT": str(port), "STORE": str(tmp / "store"), "ESTUDIO_TOKEN": "t"}, stderr=subprocess.DEVNULL)


def pc(name):
    root = tmp / name
    return root, {**os.environ, "LETRAS_DATA": str(root / "letras"), "STEMLAB_DATA": str(root / "stemlab"), "ESTUDIO_DATA": str(root / "estudio"),
                  "LYRIC_EDITS_DATA": str(root / "edits"), "ESTUDIO_REMOTE": f"127.0.0.1:{port}", "ESTUDIO_REMOTE_TOKEN": "t"}


def hub(env, *args):
    r = subprocess.run([sys.executable, HERE / "hub.py", *args], env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr
    return json.loads(r.stdout.strip().splitlines()[-1])


def put(p, data):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_bytes(data)


try:
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://127.0.0.1:{port}/songs")
        except urllib.error.HTTPError as e:
            assert e.code == 401  # sin token no se entra
            break
        except OSError:
            time.sleep(0.1)

    a, ea = pc("a")
    put(a / "letras/lyrics" / f"{KEY}.json", json.dumps({"artist": "Artista", "title": "Canción", "lines": [{"t": 1, "text": "hola"}]}).encode())
    put(a / "letras/audio" / f"{KEY}.wav", b"audio-1" * 1000)
    put(a / "letras/audio" / f"{KEY}.ctc.npz", b"ctc-1")
    sid = a / "stemlab/songs/otro-id"
    sid.mkdir(parents=True)
    os.link(a / "letras/audio" / f"{KEY}.wav", sid / "mix.wav")
    for s in STEMS:
        put(sid / "stems" / f"{s}.wav", s.encode())
    put(sid / "meta.json", json.dumps({"id": "otro-id", "stems": [{"name": s} for s in STEMS]}).encode())
    put(a / "estudio/songs.json", json.dumps({KEY: {"artist": "Artista", "title": "Canción", "stem": "otro-id"}}).encode())
    put(a / "edits/projects/p1.json", json.dumps({"key": KEY, "bg": {"src": "/file/data/media/fondo.png"}}).encode())
    put(a / "edits/media/fondo.png", b"png")

    r = hub(ea, "remote_sync", KEY)
    assert r["up"] == 12 and r["down"] == 0, r  # mix = audio: se sube una vez
    assert hub(ea, "remote_sync", KEY)["up"] == 0  # nada nuevo

    b, eb = pc("b")
    assert KEY in hub(eb, "remote_list")["songs"]
    r = hub(eb, "remote_sync", KEY)
    assert r["down"] == 13, r
    assert (b / "letras/audio" / f"{KEY}.wav").samefile(b / "stemlab/songs/otro-id/mix.wav")  # enlazado, no dos copias
    assert (b / "edits/media/fondo.png").read_bytes() == b"png"
    catalog = hub(eb, "catalog")["songs"]
    assert [(s["key"], s["stems"], s["lyrics"]["status"]) for s in catalog] == [(KEY, "complete", "lines")], catalog

    # A alinea el audio con la letra: audio nuevo, el ctc viejo ya no vale y se borra. B tiene que perderlo también.
    time.sleep(0.01)
    (a / "letras/audio" / f"{KEY}.ctc.npz").unlink()
    put(a / "letras/audio" / f"{KEY}.wav", b"audio-2" * 900)
    put(a / "letras/audio" / f"{KEY}.chords.json", b"[]")
    hub(ea, "remote_sync", KEY)
    # mientras, B había sacado algo del audio viejo: no se mezcla con el nuevo
    put(b / "letras/audio" / f"{KEY}.beats.json", b"{}")
    os.utime(b / "letras/audio" / f"{KEY}.beats.json", ns=(1, 1))
    r = hub(eb, "remote_sync", KEY)
    audio = sorted(p.name for p in (b / "letras/audio").iterdir())
    assert audio == [f"{KEY}.chords.json", f"{KEY}.wav"], audio
    assert (b / "letras/audio" / f"{KEY}.wav").read_bytes() == b"audio-2" * 900
    assert r["removed"] == 2, r

    # B corrige la letra: A la recibe
    time.sleep(0.01)
    doc = json.loads((b / "letras/lyrics" / f"{KEY}.json").read_text())
    put(b / "letras/lyrics" / f"{KEY}.json", json.dumps({**doc, "edited": True}).encode())
    hub(eb, "remote_sync", KEY)
    hub(ea, "remote_sync", KEY)
    assert json.loads((a / "letras/lyrics" / f"{KEY}.json").read_text())["edited"]

    # una ruta con trampa en el servidor no sale de las carpetas de datos
    sys.path.insert(0, str(HERE))
    os.environ.update(eb)
    import hub as H
    for bad in ("stems//etc/passwd", "stems/../../x", "audio/../x", "edits/../x", "history/a/b"):
        try:
            H.local_path(KEY, "id", bad)
            raise AssertionError(bad)
        except ValueError:
            pass
    print("remote ok")
finally:
    server.kill()
