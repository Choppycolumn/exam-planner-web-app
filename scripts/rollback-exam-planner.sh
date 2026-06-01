#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/exam-planner}"
SERVICE="${SERVICE:-exam-planner}"

cd "$APP_DIR"

if [[ ! -d dist.prev ]]; then
  echo "dist.prev not found; cannot roll back frontend" >&2
  exit 1
fi

timestamp="$(date +%Y%m%d-%H%M%S)"
mv dist "dist.failed-$timestamp"
mv dist.prev dist

latest_server_backup="$(ls -1t server/auth-static-server.mjs.predeploy-* 2>/dev/null | head -n 1 || true)"
if [[ -n "$latest_server_backup" ]]; then
  cp "$latest_server_backup" server/auth-static-server.mjs
fi

systemctl restart "$SERVICE"
curl -fsS http://127.0.0.1:8080/health
systemctl --no-pager --full status "$SERVICE"
