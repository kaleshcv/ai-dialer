#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

ACCENTAI_DIR="${ACCENTAI_DIR:-${ACCENTAI_DSP_ROOT:-/home/administrator/work/AccentAI}}"
PID_FILE="${ACCENTAI_HOST_PID_FILE:-$ROOT_DIR/run/accentai-host.pid}"
PGID_FILE="${ACCENTAI_HOST_PGID_FILE:-${PID_FILE%.pid}.pgid}"
LOG_FILE="${ACCENTAI_HOST_LOG_FILE:-$ROOT_DIR/run/accentai-host.log}"
OUTPUT_NAME="${ACCENTAI_HOST_OUTPUT_NAME:-AccentAI_Output}"
SETUP_SCRIPT="${ACCENTAI_HOST_SETUP_SCRIPT:-$ROOT_DIR/scripts/setup-accentai-linux-audio.sh}"
PYTHON_BIN="${ACCENTAI_HOST_PYTHON_BIN:-}"

find_running_host_pids() {
  ps -eo pid=,args= | awk '
    /python/ && /src\/main\.py/ && $0 !~ /awk/ {
      print $1
    }
  '
}

find_running_dsp_pids() {
  ps -eo pid=,args= | awk '
    /node/ && /\/home\/administrator\/work\/AccentAI\/src\/index\.js/ && $0 !~ /awk/ {
      print $1
    }
  '
}

find_physical_pulse_source() {
  pactl list short sources 2>/dev/null | awk '
    $2 !~ /\.monitor$/ && $2 !~ /^AccentAI_/ {
      print $2
      exit
    }
  '
}

find_preferred_pulse_source() {
  local headset_source
  local external_source

  headset_source="$(pactl list short sources 2>/dev/null | awk '
    $2 !~ /\.monitor$/ && $2 !~ /^AccentAI_/ && ($2 ~ /^bluez_source\./ || $2 ~ /headset|handsfree|bluetooth/) {
      print $2
      exit
    }
  ')"
  if [[ -n "$headset_source" ]]; then
    printf '%s\n' "$headset_source"
    return
  fi

  external_source="$(pactl list short sources 2>/dev/null | awk '
    $2 !~ /\.monitor$/ && $2 !~ /^AccentAI_/ && $2 ~ /usb|headphone|headset|earphone|earbud/ {
      print $2
      exit
    }
  ')"
  if [[ -n "$external_source" ]]; then
    printf '%s\n' "$external_source"
    return
  fi

  find_physical_pulse_source
}

get_default_pulse_source() {
  pactl info 2>/dev/null | awk -F': ' '/^Default Source:/ { print $2; exit }'
}

read_pgid() {
  local pid="$1"
  ps -o pgid= -p "$pid" 2>/dev/null | tr -d '[:space:]'
}

is_pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

kill_process_group() {
  local pgid="$1"
  local signal_name="${2:-TERM}"
  [[ -z "$pgid" ]] && return
  kill "-${signal_name}" -- "-${pgid}" 2>/dev/null || true
}

wait_for_pid_exit() {
  local pid="$1"
  local attempts="${2:-20}"
  local delay_seconds="${3:-0.2}"
  local attempt
  for ((attempt = 0; attempt < attempts; attempt += 1)); do
    if ! is_pid_running "$pid"; then
      return 0
    fi
    sleep "$delay_seconds"
  done
  return 1
}

cleanup_runtime() {
  local host_pids dsp_pids pid pgid
  host_pids="$(find_running_host_pids || true)"
  dsp_pids="$(find_running_dsp_pids || true)"

  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    pgid="$(read_pgid "$pid")"
    kill_process_group "$pgid" TERM
    kill "$pid" 2>/dev/null || true
  done <<< "$host_pids"

  sleep 1

  host_pids="$(find_running_host_pids || true)"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    pgid="$(read_pgid "$pid")"
    kill_process_group "$pgid" KILL
    kill -9 "$pid" 2>/dev/null || true
  done <<< "$host_pids"

  dsp_pids="$(find_running_dsp_pids || true)"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill "$pid" 2>/dev/null || true
  done <<< "$dsp_pids"

  sleep 1

  dsp_pids="$(find_running_dsp_pids || true)"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill -9 "$pid" 2>/dev/null || true
  done <<< "$dsp_pids"

  rm -f "$PID_FILE" "$PGID_FILE"
}

mkdir -p "$(dirname "$PID_FILE")"
mkdir -p "$(dirname "$LOG_FILE")"

running_host_pids="$(find_running_host_pids || true)"
running_dsp_pids="$(find_running_dsp_pids || true)"

if [[ -n "$running_host_pids" || -n "$running_dsp_pids" ]]; then
  cleanup_runtime
fi

"$SETUP_SCRIPT"

if [[ -z "$PYTHON_BIN" ]]; then
  if [[ -x "$ACCENTAI_DIR/venv/bin/python" ]]; then
    PYTHON_BIN="$ACCENTAI_DIR/venv/bin/python"
  else
    PYTHON_BIN="$(command -v python3 || command -v python)"
  fi
fi

if [[ -z "$PYTHON_BIN" ]]; then
  echo "Could not find a Python interpreter for AccentAI host runtime." >&2
  exit 1
fi

export VOICEDSP_HTTP_ENABLED="${VOICEDSP_HTTP_ENABLED:-0}"
export VOICEDSP_VB_OUTPUT_NAME="$OUTPUT_NAME"
export PULSE_SINK="$OUTPUT_NAME"
DEFAULT_PULSE_SOURCE="$(get_default_pulse_source || true)"
PREFERRED_PULSE_SOURCE="$(find_preferred_pulse_source || true)"
if [[ -n "$PREFERRED_PULSE_SOURCE" ]]; then
  PULSE_SOURCE_NAME="${PULSE_SOURCE:-$PREFERRED_PULSE_SOURCE}"
elif [[ -n "$DEFAULT_PULSE_SOURCE" && "$DEFAULT_PULSE_SOURCE" != AccentAI_* && ! "$DEFAULT_PULSE_SOURCE" =~ \.monitor$ ]]; then
  PULSE_SOURCE_NAME="${PULSE_SOURCE:-$DEFAULT_PULSE_SOURCE}"
else
  PULSE_SOURCE_NAME="${PULSE_SOURCE:-$(find_physical_pulse_source || true)}"
fi
if [[ -n "$PULSE_SOURCE_NAME" ]]; then
  export PULSE_SOURCE="$PULSE_SOURCE_NAME"
fi
export PYTHONUNBUFFERED=1

setsid "$PYTHON_BIN" "$ACCENTAI_DIR/src/main.py" run </dev/null >>"$LOG_FILE" 2>&1 &
HOST_PID=$!
HOST_PGID="$(read_pgid "$HOST_PID")"

if ! wait_for_pid_exit "$HOST_PID" 5 0.2; then
  :
fi

RUNNING_HOST_PID="$(find_running_host_pids | head -n 1 || true)"
if [[ -n "$RUNNING_HOST_PID" ]]; then
  HOST_PID="$RUNNING_HOST_PID"
  HOST_PGID="$(read_pgid "$HOST_PID")"
fi

if ! is_pid_running "$HOST_PID"; then
  cleanup_runtime
  echo "AccentAI host failed to start. Check $LOG_FILE" >&2
  exit 1
fi

echo "$HOST_PID" > "$PID_FILE"
echo "$HOST_PGID" > "$PGID_FILE"
echo "AccentAI host started with PID $HOST_PID"
