#!/usr/bin/env bash
# SubHub 桌面启动器: 生成可双击的 .desktop, 并可安装到应用菜单 / 桌面
#
#   bash scripts/desktop.sh              # 同 install
#   bash scripts/desktop.sh install      # 生成 3 个启动器 + 装进菜单和桌面
#   bash scripts/desktop.sh make         # 只在项目根目录生成 .desktop (不安装)
#   bash scripts/desktop.sh uninstall    # 从菜单/桌面移除
#
# 生成的启动器: subhub-start.desktop (启动) / subhub-stop.desktop (停止) / subhub-open.desktop (打开控制台)
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
ICON="$ROOT/config/subhub.svg"
APP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"

if [ -t 1 ]; then
    C_G="\033[32m"; C_Y="\033[33m"; C_R="\033[31m"; C_0="\033[0m"
else
    C_G=""; C_Y=""; C_R=""; C_0=""
fi
ok() { printf "%b✔%b %s\n" "$C_G" "$C_0" "$1"; }
warn() { printf "%b!%b %s\n" "$C_Y" "$C_0" "$1"; }
err() { printf "%b✘%b %s\n" "$C_R" "$C_0" "$1" >&2; }

# ---------- 取端口 (与 scripts/manage.sh 的规则保持一致) ----------
# 与 scripts/manage.sh 同规则: 环境变量 > .env > 默认 9635; 无效值 (空 / 0 / 非数字) 一律回落到默认
read_port() {
    local p="${SUB_STORE_BACKEND_API_PORT:-${PORT:-}}"
    case "$p" in
        '' | 0 | *[!0-9]*) p="" ;;
    esac
    if [ -z "$p" ] && [ -f "$ROOT/.env" ]; then
        p="$(sed -n 's/^[[:space:]]*SUB_STORE_BACKEND_API_PORT[[:space:]]*=\(.*\)$/\1/p;s/^[[:space:]]*PORT[[:space:]]*=\(.*\)$/\1/p' "$ROOT/.env" 2>/dev/null | tail -n 1 | tr -d " \t\"'")"
        case "$p" in
            '' | 0 | *[!0-9]*) p="" ;;
        esac
    fi
    echo "${p:-9635}"
}

# ---------- 取桌面目录 ----------
desktop_dir() {
    local d=""
    if command -v xdg-user-dir >/dev/null 2>&1; then
        d="$(xdg-user-dir DESKTOP 2>/dev/null)"
    fi
    [ -d "$d" ] && { echo "$d"; return 0; }
    for d in "$HOME/桌面" "$HOME/Desktop"; do
        [ -d "$d" ] && { echo "$d"; return 0; }
    done
    return 1
}

# ---------- 生成 .desktop ----------
gen_one() {
    local file="$1" name="$2" comment="$3" exec_line="$4" terminal="$5"
    cat >"$file" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=$name
Name[zh_CN]=$name
GenericName=节点 / 订阅转换中枢
GenericName[zh_CN]=节点 / 订阅转换中枢
Comment=$comment
Comment[zh_CN]=$comment
Exec=$exec_line
Path=$ROOT
Icon=$ICON
Terminal=$terminal
Categories=Network;
Keywords=SubHub;Sub-Store;订阅;节点;转换;clash;mihomo;sing-box;surge;
StartupNotify=false
EOF
    chmod +x "$file"
}

make_files() {
    local url="http://127.0.0.1:$(read_port)"
    # SUBHUB_KEEP_OPEN=1: 终端里跑完停住等回车, 双击时能看到结果而不是窗口一闪而过
    gen_one "$ROOT/subhub-start.desktop" "SubHub 启动" "启动 SubHub (节点/订阅转换中枢)" "env SUBHUB_KEEP_OPEN=1 $ROOT/start.sh" true
    gen_one "$ROOT/subhub-stop.desktop" "SubHub 停止" "停止 SubHub 服务" "env SUBHUB_KEEP_OPEN=1 $ROOT/stop.sh" true
    gen_one "$ROOT/subhub-open.desktop" "SubHub 控制台" "打开 SubHub 网页控制台 ($url)" "xdg-open $url" false
    # 项目目录里的这几个也要标成"可信", 否则文件管理器/启动器会拒绝双击运行 (GNOME/Deepin 都认这个标记)
    local f
    for f in subhub-start subhub-stop subhub-open; do
        mark_trusted "$ROOT/$f.desktop"
    done
    ok "已生成启动器: subhub-start / subhub-stop / subhub-open.desktop"
    echo "  访问地址: $url"
    echo "  图标:     $ICON"
}

# ---------- 标记为可信 (GNOME/Deepin 双击 .desktop 需要) ----------
mark_trusted() {
    local f="$1"
    command -v gio >/dev/null 2>&1 && gio set "$f" metadata::trusted true >/dev/null 2>&1
    chmod +x "$f" 2>/dev/null
    return 0
}

install_files() {
    make_files

    mkdir -p "$APP_DIR" || { err "无法写入 $APP_DIR"; exit 1; }
    local f
    for f in subhub-start subhub-stop subhub-open; do
        cp -f "$ROOT/$f.desktop" "$APP_DIR/$f.desktop"
        mark_trusted "$APP_DIR/$f.desktop"
    done
    ok "已加入应用菜单: $APP_DIR"

    local d
    if d="$(desktop_dir)"; then
        for f in subhub-start subhub-stop subhub-open; do
            cp -f "$ROOT/$f.desktop" "$d/$f.desktop"
            mark_trusted "$d/$f.desktop"
        done
        ok "已放到桌面: $d"
    else
        warn "没找到桌面目录, 只装了应用菜单"
    fi

    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APP_DIR" >/dev/null 2>&1
    return 0
}

uninstall_files() {
    local f removed=0 d
    for f in subhub-start subhub-stop subhub-open; do
        [ -f "$APP_DIR/$f.desktop" ] && { rm -f "$APP_DIR/$f.desktop"; removed=1; }
        if d="$(desktop_dir)"; then
            [ -f "$d/$f.desktop" ] && { rm -f "$d/$f.desktop"; removed=1; }
        fi
    done
    command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APP_DIR" >/dev/null 2>&1
    [ "$removed" = "1" ] && ok "已移除菜单/桌面上的 SubHub 启动器" || warn "菜单/桌面上没有找到 SubHub 启动器"
    echo "  项目里的 subhub-*.desktop 保留 (要一起删: rm -f $ROOT/subhub-*.desktop)"
}

case "${1:-install}" in
    make | gen | generate) make_files ;;
    install | add)         install_files ;;
    uninstall | remove)    uninstall_files ;;
    help | -h | --help)
        cat <<'EOF'
用法: bash scripts/desktop.sh [install|make|uninstall]

  install    生成启动器并安装到应用菜单 + 桌面 (默认)
  make       只在项目根目录生成 .desktop
  uninstall  从应用菜单 / 桌面移除
EOF
        ;;
    *)
        err "未知参数: $1 (可用: install | make | uninstall)"
        exit 1
        ;;
esac
