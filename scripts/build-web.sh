#!/usr/bin/env bash
# SubHub 前端构建 (web/ -> web/dist)
#
#   bash scripts/build-web.sh          第一次构建; 已存在则跳过
#   FORCE=1 bash scripts/build-web.sh  强制重建
#   bash scripts/build-web.sh --force   同上
#
# 构建产物 web/dist 存在的状态下再 ./start.sh, 就会自动单端口同时提供 界面 + API。
set -uo pipefail

cd "$(dirname "$0")/.."

case "${1:-}" in
    -f | --force | force) FORCE=1 ;;
esac
export FORCE="${FORCE:-0}"

exec bash scripts/manage.sh build-web
