#!/usr/bin/env bash
# SubHub 一键启动 —— 在文件管理器里直接双击本文件也行
#
#   ./start.sh                启动 (后台运行, 就绪后自动开浏览器)
#   PORT=8080 ./start.sh      换端口
#   LAN=1 ./start.sh          监听 0.0.0.0, 局域网设备可访问
#   FORCE_MODE=dev ./start.sh 用源码模式启动 (改代码即时生效, 启动慢一点)
#
#   ./stop.sh                 停止
#   ./status.sh               看状态 + 最近日志
#   ./logs.sh -f              实时跟踪日志
#   ./desktop.sh install      装一个双击即启动的桌面图标
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=scripts/terminal.sh
. "$HERE/scripts/terminal.sh"

# 双击运行时没有终端窗口, 自动开个终端把输出留在里面 (SUBHUB_NO_TERMINAL=1 可禁用)
if ! subhub_in_terminal; then
    subhub_reopen_in_terminal "$HERE/start.sh" "$@"
fi

bash "$HERE/scripts/manage.sh" start "$@"
rc=$?

subhub_pause_if_needed
exit "$rc"
