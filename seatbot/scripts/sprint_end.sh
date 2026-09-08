#!/bin/bash
LOG=/var/log/seatbot/login.log
FLAG=/opt/seatbot/logs/sprint_restored
mkdir -p /opt/seatbot/logs
# 同一窗口避免重复拉起
if [ -f "$FLAG" ] && [ $(($(date +%s) - $(stat -c %Y "$FLAG"))) -lt 600 ]; then
  echo "$(date '+%F %T') sprint_end skipped (recent)" >> "$LOG"
  exit 0
fi
touch "$FLAG"
echo "$(date '+%F %T') sprint_end" >> "$LOG"
for s in exam-planner.service exam-planner-worker.service exam-planner-health-watchdog.timer exam-planner-hbr-guard.timer; do
  systemctl start "$s" >>"$LOG" 2>&1 || true
  echo "$(date '+%F %T') started $s" >> "$LOG"
done
echo "$(date '+%F %T') sprint_end done mem=$(awk '/MemAvailable/{print $2}' /proc/meminfo)kB" >> "$LOG"
