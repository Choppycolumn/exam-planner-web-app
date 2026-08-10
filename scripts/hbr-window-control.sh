#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-status}"
WINDOW_START="${HBR_WINDOW_START:-0305}"
WINDOW_END="${HBR_WINDOW_END:-0645}"
PRESSURE_CHECK="${PRESSURE_CHECK:-/usr/local/sbin/exam-planner-pressure-check}"
APP_READY_URL="${APP_READY_URL:-http://127.0.0.1:8080/ready}"
UNITS=(hbrclientupdater.service hbrclient.service)

if [[ "${HBR_LOCK_HELD:-0}" != "1" ]]; then
  exec 9>/run/lock/exam-planner-heavy-io.lock
  flock -w 30 9 || { echo "another heavy I/O operation is active" >&2; exit 1; }
fi

inside_window() {
  local current
  current="$(date +%H%M)"
  (( 10#$current >= 10#$WINDOW_START && 10#$current < 10#$WINDOW_END ))
}

stop_hbr() {
  systemctl stop "${UNITS[@]}" 2>/dev/null || true
  # The vendor updater re-enables both units after it starts. Keep the timer
  # as the only authority allowed to open the backup window.
  systemctl disable "${UNITS[@]}" >/dev/null 2>&1 || true
}

case "$ACTION" in
  open)
    systemctl disable "${UNITS[@]}" >/dev/null 2>&1 || true
    if [[ "${HBR_FORCE_OPEN:-0}" != "1" ]] && ! inside_window; then
      echo "HBR start skipped outside the maintenance window"
      exit 0
    fi
    curl --max-time 10 -fsS "$APP_READY_URL" >/dev/null
    "$PRESSURE_CHECK" hbr
    systemctl start hbrclientupdater.service
    systemctl start hbrclient.service
    sleep 5
    if ! "$PRESSURE_CHECK" hbr; then
      stop_hbr
      echo "HBR stopped because system pressure exceeded the safety budget" >&2
      exit 1
    fi
    echo "HBR maintenance window opened"
    ;;
  close)
    stop_hbr
    echo "HBR maintenance window closed"
    ;;
  status)
    for unit in "${UNITS[@]}"; do
      printf '%s=%s\n' "$unit" "$(systemctl is-active "$unit" 2>/dev/null || true)"
    done
    ;;
  guard)
    systemctl disable "${UNITS[@]}" >/dev/null 2>&1 || true
    if ! systemctl is-active --quiet hbrclient.service && ! systemctl is-active --quiet hbrclientupdater.service; then
      exit 0
    fi
    if ! inside_window || ! "$PRESSURE_CHECK" hbr; then
      stop_hbr
      echo "HBR guard stopped the backup services outside their safety budget" >&2
      exit 1
    fi
    echo "HBR guard check passed"
    ;;
  *)
    echo "usage: $0 open|close|guard|status" >&2
    exit 64
    ;;
esac
