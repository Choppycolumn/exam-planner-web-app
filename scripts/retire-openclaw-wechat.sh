#!/usr/bin/env bash
set -euo pipefail

STAMP="$(date +%Y%m%d%H%M%S)"
BACKUP_ROOT="${BACKUP_ROOT:-/opt/exam-planner-deploy-backups/openclaw-retirement-$STAMP}"
RUNTIME_ENV="${RUNTIME_ENV:-/etc/exam-planner/runtime.env}"

install -d -m 0700 "$BACKUP_ROOT"

mapfile -t units < <(
  systemctl list-unit-files --no-legend 2>/dev/null |
    awk 'tolower($1) ~ /(openclaw|clawbot|weixin|wechat|wecom)/ { print $1 }'
)

backup_targets=()
for path in \
  /root/.openclaw \
  /root/.openclaw-weixin \
  /opt/openclaw \
  /opt/node22 \
  /etc/openclaw \
  /etc/exam-planner/openclaw.env \
  /etc/exam-planner/wechat.env \
  /usr/local/lib/node_modules/openclaw \
  /usr/local/bin/openclaw \
  /usr/local/bin/openclaw-weixin; do
  [[ -e "$path" || -L "$path" ]] && backup_targets+=("$path")
done

for unit in "${units[@]}"; do
  fragment="$(systemctl show "$unit" -p FragmentPath --value 2>/dev/null || true)"
  [[ -n "$fragment" && ( -e "$fragment" || -L "$fragment" ) ]] && backup_targets+=("$fragment")
  [[ -d "/etc/systemd/system/$unit.d" ]] && backup_targets+=("/etc/systemd/system/$unit.d")
done

[[ -f "$RUNTIME_ENV" ]] && backup_targets+=("$RUNTIME_ENV")
if crontab -l >"$BACKUP_ROOT/root.crontab" 2>/dev/null; then
  chmod 0600 "$BACKUP_ROOT/root.crontab"
fi

if ((${#backup_targets[@]})); then
  tar -czf "$BACKUP_ROOT/files.tgz" --ignore-failed-read "${backup_targets[@]}"
  chmod 0600 "$BACKUP_ROOT/files.tgz"
fi

if ((${#units[@]})); then
  systemctl disable --now "${units[@]}" >/dev/null 2>&1 || true
fi

pkill -TERM -f '[o]penclaw|[c]lawbot|[w]eixin|[w]echat|[w]ecom' 2>/dev/null || true
sleep 2
pkill -KILL -f '[o]penclaw|[c]lawbot|[w]eixin|[w]echat|[w]ecom' 2>/dev/null || true

for unit in "${units[@]}"; do
  fragment="$(systemctl show "$unit" -p FragmentPath --value 2>/dev/null || true)"
  if [[ "$fragment" =~ ^/(etc|usr/lib|lib)/systemd/system/ ]] && [[ -e "$fragment" || -L "$fragment" ]]; then
    rm -f -- "$fragment"
  fi
  rm -rf -- "/etc/systemd/system/$unit.d"
  find /etc/systemd/system -maxdepth 2 -type l -name "$unit" -delete 2>/dev/null || true
done

rm -rf -- \
  /root/.openclaw \
  /root/.openclaw-weixin \
  /opt/openclaw \
  /opt/node22 \
  /etc/openclaw \
  /etc/exam-planner/openclaw.env \
  /etc/exam-planner/wechat.env \
  /usr/local/lib/node_modules/openclaw
rm -f -- /usr/local/bin/openclaw /usr/local/bin/openclaw-weixin

if [[ -f "$RUNTIME_ENV" ]]; then
  temp_env="$(mktemp)"
  awk '!/^(OPENCLAW_|CLAWBOT_|WECOM_|WECHAT_|WEIXIN_)[A-Z0-9_]*=/' "$RUNTIME_ENV" >"$temp_env"
  install -m 0600 "$temp_env" "$RUNTIME_ENV"
  rm -f "$temp_env"
fi

if [[ -s "$BACKUP_ROOT/root.crontab" ]]; then
  awk 'tolower($0) !~ /(openclaw|clawbot|weixin|wechat|wecom)/' "$BACKUP_ROOT/root.crontab" | crontab -
fi

find /etc/cron.d /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly \
  -maxdepth 1 -type f 2>/dev/null |
  awk 'tolower($0) ~ /(openclaw|clawbot|weixin|wechat|wecom)/' |
  xargs -r rm -f --

systemctl daemon-reload
systemctl reset-failed >/dev/null 2>&1 || true

remaining_units="$(systemctl list-unit-files --no-legend 2>/dev/null | awk 'tolower($1) ~ /(openclaw|clawbot|weixin|wechat|wecom)/ { print $1 }')"
remaining_processes="$(pgrep -af '[o]penclaw|[c]lawbot|[w]eixin|[w]echat|[w]ecom' || true)"

printf 'backup=%s\n' "$BACKUP_ROOT"
printf 'remaining_units=%s\n' "${remaining_units:-none}"
printf 'remaining_processes=%s\n' "${remaining_processes:-none}"
printf 'preserved_channels=Bark,Telegram\n'
