#!/usr/bin/env bash
# Instalador de Estudio para Linux: compila la app y la añade al lanzador de aplicaciones.
#
#   ./install.sh               compila e instala
#   ./install.sh --uninstall   quita app, icono y entrada del menú (tus canciones no se tocan)
#
# Estudio sustituye a Letras, StemLab y Lyric Edits: lleva sus motores dentro (engine/). No usa sudo.
#   ./install.sh --gpu cuda|rocm|cpu   fuerza el torch de esa GPU (si no, se detecta)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BIN="$HOME/.local/bin/estudio"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
ICONS="${XDG_DATA_HOME:-$HOME/.local/share}/icons/hicolor"
DESKTOP="$APPS/estudio.desktop"
UNITS="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"

say() { printf '\033[1;33m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mError:\033[0m %s\n' "$*" >&2; exit 1; }

GPU=""
case "${1:-}" in
  --gpu) GPU="${2:-}"; [[ "$GPU" =~ ^(cuda|rocm|cpu)$ ]] || { echo "--gpu tiene que ser cuda, rocm o cpu" >&2; exit 1; } ;;
esac
if [[ "${1:-}" == --uninstall ]]; then
  systemctl --user disable --now estudio-prefetch.timer 2>/dev/null || true
  rm -f "$UNITS/estudio-prefetch.service" "$UNITS/estudio-prefetch.timer"
  rm -f "$BIN" "$DESKTOP" "$ICONS/scalable/apps/estudio.svg"
  command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true
  say "Estudio desinstalado. Letras, pistas y edits siguen en sus carpetas."
  exit 0
fi

for c in uv npm cargo ffmpeg node playerctl; do command -v "$c" >/dev/null || die "falta $c"; done

# --- motor: Python + IA (varios GB la primera vez; con la caché de uv, enlaces sin copiar) ---
if [[ -z "$GPU" ]]; then
  if command -v nvidia-smi >/dev/null && nvidia-smi -L >/dev/null 2>&1; then GPU=cuda
  elif [[ -e /dev/kfd ]] && grep -qs 0x1002 /sys/class/drm/card*/device/vendor; then GPU=rocm
  else GPU=cpu; fi
fi
say "Motor (GPU: $GPU)…"
(cd "$REPO/engine" && uv sync --frozen 2>/dev/null || uv sync)
if [[ "$GPU" != rocm ]]; then
  # pyproject trae torch ROCm: aquí se cambia por el de esta máquina (un `uv sync` posterior lo devolvería a ROCm)
  index="https://download.pytorch.org/whl/$([[ $GPU == cuda ]] && echo cu128 || echo cpu)"
  uv pip install --python "$REPO/engine/.venv/bin/python" --reinstall torch torchaudio torchvision --index-url "$index"
fi
for t in test_hub test_letras test_stemlab test_remote; do
  "$REPO/engine/.venv/bin/python" "$REPO/engine/$t.py" >/dev/null || die "el motor no pasa sus tests (engine/$t.py)"
done

say "Compilando la app (unos minutos la primera vez)…"
cd "$REPO/app"
if [[ -d node_modules ]]; then npm install --no-audit --no-fund; else npm ci --no-audit --no-fund; fi
npm run tauri build -- --no-bundle

# lanzador, icono y .desktop: solo si faltan (en una máquina con dotfiles ya son enlaces a ~/dotfiles y no se pisan)
if [[ ! -e "$BIN" && ! -L "$BIN" ]]; then
  mkdir -p "$(dirname "$BIN")"
  ln -s "$REPO/app/src-tauri/target/release/estudio" "$BIN"
fi
[[ -e "$ICONS/scalable/apps/estudio.svg" ]] || install -Dm644 "$REPO/app/src-tauri/icons/estudio.svg" "$ICONS/scalable/apps/estudio.svg"

exec_line="$BIN"
# WebKitGTK + driver NVIDIA: sin esto la ventana puede salir en blanco
command -v nvidia-smi >/dev/null && nvidia-smi -L >/dev/null 2>&1 && exec_line="env WEBKIT_DISABLE_DMABUF_RENDERER=1 $BIN"

mkdir -p "$APPS"
[[ -e "$DESKTOP" ]] || cat > "$DESKTOP" <<EOF2
[Desktop Entry]
Type=Application
Name=Estudio
GenericName=Letras, pistas, partituras y edits
Comment=Cada canción entera en un sitio: letra palabra a palabra, pistas, partitura, acordes y edits
Exec=$exec_line
Icon=estudio
Terminal=false
Categories=AudioVideo;Audio;Music;
Keywords=letras;lyrics;stems;pistas;partitura;acordes;karaoke;edits;tiktok;
StartupWMClass=estudio
EOF2
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" 2>/dev/null || true

# prefetch de las playlists cada 6 h (si no está ya, p. ej. como enlace a los dotfiles)
if [[ ! -e "$UNITS/estudio-prefetch.service" ]]; then
  mkdir -p "$UNITS"
  cat > "$UNITS/estudio-prefetch.service" <<EOF2
[Unit]
Description=Estudio: sincroniza con IA las canciones de tus playlists de Spotify

[Service]
Type=oneshot
ExecStart=$REPO/engine/.venv/bin/python $REPO/engine/hub.py prefetch
TimeoutStartSec=infinity
Nice=19
CPUSchedulingPolicy=idle
IOSchedulingClass=idle
EOF2
  printf '[Unit]\nDescription=Estudio: playlists cada 6 h\n\n[Timer]\nOnStartupSec=15min\nOnUnitInactiveSec=6h\n\n[Install]\nWantedBy=timers.target\n' > "$UNITS/estudio-prefetch.timer"
fi
systemctl --user daemon-reload 2>/dev/null && systemctl --user enable --now estudio-prefetch.timer 2>/dev/null || true

say "Listo. Búscala como «Estudio» en tu lanzador, o ejecuta: estudio"
echo "    No muevas la carpeta del repo: el motor (engine/hub.py) y el render (app/render.mjs) se ejecutan desde aquí."
[[ ":$PATH:" == *":$HOME/.local/bin:"* ]] || echo "    Nota: ~/.local/bin no está en tu PATH; desde el lanzador funciona igual."
