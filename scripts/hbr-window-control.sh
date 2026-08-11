#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-status}"
WINDOW_START="${HBR_WINDOW_START:-0305}"
WINDOW_END="${HBR_WINDOW_END:-0645}"
PRESSURE_CHECK="${PRESSURE_CHECK:-/usr/local/sbin/exam-planner-pressure-check}"
APP_READY_URL="${APP_READY_URL:-http://127.0.0.1:8080/ready}"
STATUS_FILE="${HBR_STATUS_FILE:-/opt/exam-planner/data/hbr-status.json}"
STARTUP_SETTLE_SECONDS="${HBR_STARTUP_SETTLE_SECONDS:-20}"
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

write_status() {
  local action="$1" result="$2" detail="$3" temporary
  mkdir -p "$(dirname "$STATUS_FILE")"
  temporary="${STATUS_FILE}.tmp.$$"
  umask 022
  printf '{"action":"%s","result":"%s","checkedAt":"%s","detail":"%s"}\n' \
    "$action" "$result" "$(date --iso-8601=seconds)" "$detail" > "$temporary"
  chmod 0644 "$temporary"
  mv -f "$temporary" "$STATUS_FILE"
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
    if ! curl --max-time 10 -fsS "$APP_READY_URL" >/dev/null; then
      write_status open failed app-not-ready
      echo "HBR start skipped because the application is not ready" >&2
      exit 1
    fi
    if ! "$PRESSURE_CHECK" hbr; then
      write_status open failed pressure-before-start
      exit 1
    fi
    if ! systemctl start hbrclientupdater.service || ! systemctl start hbrclient.service; then
      stop_hbr
      write_status open failed service-start-failed
      exit 1
    fi
    sleep "$STARTUP_SETTLE_SECONDS"
    if ! systemctl is-active --quiet hbrclientupdater.service || ! systemctl is-active --quiet hbrclient.service; then
      stop_hbr
      write_status open failed service-not-active
      echo "HBR services did not remain active after startup" >&2
      exit 1
    fi
    if ! curl --max-time 10 -fsS "$APP_READY_URL" >/dev/null; then
      stop_hbr
      write_status open failed app-not-ready-after-start
      exit 1
    fi
    if ! "$PRESSURE_CHECK" hbr; then
      stop_hbr
      write_status open failed pressure-after-start
      echo "HBR stopped because system pressure exceeded the safety budget" >&2
      exit 1
    fi
    write_status open success window-opened
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
    if ! inside_window; then
      stop_hbr
      write_status guard failed outside-window
      echo "HBR guard stopped the backup services outside their safety budget" >&2
      exit 1
    fi
    if ! curl --max-time 10 -fsS "$APP_READY_URL" >/dev/null || ! "$PRESSURE_CHECK" hbr; then
      stop_hbr
      write_status guard failed health-or-pressure
      echo "HBR guard stopped the backup services outside their safety budget" >&2
      exit 1
    fi
    write_status guard success safety-budget-ok
    echo "HBR guard check passed"
    ;;
  *)
    echo "usage: $0 open|close|guard|status" >&2
    exit 64
    ;;
esac
