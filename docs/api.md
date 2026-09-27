# API 参考

基地址：`http://<host>:<port>`（默认 `127.0.0.1:9635`，可用 `PORT` / `SUB_STORE_BACKEND_API_PORT` 覆盖）。

统一层接口同时挂在 `/api/v1/*` 与 `/v1/*` 下；**推荐用 `/api/v1/*`**，因为单端口合并模式（后端 + 内置前端同端口）只把 `/api/*` 路由给后端。

统一响应格式（沿用内核约定）：

```json
{ "status": "success", "data": { ... } }
{ "status": "failed",  "error": { "code": "...", "type": "SUBHUB", "message": "...", "details": "..." } }
```

---

## 1. 信息类

| 接口 | 说明 |
| --- | --- |
| `GET /api/v1`、`GET /api/v1/info` | 版本（本层 + 内核）、目标表、引擎、模板/规则集/片段数量、存储统计、路由清单 |
| `GET /api/v1/targets` | 统一目标表：`id`、`label`、`format`、`kind`、别名、subconverter 对应名 |
| `GET /api/v1/templates` | `config/templates` 文件清单（`?name=` 时附带内容） |
| `GET /api/v1/rulesets` | `config/rulesets` 递归清单（`?name=` 时附带内容），并列出可用规则目标 |
| `GET /api/v1/snippets` | `config/snippets` 清单 |
| `GET /api/v1/engines` | 引擎配置与能力；`?probe=true` 或 `?id=subconverter` 时探活 |
| `GET /api/version` | `SubHub v1.0.0 backend` + 内核版本（sub-web 用于显示） |

## 2. 转换

### `POST /api/v1/convert`（也支持 GET + query）

输入三选一：

| 字段 | 说明 |
| --- | --- |
| `data` / `content` | 内联内容：分享链接（每行一个）、整段 base64（标准 / url-safe / 缺 padding 都行）、**整段 Clash / mihomo YAML 或 Surge 配置**（整段原样送进解析器，缩进不会被削） |
| `url` / `urls` | 订阅地址；多个用 `|` 分隔（与 subconverter 一致），失败可用 `ignoreFailedRemoteSub` 跳过。**也可以直接塞节点分享链接**（与 `data` 混着给会合并）：只有 `http(s)://` 和 `/` 开头的才当真去下载，其余认成本地内容。整段配置放这里同样按原样处理（检测到 `proxies:` / `outbounds:` 等根级键或 `{` `[` 开头时不再按行 trim、也不再把 `|` 当分隔符） |
| `selection` | 从节点库选择：`{ ids: [], tags: [], groups: [], includeDisabled }` |

其它参数：

| 字段 | 默认 | 说明 |
| --- | --- | --- |
| `target` / `client` / `platform` | `config.subhub.json` 的 `defaultTarget` | 目标平台，见 `/api/v1/targets` |
| `list` | `false` | 只输出节点定义（等价 subconverter `list=true`） |
| `include` / `exclude` | – | 名称正则，保留 / 剔除 |
| `include_remarks` / `exclude_remarks` | – | 同上（对备注/名称） |
| `types` / `exclude_types` | – | 按协议类型过滤，如 `vmess,vless` |
| `rename` | – | `旧@新`，逗号分隔多条；或传 `config/snippets` 中的片段文件名（如 `rename_node`） |
| `emoji` / `add_emoji` | `false` | 按 `config/snippets/emoji.txt` 给命中节点名前置国旗 |
| `remove_emoji` | `false` | 去掉节点名里的 emoji |
| `prepend` / `append` | – | 节点名前缀 / 后缀 |
| `sort` | – | `true`/`name`、`server`、`port`、`type`、`none` |
| `dedupe` | `true` | 按协议+地址+端口+凭据去重 |
| `includeUnsupportedProxy` | `false` | 保留目标平台不支持的节点 |
| `name` | – | 订阅名（模板中的 `{{title}}`、`{{name}}`） |
| `baseUrl` | – | 生成订阅页客户端链接时用的外部地址前缀 |

返回：`{ target, source, inputCount, count, format, template, warnings, stats, content }`。

### `POST /api/v1/inspect`

同上输入参数，但不生成配置，只返回统计：`summary.byType`（协议分布）、`summary.byFlag`（国旗分布）、`stats`（各阶段耗时与增删数量）、`nodes`（前 N 个，`limit` 控制，默认 50）。

### `POST /api/v1/render`

等价 `convert` 的 `list=false` 分支：强制走模板渲染，适合"我只要成品配置"。

### `POST /api/v1/rules/convert`

| 字段 | 说明 |
| --- | --- |
| `data` / `content` | 内联规则文本 |
| `ruleset` | `config/rulesets` 下的相对路径，如 `LocalAreaNetwork.list` |
| `url` | 远程规则地址 |
| `target` | `Clash`（默认，输出 rule-provider YAML）、`Surge`、`Loon`、`QX` |
| `include` / `exclude` | 对规则内容的正则过滤 |

## 3. 节点库

| 接口 | 说明 |
| --- | --- |
| `GET /api/v1/nodes?q=&type=&tags=&group=&enabled=` | 列表（含 `shareLink`） |
| `POST /api/v1/nodes` | 导入：`{ raw \| data \| content, tags?, group?, note? }`，自动去重并返回 `added/skipped`；输入宽容度与 `/api/v1/convert` 一致（多行 / `\|` 拼接 / 整段 base64 均可），原始链接会作为 `shareLink` 保留 |
| `PUT /api/v1/nodes/:id` | 更新：`tags`、`group`、`note`、`enabled`、`name`，或传 `raw` 重新解析 |
| `DELETE /api/v1/nodes/:id`、`DELETE /api/v1/nodes?all=true` | 删除单个 / 清空 |
| `POST /api/v1/nodes/prune` | 按协议+地址+端口+凭据去重 |
| `POST /api/v1/nodes/probe` | `{ ids \| tags \| groups, timeout=3000, concurrency=8, ip=true }` → TCP 握手延迟 + IP 归属（带 6 小时缓存） |
| `GET /api/v1/nodes/export?format=uri\|base64\|json` | 导出 |
| `GET/POST /api/v1/groups`、`DELETE /api/v1/groups/:name` | 分组管理（删除分组会解除节点引用） |

## 4. subconverter 兼容层

| 接口 | 说明 |
| --- | --- |
| `GET /api/sub` | 见下表参数；响应形态与 subconverter 一致（YAML / JSON / 文本 / Base64） |
| `GET /api/version` | 纯文本版本信息 |
| `POST /api/upload` | `{ content }` → `{ code: 0, data: { url } }`（自托管外部配置） |
| `GET /api/c/:id` | 取回上传内容 |
| `POST /api/short` | form-data / JSON 的 `longUrl`（支持 base64 编码）→ `{ Code: 1, ShortUrl }` |
| `GET /api/s/:id` | 302 跳转 |

`/api/sub` 参数：

| 参数 | 说明 |
| --- | --- |
| `target` | subconverter 命名或统一 id（`clash`、`clashmeta`、`stash`、`surge`、`surfboard`、`loon`、`quanx`、`singbox`、`mixed`、`v2ray`、`ss`、`ssr`、`ssd`、`page` …）。同一目标常有多个叫法，输出完全一致，完整对照见 `/api/v1/targets` 的 `aliases` / `subconverter` 字段（也是内置前端解析页「别名对照」的数据源）：<br>`v2ray` / `v2rayn` / `v2rayng` / `sub` → `base64`（Base64 订阅）；`mixed` / `links` / `plain` → `uri`（明文分享链接）；`clashmeta` / `meta` → `mihomo`；`sing-box` → `singbox`；`quan` / `quantumultx` → `qx`；`clashr` → `clash` |
| `url` | 订阅地址，多个用 `|` 分隔（也可以多行）。**直接放节点分享链接也行**：`ss://` `ssr://` `vmess://` `vless://` `trojan://` `hysteria2://` `tuic://` … 任意 scheme 都会被当成本地内容、不联网；整段 base64（标准 / url-safe / 带折行都行）同样支持。判定规则：`http(s)://` 与 `/` 开头才去下载，其余认成内容，认不出来的仍按订阅地址去拉并报 `REMOTE_FETCH_FAILED` |
| `data` `content` | 内联内容：裸节点（多行）、整段 Clash / mihomo YAML、Surge 配置、或整段 base64；可与 `url` 同时给，会合并。**YAML / JSON 必须整段给**（缩进即结构）：按行 trim 会削平缩进导致解析失败，服务端已对这一类输入自动走原样处理 |
| `list=true` | 只输出节点定义 |
| `include` `exclude` `include_remarks` `exclude_remarks` | 名称过滤 |
| `rename` `emoji` `add_emoji` `remove_emoji` `prepend` `append` `sort` `dedupe` | 节点清洗 |
| `config` | 外壳模板：`config/templates` 中的文件名，或 http(s) 地址 |
| `insert=true` | 与 `config` 搭配时按"注入节点"处理（不渲染 token） |
| `interval` | Surge 类目标的 `#!MANAGED-CONFIG ... interval=` 头与 `profile-update-interval` 响应头 |
| `filename` `new_name` | 文件名（缺失扩展名时按目标自动补 `.yaml/.json/.conf/.txt`）与 `Content-Disposition` |
| `profile-web-page-url` | 直接作为响应头透传 |
| `udp` `tfo` `tls13` `scv` `fdn` `ver` `token` | 接受但忽略（内核生成策略不同） |
| 整段 base64 查询串 | 支持：`/api/sub?<base64(查询串)>` |

## 5. 内核原生接口（未改动，仍然可用）

| 接口 | 说明 |
| --- | --- |
| `POST /api/proxy/parse` | `{ data, client, type?, produce? }` → 节点转换（最底层入口） |
| `POST /api/rule/parse` | `{ data, client }` → 规则转换 |
| `POST /api/utils/node-info` | 单节点分享链接 + IP 归属 |
| `/api/subscriptions` `/api/collections` `/api/files` `/api/artifacts` `/api/sync` `/api/preview/*` `/api/share/*` `/api/tokens` `/api/archives` `/api/modules` `/api/download/*` `/api/settings` `/api/logs` `/api/sort` | 内核完整的订阅管理、产物生成与分享体系 |

内核接口的参数请参考上游文档；本工程不修改其行为。
