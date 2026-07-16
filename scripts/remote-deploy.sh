#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/exam-planner}"
APP_NODE_BIN="${APP_NODE_BIN:-/opt/node-v22.22.3-linux-x64/bin/node}"
PACKAGE_FILE="${1:?deployment package path is required}"
BACKUP_DIR="${BACKUP_DIR:-/opt/exam-planner-deploy-backups}"
RELEASES_DIR="$APP_DIR/releases"
CURRENT_LINK="$APP_DIR/current"
STAMP="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="$RELEASES_DIR/$STAMP"
UNIT_BACKUP_DIR="$BACKUP_DIR/units-pre-$STAMP"
STAGE_DIR="$(mktemp -d /opt/exam-planner-stage.XXXXXX)"
TEST_DATA_DIR="$(mktemp -d /tmp/exam-planner-smoke-data.XXXXXX)"
TEST_PID=""
HELPER_PID=""
PREVIOUS_RELEASE=""

cleanup() {
  if [[ -n "$TEST_PID" ]]; then kill "$TEST_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "$HELPER_PID" ]]; then kill "$HELPER_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "$STAGE_DIR" && "$STAGE_DIR" == /opt/exam-planner-stage.* ]]; then rm -r -- "$STAGE_DIR" 2>/dev/null || true; fi
  [[ "$TEST_DATA_DIR" == /tmp/exam-planner-smoke-data.* ]] && rm -r -- "$TEST_DATA_DIR" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$APP_DIR" "$RELEASES_DIR" "$BACKUP_DIR" "$UNIT_BACKUP_DIR"
for unit_item in /etc/systemd/system/exam-planner.service /etc/systemd/system/exam-planner.service.d /etc/systemd/system/exam-planner-worker.service /etc/systemd/system/exam-planner-privileged.service; do
  [[ -e "$unit_item" ]] && cp -a "$unit_item" "$UNIT_BACKUP_DIR/"
done

tar -xzf "$PACKAGE_FILE" -C "$STAGE_DIR"
[[ -x "$APP_NODE_BIN" ]] || { echo "Node 22 runtime is missing: $APP_NODE_BIN" >&2; exit 1; }
[[ -f "$STAGE_DIR/node_modules/undici/index.js" ]] || { echo "bundled undici runtime dependency is missing" >&2; exit 1; }
"$APP_NODE_BIN" --check "$STAGE_DIR/server/auth-static-server.mjs"
"$APP_NODE_BIN" --check "$STAGE_DIR/server/web.mjs"
"$APP_NODE_BIN" --check "$STAGE_DIR/server/worker.mjs"
"$APP_NODE_BIN" --check "$STAGE_DIR/server/privileged-helper.mjs"

PRIVILEGED_HELPER_SOCKET="$TEST_DATA_DIR/privileged.sock" "$APP_NODE_BIN" "$STAGE_DIR/server/privileged-helper.mjs" >"$TEST_DATA_DIR/helper.log" 2>&1 &
HELPER_PID="$!"
for _ in $(seq 1 20); do [[ -S "$TEST_DATA_DIR/privileged.sock" ]] && break; sleep 0.2; done
[[ -S "$TEST_DATA_DIR/privileged.sock" ]] || { cat "$TEST_DATA_DIR/helper.log" >&2; exit 1; }
curl --unix-socket "$TEST_DATA_DIR/privileged.sock" -fsS http://localhost/health >/dev/null

PORT=18080 DATA_DIR="$TEST_DATA_DIR" STATIC_ROOT="$STAGE_DIR/dist" PRIVILEGED_HELPER_SOCKET="$TEST_DATA_DIR/privileged.sock" APP_PASSWORD='deployment-smoke-only' COOKIE_SECRET='deployment-smoke-cookie-secret-000000000000' SETTINGS_ENCRYPTION_KEY='deployment-smoke-settings-key-000000000000' BREAK_GUARD_TOKEN='deployment-smoke-break-guard' "$APP_NODE_BIN" "$STAGE_DIR/server/web.mjs" >"$TEST_DATA_DIR/server.log" 2>&1 &
TEST_PID="$!"
for _ in $(seq 1 20); do
  if "$APP_NODE_BIN" "$STAGE_DIR/scripts/production-smoke.mjs" http://127.0.0.1:18080 >/dev/null 2>&1; then break; fi
  sleep 1
done
CHECK_EMPTY_LOGIN=1 "$APP_NODE_BIN" "$STAGE_DIR/scripts/production-smoke.mjs" http://127.0.0.1:18080
SMOKE_APP_PASSWORD='deployment-smoke-only' SMOKE_BREAK_GUARD_TOKEN='deployment-smoke-break-guard' "$APP_NODE_BIN" "$STAGE_DIR/scripts/production-integration.mjs" http://127.0.0.1:18080
kill "$TEST_PID" >/dev/null 2>&1 || true
wait "$TEST_PID" 2>/dev/null || true
TEST_PID=""
kill "$HELPER_PID" >/dev/null 2>&1 || true
wait "$HELPER_PID" 2>/dev/null || true
HELPER_PID=""

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
  mkdir -p /etc/exam-planner
  python3 - "$runtime_file" <<'PY'
import os
import shlex
import subprocess
import sys

target = sys.argv[1]
keys = {
    'APP_PASSWORD', 'COOKIE_SECRET', 'SETTINGS_ENCRYPTION_KEY',
    'BREAK_GUARD_TOKEN', 'CLAWBOT_SECRET', 'STUDY_PET_API_TOKEN',
    'BACKUP_KEEP_DAILY', 'BACKUP_KEEP_WEEKLY', 'BACKUP_KEEP_DEPLOY',
    'BACKUP_KEEP_MANUAL', 'BACKUP_KEEP_MIGRATION', 'BACKUP_KEEP_OTHER',
    'BACKGROUND_TASK_CONCURRENCY', 'BACKGROUND_MIN_AVAILABLE_MEMORY_BYTES',
    'BACKGROUND_MAX_LOAD_PER_CPU', 'ERROR_THEME_TIME', 'MAINTENANCE_TIME',
}
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
missing = {'APP_PASSWORD', 'COOKIE_SECRET', 'SETTINGS_ENCRYPTION_KEY'} - values.keys()
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
  chown root:examplanner "$runtime_file"
  chmod 0640 "$runtime_file"
}

ensure_runtime_user() {
  getent group examplanner >/dev/null || groupadd --system examplanner
  id -u examplanner >/dev/null 2>&1 || useradd --system --gid examplanner --home-dir "$APP_DIR" --shell /usr/sbin/nologin examplanner
  install -d -o examplanner -g examplanner -m 0700 "$APP_DIR/data" "$APP_DIR/data/backups"
  if [[ -f /etc/exam-planner/telegram.env && ! -f "$APP_DIR/data/telegram.env" ]]; then
    cp /etc/exam-planner/telegram.env "$APP_DIR/data/telegram.env"
  fi
  [[ -f "$APP_DIR/data/telegram.env" ]] && chown examplanner:examplanner "$APP_DIR/data/telegram.env" && chmod 0600 "$APP_DIR/data/telegram.env" || true
  chown -R examplanner:examplanner "$APP_DIR/data"
  find "$APP_DIR/data" -type d -exec chmod 0700 {} +
  find "$APP_DIR/data" -type f -exec chmod 0600 {} +
}

prepare_previous_release() {
  local legacy_release item
  if [[ -L "$CURRENT_LINK" ]]; then
    PREVIOUS_RELEASE="$(readlink -f -- "$CURRENT_LINK")"
    [[ "$PREVIOUS_RELEASE" == "$RELEASES_DIR"/* && -d "$PREVIOUS_RELEASE" ]] || {
      echo "current release symlink points outside the release root" >&2
      return 1
    }
    return
  fi
  [[ ! -e "$CURRENT_LINK" ]] || { echo "$CURRENT_LINK must be a symlink" >&2; return 1; }
  legacy_release="$RELEASES_DIR/legacy-$STAMP"
  mkdir -p "$legacy_release"
  for item in dist server public package.json package-lock.json docs scripts infra README.md node_modules; do
    [[ -e "$APP_DIR/$item" ]] && cp -a "$APP_DIR/$item" "$legacy_release/"
  done
  [[ -f "$legacy_release/server/web.mjs" ]] || { echo "legacy release could not be prepared" >&2; return 1; }
  PREVIOUS_RELEASE="$legacy_release"
}

activate_release() {
  local release="$1" temporary_link="$APP_DIR/.current-$STAMP"
  [[ "$release" == "$RELEASES_DIR"/* && -d "$release" ]] || { echo "invalid release path: $release" >&2; return 1; }
  ln -s -- "$release" "$temporary_link"
  mv -Tf -- "$temporary_link" "$CURRENT_LINK"
}

configure_service_roles() {
  local release="$1"
  install -m 0644 "$release/infra/systemd/exam-planner.service" /etc/systemd/system/exam-planner.service
  install -m 0644 "$release/infra/systemd/exam-planner-worker.service" /etc/systemd/system/exam-planner-worker.service
  install -m 0644 "$release/infra/systemd/exam-planner-privileged.service" /etc/systemd/system/exam-planner-privileged.service
  rm -rf /etc/systemd/system/exam-planner.service.d
  systemctl daemon-reload
  systemctl enable exam-planner exam-planner-worker exam-planner-privileged >/dev/null
}

start_and_verify() {
  systemctl start exam-planner-privileged || return 1
  for _ in $(seq 1 20); do [[ -S /run/exam-planner/privileged.sock ]] && break; sleep 0.2; done
  [[ -S /run/exam-planner/privileged.sock ]] || return 1
  systemctl start exam-planner || return 1
  for _ in $(seq 1 20); do
    if "$APP_NODE_BIN" "$CURRENT_LINK/scripts/production-smoke.mjs" http://127.0.0.1:8080 >/dev/null 2>&1; then break; fi
    sleep 1
  done
  "$APP_NODE_BIN" "$CURRENT_LINK/scripts/production-smoke.mjs" http://127.0.0.1:8080 >/dev/null || return 1
  systemctl start exam-planner-worker || return 1
  systemctl is-active --quiet exam-planner-worker || return 1
}

rollback_release() {
  systemctl stop exam-planner-worker exam-planner exam-planner-privileged 2>/dev/null || true
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    activate_release "$PREVIOUS_RELEASE"
    configure_service_roles "$PREVIOUS_RELEASE"
    start_and_verify
    return
  fi
  rm -rf /etc/systemd/system/exam-planner.service /etc/systemd/system/exam-planner.service.d /etc/systemd/system/exam-planner-worker.service /etc/systemd/system/exam-planner-privileged.service
  cp -a "$UNIT_BACKUP_DIR"/* /etc/systemd/system/ 2>/dev/null || true
  systemctl daemon-reload
  systemctl restart exam-planner-privileged exam-planner exam-planner-worker
}

prune_releases() {
  local keep_count="${DEPLOY_RELEASE_KEEP:-5}" current item resolved index=0
  current="$(readlink -f -- "$CURRENT_LINK")"
  while IFS= read -r item; do
    resolved="$(readlink -f -- "$item")"
    [[ "$resolved" == "$current" ]] && continue
    index=$((index + 1))
    if (( index >= keep_count )); then
      case "$resolved" in "$RELEASES_DIR"/*) rm -rf -- "$resolved" ;; *) echo "refusing release path $resolved" >&2; return 1 ;; esac
    fi
  done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
}

prune_deploy_backups() {
  local keep_count="${DEPLOY_UNIT_BACKUP_KEEP:-5}" item resolved
  mapfile -t unit_backups < <(find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -name 'units-pre-*' -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
  for item in "${unit_backups[@]:$keep_count}"; do
    resolved="$(readlink -f -- "$item")"
    case "$resolved" in "$BACKUP_DIR"/units-pre-*) rm -rf -- "$resolved" ;; *) echo "refusing unit backup path $resolved" >&2; return 1 ;; esac
  done
  find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type f -name 'code-pre-*.tgz' -delete
}

ensure_runtime_user
migrate_inline_secrets
prepare_previous_release
mv -- "$STAGE_DIR" "$RELEASE_DIR"
STAGE_DIR=""
chown -R root:root "$RELEASE_DIR"
find "$RELEASE_DIR" -type d -exec chmod 0755 {} +

systemctl stop exam-planner-worker 2>/dev/null || true
systemctl stop exam-planner || true
systemctl stop exam-planner-privileged 2>/dev/null || true
activate_release "$RELEASE_DIR"
configure_service_roles "$RELEASE_DIR"

if ! start_and_verify; then
  rollback_release
  echo "deployment failed; previous release restored" >&2
  exit 1
fi

prune_releases
prune_deploy_backups
rm -f -- "$PACKAGE_FILE"
echo "deployment_ok release=$RELEASE_DIR previous=$PREVIOUS_RELEASE"
