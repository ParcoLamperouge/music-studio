"""Servidor de Estudio: guarda lo ya procesado de cada canción (audio, voz, pistas, Whisper, acordes, notas, letra,
edits) para no tener que repetirlo en otro ordenador. Solo biblioteca estándar.

Los ficheros se guardan por contenido (sha256): un audio enlazado en dos sitios se sube una vez. Cada canción es un
manifiesto {meta, files: {ruta: {sha, size, mtime}}}; quien sincroniza (hub.py remote_sync) decide qué gana.

  GET  /songs            {clave: {artist, title, updated, bytes}}
  GET  /songs/<clave>    manifiesto (404 si no está)
  PUT  /songs/<clave>    manifiesto nuevo; todos sus ficheros tienen que estar ya subidos
  POST /missing          [sha, …] -> los que faltan
  PUT  /blobs/<sha>      un fichero (se comprueba que su sha256 es ese)
  GET  /blobs/<sha>

Variables: HOST (127.0.0.1), PORT (8765), STORE (./store), ESTUDIO_TOKEN (obligatorio si escucha fuera de localhost:
la app lo manda como «Authorization: Bearer …»). Sin TLS: en la nube, detrás de un proxy con HTTPS (Caddy, Traefik…).
"""

import hashlib
import hmac
import json
import os
import re
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote

HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8765"))
STORE = Path(os.environ.get("STORE", "store")).resolve()
TOKEN = os.environ.get("ESTUDIO_TOKEN", "")
SHA = re.compile(r"[0-9a-f]{64}")
KEY = re.compile(r"[\w:.-]{1,200}")
BLOBS, SONGS = STORE / "blobs", STORE / "songs"


def blob(sha):
    return BLOBS / sha[:2] / sha


def manifest(key):
    return SONGS / f"{quote(key, safe='')}.json"


def write_atomic(p, data):
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f".{p.name}.{os.getpid()}.{time.monotonic_ns()}.tmp")
    tmp.write_bytes(data)
    tmp.replace(p)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def send(self, code, body=b"", ctype="application/json"):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        if not TOKEN or hmac.compare_digest(self.headers.get("Authorization", ""), f"Bearer {TOKEN}"):
            return True
        self.send(401, {"error": "token incorrecto"})
        return False

    def body(self):
        return self.rfile.read(int(self.headers.get("Content-Length") or 0))

    def route(self):
        parts = [unquote(p) for p in self.path.split("?")[0].strip("/").split("/")]
        return parts + [""] * (2 - len(parts))

    def do_GET(self):
        if not self.authed():
            return
        kind, arg = self.route()[:2]
        if kind == "songs" and not arg:
            out = {}
            for f in SONGS.glob("*.json"):
                m = json.loads(f.read_bytes())
                out[unquote(f.stem)] = {**{k: m["meta"].get(k) for k in ("artist", "title")}, "updated": m.get("updated"),
                                        "bytes": sum({v["sha"]: v["size"] for v in m["files"].values()}.values())}
            return self.send(200, out)
        if kind == "songs" and KEY.fullmatch(arg):
            f = manifest(arg)
            return self.send(200, f.read_bytes()) if f.exists() else self.send(404, {"error": "no está"})
        if kind == "blobs" and SHA.fullmatch(arg) and blob(arg).exists():
            p = blob(arg)
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(p.stat().st_size))
            self.end_headers()
            with open(p, "rb") as f:
                while chunk := f.read(1 << 20):
                    self.wfile.write(chunk)
            return
        self.send(404, {"error": "no está"})

    def do_POST(self):
        if not self.authed():
            return
        if self.route()[0] == "missing":
            shas = json.loads(self.body() or b"[]")
            return self.send(200, [s for s in shas if not (SHA.fullmatch(s) and blob(s).exists())])
        self.send(404, {"error": "no está"})

    def do_PUT(self):
        if not self.authed():
            return
        kind, arg = self.route()[:2]
        if kind == "blobs" and SHA.fullmatch(arg):
            left, h = int(self.headers.get("Content-Length") or 0), hashlib.sha256()
            tmp = BLOBS / f".{arg}.{time.monotonic_ns()}.part"
            tmp.parent.mkdir(parents=True, exist_ok=True)
            try:
                with open(tmp, "wb") as f:
                    while left:
                        chunk = self.rfile.read(min(left, 1 << 20))
                        if not chunk:
                            raise ConnectionError("subida cortada")
                        left -= len(chunk)
                        h.update(chunk)
                        f.write(chunk)
                if h.hexdigest() != arg:
                    return self.send(400, {"error": "el contenido no es ese sha256"})
                blob(arg).parent.mkdir(exist_ok=True)
                tmp.replace(blob(arg))
                return self.send(200, {"ok": True})
            finally:
                tmp.unlink(missing_ok=True)
        if kind == "songs" and KEY.fullmatch(arg):
            m = json.loads(self.body())
            missing = [v["sha"] for v in m["files"].values() if not (SHA.fullmatch(v["sha"]) and blob(v["sha"]).exists())]
            if missing:
                return self.send(409, {"error": "faltan ficheros", "missing": missing})
            m["updated"] = time.time()
            # ponytail: los blobs que ya no usa ningún manifiesto se quedan; limpiar a mano o con un GC si ocupa mucho
            write_atomic(manifest(arg), json.dumps(m, ensure_ascii=False).encode())
            return self.send(200, {"ok": True, "updated": m["updated"]})
        self.send(404, {"error": "no está"})

    def log_message(self, fmt, *args):
        sys.stderr.write(f"{self.address_string()} {fmt % args}\n")


def main():
    if not TOKEN and HOST not in ("127.0.0.1", "localhost", "::1"):
        sys.exit("ESTUDIO_TOKEN es obligatorio si el servidor escucha fuera de localhost")
    for d in (BLOBS, SONGS):
        d.mkdir(parents=True, exist_ok=True)
    print(f"Estudio · servidor en http://{HOST}:{PORT} · datos en {STORE}{'' if TOKEN else ' · sin token'}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
