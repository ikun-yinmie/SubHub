#!/usr/bin/env bash
# SubHub 一键停止 —— 也可以双击运行
#
#   ./stop.sh                 优雅停止 (最多等 15 秒, 之后强制结束)
#   PORT=8080 ./stop.sh       停止指定端口的实例 (要与启动时的 PORT 一致)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=scripts/terminal.sh
. "$HERE/scripts/terminal.sh"

if ! subhub_in_terminal; then
    subhub_reopen_in_terminal "$HERE/stop.sh" "$@"
fi

bash "$HERE/scripts/manage.sh" stop "$@"
rc=$?

subhub_pause_if_needed
exit "$rc"
