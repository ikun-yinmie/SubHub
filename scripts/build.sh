#!/usr/bin/env bash
# SubHub 构建
#
#   bash scripts/build.sh             # 只打包后端 (dist/sub-store.bundle.js)
#   BUILD_WEB=1 bash scripts/build.sh # 额外构建内置前端 web/dist
#
# 产物 dist/sub-store.bundle.js 自带全部依赖, 运行时不需要 node_modules。
set -euo pipefail

cd "$(dirname "$0")/.."

# 先把 node 找出来 (双击启动时 PATH 里很可能没有它)
# shellcheck source=scripts/env.sh
. ./scripts/env.sh
subhub_bootstrap_runtime || exit 1

if [ ! -d node_modules ]; then
    echo "[SubHub] 安装依赖 (pnpm install)..."
    if command -v pnpm >/dev/null 2>&1; then
        pnpm install --frozen-lockfile
    else
        corepack pnpm install --frozen-lockfile
    fi
fi

echo "[SubHub] 打包后端 (esbuild)..."
node bundle-esbuild.js

ls -lh sub-store.min.js dist/sub-store.bundle.js

if [ "${BUILD_WEB:-0}" = "1" ]; then
    echo "[SubHub] 构建前端 (web/)..."
    # subhub_yarn 会绕开 corepack 对根 package.json (pnpm) 的 project-spec 校验
    ( cd web && subhub_yarn install && subhub_yarn build )
    ls -lh web/dist/index.html
    echo ""
    echo "启用单端口模式: 复制 .env.example 为 .env 并打开 MERGE_FRONTEND=1, 或手动设置:"
    echo "  SUB_STORE_BACKEND_MERGE=true"
    echo "  SUB_STORE_FRONTEND_PATH=$PWD/web/dist"
    echo "  SUB_STORE_FRONTEND_BACKEND_PATH=/"
fi
