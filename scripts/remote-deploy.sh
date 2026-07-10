#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/exam-planner}"
PACKAGE_FILE="${1:?deployment package path is required}"
BACKUP_DIR="${BACKUP_DIR:-/opt/exam-planner-deploy-backups}"
STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_FILE="$BACKUP_DIR/code-pre-$STAMP.tgz"
STAGE_DIR="$(mktemp -d /opt/exam-planner-stage.XXXXXX)"
TEST_DATA_DIR="$(mktemp -d /tmp/exam-planner-smoke-data.XXXXXX)"
TEST_PID=""

cleanup() {
  if [[ -n "$TEST_PID" ]]; then kill "$TEST_PID" >/dev/null 2>&1 || true; fi
  [[ "$STAGE_DIR" == /opt/exam-planner-stage.* ]] && rm -r -- "$STAGE_DIR" 2>/dev/null || true
  [[ "$TEST_DATA_DIR" == /tmp/exam-planner-smoke-data.* ]] && rm -r -- "$TEST_DATA_DIR" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$APP_DIR" "$BACKUP_DIR"
tar -xzf "$PACKAGE_FILE" -C "$STAGE_DIR"
node --check "$STAGE_DIR/server/auth-static-server.mjs"

PORT=18080 DATA_DIR="$TEST_DATA_DIR" STATIC_ROOT="$STAGE_DIR/dist" APP_PASSWORD='deployment-smoke-only' COOKIE_SECRET='deployment-smoke-cookie-secret-000000000000' BREAK_GUARD_TOKEN='deployment-smoke-break-guard' SERVICE_ROLE=web node "$STAGE_DIR/server/auth-static-server.mjs" >"$TEST_DATA_DIR/server.log" 2>&1 &
TEST_PID="$!"
for _ in $(seq 1 20); do
  if node "$STAGE_DIR/scripts/production-smoke.mjs" http://127.0.0.1:18080 >/dev/null 2>&1; then break; fi
  sleep 1
done
CHECK_EMPTY_LOGIN=1 node "$STAGE_DIR/scripts/production-smoke.mjs" http://127.0.0.1:18080
SMOKE_APP_PASSWORD='deployment-smoke-only' SMOKE_BREAK_GUARD_TOKEN='deployment-smoke-break-guard' node "$STAGE_DIR/scripts/production-integration.mjs" http://127.0.0.1:18080
kill "$TEST_PID" >/dev/null 2>&1 || true
wait "$TEST_PID" 2>/dev/null || true
TEST_PID=""

backup_items=()
for item in dist server public package.json package-lock.json docs scripts infra README.md; do
  [[ -e "$APP_DIR/$item" ]] && backup_items+=("$item")
done
if [[ ${#backup_items[@]} -eq 0 ]]; then
  echo "deployment backup has no source files" >&2
  exit 1
fi
tar -czf "$BACKUP_FILE" -C "$APP_DIR" "${backup_items[@]}"
[[ -s "$BACKUP_FILE" ]] || { echo "deployment backup is empty" >&2; exit 1; }

if [[ -f "$APP_DIR/data/exam-planner.sqlite" ]]; then
  DB_BACKUP_DIR="$APP_DIR/data/backups"
  DB_BACKUP_FILE="$DB_BACKUP_DIR/exam-planner-pre-deploy-$STAMP.sqlite"
  mkdir -p "$DB_BACKUP_DIR"
  sqlite3 "$APP_DIR/data/exam-planner.sqlite" ".backup '$DB_BACKUP_FILE'"
  [[ "$(sqlite3 "$DB_BACKUP_FILE" 'PRAGMA integrity_check;')" == 'ok' ]] || {
    echo "pre-deployment database backup failed integrity validation" >&2
    exit 1
  }
fi

migrate_inline_secrets() {
  local fragment runtime_file
  fragment="$(systemctl show -p FragmentPath --value exam-planner)"
  runtime_file="/etc/exam-planner/runtime.env"
  [[ "$fragment" == /etc/systemd/system/* ]] || { echo "unexpected exam-planner unit path" >&2; return 1; }
  mkdir -p /etc/exam-planner /etc/systemd/system/exam-planner.service.d
  python3 - "$runtime_file" <<'PY'
import os
import shlex
import subprocess
import sys

target = sys.argv[1]
keys = {'APP_PASSWORD', 'COOKIE_SECRET', 'BREAK_GUARD_TOKEN', 'CLAWBOT_SECRET', 'STUDY_PET_API_TOKEN'}
values = {}
if os.path.exists(target):
    with open(target, encoding='utf-8') as stream:
        for raw_line in stream:
            line = raw_line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            if key in keys:
                parsed = shlex.split(value, posix=True)
                values[key] = parsed[0] if parsed else ''
raw = subprocess.check_output(['systemctl', 'show', '-p', 'Environment', '--value', 'exam-planner'], text=True)
for item in shlex.split(raw):
    key, separator, value = item.partition('=')
    if separator and key in keys and value:
        values[key] = value
missing = {'APP_PASSWORD', 'COOKIE_SECRET'} - values.keys()
if missing:
    raise SystemExit(f"missing required runtime credentials: {', '.join(sorted(missing))}")
temporary = target + '.tmp'
with open(temporary, 'w', encoding='utf-8', newline='\n') as stream:
    stream.write('# Root-only runtime credentials. Managed by the deployment script.\n')
    for key in sorted(values):
        stream.write(f'{key}={shlex.quote(values[key])}\n')
os.chmod(temporary, 0o600)
os.replace(temporary, target)
PY
  chmod 0600 "$runtime_file"
  sed -i '/^Environment=APP_PASSWORD=/d; /^Environment=COOKIE_SECRET=/d' "$fragment"
  rm -f /etc/systemd/system/exam-planner.service.d/break-guard.conf \
    /etc/systemd/system/exam-planner.service.d/clawbot.conf \
    /etc/systemd/system/exam-planner.service.d/vpet-token.conf
  printf '[Service]\nEnvironmentFile=-/etc/exam-planner/runtime.env\n' > /etc/systemd/system/exam-planner.service.d/10-runtime-secrets.conf
  systemctl daemon-reload
}

configure_service_roles() {
  mkdir -p /etc/systemd/system/exam-planner.service.d
  printf '[Service]\nEnvironment=NODE_ENV=production\nEnvironment=SERVICE_ROLE=web\nEnvironment=COOKIE_SECURE=1\nEnvironment=NODE_OPTIONS=--max-old-space-size=192\nUMask=0077\nNoNewPrivileges=true\nPrivateTmp=true\n' > /etc/systemd/system/exam-planner.service.d/20-runtime-role.conf
  systemctl daemon-reload
  systemctl cat exam-planner > /tmp/exam-planner-worker.service
  sed -i '0,/^Description=.*/s//Description=Exam Planner Background Worker/' /tmp/exam-planner-worker.service
  sed -i '0,/^After=.*/s//& exam-planner.service/' /tmp/exam-planner-worker.service
  printf '\n[Service]\nEnvironment=SERVICE_ROLE=worker\nEnvironment=COOKIE_SECURE=1\nEnvironment=NODE_OPTIONS=--max-old-space-size=192\nRestartSec=10\nOOMScoreAdjust=200\n' >> /tmp/exam-planner-worker.service
  install -m 0644 /tmp/exam-planner-worker.service /etc/systemd/system/exam-planner-worker.service
  rm -f /tmp/exam-planner-worker.service
  systemctl daemon-reload
  systemctl enable exam-planner-worker >/dev/null
}

deploy_and_verify() {
  migrate_inline_secrets || return 1
  systemctl stop exam-planner-worker 2>/dev/null || true
  systemctl stop exam-planner || return 1
  tar -xzf "$PACKAGE_FILE" -C "$APP_DIR" || return 1
  configure_service_roles || return 1
  systemctl start exam-planner || return 1
  for _ in $(seq 1 20); do
    if node "$APP_DIR/scripts/production-smoke.mjs" http://127.0.0.1:8080 >/dev/null 2>&1; then break; fi
    sleep 1
  done
  node "$APP_DIR/scripts/production-smoke.mjs" http://127.0.0.1:8080 >/dev/null || return 1
  systemctl start exam-planner-worker || return 1
  systemctl is-active --quiet exam-planner-worker || return 1
}

if ! deploy_and_verify; then
  systemctl stop exam-planner-worker 2>/dev/null || true
  systemctl disable exam-planner-worker >/dev/null 2>&1 || true
  rm -f /etc/systemd/system/exam-planner-worker.service /etc/systemd/system/exam-planner.service.d/20-runtime-role.conf
  systemctl daemon-reload
  tar -xzf "$BACKUP_FILE" -C "$APP_DIR"
  systemctl restart exam-planner
  node "$APP_DIR/scripts/production-smoke.mjs" http://127.0.0.1:8080 >/dev/null
  echo "deployment failed; previous release restored" >&2
  exit 1
fi

rm -f -- "$PACKAGE_FILE"
echo "deployment_ok backup=$BACKUP_FILE"
