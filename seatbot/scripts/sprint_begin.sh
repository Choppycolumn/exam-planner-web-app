#!/bin/bash
# 23:48 关掉抢座无关服务，给 CAS/OCR 和 0 点开抢让内存
LOG=/var/log/seatbot/login.log
echo "$(date '+%F %T') sprint_begin" >> "$LOG"
# 只停业务站点，不动 nginx / seatbot / ssh
for s in exam-planner.service exam-planner-worker.service exam-planner-health-watchdog.timer exam-planner-hbr-guard.timer; do
  if systemctl is-active --quiet "$s" || systemctl is-enabled --quiet "$s" 2>/dev/null; then
    systemctl stop "$s" >>"$LOG" 2>&1 || true
    echo "$(date '+%F %T') stopped $s" >> "$LOG"
  fi
done
sync
echo "$(date '+%F %T') sprint_begin done mem=$(awk '/MemAvailable/{print $2}' /proc/meminfo)kB" >> "$LOG"
