#!/usr/bin/env bash
# SubHub 一键管理
#
#   ./start.sh            启动 (后台运行, 自动挑选运行模式)
#   ./stop.sh             停止
#   ./status.sh           查看状态与最近日志
#
# 也可以直接调用本脚本:
#   bash scripts/manage.sh start|stop|restart|status|logs|open|url|build-web
#
# 环境变量 (可写进 .env):
#   PORT=9635                    监听端口
#   LAN=1                        监听 0.0.0.0 (局域网可访问)
#   PUBLIC_HOST=192.168.1.10     外部访问地址 (用于打印/打开浏览器的链接)
#   MERGE_FRONTEND=1|0           是否单端口托管 web/dist (默认: 有 dist 就开)
#   OPEN_BROWSER=1|0             启动后是否打开浏览器 (默认: 双击启动时打开)
#   AUTO_INSTALL=0               缺少 node_modules 时不自动安装
#   FORCE_MODE=dev|bundle        强制源码模式 / 打包模式
set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"

RUN_DIR=".run"
PID_FILE="$RUN_DIR/subhub.pid"
LOG_DIR="logs"
LOG_FILE="$LOG_DIR/subhub.log"

# ---------- 读取 .env ----------
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
fi

# ---------- 运行环境自检 (node 在不在 PATH 里) ----------
# shellcheck source=scripts/env.sh
. "$ROOT/scripts/env.sh"

# 端口: 环境变量优先, 但挡住 PORT=0 和非数字这类无效值 (有些运行环境会塞 PORT=0), 回落到默认端口
DEFAULT_PORT=9635
RAW_PORT="${SUB_STORE_BACKEND_API_PORT:-${PORT:-}}"
PORT="${RAW_PORT:-$DEFAULT_PORT}"
case "$PORT" in
    '' | 0 | *[!0-9]*) PORT="$DEFAULT_PORT" ;;
esac
if [ "${LAN:-0}" = "1" ]; then
    SUB_STORE_BACKEND_API_HOST="0.0.0.0"
fi
BIND_HOST="${SUB_STORE_BACKEND_API_HOST:-127.0.0.1}"

detect_public_host() {
    if [ -n "${PUBLIC_HOST:-}" ]; then
        echo "$PUBLIC_HOST"
    elif [ "$BIND_HOST" = "0.0.0.0" ] || [ "$BIND_HOST" = "::" ]; then
        hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1"
    else
        echo "$BIND_HOST"
    fi
}

PUBLIC_HOST_RESOLVED="$(detect_public_host)"
BASE_URL="http://${PUBLIC_HOST_RESOLVED}:${PORT}"

export SUBHUB_HOME="${SUBHUB_HOME:-$ROOT}"
export SUB_STORE_DATA_BASE_PATH="${SUB_STORE_DATA_BASE_PATH:-./data}"
export SUB_STORE_BACKEND_API_HOST="$BIND_HOST"
export SUB_STORE_BACKEND_API_PORT="$PORT"

# ---------- 彩色输出 ----------
if [ -t 1 ]; then
    C_G="\033[32m"; C_Y="\033[33m"; C_R="\033[31m"; C_B="\033[36m"; C_0="\033[0m"
else
    C_G=""; C_Y=""; C_R=""; C_B=""; C_0=""
fi
say()  { printf "%b%s%b\n" "$C_B" "$1" "$C_0"; }
ok()   { printf "%b✔%b %s\n" "$C_G" "$C_0" "$1"; }
warn() { printf "%b!%b %s\n" "$C_Y" "$C_0" "$1"; }
err()  { printf "%b✘%b %s\n" "$C_R" "$C_0" "$1" >&2; }

notify() {
    # 桌面通知 (双击启动时给个反馈); 没有 notify-send 就静默
    command -v notify-send >/dev/null 2>&1 && notify-send "SubHub" "$1" 2>/dev/null
    return 0
}

open_url() {
    local url="$1"
    if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 &
    elif command -v gio >/dev/null 2>&1; then
        gio open "$url" >/dev/null 2>&1 &
    else
        warn "没找到 xdg-open / gio, 请手动访问: $url"
    fi
}

# ---------- 进程状态 ----------
pid_of() {
    [ -f "$PID_FILE" ] || return 1
    local pid
    pid="$(cat "$PID_FILE" 2>/dev/null)"
    [ -n "$pid" ] || return 1
    kill -0 "$pid" 2>/dev/null || return 1
    echo "$pid"
}

find_by_pattern() {
    # 兜底: pid 文件丢了 / 服务是别的 shell 拉起来的时候, 按特征找真实进程。
    # 只认 node 可执行文件 (看 /proc/<pid>/exe), 否则会误伤"命令行里恰好含关键字的 shell"。
    local pid exe argv0 base found=""
    for pid in $(pgrep -f 'sub-store\.bundle\.js' 2>/dev/null) $(pgrep -f 'babel-node src/main\.js' 2>/dev/null); do
        [ -n "$pid" ] || continue
        exe="$(readlink -f "/proc/$pid/exe" 2>/dev/null)"
        argv0="$(tr '\0' '\n' <"/proc/$pid/cmdline" 2>/dev/null | head -n 1)"
        [ -n "$argv0" ] || argv0="$(ps -o comm= -p "$pid" 2>/dev/null | tr -d ' ')"
        base="${exe##*/}"
        [ -n "$base" ] || base="${argv0##*/}"
        case "$base" in
            node | nodejs | node-* | babel-node) found="$found $pid" ;;
        esac
    done
    found="${found# }"
    [ -n "$found" ] || return 1
    echo "$found"
}

is_running() { pid_of >/dev/null 2>&1 || [ -n "$(find_by_pattern)" ]; }

port_is_listening() {
    if command -v ss >/dev/null 2>&1; then
        ss -ltn 2>/dev/null | grep -q ":${PORT}[[:space:]]"
    elif command -v curl >/dev/null 2>&1; then
        curl -sf -m 2 "http://127.0.0.1:${PORT}/api/v1" >/dev/null 2>&1
    else
        return 1
    fi
}

wait_ready() {
    local i=0
    while [ "$i" -lt 60 ]; do
        if curl -sf -m 2 "http://127.0.0.1:${PORT}/api/v1" >/dev/null 2>&1; then
            return 0
        fi
        sleep 1
        i=$((i + 1))
    done
    return 1
}

# ---------- 运行模式 ----------
select_mode() {
    if [ -n "${FORCE_MODE:-}" ]; then
        echo "$FORCE_MODE"
        return
    fi
    if [ -f dist/sub-store.bundle.js ]; then
        echo "bundle"
    elif [ -f node_modules/.bin/babel-node ]; then
        echo "dev"
    else
        echo ""
    fi
}

# 打包产物是否比源码旧 (改过源码却忘了重新打包, 最容易让人摸不着头脑)
bundle_is_stale() {
    [ -f dist/sub-store.bundle.js ] || return 1
    # 只比普通文件: 目录 mtime 会因为增删文件变化, 不是"源码改过"的信号
    [ -n "$(find src config package.json -type f -newer dist/sub-store.bundle.js -print -quit 2>/dev/null)" ]
}

ensure_deps() {
    [ -f node_modules/.bin/babel-node ] && return 0
    if [ "${AUTO_INSTALL:-1}" != "1" ]; then
        err "缺少 node_modules, 请先执行: pnpm install"
        return 1
    fi
    command -v pnpm >/dev/null 2>&1 || command -v corepack >/dev/null 2>&1 || {
        err "未找到 pnpm/corepack, 无法自动安装依赖"
        return 1
    }
    warn "首次运行, 正在安装依赖 (可能需要几分钟)..."
    notify "首次运行: 正在安装依赖, 请稍候…"
    if command -v pnpm >/dev/null 2>&1; then
        pnpm install --frozen-lockfile >>"$LOG_FILE" 2>&1
    else
        corepack pnpm install --frozen-lockfile >>"$LOG_FILE" 2>&1
    fi
}

# ---------- 前端 ----------
frontend_dist() {
    [ -f web/dist/index.html ] && echo "web/dist"
}

prepare_frontend() {
    local dist
    dist="$(frontend_dist)"
    case "${MERGE_FRONTEND:-auto}" in
        0|false|no) return 0 ;;
    esac
    if [ -n "$dist" ]; then
        export SUB_STORE_BACKEND_MERGE=true
        export SUB_STORE_FRONTEND_PATH="$ROOT/$dist"
        export SUB_STORE_FRONTEND_BACKEND_PATH=/
        prepare_cors
        return 0
    fi
    if [ "${MERGE_FRONTEND:-auto}" = "1" ]; then
        warn "MERGE_FRONTEND=1 但找不到 web/dist, 请先执行: bash scripts/build-web.sh"
    fi
    return 0
}

# 单端口模式下页面会白屏, 大多是这个原因:
#   Vite 产出的 <script type="module" crossorigin> 会以 CORS 模式加载 /assets/*.js,
#   浏览器会带上 Origin: http://127.0.0.1:<端口>, 而内核默认白名单只有
#   sub-store.vercel.app / substore.stash —— 于是静态资源被 403, 页面空白。
#   浏览器的 POST 同样会带 Origin (例如 /api/short), 所以 API 也跟着挂。
#   curl 不带 Origin, 所以只测接口时看不出问题。
# 对策: 给内核一个自定义名字 —— 此时内核会自动放行 http://localhost|127.0.0.1:<任意端口>;
#   用户若自己设过 SUB_STORE_CORS_ALLOWED_ORIGINS, 就把自身来源追加进去。
#   监听 0.0.0.0 时上面那条"本机放行"不覆盖局域网 IP, 所以自己把白名单拼出来。
#
# 隧道 / 反向代理 (Cloudflare Tunnel、Nginx、Caddy…) 是同一个坑的另一个入口:
#   浏览器看到的站点是 https://<你的域名>, 它送进来的 Origin 就是这个域名, 既不在
#   内核白名单里, 也不属于"本机放行"那两条 —— 于是 module 脚本 403 (页面白屏),
#   所有 POST/PUT 也 403。现场长这样: Cloudflare 的 cdn-cgi/rum 心跳能通, 业务全挂。
#   → 声明公网地址即可 (config/subhub.json 的 publicBaseUrl, 或 SUBHUB_PUBLIC_URL),
#     启动时自动进白名单; 同一个值也用于生成订阅链接的绝对地址。

# 内核默认白名单 (src/utils/cors.js 的 NODE_CORS_DEFAULT)。
# 之所以抄一份: 监听非回环地址时要自己拼白名单, 不能让内核原本默认放行的来源静默失效。
SUBHUB_CORS_KERNEL_DEFAULTS="https://sub-store.vercel.app,http://substore.stash,https://substore.stash"

# 对外访问本服务的公网地址 (不含路径), 没声明就返回空
public_origin() {
    local value="${SUBHUB_PUBLIC_URL:-}" json="$ROOT/config/subhub.json"
    if [ -z "$value" ] && [ -f "$json" ]; then
        value="$("${SUBHUB_NODE:-node}" -e '
            try {
                const fs = require("fs");
                const config = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
                process.stdout.write(`${config.publicBaseUrl ?? ""}`.trim());
            } catch (e) {
                process.stdout.write("");
            }
        ' "$json" 2>/dev/null || true)"
    fi
    [ -z "$value" ] && return 0
    value="${value%/}"
    case "$value" in
        http://*|https://*) printf '%s' "$value" ;;
        *) warn "publicBaseUrl 要是 http(s):// 开头的完整地址 (当前: $value), 已忽略" >&2 ;;
    esac
    return 0
}

prepare_cors() {
    export SUB_STORE_BACKEND_CUSTOM_NAME="${SUB_STORE_BACKEND_CUSTOM_NAME:-SubHub}"

    local extra="http://127.0.0.1:$PORT,http://localhost:$PORT" ip lan="" origin public=""
    case "${BIND_HOST:-127.0.0.1}" in
        127.0.0.1|localhost|"") ;;
        0.0.0.0|::|\*)
            # 对外监听: 把本机 IP 一起放行, 否则局域网里打开界面是白屏
            for ip in $(hostname -I 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9]+(\.[0-9]+){3}$'); do
                lan="$lan,http://$ip:$PORT"
            done
            ;;
        *) lan=",http://$BIND_HOST:$PORT" ;;
    esac
    public="$(public_origin)"
    extra="$extra$lan"
    if [ -n "$public" ]; then
        extra="$extra,$public"
    fi

    if [ -n "${SUB_STORE_CORS_ALLOWED_ORIGINS:-}" ]; then
        # 用户自己设过白名单 (此时内核不再启用"本机自动放行"): 把自己这些来源补齐。
        # 逐个判断而不是只看第一个, 否则漏掉公网域名照样白屏。
        for origin in ${extra//,/ }; do
            case ",${SUB_STORE_CORS_ALLOWED_ORIGINS}," in
                *",$origin,"*) ;;
                *) SUB_STORE_CORS_ALLOWED_ORIGINS="${SUB_STORE_CORS_ALLOWED_ORIGINS},$origin" ;;
            esac
        done
        export SUB_STORE_CORS_ALLOWED_ORIGINS
    elif [ -n "$lan" ] || [ -n "$public" ]; then
        # 有对外来源时不能再依赖内核的"本机自动放行"(只在默认策略下生效), 自己拼全
        export SUB_STORE_CORS_ALLOWED_ORIGINS="${SUBHUB_CORS_KERNEL_DEFAULTS},${extra}"
    fi

    if [ -n "$public" ]; then
        # 传给内核子进程: 生成的订阅链接/短链用同一个地址 (src/unified/config.js)。
        # env/setsid 会继承已导出的变量, 不用再单独列出。
        export SUBHUB_PUBLIC_URL="$public"
        say "公网地址 $public 已加入 CORS 白名单"
    elif [ -n "${SUBHUB_PUBLIC_URL:-}" ]; then
        # 值不合法 (public_origin 里已提示): 别让它继续干扰生成的链接
        unset SUBHUB_PUBLIC_URL
    fi
    return 0
}

# ---------- 启动 ----------
do_start() {
    # 端口被环境变量塞了无效值 (例如某些环境会给 PORT=0) 时, 只在启动时说一声
    if [ -n "$RAW_PORT" ] && [ "$RAW_PORT" != "$PORT" ]; then
        warn "端口 '$RAW_PORT' 不可用 (空 / 0 / 非数字), 已按 $PORT 启动"
    fi

    if is_running; then
        warn "SubHub 已经在运行 (pid $(pid_of 2>/dev/null || find_by_pattern))"
        if [ "${OPEN_BROWSER:-auto}" != "0" ]; then
            [ -n "$(frontend_dist)" ] && open_url "$BASE_URL"
        fi
        say "地址: $BASE_URL   停止: ./stop.sh"
        return 0
    fi

    mkdir -p "$RUN_DIR" "$LOG_DIR" "$SUB_STORE_DATA_BASE_PATH"

    if port_is_listening; then
        err "端口 $PORT 已被其它进程占用, 请修改 PORT 或先释放端口"
        return 1
    fi

    # node 找不到是双击启动最常见的原因 (GUI 里的 PATH 没有 ~/.bashrc 那些设置)
    if ! subhub_bootstrap_runtime; then
        notify "启动失败: 找不到 node"
        return 1
    fi

    ensure_deps || return 1

    local mode
    mode="$(select_mode)"
    if [ -z "$mode" ]; then
        err "既没有 dist/sub-store.bundle.js 也没有 node_modules"
        err "请执行: pnpm install && bash scripts/build.sh"
        return 1
    fi

    prepare_frontend

    local cmd
    if [ "$mode" = "bundle" ]; then
        if bundle_is_stale; then
            warn "dist/sub-store.bundle.js 比 src/ 旧 (源码改过但没重新打包)"
            warn "建议先执行: bash scripts/build.sh  (或 FORCE_MODE=dev ./start.sh 直接跑源码)"
        fi
        cmd="node dist/sub-store.bundle.js"
    else
        cmd="./node_modules/.bin/babel-node src/main.js"
        warn "使用源码模式 (babel-node, 启动较慢); 建议执行 bash scripts/build.sh 生成单文件产物"
    fi

    {
        echo ""
        echo "===== $(date '+%F %T') 启动 (mode=$mode, port=$PORT) ====="
    } >>"$LOG_FILE"

    # 后台拉起: setsid 让进程脱离本会话 (关掉终端也不会被回收), nohup 兜底
    # shellcheck disable=SC2086
    if command -v setsid >/dev/null 2>&1; then
        setsid env \
            SUBHUB_HOME="$SUBHUB_HOME" \
            SUB_STORE_DATA_BASE_PATH="$SUB_STORE_DATA_BASE_PATH" \
            SUB_STORE_BACKEND_API_HOST="$BIND_HOST" \
            SUB_STORE_BACKEND_API_PORT="$PORT" \
            ${SUB_STORE_BACKEND_MERGE:+SUB_STORE_BACKEND_MERGE="$SUB_STORE_BACKEND_MERGE"} \
            ${SUB_STORE_FRONTEND_PATH:+SUB_STORE_FRONTEND_PATH="$SUB_STORE_FRONTEND_PATH"} \
            ${SUB_STORE_FRONTEND_BACKEND_PATH:+SUB_STORE_FRONTEND_BACKEND_PATH="$SUB_STORE_FRONTEND_BACKEND_PATH"} \
            ${SUB_STORE_BACKEND_CUSTOM_NAME:+SUB_STORE_BACKEND_CUSTOM_NAME="$SUB_STORE_BACKEND_CUSTOM_NAME"} \
            ${SUB_STORE_CORS_ALLOWED_ORIGINS:+SUB_STORE_CORS_ALLOWED_ORIGINS="$SUB_STORE_CORS_ALLOWED_ORIGINS"} \
            $cmd >>"$LOG_FILE" 2>&1 </dev/null &
    else
        nohup env \
            SUBHUB_HOME="$SUBHUB_HOME" \
            SUB_STORE_DATA_BASE_PATH="$SUB_STORE_DATA_BASE_PATH" \
            SUB_STORE_BACKEND_API_HOST="$BIND_HOST" \
            SUB_STORE_BACKEND_API_PORT="$PORT" \
            ${SUB_STORE_BACKEND_MERGE:+SUB_STORE_BACKEND_MERGE="$SUB_STORE_BACKEND_MERGE"} \
            ${SUB_STORE_FRONTEND_PATH:+SUB_STORE_FRONTEND_PATH="$SUB_STORE_FRONTEND_PATH"} \
            ${SUB_STORE_FRONTEND_BACKEND_PATH:+SUB_STORE_FRONTEND_BACKEND_PATH="$SUB_STORE_FRONTEND_BACKEND_PATH"} \
            ${SUB_STORE_BACKEND_CUSTOM_NAME:+SUB_STORE_BACKEND_CUSTOM_NAME="$SUB_STORE_BACKEND_CUSTOM_NAME"} \
            ${SUB_STORE_CORS_ALLOWED_ORIGINS:+SUB_STORE_CORS_ALLOWED_ORIGINS="$SUB_STORE_CORS_ALLOWED_ORIGINS"} \
            $cmd >>"$LOG_FILE" 2>&1 </dev/null &
    fi
    echo $! >"$PID_FILE"
    disown 2>/dev/null || true

    say "正在启动 (pid $(cat "$PID_FILE"), mode=$mode)..."
    if wait_ready; then
        ok "SubHub 已启动"
        say "  地址:     $BASE_URL"
        say "  统一 API: $BASE_URL/api/v1"
        say "  兼容层:   $BASE_URL/api/sub?target=mihomo&url=<订阅>"
        if [ -n "${SUB_STORE_FRONTEND_PATH:-}" ]; then
            say "  前端:     $BASE_URL  (单端口模式)"
        else
            warn "未构建前端 (web/dist 不存在), 当前只有 API; 需要界面请执行: bash scripts/build-web.sh"
        fi
        say "  日志:     $LOG_FILE"
        say "  停止:     ./stop.sh"
        notify "已启动: $BASE_URL"
        if [ "${OPEN_BROWSER:-auto}" != "0" ]; then
            if [ -n "${SUB_STORE_FRONTEND_PATH:-}" ]; then
                open_url "$BASE_URL"
            elif [ ! -t 1 ]; then
                open_url "$BASE_URL/api/v1"
            fi
        fi
        return 0
    fi

    err "启动超时, 最近日志:"
    tail -n 20 "$LOG_FILE" >&2
    return 1
}

# ---------- 停止 ----------
do_stop() {
    local pid
    pid="$(pid_of 2>/dev/null)"
    local fallback
    fallback="$(find_by_pattern)"

    if [ -z "$pid" ] && [ -z "$fallback" ]; then
        warn "SubHub 未在运行"
        rm -f "$PID_FILE"
        return 0
    fi

    for target in $pid $fallback; do
        kill "$target" 2>/dev/null || true
    done

    local i=0
    while [ "$i" -lt 15 ]; do
        if [ -z "$(pid_of 2>/dev/null)$(find_by_pattern)" ]; then
            break
        fi
        sleep 1
        i=$((i + 1))
    done

    local left
    left="$(find_by_pattern)"
    if [ -n "$left" ]; then
        warn "进程未退出, 强制结束: $left"
        for target in $left $pid; do kill -9 "$target" 2>/dev/null || true; done
        sleep 1
    fi

    rm -f "$PID_FILE"
    ok "SubHub 已停止"
    notify "SubHub 已停止"
}

# ---------- 状态 ----------
do_status() {
    local pid
    pid="$(pid_of 2>/dev/null)"
    echo "SubHub 状态"
    echo "  运行目录: $ROOT"
    echo "  监听:     $BIND_HOST:$PORT   (访问: $BASE_URL)"
    echo "  数据目录: $SUB_STORE_DATA_BASE_PATH"
    echo "  运行模式: $(select_mode || echo '未就绪')"
    echo "  node:     $(subhub_find_bin node 2>/dev/null || echo '未找到 (./start.sh 会给出详细提示)')"
    echo "  日志:     $LOG_FILE"
    if [ -n "$pid" ]; then
        echo "  进程:     运行中 (pid $pid)"
    elif [ -n "$(find_by_pattern)" ]; then
        echo "  进程:     运行中 (pid $(find_by_pattern), 无 pid 文件)"
    else
        echo "  进程:     未运行"
    fi
    if curl -sf -m 3 "http://127.0.0.1:${PORT}/api/v1" >/dev/null 2>&1; then
        echo "  健康检查: 通过"
    else
        echo "  健康检查: 未响应"
    fi
    if [ -f "$LOG_FILE" ]; then
        echo ""
        echo "最近日志:"
        tail -n 15 "$LOG_FILE"
    fi
}

do_logs() {
    [ -f "$LOG_FILE" ] || { warn "还没有日志文件: $LOG_FILE"; return 0; }
    case "${1:-}" in
        -f|--follow|follow) tail -n 60 -f "$LOG_FILE" ;;
        help|-h|--help)     echo "用法: ./logs.sh [-f] [行数]   (默认看最近 60 行, -f 实时跟踪)" ;;
        *)                  tail -n "${1:-60}" "$LOG_FILE" ;;
    esac
}

do_url() {
    echo "$BASE_URL"
    [ -n "$(frontend_dist)" ] && echo "$BASE_URL  (前端 + API 同端口)" || echo "$BASE_URL/api/v1  (当前仅 API)"
}

do_open() {
    if ! is_running; then
        err "SubHub 没有在运行, 先执行: ./start.sh"
        return 1
    fi
    open_url "$BASE_URL"
}

# ---------- 前端构建 ----------
do_build_web() {
    subhub_bootstrap_runtime || return 1

    if [ -f web/dist/index.html ] && [ "${FORCE:-0}" != "1" ]; then
        ok "web/dist 已存在 (强制重建: FORCE=1 bash scripts/build-web.sh)"
        return 0
    fi
    command -v yarn >/dev/null 2>&1 || command -v corepack >/dev/null 2>&1 ||
        [ -n "$(subhub_find_bin yarn 2>/dev/null)" ] || {
            err "需要 yarn (或 corepack), 请先安装"
            return 1
        }
    mkdir -p "$LOG_DIR"
    warn "正在安装前端依赖并构建 (首次可能需要几分钟)..."
    notify "开始构建 SubHub 前端…"
    (
        cd web || exit 1
        # subhub_yarn 会绕开 corepack 对根 package.json (pnpm) 的 project-spec 校验
        subhub_yarn install && subhub_yarn build
    ) 2>&1 | tee -a "$LOG_DIR/web-build.log"
    if [ -f web/dist/index.html ]; then
        ok "前端构建完成: web/dist"
        notify "前端构建完成, 现在 ./start.sh 即可用界面"
        return 0
    fi
    err "前端构建失败, 详见 $LOG_DIR/web-build.log"
    return 1
}

usage() {
    cat <<'EOF'
SubHub 一键管理

根目录脚本 (可直接双击):
  ./start.sh              启动 (后台运行, 自动挑运行模式, 就绪后打开浏览器)
  ./stop.sh               停止
  ./restart.sh            重启
  ./status.sh             查看状态 + 最近日志
  ./logs.sh [-f] [行数]   看日志 (-f 实时跟踪)
  ./desktop.sh install    安装可双击的桌面启动器 (菜单 + 桌面图标)

子命令 (等价):
  bash scripts/manage.sh {start|stop|restart|status|logs|open|url|build-web|desktop}
  bash scripts/manage.sh desktop [install|uninstall|make]

常用环境变量 (可写进 .env):
  PORT=9635              监听端口
  LAN=1                  监听 0.0.0.0, 局域网可访问
  PUBLIC_HOST=1.2.3.4    打印/打开链接时用的地址
  MERGE_FRONTEND=1       单端口托管 web/dist 前端 (有 dist 时默认开)
  OPEN_BROWSER=0         启动后不打开浏览器
  AUTO_INSTALL=0         缺依赖时报错而不是自动 pnpm install
  FORCE_MODE=dev|bundle  强制源码模式 / 打包模式
  FORCE=1                配合 build-web 强制重建前端

示例:
  PORT=8080 ./start.sh          # 换端口启动
  LAN=1 ./start.sh              # 让局域网设备访问
  FORCE_MODE=dev ./start.sh     # 用源码模式 (改代码即时生效)
EOF
}

# ---------- 入口 ----------
case "${1:-status}" in
    start)      do_start ;;
    stop)       do_stop ;;
    restart)    do_stop; do_start ;;
    status)     do_status ;;
    logs)       shift || true; do_logs "${1:-60}" ;;
    open)       do_open ;;
    url)        do_url ;;
    build-web)  do_build_web ;;
    desktop)    shift || true; bash scripts/desktop.sh "${1:-install}" ;;
    help|-h|--help|usage) usage ;;
    *)
        usage
        exit 1
        ;;
esac
