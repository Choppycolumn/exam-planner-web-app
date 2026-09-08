#!/usr/bin/env bash
# 拾座 · 一键启动（本机 / 服务器通用）
# 用法:
#   ./一键启动.sh              # 保活直到 grab_at 再预约
#   ./一键启动.sh login        # 本机采集统一认证会话
#   ./一键启动.sh now          # 立刻跑一轮
#   ./一键启动.sh dry          # 演练（不提交）
#   ./一键启动.sh keepalive    # 只保活
#   ./一键启动.sh web          # 打开座位预约面板

set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

CMD="${1:-}"
PY=python3
command -v "$PY" >/dev/null 2>&1 || PY=python
command -v "$PY" >/dev/null 2>&1 || { echo "需要 Python 3.10+"; exit 1; }

if [[ ! -d .venv ]]; then
  echo "[拾座] 创建虚拟环境 .venv …"
  "$PY" -m venv .venv
fi

# shellcheck disable=SC1091
source .venv/bin/activate

echo "[拾座] 检查依赖（清华源）…"
PIP_INDEX="https://pypi.tuna.tsinghua.edu.cn/simple"
PIP_HOST="pypi.tuna.tsinghua.edu.cn"
python -m pip install -q --upgrade pip -i "$PIP_INDEX" --trusted-host "$PIP_HOST" || true
if ! python -m pip install -q -r requirements.txt -i "$PIP_INDEX" --trusted-host "$PIP_HOST"; then
  echo "[拾座] 清华源失败，尝试阿里云…"
  python -m pip install -q -r requirements.txt -i https://mirrors.aliyun.com/pypi/simple/ --trusted-host mirrors.aliyun.com
fi

if [[ ! -f config.yaml ]]; then
  cp config.example.yaml config.yaml
  echo "[拾座] 已生成 config.yaml，请先填写学号、密码、座位后再跑。"
  echo "       也可用浏览器打开 web/index.html 生成配置片段。"
  if [[ "$CMD" != "web" && "$CMD" != "login" ]]; then
    exit 2
  fi
fi

mkdir -p logs

case "$CMD" in
  "" )
    echo "[拾座] 座位预约：保活直到 grab_at"
    exec python main.py
    ;;
  login )
    echo "[拾座] 本机登录（统一认证）"
    exec python main.py --login
    ;;
  now )
    echo "[拾座] 立即预约一轮"
    exec python main.py --now
    ;;
  dry|dry-run )
    echo "[拾座] 演练模式"
    exec python main.py --dry-run --now
    ;;
  keepalive|keep )
    echo "[拾座] 仅保活"
    exec python main.py --keepalive-only
    ;;
  web )
    echo "[拾座] 打开座位预约面板"
    if command -v xdg-open >/dev/null 2>&1; then
      xdg-open "file://$ROOT/web/index.html" >/dev/null 2>&1 || true
    elif command -v open >/dev/null 2>&1; then
      open "$ROOT/web/index.html" || true
    else
      echo "请用浏览器打开: $ROOT/web/index.html"
    fi
    # 顺带起一个静态服务，方便手机访问
    echo "[拾座] 本机预览 http://127.0.0.1:8765/  （Ctrl+C 结束）"
    cd web && exec python -m http.server 8765 --bind 127.0.0.1
    ;;
  * )
    echo "未知参数: $CMD"
    echo "可用: login | now | dry | keepalive | web | （空=到点预约）"
    exit 1
    ;;
esac
