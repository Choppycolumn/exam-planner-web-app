#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/exam-planner}"
APP_NODE_BIN="${APP_NODE_BIN:-/opt/node-v22.22.3-linux-x64/bin/node}"
RELEASES_DIR="$APP_DIR/releases"
CURRENT_LINK="$APP_DIR/current"
SHARED_ROOT="$APP_DIR/shared"
STATIC_ASSET_RETENTION_DAYS="${STATIC_ASSET_RETENTION_DAYS:-14}"
requested="${1:-previous}"
original="$(readlink -f -- "$CURRENT_LINK")"

if [[ "${EXAM_PLANNER_LOCK_HELD:-0}" != 1 ]]; then
  exec 9>/run/lock/exam-planner-deploy.lock
  flock -w 30 9 || { echo "another deployment or recovery action is active" >&2; exit 1; }
fi

if [[ "$requested" == previous ]]; then
  target="$(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -name '[0-9]*' -printf '%f %p\n' | sort -r | awk -v current="$original" '$2 != current { print $2; exit }')"
  if [[ -z "$target" ]]; then
    target="$(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -name 'legacy-*' -printf '%T@ %p\n' | sort -nr | awk -v current="$original" '$2 != current { print $2; exit }')"
  fi
else
  target="$(readlink -f -- "$RELEASES_DIR/$requested")"
fi

validate_release() {
  local release="$1"
  [[ -n "$release" && "$release" == "$RELEASES_DIR"/* && -d "$release" && -f "$release/server/web.mjs" ]]
}

activate_release() {
  local release="$1" temporary="$APP_DIR/.rollback-current"
  validate_release "$release" || return 1
  rm -f -- "$temporary"
  ln -s -- "$release" "$temporary"
  mv -Tf -- "$temporary" "$CURRENT_LINK"
  install -m 0644 "$release/infra/systemd/exam-planner.service" /etc/systemd/system/exam-planner.service
  install -m 0644 "$release/infra/systemd/exam-planner-worker.service" /etc/systemd/system/exam-planner-worker.service
  install -m 0644 "$release/infra/systemd/exam-planner-privileged.service" /etc/systemd/system/exam-planner-privileged.service
  systemctl daemon-reload
}

publish_release_assets() {
  local release="$1" publisher="$original/scripts/publish-release-assets.sh"
  [[ -f "$publisher" ]] || publisher="$release/scripts/publish-release-assets.sh"
  [[ -f "$publisher" ]] || return 0
  APP_DIR="$APP_DIR" ASSET_SHARED_ROOT="$SHARED_ROOT" STATIC_ASSET_RETENTION_DAYS="$STATIC_ASSET_RETENTION_DAYS" \
    bash "$publisher" "$release" >/dev/null
}

verify_nginx_assets() {
  local asset downloaded
  downloaded="$(mktemp /tmp/exam-planner-rollback-asset.XXXXXX)"
  asset="$(grep -o '/assets/[^"[:space:]]*\.js' "$CURRENT_LINK/dist/index.html" | head -n 1)"
  [[ "$asset" == /assets/*.js ]] || { rm -f "$downloaded"; return 1; }
  curl --max-time 10 -fsS -H 'Host: 127.0.0.1' "http://127.0.0.1:8088$asset" -o "$downloaded" || { rm -f "$downloaded"; return 1; }
  if cmp -s "$CURRENT_LINK/dist$asset" "$downloaded"; then result=0; else result=1; fi
  rm -f "$downloaded"
  return "$result"
}

start_and_verify() {
  systemctl start exam-planner-privileged
  for _ in $(seq 1 20); do [[ -S /run/exam-planner/privileged.sock ]] && break; sleep 0.2; done
  [[ -S /run/exam-planner/privileged.sock ]] || return 1
  systemctl start exam-planner
  for _ in $(seq 1 30); do
    if "$APP_NODE_BIN" "$CURRENT_LINK/scripts/production-smoke.mjs" http://127.0.0.1:8080 >/dev/null 2>&1; then
      systemctl start exam-planner-worker
      systemctl is-active --quiet exam-planner-worker
      verify_nginx_assets
      [[ ! -f /usr/local/lib/exam-planner/runtime-watchdog.mjs ]] || "$APP_NODE_BIN" /usr/local/lib/exam-planner/runtime-watchdog.mjs --check-only >/dev/null
      return
    fi
    sleep 1
  done
  return 1
}

validate_release "$target" || {
  echo "rollback target is invalid" >&2
  exit 1
}

publish_release_assets "$target"
systemctl stop exam-planner-worker exam-planner exam-planner-privileged
activate_release "$target"
if ! start_and_verify; then
  systemctl stop exam-planner-worker exam-planner exam-planner-privileged 2>/dev/null || true
  activate_release "$original"
  start_and_verify
  echo "rollback failed; original release restored" >&2
  exit 1
fi

echo "rollback_ok release=$target previous=$original"
