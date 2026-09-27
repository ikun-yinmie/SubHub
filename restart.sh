#!/usr/bin/env bash
# SubHub 重启 (先停后起, 等价于 ./stop.sh && ./start.sh)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"

# shellcheck source=scripts/terminal.sh
. "$HERE/scripts/terminal.sh"

if ! subhub_in_terminal; then
    subhub_reopen_in_terminal "$HERE/restart.sh" "$@"
fi

bash "$HERE/scripts/manage.sh" restart "$@"
rc=$?

subhub_pause_if_needed
exit "$rc"
