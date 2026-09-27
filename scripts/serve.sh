#!/usr/bin/env bash
# SubHub 生产模式启动 (跑打包产物, 不需要 node_modules)
#
# 用法: bash scripts/serve.sh
#   可选: MERGE_FRONTEND=1 bash scripts/serve.sh   # 同时托管 web/dist 前端 (单端口)
set -euo pipefail

cd "$(dirname "$0")/.."

[ -f .env ] && set -a && . ./.env && set +a || true

# 先把 node 找出来 (双击启动时 PATH 里很可能没有它)
# shellcheck source=scripts/env.sh
. ./scripts/env.sh
subhub_bootstrap_runtime || exit 1

export SUBHUB_HOME="${SUBHUB_HOME:-$PWD}"
export SUB_STORE_DATA_BASE_PATH="${SUB_STORE_DATA_BASE_PATH:-./data}"
export SUB_STORE_BACKEND_API_HOST="${SUB_STORE_BACKEND_API_HOST:-127.0.0.1}"
_port="${SUB_STORE_BACKEND_API_PORT:-${PORT:-9635}}"
case "$_port" in
    '' | 0 | *[!0-9]*) echo "[SubHub] PORT=$_port 不是可用端口, 回落到 9635"; _port=9635 ;;
esac
export SUB_STORE_BACKEND_API_PORT="$_port"

if [ "${MERGE_FRONTEND:-0}" = "1" ]; then
    if [ ! -f web/dist/index.html ]; then
        echo "[SubHub] 找不到 web/dist/index.html, 请先执行: BUILD_WEB=1 bash scripts/build.sh"
        exit 1
    fi
    export SUB_STORE_BACKEND_MERGE=true
    export SUB_STORE_FRONTEND_PATH="${SUB_STORE_FRONTEND_PATH:-$PWD/web/dist}"
    export SUB_STORE_FRONTEND_BACKEND_PATH=/
fi

mkdir -p "$SUB_STORE_DATA_BASE_PATH"

if [ ! -f dist/sub-store.bundle.js ]; then
    echo "[SubHub] 找不到 dist/sub-store.bundle.js, 请先执行: bash scripts/build.sh"
    exit 1
fi

echo "[SubHub] 监听: $SUB_STORE_BACKEND_API_HOST:$SUB_STORE_BACKEND_API_PORT"
exec node dist/sub-store.bundle.js
