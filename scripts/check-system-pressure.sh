#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-normal}"
case "$MODE" in
  hbr)
    MAX_LOAD_PER_CPU="${MAX_LOAD_PER_CPU:-1.5}"
    # HBR is deliberately I/O throttled by systemd. A short period of high
    # host iowait and one blocked HBR process are expected while it scans.
    MAX_IOWAIT_PERCENT="${MAX_IOWAIT_PERCENT:-70}"
    MIN_AVAILABLE_MEMORY_KB="${MIN_AVAILABLE_MEMORY_KB:-196608}"
    MAX_BLOCKED_PROCESSES="${MAX_BLOCKED_PROCESSES:-2}"
    ;;
  deploy)
    MAX_LOAD_PER_CPU="${MAX_LOAD_PER_CPU:-2.0}"
    MAX_IOWAIT_PERCENT="${MAX_IOWAIT_PERCENT:-30}"
    MIN_AVAILABLE_MEMORY_KB="${MIN_AVAILABLE_MEMORY_KB:-81920}"
    MAX_BLOCKED_PROCESSES="${MAX_BLOCKED_PROCESSES:-1}"
    ;;
  *)
    MAX_LOAD_PER_CPU="${MAX_LOAD_PER_CPU:-2.5}"
    MAX_IOWAIT_PERCENT="${MAX_IOWAIT_PERCENT:-40}"
    MIN_AVAILABLE_MEMORY_KB="${MIN_AVAILABLE_MEMORY_KB:-98304}"
    MAX_BLOCKED_PROCESSES="${MAX_BLOCKED_PROCESSES:-1}"
    ;;
esac

read_cpu_sample() {
  local label values value total=0 index=0 iowait=0
  read -r label values < /proc/stat
  for value in $values; do
    index=$((index + 1))
    total=$((total + value))
    [[ "$index" -eq 5 ]] && iowait="$value"
  done
  printf '%s %s\n' "$total" "$iowait"
}

read -r total_before iowait_before < <(read_cpu_sample)
sleep 1
read -r total_after iowait_after < <(read_cpu_sample)
total_delta=$((total_after - total_before))
iowait_delta=$((iowait_after - iowait_before))
iowait_percent="$(awk -v io_delta="$iowait_delta" -v total_delta="$total_delta" \
  'BEGIN { value = 0; if (total_delta > 0) value = io_delta * 100 / total_delta; printf "%.2f", value }')"

cpu_count="$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc)"
load_one="$(awk '{print $1}' /proc/loadavg)"
load_per_cpu="$(awk -v current_load="$load_one" -v cpu_total="$cpu_count" \
  'BEGIN { divisor = 1; if (cpu_total > 0) divisor = cpu_total; printf "%.2f", current_load / divisor }')"
available_memory_kb="$(awk '/^MemAvailable:/ {print $2; exit}' /proc/meminfo)"
available_memory_kb="${available_memory_kb:-0}"

blocked_processes=0
for stat_file in /proc/[0-9]*/stat; do
  [[ -r "$stat_file" ]] || continue
  state="$(sed -E 's/^[0-9]+ \(.*\) ([A-Z]).*/\1/' "$stat_file" 2>/dev/null || true)"
  [[ "$state" == "D" ]] && blocked_processes=$((blocked_processes + 1))
done

failed=0
awk -v value="$load_per_cpu" -v limit="$MAX_LOAD_PER_CPU" 'BEGIN { exit !(value > limit) }' && failed=1
awk -v value="$iowait_percent" -v limit="$MAX_IOWAIT_PERCENT" 'BEGIN { exit !(value > limit) }' && failed=1
(( available_memory_kb < MIN_AVAILABLE_MEMORY_KB )) && failed=1
(( blocked_processes > MAX_BLOCKED_PROCESSES )) && failed=1

printf 'mode=%s load_per_cpu=%s iowait_percent=%s memory_available_kb=%s blocked_processes=%s\n' \
  "$MODE" "$load_per_cpu" "$iowait_percent" "$available_memory_kb" "$blocked_processes"

if (( failed )); then
  echo "system pressure exceeds the ${MODE} safety budget" >&2
  exit 1
fi
