#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/exam-planner}"
APP_NODE_BIN="${APP_NODE_BIN:-/opt/node-v22.22.3-linux-x64/bin/node}"
NGINX_COMMON_CONFIG="${NGINX_COMMON_CONFIG:-/etc/nginx/snippets/exam-planner-common.conf}"
PACKAGE_FILE="${1:?deployment package path is required}"
BACKUP_DIR="${BACKUP_DIR:-/opt/exam-planner-deploy-backups}"
RELEASES_DIR="$APP_DIR/releases"
CURRENT_LINK="$APP_DIR/current"
SHARED_ROOT="$APP_DIR/shared"
WATCHDOG_STATE_DIR="$APP_DIR/data/runtime-watchdog"
STATIC_ASSET_RETENTION_DAYS="${STATIC_ASSET_RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d%H%M%S)"
RELEASE_DIR="$RELEASES_DIR/$STAMP"
UNIT_BACKUP_DIR="$BACKUP_DIR/units-pre-$STAMP"
STAGE_DIR="$(mktemp -d /opt/exam-planner-stage.XXXXXX)"
TEST_DATA_DIR="$(mktemp -d /tmp/exam-planner-smoke-data.XXXXXX)"
TEST_PID=""
HELPER_PID=""
PREVIOUS_RELEASE=""

exec 9>/run/lock/exam-planner-deploy.lock
flock -w 30 9 || { echo "another deployment or recovery action is active" >&2; exit 1; }

cleanup() {
  if [[ -n "$TEST_PID" ]]; then kill "$TEST_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "$HELPER_PID" ]]; then kill "$HELPER_PID" >/dev/null 2>&1 || true; fi
  if [[ -n "$STAGE_DIR" && "$STAGE_DIR" == /opt/exam-planner-stage.* ]]; then rm -r -- "$STAGE_DIR" 2>/dev/null || true; fi
  [[ "$TEST_DATA_DIR" == /tmp/exam-planner-smoke-data.* ]] && rm -r -- "$TEST_DATA_DIR" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "$APP_DIR" "$RELEASES_DIR" "$SHARED_ROOT/assets" "$BACKUP_DIR" "$UNIT_BACKUP_DIR"
for unit_item in /etc/systemd/system/exam-planner.service /etc/systemd/system/exam-planner.service.d /etc/systemd/system/exam-planner-worker.service /etc/systemd/system/exam-planner-privileged.service /etc/systemd/system/exam-planner-health-watchdog.service /etc/systemd/system/exam-planner-health-watchdog.timer /etc/systemd/system/hbrclient.service.d /etc/systemd/system/hbrclientupdater.service.d; do
  [[ -e "$unit_item" ]] && cp -a "$unit_item" "$UNIT_BACKUP_DIR/"
done

tar -xzf "$PACKAGE_FILE" -C "$STAGE_DIR"
[[ -x "$APP_NODE_BIN" ]] || { echo "Node 22 runtime is missing: $APP_NODE_BIN" >&2; exit 1; }
[[ -f "$STAGE_DIR/node_modules/undici/index.js" ]] || { echo "bundled undici runtime dependency is missing" >&2; exit 1; }
"$APP_NODE_BIN" --check "$STAGE_DIR/server/auth-static-server.mjs"
"$APP_NODE_BIN" --check "$STAGE_DIR/server/web.mjs"
"$APP_NODE_BIN" --check "$STAGE_DIR/server/worker.mjs"
"$APP_NODE_BIN" --check "$STAGE_DIR/server/privileged-helper.mjs"
"$APP_NODE_BIN" --check "$STAGE_DIR/server/infrastructure/runtime-watchdog.mjs"
bash -n "$STAGE_DIR/scripts/publish-release-assets.sh"
bash -n "$STAGE_DIR/scripts/rollback-release.sh"

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
    'STATIC_ASSET_RETENTION_DAYS',
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
if values.get('ERROR_THEME_TIME') in {None, '03:10'}:
    values['ERROR_THEME_TIME'] = '03:30'
if values.get('MAINTENANCE_TIME') in {None, '04:20'}:
    values['MAINTENANCE_TIME'] = '05:20'
values.setdefault('STATIC_ASSET_RETENTION_DAYS', '14')
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
  install -d -o root -g examplanner -m 0750 "$WATCHDOG_STATE_DIR"
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
  if [[ -f "$release/infra/systemd/exam-planner-health-watchdog.service" && -f "$release/server/infrastructure/runtime-watchdog.mjs" ]]; then
    install -d -m 0755 /usr/local/lib/exam-planner
    install -m 0644 "$release/server/infrastructure/runtime-watchdog.mjs" /usr/local/lib/exam-planner/runtime-watchdog.mjs
    install -m 0644 "$release/infra/systemd/exam-planner-health-watchdog.service" /etc/systemd/system/exam-planner-health-watchdog.service
    install -m 0644 "$release/infra/systemd/exam-planner-health-watchdog.timer" /etc/systemd/system/exam-planner-health-watchdog.timer
  fi
  install_timer_override() {
    local source_file="$1" timer_unit="$2" target_dir="/etc/systemd/system/$2.d"
    [[ -f "$source_file" ]] || return
    systemctl cat "$timer_unit" >/dev/null 2>&1 || return
    install -d -m 0755 "$target_dir"
    install -m 0644 "$source_file" "$target_dir/zz-exam-planner-window.conf"
  }
  install_timer_override "$release/infra/systemd/timer-overrides/apt-daily.conf" apt-daily.timer
  install_timer_override "$release/infra/systemd/timer-overrides/apt-daily-upgrade.conf" apt-daily-upgrade.timer
  install_timer_override "$release/infra/systemd/timer-overrides/logrotate.conf" logrotate.timer
  install_timer_override "$release/infra/systemd/timer-overrides/dpkg-db-backup.conf" dpkg-db-backup.timer
  install_timer_override "$release/infra/systemd/timer-overrides/openclaw-night-stop.conf" openclaw-night-stop.timer
  install_timer_override "$release/infra/systemd/timer-overrides/openclaw-morning-start.conf" openclaw-morning-start.timer
  install_service_override() {
    local source_file="$1" service_unit="$2" target_dir="/etc/systemd/system/$2.d"
    systemctl cat "$service_unit" >/dev/null 2>&1 || return
    if [[ ! -f "$source_file" ]]; then
      rm -f "$target_dir/zz-exam-planner-resources.conf"
      return
    fi
    install -d -m 0755 "$target_dir"
    install -m 0644 "$source_file" "$target_dir/zz-exam-planner-resources.conf"
  }
  install_service_override "$release/infra/systemd/service-overrides/hbrclient-resources.conf" hbrclient.service
  install_service_override "$release/infra/systemd/service-overrides/hbrclientupdater-resources.conf" hbrclientupdater.service
  rm -rf /etc/systemd/system/exam-planner.service.d
  systemctl daemon-reload
  systemctl enable exam-planner exam-planner-worker exam-planner-privileged >/dev/null
  if [[ -f /etc/systemd/system/exam-planner-health-watchdog.timer ]]; then
    systemctl enable --now exam-planner-health-watchdog.timer >/dev/null
  fi
  systemctl try-restart hbrclient.service hbrclientupdater.service >/dev/null || true
  for timer_unit in apt-daily.timer apt-daily-upgrade.timer logrotate.timer dpkg-db-backup.timer openclaw-night-stop.timer openclaw-morning-start.timer; do
    systemctl is-enabled --quiet "$timer_unit" && systemctl restart "$timer_unit" || true
  done
}

publish_release_assets() {
  local release="$1" publisher="$1/scripts/publish-release-assets.sh"
  [[ -f "$publisher" ]] || publisher="$RELEASE_DIR/scripts/publish-release-assets.sh"
  [[ -f "$publisher" ]] || { echo "asset publisher is missing" >&2; return 1; }
  APP_DIR="$APP_DIR" ASSET_SHARED_ROOT="$SHARED_ROOT" STATIC_ASSET_RETENTION_DAYS="$STATIC_ASSET_RETENTION_DAYS" \
    bash "$publisher" "$release" >/dev/null
}

publish_retained_assets() {
  local release
  while IFS= read -r release; do
    [[ -d "$release/dist/assets" ]] && publish_release_assets "$release"
  done < <(find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -print | sort)
}

configure_nginx_assets() {
  local backup_file="$UNIT_BACKUP_DIR/exam-planner-common.conf"
  [[ -f "$NGINX_COMMON_CONFIG" ]] || {
    echo "Nginx common configuration is missing: $NGINX_COMMON_CONFIG" >&2
    return 1
  }
  if grep -Fq 'root /opt/exam-planner/shared;' "$NGINX_COMMON_CONFIG"; then
    nginx -t >/dev/null
    return
  fi
  cp -a "$NGINX_COMMON_CONFIG" "$backup_file"
  sed -i -E 's#alias /opt/exam-planner/(current/)?dist/assets/;|root /opt/exam-planner/current/dist;#root /opt/exam-planner/shared;#' "$NGINX_COMMON_CONFIG"
  if ! grep -Fq 'root /opt/exam-planner/shared;' "$NGINX_COMMON_CONFIG" || ! nginx -t >/dev/null; then
    cp -a "$backup_file" "$NGINX_COMMON_CONFIG"
    nginx -t >/dev/null || true
    echo "Nginx asset path could not be migrated to the shared immutable asset pool" >&2
    return 1
  fi
  systemctl reload nginx
}

verify_nginx_assets() {
  local asset downloaded="$TEST_DATA_DIR/nginx-asset"
  asset="$(grep -o '/assets/[^"[:space:]]*\.js' "$CURRENT_LINK/dist/index.html" | head -n 1)"
  [[ "$asset" == /assets/*.js ]] || {
    echo "built index does not reference a JavaScript asset" >&2
    return 1
  }
  curl --max-time 10 -fsS -H 'Host: 127.0.0.1' "http://127.0.0.1:8088$asset" -o "$downloaded" || return 1
  cmp -s "$CURRENT_LINK/dist$asset" "$downloaded" || {
    echo "Nginx did not serve the JavaScript asset from the active release" >&2
    return 1
  }
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
  verify_nginx_assets || return 1
  systemctl start exam-planner-worker || return 1
  systemctl is-active --quiet exam-planner-worker || return 1
  if [[ -f /usr/local/lib/exam-planner/runtime-watchdog.mjs ]]; then
    "$APP_NODE_BIN" /usr/local/lib/exam-planner/runtime-watchdog.mjs --check-only >/dev/null || return 1
  fi
}

rollback_release() {
  systemctl stop exam-planner-worker exam-planner exam-planner-privileged 2>/dev/null || true
  if [[ -n "$PREVIOUS_RELEASE" && -d "$PREVIOUS_RELEASE" ]]; then
    publish_release_assets "$PREVIOUS_RELEASE"
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

write_deployment_state() {
  local temporary="$WATCHDOG_STATE_DIR/deployment-state.json.tmp"
  install -d -o root -g examplanner -m 0750 "$WATCHDOG_STATE_DIR"
  printf '{"release":"%s","previousRelease":"%s","activatedAtMs":%s}\n' \
    "$RELEASE_DIR" "$PREVIOUS_RELEASE" "$(($(date +%s) * 1000))" >"$temporary"
  chown root:examplanner "$temporary"
  chmod 0640 "$temporary"
  mv -f -- "$temporary" "$WATCHDOG_STATE_DIR/deployment-state.json"
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
publish_retained_assets
configure_nginx_assets

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

write_deployment_state
prune_releases
prune_deploy_backups
rm -f -- "$PACKAGE_FILE"
echo "deployment_ok release=$RELEASE_DIR previous=$PREVIOUS_RELEASE"
