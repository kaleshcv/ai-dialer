#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="${ACCENTAI_HOST_PID_FILE:-$ROOT_DIR/run/accentai-host.pid}"
PGID_FILE="${ACCENTAI_HOST_PGID_FILE:-${PID_FILE%.pid}.pgid}"

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

HOST_PIDS=""
if [[ -f "$PID_FILE" ]]; then
  HOST_PIDS="$(cat "$PID_FILE" 2>/dev/null || true)"
fi

RUNTIME_PIDS="$(find_running_host_pids || true)"
if [[ -n "$RUNTIME_PIDS" ]]; then
  HOST_PIDS="${HOST_PIDS}"$'\n'"${RUNTIME_PIDS}"
fi

HOST_PIDS="$(printf '%s\n' "$HOST_PIDS" | awk 'NF && !seen[$1]++ { print $1 }')"
HOST_PGID="$(cat "$PGID_FILE" 2>/dev/null || true)"

if [[ -z "$HOST_PIDS" && -z "$HOST_PGID" ]]; then
  DSP_PIDS="$(find_running_dsp_pids || true)"
  if [[ -z "$DSP_PIDS" ]]; then
    echo "AccentAI host is not running."
    exit 0
  fi
fi

if [[ -n "$HOST_PGID" ]]; then
  kill_process_group "$HOST_PGID" TERM
fi

while IFS= read -r HOST_PID; do
  [[ -z "$HOST_PID" ]] && continue
  kill "$HOST_PID" 2>/dev/null || true
done <<< "$HOST_PIDS"

sleep 1

while IFS= read -r HOST_PID; do
  [[ -z "$HOST_PID" ]] && continue
  if is_pid_running "$HOST_PID"; then
    local_pgid="$(read_pgid "$HOST_PID")"
    kill_process_group "$local_pgid" KILL
    kill -9 "$HOST_PID" 2>/dev/null || true
  fi
done <<< "$HOST_PIDS"

DSP_PIDS="$(find_running_dsp_pids || true)"
while IFS= read -r DSP_PID; do
  [[ -z "$DSP_PID" ]] && continue
  kill "$DSP_PID" 2>/dev/null || true
done <<< "$DSP_PIDS"

sleep 1

DSP_PIDS="$(find_running_dsp_pids || true)"
while IFS= read -r DSP_PID; do
  [[ -z "$DSP_PID" ]] && continue
  kill -9 "$DSP_PID" 2>/dev/null || true
done <<< "$DSP_PIDS"

rm -f "$PID_FILE" "$PGID_FILE"
echo "AccentAI host stopped."
