#!/usr/bin/env bash
# SubHub 状态查看: 进程 / 端口 / 运行模式 / 健康检查 / 最近日志
#
#   ./status.sh               查看状态
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=scripts/terminal.sh
. "$HERE/scripts/terminal.sh"

if ! subhub_in_terminal; then
    subhub_reopen_in_terminal "$HERE/status.sh" "$@"
fi

bash "$HERE/scripts/manage.sh" status "$@"
rc=$?

subhub_pause_if_needed
exit "$rc"
