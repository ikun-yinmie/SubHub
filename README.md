# SubHub — 节点 / 订阅转换中枢

把 5 个上游项目**深度合并成一个可长期演进的单一工程**：

| 角色 | 来源 | 许可证 | 在本项目中的形态 |
| --- | --- | --- | --- |
| **内核**（协议解析 / 生成 / 订阅管理 / 产物同步） | [Sub-Store](https://github.com/sub-store-org/Sub-Store) | AGPL-3.0 | `src/` 全部源码吸收进来，作为本工程自己的代码 |
| **统一层**（多引擎、模板、节点库、兼容层） | 本工程新增 | AGPL-3.0 | `src/unified/` |
| **subconverter 兼容语义**（`/sub`、`/version`、snippets、rulesets） | [subconverter](https://github.com/tindy2013/subconverter)、[SubConverter-Extended](https://github.com/Aethersailor/SubConverter-Extended) | GPL-3.0 | 语义与素材被吸收进统一层，原项目保留在 `engines/` 作为可选引擎与参照 |
| **节点库 / 分组 / 模板思路** | [sublinkX](https://github.com/gooaclok819/sublinkX) | MIT | 模型吸收进 `src/unified/nodes.js`、`config/templates/` |
| **内置前端** | [sub-web](https://github.com/CareyWang/sub-web) | MIT | `web/` 源码吸收，默认指向本工程的自托管 API |

> 合并方式说明：**Sub-Store 的后端源码 = 本工程源码**（`src/core`、`src/restful`、`src/utils` …），
> 其余项目不复制代码，而是把**能力**（兼容协议、模板、数据集）实现进统一层，原仓库留在 `engines/` 里继续可用。
> 完整归属与许可证见 [NOTICE.md](NOTICE.md)。

---

## 一、它现在能做什么

```
                         ┌──────────────────────────── 你的入口 ────────────────────────────┐
 分享链接 / clash / sing-box /   ─┐
 QuantumultX / surge 配置        │        ┌──────────────────────────────┐
 订阅 URL（可多个, 用 | 分隔）   ├──────▶ │  SubHub 统一 API  /api/v1/*  │
 节点库（自己收集的节点）        │        └──────────────┬───────────────┘
 规则集文件 / URL                ─┘                       │
                                                          ▼
                            ┌──────────────────────────────────────────────────────┐
                            │ 统一层 src/unified                                    │
                            │  目标表 targets  · 处理管线 pipeline（过滤/重命名/emoji/去重/排序）
                            │  模板 templates  · 节点库 nodes  · 规则 rules         │
                            └──────────────┬───────────────────────┬───────────────┘
                                           ▼                       ▼
                       ┌────────────────────────────┐   ┌──────────────────────────┐
                       │ 内核 Sub-Store（JS 源码）  │   │ 可选外部引擎             │
                       │ 15+ 客户端 producer        │   │ subconverter (C++)       │
                       │ 解析器 / 规则 / 订阅 / 同步│   │ SubConverter-Extended    │
                       └────────────────────────────┘   │ sublinkX (Go)            │
                                                        └──────────────────────────┘
                       输出：mihomo / clash / sing-box / surge / loon / QX / stash /
                            surfboard / shadowrocket / egern / 分享链接 / Base64 / SSD / 订阅页
```

* **一个进程、一套 API**：`/api/v1/convert` 一个入口，`target=` 决定输出形态。
* **完整配置靠模板，节点靠内核**：`config/templates/mihomo.yaml`、`surge.conf`、`singbox.json` 是"外壳"，`{{proxies}}` / `{{outbounds_json}}` 会被替换成真实节点。
* **subconverter 兼容**：`/api/sub?target=clash&url=...&list=true`、`/api/version`、上传外部配置、自托管短链——现有客户端和 sub-web 都能直接指向它。
* **节点库**：把自己收集的节点入库、打标签/分组、去重、测延迟与归属，再用 `selection` 直接生成订阅。
* **规则/规则集**：`config/rulesets/`（吸收自 subconverter 的 ACL4SSR / DivineEngine / lhie1 / NobyDa）可一键转成 Clash rule-provider 或 Surge rule-set。
* **片段**：`config/snippets/emoji.txt` / `rename_node.txt`（吸收自 subconverter，已适配 JS 正则）用于自动打国旗、批量重命名。

---

## 二、快速开始

环境：Node 24+（内核要求），pnpm 11+。Debian/Deepin 上用源码模式开箱即跑。

### 1. 一键启停（推荐，支持文件管理器里双击）

根目录几个脚本就能管住整个服务（后台运行、PID 文件、日志、健康检查、自动开浏览器都在里面）：

```bash
./start.sh         # 启动（后台运行，就绪后自动打开浏览器）
./stop.sh          # 停止（最多等 15 秒，之后强制结束）
./restart.sh       # 重启
./status.sh        # 状态 + 健康检查 + 最近日志
./logs.sh -f       # 实时跟踪日志（./logs.sh 200 看最近 200 行）
```

**双击也能用**：在文件管理器里直接双击 `start.sh` / `stop.sh` / `status.sh` —— 检测到没有终端时
会自动开一个系统终端把过程显示出来，结束时停住等回车，不会一闪而过。
后端没有 tty 的场景（cron / systemd / 远程脚本）加 `SUBHUB_NO_TERMINAL=1` 即可禁用这个行为。

装一个双击即启动的桌面图标（应用菜单 + 桌面）：

```bash
bash scripts/desktop.sh install     # 生成 subhub-{start,stop,open}.desktop 并安装
bash scripts/desktop.sh uninstall   # 从菜单/桌面移除
bash scripts/desktop.sh make        # 只在项目根目录生成 .desktop，不安装
```

常用开关（临时加在命令前面，或写进 `.env` 长期生效）：

```bash
PORT=8080 ./start.sh       # 换端口
LAN=1 ./start.sh           # 监听 0.0.0.0，局域网设备可访问
OPEN_BROWSER=0 ./start.sh  # 启动后不打开浏览器
FORCE_MODE=dev ./start.sh  # 强制源码模式（默认：有 dist 产物就用产物）
AUTO_INSTALL=0 ./start.sh  # 缺依赖时报错，不自动 pnpm install
FORCE=1 bash scripts/build-web.sh   # 重建内置前端
```

双击 / 图标启动报错时先看这两条：

| 现象 | 原因与处理 |
| --- | --- |
| `env: "node": 没有那个文件或目录` / 启动超时 | node 装在 `~/.local/nodejs/bin` 这类**只写进 `~/.bashrc` 的目录**，桌面环境启动的进程没有这段 PATH。现在脚本会自己找一轮（PATH → `~/.local/nodejs/bin` → nvm/volta/asdf/fnm/mise → 登录 shell 的 PATH），找到就自动补进 PATH 并打印一行提示；真找不到时在 `.env` 写 `SUBHUB_NODE_DIR=/你的/node/bin`。`./status.sh` 会显示当前认到的是哪个 node。 |
| 图标点了没反应 / 提示"不可信" | 用 `bash scripts/desktop.sh install` 安装（会写 `~/.local/share/applications` 并标记 trusted）；项目里的 `subhub-*.desktop` 也会带上 trusted 标记，但部分文件管理器仍要求先右键选一次"允许启动"。 |
| 打开 `http://127.0.0.1:9635` 是**白屏**，控制台一堆 403 | Vite 产出的 `<script type="module" crossorigin>` 浏览器会按 CORS 模式加载（带 `Origin` 头），而内核默认 CORS 白名单里只有 `sub-store.vercel.app` / `substore.stash`，于是 `/assets/*.js`、`/favicons/*` 被拒，页面空白（接口也跟着挂，因为 POST 也带 `Origin`；curl 不带 `Origin` 所以只测接口看不出来）。现在 `./start.sh` 会自动给内核一个名字 `SUB_STORE_BACKEND_CUSTOM_NAME=SubHub`，内核随之放行 `http://localhost:<任意端口>` / `http://127.0.0.1:<任意端口>`；`LAN=1` 监听 `0.0.0.0` 时还会自动把本机 IPv4 加进白名单。自己设过 `SUB_STORE_CORS_ALLOWED_ORIGINS` 时脚本会在其后追加自身来源（后端口径见 `./logs.sh` 的 `[CORS] allowed origins:` 一行）。 |
| 走 Cloudflare Tunnel / Nginx 反代后**只有 HTML 能开**，`.js` 一律 `403 (Forbidden)` | 同上一个坑的另一种入口：隧道把你的公网域名当 `Origin` 送进来，而白名单里没有它。把公网地址写进 `.env` 的 `SUBHUB_PUBLIC_URL=https://你的域名`（推荐：`.env` 已在 `.gitignore` 里，域名不会进仓库；等效写法是 `config/subhub.json` 的 `publicBaseUrl`），`./start.sh` 启动时会自动加进 CORS 白名单并打印一行提示；同一个值也用于生成订阅链接/短链的**绝对地址**，一举两得。临时覆盖可以 `SUBHUB_PUBLIC_URL=https://... ./start.sh`。注意 `./logs.sh` 里能看到最终白名单，白名单外的 `Origin` 依旧 403（防止 DNS-rebinding 的页面通过浏览器读你的节点）。 |

启动脚本自己选运行模式：有 `dist/sub-store.bundle.js` 就用它（秒起）；否则回退到 `babel-node` 源码模式。
改过 `src/` 但忘了重新打包时，它会提示 `dist/sub-store.bundle.js 比 src/ 旧`，不会静默跑旧产物
（此时此刻要么 `bash scripts/build.sh` 重新打包，要么 `FORCE_MODE=dev ./start.sh` 直接跑源码）。
默认端口 **9635**（与本机其它服务不打架），改端口随时 `PORT=8080 ./start.sh` 或在 `.env` 里写 `PORT=9635` 长期生效。
存在 `web/dist` 时自动单端口同时提供 **界面 + API**（访问 `http://127.0.0.1:9635`），没有就只提供 API。
第一次要把界面做出来，先构建一次前端（会自动装依赖，几分钟；以后改 `web/` 再用 `FORCE=1` 重建）：

```bash
bash scripts/build-web.sh            # web/ -> web/dist（已有产物则跳过）
FORCE=1 bash scripts/build-web.sh    # 强制重建
```

### 2. 源码模式（开发 / 个性化首选）

```bash
pnpm install --frozen-lockfile      # 首次；已有 node_modules 可跳过
bash scripts/dev.sh                 # 默认 127.0.0.1:9635
# 以后台方式 + 换端口:
PORT=9876 nohup bash scripts/dev.sh > subhub.log 2>&1 &
```

启动日志会打印：

```
[sub-store] INFO: [SUBHUB] 统一层已挂载: v1.0.0 (内核 v2.41.2)
[sub-store] INFO: [BACKEND] listening on 127.0.0.1:9635
```

自检：

```bash
curl -s http://127.0.0.1:9635/api/v1 | head
node scripts/smoke-test.mjs          # 65 项冒烟测试 (默认打 127.0.0.1:9635)
SUBHUB_BASE=http://127.0.0.1:9635 node scripts/smoke-test.mjs   # 换端口时显式指定
```

### 3. 单文件生产模式

```bash
bash scripts/build.sh                            # -> dist/sub-store.bundle.js (自带全部依赖)
MERGE_FRONTEND=1 BUILD_WEB=1 bash scripts/build.sh   # 顺便构建内置前端 web/dist
bash scripts/serve.sh                            # 只跑 bundle, 不需要 node_modules
MERGE_FRONTEND=1 bash scripts/serve.sh            # 后端 + 前端单端口 (http://127.0.0.1:9635)
```

### 4. Docker

```bash
docker compose up -d                    # 合并内核 (9635)
docker compose --profile engines up -d  # 附带官方 subconverter 镜像 (25500)
```

数据落在 `./data`（`sub-store.json`、`root.json`、节点库等），配置在 `./config`，两者都已挂载。

---

## 三、统一 API（节选）

详细参数见 [docs/api.md](docs/api.md)。

```bash
# 1) 节点 / 订阅 -> Mihomo 完整配置
curl -s -X POST http://127.0.0.1:9635/api/v1/convert \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com/sub","target":"mihomo","emoji":true,"exclude":"官网|剩余|流量"}'

# 2) 只输出节点列表 (等价 subconverter 的 list=true)
curl -s -X POST .../api/v1/convert -d '{"data":"ss://...#HK-1","target":"mihomo","list":true}'

# 2b) 手上只有节点、没有订阅地址: 直接丢链接即可 (多个用换行或 | 分隔,
#     也接受整段 base64; url 与 data 可以混着给, 不需要先凑出一个订阅 URL)
curl -s -X POST .../api/v1/convert -d '{"url":"ss://...#HK-1\nvmess://...#JP-2","target":"sing-box"}'
curl -s ".../api/sub?target=surge&url=$(python3 -c 'import urllib.parse;print(urllib.parse.quote("ss://...#HK-1|vmess://...#JP-2"))')" > surge.conf

# 3) 反向：整段 Clash / mihomo YAML 配置 -> 分享链接 / Base64 订阅
#    (整段原样给, 含缩进/注释/proxy-groups/rules 都行, 只取 proxies)
curl -s -X POST .../api/v1/convert --data-binary @<(python3 - <<'PY'
import json, pathlib
print(json.dumps({"data": pathlib.Path("clash.yaml").read_text(), "target": "base64"}))
PY
)

# 4) 只解析统计 (协议分布 / 国旗分布 / 过滤结果)
curl -s -X POST .../api/v1/inspect -d '{"url":"https://example.com/sub"}'

# 5) 节点库：入库 -> 打标签 -> 按标签生成订阅
curl -s -X POST .../api/v1/nodes -d '{"raw":"<节点链接或多行>","tags":["自建"],"group":"主力"}'
curl -s -X POST .../api/v1/convert -d '{"target":"mihomo","selection":{"tags":["自建"]}}'

# 6) 节点探测 (TCP 握手延迟 + IP 归属, 带缓存)
curl -s -X POST .../api/v1/nodes/probe -d '{"tags":["自建"],"timeout":3000}'

# 7) 规则集 -> Clash rule-provider / Surge rule-set
curl -s -X POST .../api/v1/rules/convert -d '{"ruleset":"LocalAreaNetwork.list","target":"Clash"}'
```

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/v1` `/api/v1/info` | 能力、版本、目标表、引擎状态、存储统计 |
| GET | `/api/v1/targets` | 统一目标表（含 subconverter 别名映射） |
| POST/GET | `/api/v1/convert` | 统一转换（`data`/`url`/`selection` → 任意目标） |
| POST | `/api/v1/inspect` | 只解析与统计 |
| POST | `/api/v1/render` | 强制走模板渲染 |
| POST | `/api/v1/rules/convert` | 规则/规则集转换 |
| GET | `/api/v1/rulesets` `/api/v1/snippets` `/api/v1/templates` | 素材清单 |
| GET/POST/PUT/DELETE | `/api/v1/nodes` `/api/v1/nodes/:id` | 节点库 CRUD、导入、批量删除 |
| GET | `/api/v1/nodes/export` | 导出分享链接 / JSON / Base64 |
| POST | `/api/v1/nodes/prune` `/api/v1/nodes/probe` | 去重、批量探测 |
| GET/POST/DELETE | `/api/v1/groups` | 分组管理 |
| GET | `/api/v1/engines?probe=true` | 外部引擎探活 |

> 所有统一接口同时注册在**根路径**（`/v1/convert`）与 `/api/v1/*`。请优先用 `/api/v1/*`：单端口合并模式下只有 `/api/*` 会被路由到后端。

## 四、subconverter 兼容层

| 兼容接口 | 说明 |
| --- | --- |
| `GET /api/sub?target=&url=&list=&include=&exclude=&rename=&emoji=&prepend=&append=&sort=&interval=&filename=` | 与 subconverter 同样的调用方式；`url` 支持多个订阅用 `|` 分隔，也支持整段 base64 查询串 |
| `url` 直接放节点链接 | `ss://` `vmess://` `vless://` `trojan://` `hysteria2://` … 任意 scheme 都行（传多行、`\|` 分隔、整段 base64 均可）——不必先有订阅地址。判定规则：`http(s)://` 与 `/` 开头才去下载，其余认成本地内容；`data` 与 `url` 可同时给，会合并 |
| `url` / `data` 放整段配置 | **Clash / mihomo YAML、Surge 配置直接粘整段即可**（识别到 `proxies:` `proxy-groups:` `outbounds:` 等根级键就按整段原样处理：不逐行 trim（会削平 YAML 缩进）、也不把 `|` 当分隔符，`#` 注释与 `proxy-groups`/`rules` 会被忽略而只取 `proxies`）。sing-box 配置暂不能作为**输入**（只能作为输出目标），会返回明确提示 |
| `GET /api/version` | sub-web 会读取它显示版本（返回 `SubHub vX backend` + 内核版本） |
| `config=<模板名或 http 地址>` | 本实现里表示"外壳模板"：含 `{{token}}` 则渲染，否则按 `insert` 语义注入节点 |
| `insert=true` | 把节点注入到 `config` 指向的配置里（等价 subconverter 的 insert） |
| `POST /api/upload` + `GET /api/c/:id` | 自托管"外部配置"托管（替代第三方 OSS），sub-web 的"配置上传"直接可用 |
| `POST /api/short` + `GET /api/s/:id` | 自托管短链接（替代第三方短链服务），响应结构兼容 sub-web 期望的 `{Code,ShortUrl}` |
| `GET /api/sub?target=page&url=...` | 额外能力：生成自托管订阅主页（节点表格 + 各客户端订阅链接），模板在 `config/templates/subscription.html` |

`target` 命名兼容：`clash`（默认按 Mihomo 生成，可用 `SUBHUB_CLASH_IS_MIHOMO=false` 切回 Clash Premium 语义）、`clashr`、`clashmeta/meta/mihomo`、`stash`、`surge`、`surfboard`、`loon`、`quan/quanx`、`singbox`、`mixed`（= 明文分享链接）、`v2ray/v2rayn/v2rayng/sub`（= Base64 订阅，与 `base64` 同一输出）、`ss`、`ssr`、`ssd`、`json`、`page`。

### 让内置前端用起来

```bash
bash scripts/build-web.sh                 # 首次构建 (内部走 corepack 的 yarn 1)
MERGE_FRONTEND=1 bash scripts/serve.sh    # http://127.0.0.1:9635 同时是前端与后端
```

内置前端（Vue 3 + Vite）有两个页面，顶部标签切换：

| 页面 | 路径 | 干什么 |
| --- | --- | --- |
| 订阅转换 | `/` | sub-web 原有的模板：填订阅/节点 → 选客户端 → 生成订阅链接、短链、一键导入 Clash |
| 解析 / 转格式 | `/parse` | **输入订阅地址、节点链接（多行 / `\|` 分隔 / 整段 base64）或整段配置（Clash / mihomo YAML、Surge）→ 一次勾选多种输出格式 → 并列展示结果，可复制或下载** |

解析页的输出格式直接读 `/api/v1/targets`，后端加了新目标就会自动出现在页面上（当前 18 个：mihomo / clash / stash / surge / surgemac / qx / loon / sing-box / surfboard / shadowrocket / egern / 分享链接 / base64 / ss / ssr / ssd / 订阅页 / 内部 JSON）。

**别名（subconverter 习惯的叫法）**：目标表里很多条目有别名，输出与规范名完全一致，所以页面上不会重复列成两个按钮。最常见的两组：

| 你习惯叫 | 实际就是 | 页面上怎么找 |
| --- | --- | --- |
| `v2ray` / `v2rayn` / `v2rayng` / `sub` | 分享链接 (Base64 订阅)，即 `base64` | 筛选框输 `v2ray`，按钮会补上「 · v2ray」提示 |
| `mixed` / `links` / `plain` | 分享链接 (明文)，即 `uri` | 筛选框输 `mixed` |

其余别名（如 `clashmeta`、`sing-box`、`quanx`、`sr`、`shadow-rocket`、`internal`…）在解析页右上角的**「别名对照」**里能一次看全，数据同样来自 `/api/v1/targets`；接口侧直接写 `target=v2ray` 一样能用。

`web/.env` 已指向本工程：后端 `/api`、短链 `/api/short`、配置上传 `/api/upload`（都是自托管，不再依赖第三方服务）。

## 五、个性化扩展点

| 想改什么 | 改哪里 |
| --- | --- |
| 输出配置的骨架（端口、DNS、策略组、规则） | `config/templates/mihomo.yaml` / `clash.yaml` / `surge.conf` / `singbox.json`，或新增 `<target>.yaml` 自动生效 |
| 订阅主页样式 | `config/templates/subscription.html` |
| 国旗 / 重命名规则 | `config/snippets/emoji.txt`、`config/snippets/rename_node.txt`（PCRE 写法已兼容，`(?i:)` 会自动适配） |
| 规则集素材 | `config/rulesets/`（按目录随意增删，`/api/v1/rulesets` 会自动列出） |
| 默认目标、引擎地址、探测服务 | `config/subhub.json` 或环境变量（见 `.env.example`） |
| 新增客户端目标 | `src/core/proxy-utils/producers/<name>.js` + 在 `src/unified/targets.js` 注册 |
| 新增处理管线步骤 | `src/unified/pipeline.js`（过滤/重命名/去重/排序都在这条链上） |
| 新增统一接口 | `src/unified/*.js` + 在 `src/unified/index.js` 注册路由 |

更细的说明见 [docs/personalization.md](docs/personalization.md)。

## 六、目录结构

```
├── src/                 # 内核（Sub-Store 源码）+ 统一层
│   ├── core/ restful/ utils/ vendor/ runtime/ products/   # 内核
│   └── unified/         # 本工程新增：targets/convert/pipeline/nodes/templates/rules/engines/compat
├── config/
│   ├── templates/       # 订阅外壳模板（含吸收自 sublinkX 的 upstream/ 参考模板）
│   ├── rulesets/        # 规则集（吸收自 subconverter base/rules）
│   ├── snippets/        # emoji / rename / groups 片段
│   ├── clients/         # 各客户端模块与片段（Surge sgmodule、QX snippet、Loon plugin…）
│   └── subhub.json      # 合并层配置
├── web/                 # 内置前端（吸收自 sub-web，已指向本工程 API）
├── scripts/             # dev / build / serve / smoke-test / manage.sh（启停核心）/ desktop.sh
├── start.sh stop.sh restart.sh status.sh logs.sh   # 一键启停（可双击）
├── docs/                # 架构、API、个性化、上游同步
├── verify/              # 回归样例（节点、各目标输出、调用示例）
├── engines/             # 5 个上游仓库原样保留（各自带 .git，可 pull 升级）
├── Dockerfile · compose.yaml · Makefile · .env.example · subhub-*.desktop（生成物）
```

## 七、验证状态

在本机（Deepin / Node 24.20）实测通过：

* `node scripts/smoke-test.mjs` → **65 项全部通过**：统一转换（mihomo/sing-box/surge/list/base64/QX/Loon）、过滤与重命名、模板、规则集、节点库 CRUD/导出/去重、订阅页、兼容层（远程订阅 + 模板、`list=true`、`config+insert`）、上传与短链、内核原生接口、**裸节点直转**（`url=` 直接塞分享链接 / 单条链接 / 整段 url-safe base64、`list=true`、`data` 与 `url` 混用、节点库导入同样形态、认不出的地址仍报 `REMOTE_FETCH_FAILED` 而不误判），以及**整段配置当输入**（Clash Verge YAML 经 `data` / `url` 两条路都解出全部节点、结果不含 `undefined`、`proxy-groups`/`rules` 不会被当成节点、sing-box 配置给出明确提示）。
* `node bundle-esbuild.js` → `dist/sub-store.bundle.js` 可直接 `node dist/sub-store.bundle.js` 运行，`/api/version`、`/api/sub` 均正常。
* 回归样例存放在 `verify/`（`nodes.txt` 为 5 种协议输入，`out_*.txt` 为对应输出）。
* 一键启停实测：`./start.sh` → `./status.sh` → `./logs.sh` → `./stop.sh` 全流程通过，停止后端口释放、无残留进程；
  删除 `.run/subhub.pid` 后仍能靠进程特征找到并停掉服务（只认 node 进程，不会误杀调用它的 shell）。
* 内置前端实测：`bash scripts/build-web.sh`（Vue 3.5 + Vite 8，走 corepack 的 yarn 1）产出 `web/dist`，`./start.sh` 日志出现
  `MERGE mode is [ON]` + `[BACKEND && FRONTEND] 127.0.0.1:9635`；浏览器打开 `http://127.0.0.1:9635` 界面完整渲染、
  头部版本号就是 `/api/version` 的实时内容（`SubHub v1.0.0 backend / kernel: Sub-Store v2.41.2`），
  在界面里粘贴订阅地址 →「生成订阅链接」得到的 `/api/sub?...` 直接返回 200 `text/yaml` 配置，短链/上传配置按钮也正常。
  换端口（`PORT=9701`）、局域网监听（`LAN=1` 后用 `http://192.168.x.x:9702` 带 `Origin` 请求静态资源）均返回 200。
* 内置前端两个页面实测：顶部标签可在「订阅转换」与「解析 / 转格式」间切换（`/` ↔ `/parse`），`/parse` 刷新也能直接打开（SPA 回退）。
  解析页里分别用**订阅地址**、**裸节点多行**、**整段 url-safe base64**、**订阅+节点混着粘**四种输入各跑一遍，识别提示正确（「订阅地址 N 个 / 节点 N 条」）；
  18 个输出格式全选后一次解析**全部成功**（SSD/SS/SSR 按协议自动只留 ss，订阅页出 HTML）；每个结果可复制（提示「…已复制」）、可按 `subhub-<目标>-<时间>.<扩展名>` 下载。
  失败时每个标签页单独标红并显示后端错误码（如 `[REMOTE_FETCH_FAILED] 拉取订阅失败: …`），不会静默失败。

## 八、许可证

本工程整体按 **AGPL-3.0** 发布（内核 Sub-Store 为 AGPL-3.0，被整体吸收）。
subconverter / SubConverter-Extended 为 GPL-3.0，sublinkX / sub-web 为 MIT——它们的能力与素材被吸收，归属于此已在 [NOTICE.md](NOTICE.md) 逐项标注。

> ⚠️ AGPL 要求：**若你把本服务开放给他人使用（对外提供网络服务），必须以源码形式提供对应版本的完整源码**。
> 个人自用（仅本机 / 局域网自己用）不受额外约束，但对外分享请遵守 AGPL。

## 九、与上游同步

`engines/` 里的 5 个仓库都是浅克隆（各带 `.git`）：

```bash
cd engines/Sub-Store && git pull --depth 1 origin main     # 内核更新
cd ../subconverter && git pull --depth 1 origin master       # 参照引擎更新
```

内核更新后如何安全合并进 `src/`，见 [docs/upstream.md](docs/upstream.md)。
