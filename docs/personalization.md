# 个性化指南

按"改动成本从低到高"排列，前 5 类都不需要写代码。

## 1. 改配置（最高频）

`config/subhub.json`（或环境变量，见 `.env.example`）：

```json
{
    "defaultTarget": "mihomo",        // 不传 target 时的默认目标
    "clashIsMihomo": true,            // target=clash 是否按 Mihomo 生成
    "engines": { "subconverter": { "url": "http://127.0.0.1:25500", "enabled": true } },
    "nodeInfo": { "provider": "http://ip-api.com/json", "lang": "zh-CN", "cacheTTL": 21600000 },
    "paths": { "templates": "config/templates", "rulesets": "config/rulesets", "snippets": "config/snippets" },
    "publicBaseUrl": ""               // 放在反代后面时填外部地址, 用于订阅页/短链生成绝对链接
}
```

## 2. 改输出外壳（模板）

模板 = 配置骨架 + `{{token}}` 占位。语法：

```
整行占位（按占位行缩进注入多行内容）:
proxies:
{{proxies}}

行内占位（数组默认逗号连接）:
🚀 节点选择 = select, {{names}}
```

可用 token：

| token | 内容 |
| --- | --- |
| `proxies` | 当前目标格式的节点定义（YAML 目标=序列项，文本目标=节点行） |
| `names` | 节点名数组（`{{names}}` 逗号连接，`{{names|lines}}` 每行一个，`{{names|json}}` JSON） |
| `names_json` | 节点名 JSON 数组（适合 sing-box 的 outbounds 引用） |
| `outbounds_json` / `endpoints_json` | sing-box 专用：节点 outbounds + 策略组 outbounds（selector/urltest/direct） |
| `share_links` | 分享链接（每行一个） |
| `count` `time` `target` `target_label` `title` `name` `base_url` | 元信息 |
| `node_rows` / `client_links` | 订阅页 HTML 片段（`subscription.html` 使用） |

过滤器：`|json`、`|yaml`、`|lines`、`|csv`、`|base64`。

命名规则：`config/templates/<target>.yaml|yml|json|conf|ini|txt|html` 会被该目标自动采用，例如放一个 `stash.yaml` 后
`target=stash` 就默认输出完整 Stash 配置；不传 `list=true` 时走模板，`list=true` 时永远只输出节点（与 subconverter 一致）。

默认模板：`mihomo.yaml`、`clash.yaml`、`surge.conf`、`singbox.json`、`subscription.html`。
参考模板（吸收自 sublinkX 的"策略组"风格，节点名需匹配）：`config/templates/upstream/`。

## 3. 改节点清洗规则（片段）

* `config/snippets/emoji.txt`：`正则,emoji`，命中即给节点名前置国旗（只取第一条命中的规则，与 subconverter 行为一致）。
  支持 `(?i:...)` 内联大小写标志，会自动适配成 JS 正则。
* `config/snippets/rename_node.txt`：`正则@替换`，按顺序替换；替换留空即删除匹配内容。
* `config/snippets/groups.txt` 等其余文件：保留原始素材，供模板或人工参考（`/api/v1/snippets` 会列出）。

调用：`?emoji=true`、`?rename=rename_node`（片段名）或 `?rename=旧名@新名`（内联）。

## 4. 规则集

把 `.list` / `.conf` / `.yaml` 丢进 `config/rulesets/`（可以建子目录），然后：

```bash
curl -s -X POST http://127.0.0.1:9635/api/v1/rules/convert \
  -d '{"ruleset":"ACL4SSR/Clash/xxx.list","target":"Clash"}'
```

Clash 输出是 rule-provider 的 `payload:` YAML，可直接存成文件给 mihomo 的 `rule-providers` 引用；
Surge/Loon/QX 输出对应平台的规则文本。

## 5. 节点库工作流

```bash
BASE=http://127.0.0.1:9635
# 入库（可一次多行；重复节点自动跳过）
curl -s -X POST $BASE/api/v1/nodes -H 'Content-Type: application/json' \
  -d "{\"raw\":\"$(cat verify/nodes.txt | head -3 | paste -sd'\n')\",\"tags\":[\"自建\"],\"group\":\"主力\"}"
# 打标签 / 改备注 / 停用
curl -s -X PUT $BASE/api/v1/nodes/<id> -d '{"tags":["自建","HK"],"note":"月付 5 元"}'
# 探测（延迟 + 归属）
curl -s -X POST $BASE/api/v1/nodes/probe -d '{"tags":["自建"],"concurrency":8}'
# 用库里的节点直接出订阅
curl -s -X POST $BASE/api/v1/convert -d '{"target":"mihomo","selection":{"tags":["自建"]}}'
```

建议：把"订阅源"用 `selection` + 定期 `prune` 管理，源失效时只删库里的节点，模板与规则不受影响。

## 6. 前端

`web/` 是吸收进来的 sub-web：

```bash
cd web && yarn install && yarn dev      # 开发: 5173, /api 由 vite 代理到 127.0.0.1:9635
BUILD_WEB=1 bash scripts/build.sh       # 构建到 web/dist
MERGE_FRONTEND=1 bash scripts/serve.sh  # 单端口: 后端 + 前端都在 9635
```

`web/.env` 里三个地址都已指向本工程：`/api`（转换）、`/api/short`（短链）、`/api/upload`（配置托管）。
若要放到反代/局域网，把 `VITE_SUBCONVERTER_DEFAULT_BACKEND` 改成绝对地址（如 `https://hub.example.com/api`）后重新构建。

## 7. 新增能力（要写代码时）

| 目标 | 位置 | 要点 |
| --- | --- | --- |
| 新增客户端目标 | `src/core/proxy-utils/producers/<name>.js` | 返回 `{ type: 'ALL' \| 'SINGLE', produce }`；再在 `src/unified/targets.js` 注册 id/别名/格式。注册后会自动出现在内置前端「解析 / 转格式」页的可选格式里（该页读 `/api/v1/targets`） |
| 新增管线步骤 | `src/unified/pipeline.js` | 在 `runPipeline()` 里插一段，并把统计写进 `stats.stages` |
| 新增统一接口 | `src/unified/*.js` | 在 `index.js` 中用 `register($app, 'post', pattern, handler)`，双侧前缀用 `v1()/api()` 生成 |
| 新增兼容层参数 | `src/unified/compat.js` | `buildConvertPayload()` 里把 subconverter 参数映射到统一参数 |
| 接入新引擎 | `src/unified/engines.js` | 加进 `ENGINE_CAPABILITIES` 与 `engineTarget()` 映射表 |
| 换 IP 归属服务 | `src/unified/nodes.js` | `lookupIPInfo()` 按 ip-api.com 响应结构适配即可（缓存键为 host） |

## 8. 部署到局域网 / 公网

1. `HOST=0.0.0.0 nohup bash scripts/dev.sh > subhub.log 2>&1 &`（默认监听 9635）或 `docker compose up -d`
2. 反代（Caddy/Nginx）到 `9635`；模板与短链里要生成绝对链接时设置 `publicBaseUrl`（或 `SUBHUB_*`/`publicBaseUrl` 字段）。
3. 自建前端跨域访问时，把前端来源加入 `SUB_STORE_CORS_ALLOWED_ORIGINS`。
4. **对外提供服务请遵守 AGPL：同时公开本工程完整源码。**
