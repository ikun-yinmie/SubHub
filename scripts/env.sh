#!/usr/bin/env bash
# SubHub 运行环境自检 (被 manage.sh / dev.sh / serve.sh / build.sh 引用)
#
# 要解决的坑:
#   node 常装在 ~/.local/nodejs/bin 这类目录, 只有 ~/.bashrc / ~/.profile 里的 PATH 认它。
#   于是"终端里 ./start.sh 一切正常, 双击桌面图标却报 node: 没有那个文件或目录"。
#   这里在启动前主动把 node 找出来并补进 PATH, 找不到才报错, 并且把线索说清楚。
#
# 可用环境变量 (写进 .env 或临时加在命令前):
#   SUBHUB_NODE_DIR=/path/to/bin    指定 node 所在的 bin 目录
#   NODE_DIR=/path/to/bin           同上 (兼容写法)
#
# 导出:
#   SUBHUB_NODE          node 可执行文件的绝对路径
#   SUBHUB_NODE_VERSION  node -v 的输出
#   PATH                 已补上 node 所在目录

# 候选目录: 越常用的排越前
subhub_node_dirs() {
    local d
    for d in "${SUBHUB_NODE_DIR:-}" "${NODE_DIR:-}" \
        "$HOME/.local/nodejs/bin" \
        "$HOME/.local/bin" "$HOME/bin" \
        /usr/local/bin /usr/bin /usr/local/node/bin /opt/node/bin; do
        [ -n "$d" ] && [ -d "$d" ] && echo "$d"
    done
    # 版本管理器 (nvm / volta / asdf / fnm / mise / 手动解压的 nodejs)
    for d in "$HOME"/.nvm/versions/node/*/bin "$HOME"/.volta/bin "$HOME"/.asdf/shims \
        "$HOME"/.local/share/mise/shims "$HOME"/.local/share/fnm/aliases/default/bin \
        "$HOME"/nodejs/*/bin; do
        [ -d "$d" ] && echo "$d"
    done
}

# 找可执行文件: 先看 PATH, 再看候选目录, 最后问一次登录 shell
subhub_find_bin() {
    local name="$1" d p
    if command -v "$name" >/dev/null 2>&1; then
        command -v "$name"
        return 0
    fi
    while IFS= read -r d; do
        if [ -x "$d/$name" ]; then
            echo "$d/$name"
            return 0
        fi
    done < <(subhub_node_dirs)
    # 登录 shell 的 PATH 里通常什么都有 (~/.profile 会被读到)
    p="$(bash -lc "command -v $name" 2>/dev/null | grep -E '^/' | tail -n 1)"
    if [ -n "$p" ] && [ -x "$p" ]; then
        echo "$p"
        return 0
    fi
    return 1
}

# 跑 yarn 命令 (前端构建用)
#
# 坑: 系统里的 yarn 往往是 corepack 垫片, 一进仓库就读根 package.json 的
#   "packageManager": "pnpm@..." 然后拒绝干活:
#     This project is configured to use pnpm because ... has a "packageManager" field
#   而 web/ 用的是 yarn v1 (web/yarn.lock), 两边并不冲突。
#   关掉 project-spec 校验 + 允许 corepack 静默下载 yarn 即可稳定跑通。
subhub_yarn() {
    local yarn_bin
    yarn_bin="$(subhub_find_bin yarn 2>/dev/null || true)"

    if [ -z "$yarn_bin" ]; then
        if command -v corepack >/dev/null 2>&1; then
            COREPACK_ENABLE_PROJECT_SPEC=0 COREPACK_ENABLE_STRICT=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
                corepack yarn "$@"
            return $?
        fi
        printf '✘ 找不到 yarn —— 构建前端需要它 (Node 20+ 自带 corepack, 可运行 corepack enable)\n' >&2
        return 127
    fi

    COREPACK_ENABLE_PROJECT_SPEC=0 COREPACK_ENABLE_STRICT=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
        "$yarn_bin" "$@"
}

# 返回 0 = 运行环境就绪; 返回 1 = 真的没找到 node
subhub_bootstrap_runtime() {
    local node_bin node_dir ver major fixed=""

    node_bin="$(subhub_find_bin node)" || {
        printf '✘ 找不到 node —— SubHub 需要 Node 20+ (本工程在 Node 24 上验证)\n' >&2
        printf '  1) 装一个:  https://nodejs.org  或用系统包管理器\n' >&2
        printf '  2) 已装但不在 PATH 里: 在 .env 里写一行 SUBHUB_NODE_DIR=/你的/node/bin 即可\n' >&2
        return 1
    }

    SUBHUB_NODE="$node_bin"
    node_dir="$(dirname "$node_bin")"
    case ":$PATH:" in
        *":$node_dir:"*) ;;
        *)
            PATH="$node_dir:$PATH"
            fixed="$node_dir"
            ;;
    esac
    export PATH SUBHUB_NODE

    ver="$("$node_bin" -v 2>/dev/null)"
    SUBHUB_NODE_VERSION="$ver"
    export SUBHUB_NODE_VERSION

    if [ -n "$fixed" ]; then
        printf '! PATH 里没有 node, 已自动补上: %s (%s)\n' "$fixed" "${ver:-版本未知}"
    fi

    case "${ver#v}" in
        [0-9]*)
            major="${ver#v}"
            major="${major%%.*}"
            if [ "$major" -lt 20 ] 2>/dev/null; then
                printf '! node %s 版本偏旧, 建议升到 Node 20+ (内核按 Node 24 验证)\n' "$ver" >&2
            fi
            ;;
    esac

    return 0
}
