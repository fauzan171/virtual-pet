#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
export MPLCONFIGDIR="$ROOT_DIR/.cache/matplotlib"
export XDG_CACHE_HOME="$ROOT_DIR/.cache"
mkdir -p "$ROOT_DIR/.cache/matplotlib" "$ROOT_DIR/.cache/fontconfig"

if [ ! -x "$ROOT_DIR/.venv/bin/python" ]; then
  echo "error: virtual environment not found at $ROOT_DIR/.venv"
  echo "create it with: python3.11 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
  exit 1
fi

cd "$ROOT_DIR"
exec "$ROOT_DIR/.venv/bin/python" -m src.app.main --debug "$@"
