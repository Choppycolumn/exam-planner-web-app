#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/exam-planner}"
APP_NODE_BIN="${APP_NODE_BIN:-/opt/node-v22.22.3-linux-x64/bin/node}"
RELEASES_DIR="$APP_DIR/releases"
CURRENT_LINK="$APP_DIR/current"
requested="${1:-previous}"
current="$(readlink -f -- "$CURRENT_LINK")"

if [[ "$requested" == previous ]]; then
  target="$(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | awk -v current="$current" '$2 != current { print $2; exit }')"
else
  target="$(readlink -f -- "$RELEASES_DIR/$requested")"
fi

[[ -n "$target" && "$target" == "$RELEASES_DIR"/* && -d "$target" ]] || {
  echo "rollback target is invalid" >&2
  exit 1
}

temporary="$APP_DIR/.rollback-current"
ln -s -- "$target" "$temporary"
systemctl stop exam-planner-worker exam-planner exam-planner-privileged
mv -Tf -- "$temporary" "$CURRENT_LINK"
install -m 0644 "$target/infra/systemd/exam-planner.service" /etc/systemd/system/exam-planner.service
install -m 0644 "$target/infra/systemd/exam-planner-worker.service" /etc/systemd/system/exam-planner-worker.service
install -m 0644 "$target/infra/systemd/exam-planner-privileged.service" /etc/systemd/system/exam-planner-privileged.service
systemctl daemon-reload
systemctl start exam-planner-privileged exam-planner exam-planner-worker
"$APP_NODE_BIN" "$CURRENT_LINK/scripts/production-smoke.mjs" http://127.0.0.1:8080
echo "rollback_ok release=$target"
