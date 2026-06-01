#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/exam-planner}"
APP_USER="${APP_USER:-exam-planner}"
SERVICE="${SERVICE:-exam-planner}"
ENV_FILE="${ENV_FILE:-/etc/exam-planner/exam-planner.env}"

id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$(dirname "$ENV_FILE")" "$APP_DIR/data" "$APP_DIR/data/backups"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
chown root:"$APP_USER" "$ENV_FILE"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/data"

cat >/etc/systemd/system/"$SERVICE".service <<UNIT
[Unit]
Description=Exam Planner Web App
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$APP_USER
Group=$APP_USER
WorkingDirectory=$APP_DIR
EnvironmentFile=$ENV_FILE
ExecStart=/usr/bin/node $APP_DIR/server/auth-static-server.mjs
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$APP_DIR/data
MemoryMax=768M
LimitNOFILE=65535
TimeoutStopSec=15

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "$SERVICE"
systemctl restart "$SERVICE"
systemctl --no-pager --full status "$SERVICE"
