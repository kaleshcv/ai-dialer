#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT_DIR/run"
API_DIR="$ROOT_DIR/apps/api"
WEB_DIR="$ROOT_DIR/apps/web"
ENV_FILE="$ROOT_DIR/.env"
ACCENTAI_DIR_DEFAULT="/home/administrator/work/AccentAI"

mkdir -p "$RUN_DIR"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

API_VENV_DIR="${API_VENV_DIR:-$API_DIR/venv}"
ACCENTAI_DIR="${ACCENTAI_DIR:-${ACCENTAI_DSP_ROOT:-$ACCENTAI_DIR_DEFAULT}}"
API_PID_FILE="${API_PID_FILE:-$RUN_DIR/api.pid}"
API_LOG_FILE="${API_LOG_FILE:-$RUN_DIR/api.log}"
WEB_PID_FILE="${WEB_PID_FILE:-$RUN_DIR/web.pid}"
WEB_LOG_FILE="${WEB_LOG_FILE:-$RUN_DIR/web.log}"

run_as_root() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
    return
  fi

  if command -v sudo >/dev/null 2>&1; then
    sudo "$@"
    return
  fi

  echo "This step requires root privileges: $*" >&2
  exit 1
}

cleanup_pid_file() {
  local pid_file="$1"
  if [[ ! -f "$pid_file" ]]; then
    return
  fi

  local existing_pid
  existing_pid="$(cat "$pid_file" 2>/dev/null || true)"
  if [[ -n "$existing_pid" ]] && kill -0 "$existing_pid" 2>/dev/null; then
    return
  fi

  rm -f "$pid_file"
}

start_background() {
  local name="$1"
  local pid_file="$2"
  local log_file="$3"
  shift 3

  cleanup_pid_file "$pid_file"
  if [[ -f "$pid_file" ]]; then
    local existing_pid
    existing_pid="$(cat "$pid_file" 2>/dev/null || true)"
    echo "$name already running with PID ${existing_pid}"
    return
  fi

  nohup "$@" >>"$log_file" 2>&1 &
  local pid=$!
  echo "$pid" > "$pid_file"
  echo "$name started with PID $pid"
}

ensure_command() {
  local command_name="$1"
  local package_name="$2"
  if command -v "$command_name" >/dev/null 2>&1; then
    return
  fi
  MISSING_APT_PACKAGES+=("$package_name")
}

ensure_host_postgres() {
  local host="${HOST_POSTGRES_HOST:-127.0.0.1}"
  local port="${HOST_POSTGRES_PORT:-5432}"

  if command -v pg_isready >/dev/null 2>&1; then
    if pg_isready -h "$host" -p "$port" >/dev/null 2>&1; then
      echo "Host Postgres is reachable at ${host}:${port}"
      return
    fi
  else
    if python3 - "$host" "$port" <<'PY'
import socket
import sys

host = sys.argv[1]
port = int(sys.argv[2])

try:
    with socket.create_connection((host, port), timeout=1):
        pass
except OSError:
    sys.exit(1)
sys.exit(0)
PY
    then
      echo "Host Postgres is reachable at ${host}:${port}"
      return
    fi
  fi

  echo "Host Postgres is not reachable at ${host}:${port}." >&2
  echo "Start your host Postgres service first, then rerun this script." >&2
  exit 1
}

ensure_apt_packages() {
  if ! command -v apt-get >/dev/null 2>&1; then
    return
  fi

  MISSING_APT_PACKAGES=()
  ensure_command python3 python3
  ensure_command pip3 python3-pip
  ensure_command node nodejs
  ensure_command npm npm
  ensure_command pactl pulseaudio-utils

  local package
  for package in python3-venv portaudio19-dev libsndfile1 build-essential gfortran python3-dev; do
    if ! dpkg -s "$package" >/dev/null 2>&1; then
      MISSING_APT_PACKAGES+=("$package")
    fi
  done

  if [[ "${#MISSING_APT_PACKAGES[@]}" -eq 0 ]]; then
    return
  fi

  echo "Installing missing apt packages: ${MISSING_APT_PACKAGES[*]}"
  run_as_root apt-get update
  run_as_root apt-get install -y "${MISSING_APT_PACKAGES[@]}"
}

ensure_docker() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi

  echo "Docker with 'docker compose' is required but not installed or not available in PATH." >&2
  echo "Install Docker manually, then rerun this script." >&2
  exit 1
}

ensure_python_venv() {
  local venv_dir="$1"
  local requirements_file="$2"
  local label="$3"

  if [[ ! -x "$venv_dir/bin/python" ]]; then
    echo "Creating $label virtualenv at $venv_dir"
    python3 -m venv "$venv_dir"
  fi

  echo "Installing $label Python dependencies..."
  (
    source "$venv_dir/bin/activate"
    python -m pip install --upgrade pip setuptools wheel
    pip install -r "$requirements_file"
  )
}

ensure_npm_dependencies() {
  local app_dir="$1"
  local label="$2"

  if [[ ! -d "$app_dir/node_modules" ]]; then
    echo "Installing $label npm dependencies..."
    (cd "$app_dir" && npm install)
    return
  fi

  echo "$label npm dependencies already installed."
}

require_path() {
  local path="$1"
  local message="$2"
  if [[ ! -e "$path" ]]; then
    echo "$message" >&2
    exit 1
  fi
}

ensure_apt_packages
ensure_host_postgres

require_path "$ACCENTAI_DIR" "AccentAI directory not found: $ACCENTAI_DIR"
require_path "$ACCENTAI_DIR/src/main.py" "AccentAI runtime entrypoint missing: $ACCENTAI_DIR/src/main.py"
if [[ -f "$ACCENTAI_DIR/assets/accentai.onnx" ]]; then
  echo "AccentAI bundle found: $ACCENTAI_DIR/assets/accentai.onnx"
else
  require_path "$ACCENTAI_DIR/assets/dsp.wasm" "AccentAI DSP wasm missing: $ACCENTAI_DIR/assets/dsp.wasm"
  require_path "$ACCENTAI_DIR/assets/accent.model" "AccentAI model missing: $ACCENTAI_DIR/assets/accent.model"
fi
require_path "$WEB_DIR/package.json" "Missing $WEB_DIR/package.json"
require_path "$API_DIR/requirements.txt" "Missing $API_DIR/requirements.txt"

ensure_python_venv "$API_VENV_DIR" "$API_DIR/requirements.txt" "API"
ensure_python_venv "$ACCENTAI_DIR/venv" "$ACCENTAI_DIR/requirements_linux.txt" "AccentAI"
ensure_npm_dependencies "$ACCENTAI_DIR" "AccentAI"
ensure_npm_dependencies "$WEB_DIR" "Web"

echo "Preparing AccentAI host audio..."
"$ROOT_DIR/scripts/setup-accentai-linux-audio.sh"
"$ROOT_DIR/scripts/start-accentai-host.sh"

echo "Running API migrations..."
(
  cd "$ROOT_DIR"
  source "$API_VENV_DIR/bin/activate"
  export PYTHONPATH="$API_DIR:${PYTHONPATH:-}"
  alembic -c "$ROOT_DIR/alembic.ini" upgrade head
)

echo "Starting API..."
start_background \
  "API" \
  "$API_PID_FILE" \
  "$API_LOG_FILE" \
  bash -lc "cd '$API_DIR' && source '$API_VENV_DIR/bin/activate' && exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload"

echo "Starting web app..."
start_background \
  "Web" \
  "$WEB_PID_FILE" \
  "$WEB_LOG_FILE" \
  bash -lc "cd '$WEB_DIR' && exec npm run dev -- --host 0.0.0.0"

cat <<EOF

Local stack started.

Web: http://localhost:3000
API: http://localhost:8000/health

Logs:
  API: $API_LOG_FILE
  Web: $WEB_LOG_FILE
  AccentAI host: $ROOT_DIR/run/accentai-host.log

PIDs:
  API: $API_PID_FILE
  Web: $WEB_PID_FILE
  AccentAI host: $ROOT_DIR/run/accentai-host.pid

EOF
