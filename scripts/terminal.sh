#!/usr/bin/env bash
# SubHub - 终端复用小工具 (被根目录的 start.sh / stop.sh / status.sh / restart.sh / logs.sh 引用)
#
# 为什么需要它:
#   在文件管理器里双击 .sh 时, 进程是没有终端的 —— 输出看不见, 报错一闪而过。
#   这里检测到"没有终端"就自动找一个系统终端模拟器, 把自己重新打开,
#   脚本跑完停一下等回车, 窗口不会瞬间消失。
#
# 已经跑在终端里 (`./start.sh` 或 `bash start.sh`) 时完全不做事, 照常执行。
#
# 环境变量:
#   SUBHUB_NO_TERMINAL=1     禁止自动打开终端 (给 cron / systemd / 远程脚本用)
#   SUBHUB_KEEP_OPEN=1       在终端里跑完也停住等回车 (桌面启动器用的就是这个)
#   SUBHUB_TERMINALS="..."   自定义终端候选 (按空格分隔, 取第一个存在的)

# 终端候选 (按顺序找第一个存在的)
SUBHUB_TERMINALS="${SUBHUB_TERMINALS:-x-terminal-emulator deepin-terminal gnome-terminal konsole xfce4-terminal mate-terminal tilix alacritty kitty xterm}"

# 是否已经处在"能看到输出"的环境里
subhub_in_terminal() {
    # 显式禁用
    [ "${SUBHUB_NO_TERMINAL:-0}" = "1" ] && return 0
    # 自己已经是被终端包起来的那一份
    [ "${SUBHUB_TERM_WRAPPED:-0}" = "1" ] && return 0
    # 有 tty 就照常跑
    [ -t 0 ] && [ -t 1 ] && return 0
    return 1
}

# 有没有图形会话 (没有就别折腾终端了)
subhub_has_display() {
    [ -n "${DISPLAY:-}" ] || [ -n "${WAYLAND_DISPLAY:-}" ] || [ -n "${XDG_SESSION_TYPE:-}" ]
}

# 在系统终端里重新打开自己: subhub_reopen_in_terminal <脚本绝对路径> [参数...]
subhub_reopen_in_terminal() {
    local self="$1"
    shift
    local args="" a
    for a in "$@"; do args="$args $(printf '%q' "$a")"; done

    # 终端窗口里真正执行的命令: 打标记 -> 跑脚本 -> 停住等回车
    local inner
    # 结尾的停留: 先试着打开 /dev/tty (打不开说明根本没有控制终端, 就直接结束, 免得到处乱等)
    inner="export SUBHUB_TERM_WRAPPED=1; $(printf '%q' "$self")$args; rc=\$?; echo; if ( : </dev/tty ) 2>/dev/null; then printf '%s\n' '--- SubHub: 按回车键关闭本窗口 ---'; read -r _ </dev/tty; fi; exit \$rc"

    if subhub_has_display; then
        local t
        for t in $SUBHUB_TERMINALS; do
            command -v "$t" >/dev/null 2>&1 || continue
            case "$t" in
                gnome-terminal | tilix | mate-terminal)
                    exec "$t" -- bash -c "$inner"
                    ;;
                deepin-terminal)
                    exec "$t" -w "$PWD" --keep-open -e bash -c "$inner"
                    ;;
                *)
                    exec "$t" -e bash -c "$inner"
                    ;;
            esac
        done
    fi

    # 没图形会话 / 没有终端模拟器: 只能悄悄跑, 结果看日志文件和桌面通知
    export SUBHUB_TERM_WRAPPED=1
    printf '%s\n' "[SubHub] 没找到可用的终端模拟器, 关掉窗口就看不到输出了。" >&2
    printf '%s\n' "[SubHub] 日志: $PWD/logs/subhub.log   桌面通知 / 浏览器里可以看到结果。" >&2
    return 0
}

# 双击/图标进来时, 脚本跑完停一下, 方便看结果 (在终端里手敲命令则不停)
subhub_pause_if_needed() {
    if [ "${SUBHUB_TERM_WRAPPED:-0}" != "1" ] && [ "${SUBHUB_KEEP_OPEN:-0}" != "1" ]; then
        return 0
    fi
    # 只有存在控制终端 (能打开 /dev/tty) 才停住 —— 否则会干等到天荒地老
    # 注意: 不能用 [ -t 0 ] 判断 (那跟重定向有关), 也不能用 [ -r /dev/tty ] (那查的是权限位)
    if ( : </dev/tty ) 2>/dev/null; then
        echo
        printf '%s\n' '--- SubHub: 按回车键关闭本窗口 ---'
        read -r _ </dev/tty 2>/dev/null || true
    fi
    return 0
}
