"""LLM con API compatible con OpenAI (DeepSeek, Kimi, GLM, OpenRouter, Ollama…), para las
funciones de revisión. Configuración en settings.json «ai»: {url, model, key}; las variables
de entorno ESTUDIO_AI_URL / ESTUDIO_AI_MODEL / ESTUDIO_AI_KEY van por encima. Sin dependencias:
urllib, como el resto del motor."""

import json
import os
from pathlib import Path
from urllib.request import Request, urlopen

XDG = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share")
DATA = Path(os.environ.get("ESTUDIO_DATA") or XDG / "estudio")


def cfg():
    c = json.loads((DATA / "settings.json").read_text()) if (DATA / "settings.json").exists() else {}
    ai = c.get("ai") or {}
    url = (os.environ.get("ESTUDIO_AI_URL") or ai.get("url") or "").strip().rstrip("/")
    model = (os.environ.get("ESTUDIO_AI_MODEL") or ai.get("model") or "").strip()
    key = (os.environ.get("ESTUDIO_AI_KEY") or ai.get("key") or "").strip()
    if not url or not model:
        raise RuntimeError("sin LLM: configura la API en Ajustes → IA (url y modelo)")
    return url, model, key


def lang():
    """Idioma de la interfaz guardado en settings.json, para los informes (zh/en; resto es)."""
    c = json.loads((DATA / "settings.json").read_text()) if (DATA / "settings.json").exists() else {}
    n = (c.get("lang") or "").lower()
    return "zh" if n.startswith("zh") else "en" if n.startswith("en") else "es"


def chat(messages, max_tokens=2048, temperature=0.2, timeout=300):
    url, model, key = cfg()
    body = json.dumps({"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}).encode()
    req = Request(url + "/chat/completions", data=body, method="POST",
                  headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {key}"} if key else {})})
    try:
        with urlopen(req, timeout=timeout) as r:
            out = json.loads(r.read())
    except Exception as e:
        detail = ""
        if hasattr(e, "read"):  # el cuerpo del error de la API dice más (key inválida, modelo…)
            try:
                detail = json.loads(e.read()).get("error", {}).get("message", "")
            except Exception:
                pass
        raise RuntimeError(f"la API del LLM falló: {e}{(' · ' + detail) if detail else ''}") from e
    return ((out.get("choices") or [{}])[0].get("message") or {}).get("content", "").strip()
