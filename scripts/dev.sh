#!/usr/bin/env bash
# SubHub 本地开发启动 (直接跑源码, 改动即时生效)
#
# 用法:
#   bash scripts/dev.sh                 # 默认 127.0.0.1:9635
#   PORT=9876 bash scripts/dev.sh       # 换端口
#   HOST=0.0.0.0 bash scripts/dev.sh    # 允许局域网访问 (默认端口 9635)
set -euo pipefail

cd "$(dirname "$0")/.."

# 先把 node 找出来 (双击启动时 PATH 里很可能没有它)
# shellcheck source=scripts/env.sh
. ./scripts/env.sh
subhub_bootstrap_runtime || exit 1

export SUBHUB_HOME="${SUBHUB_HOME:-$PWD}"
export SUB_STORE_DATA_BASE_PATH="${SUB_STORE_DATA_BASE_PATH:-./data}"
export SUB_STORE_BACKEND_API_HOST="${SUB_STORE_BACKEND_API_HOST:-${HOST:-127.0.0.1}}"
_port="${SUB_STORE_BACKEND_API_PORT:-${PORT:-9635}}"
case "$_port" in
    '' | 0 | *[!0-9]*) echo "[SubHub] PORT=$_port 不是可用端口, 回落到 9635"; _port=9635 ;;
esac
export SUB_STORE_BACKEND_API_PORT="$_port"

mkdir -p "$SUB_STORE_DATA_BASE_PATH"

if [ ! -d node_modules ]; then
    echo "[SubHub] 首次运行, 安装依赖 (pnpm install)..."
    pnpm install --frozen-lockfile
fi

echo "[SubHub] 数据目录: $SUB_STORE_DATA_BASE_PATH"
echo "[SubHub] 监听: $SUB_STORE_BACKEND_API_HOST:$SUB_STORE_BACKEND_API_PORT"
echo "[SubHub] 统一 API: http://$SUB_STORE_BACKEND_API_HOST:$SUB_STORE_BACKEND_API_PORT/api/v1"

exec ./node_modules/.bin/babel-node src/main.js
