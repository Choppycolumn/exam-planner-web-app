#!/usr/bin/env bash
# 本机登录后，把 session.json 传到服务器。
# 用法:
#   ./scripts/upload_session.sh user@your-server:/opt/seatbot/
#   SEATBOT_REMOTE=user@host:/opt/seatbot ./scripts/upload_session.sh

set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SESSION="${ROOT}/session.json"
REMOTE="${1:-${SEATBOT_REMOTE:-}}"

if [[ ! -f "$SESSION" ]]; then
  echo "找不到 $SESSION"
  echo "请先在本机执行: python main.py --login"
  exit 1
fi

if [[ -z "$REMOTE" ]]; then
  echo "用法: $0 user@host:/path/to/seatbot/"
  echo "或设置环境变量 SEATBOT_REMOTE"
  exit 1
fi

# 保证远端目录以 / 结尾时仍正确
DEST="$REMOTE"
if [[ "$DEST" != */session.json ]]; then
  DEST="${DEST%/}/session.json"
fi

echo "上传 $SESSION → $DEST"
scp -p "$SESSION" "$DEST"
echo "完成。服务器进程若在保活等待中，会自动检测到文件更新。"
