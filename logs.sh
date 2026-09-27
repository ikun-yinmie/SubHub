#!/usr/bin/env bash
# SubHub 日志查看
#
#   ./logs.sh                 看最近 60 行
#   ./logs.sh 200             看最近 200 行
#   ./logs.sh -f              实时跟踪 (Ctrl+C 退出)
#   ./logs.sh web             看前端构建日志
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=scripts/terminal.sh
. "$HERE/scripts/terminal.sh"

if ! subhub_in_terminal; then
    subhub_reopen_in_terminal "$HERE/logs.sh" "$@"
fi

case "${1:-}" in
    web | web-build | frontend)
        if [ -f "$HERE/logs/web-build.log" ]; then
            tail -n 100 -f "$HERE/logs/web-build.log"
        else
            echo "还没有前端构建日志: $HERE/logs/web-build.log" >&2
            rc=1
        fi
        ;;
    *)
        bash "$HERE/scripts/manage.sh" logs "${1:-60}"
        rc=$?
        ;;
esac

subhub_pause_if_needed
exit "${rc:-0}"
