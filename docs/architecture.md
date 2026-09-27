# 架构说明

## 1. 合并策略：为什么是"单一内核 + 能力吸收"

5 个候选项目的技术栈完全不同（Sub-Store 是 JS/Node，subconverter 系是 C++，sublinkX 是 Go，sub-web 是 Vue）。
"合并"有三种可能做法，本项目选择第 2 种：

| 做法 | 结果 | 是否采用 |
| --- | --- | --- |
| 编排式拼装（5 个子目录 + 一个启动脚本） | 升级方便，但仍是 5 个系统，无法个性化到核心逻辑 | ✗ |
| **单一内核 + 能力吸收** | 一个 Node 工程自成体系，转换核心是"自己的代码"，可深度个性化 | ✅ |
| 只保留 MIT 系重写 | 自由度最高，但丢掉 Sub-Store 的 15+ 客户端生成能力与协议覆盖 | ✗ |

具体地：

* **Sub-Store 后端源码整体变成本工程的 `src/`**（`core/` 协议解析与生成、`restful/` 路由、`utils/`、`vendor/`、`runtime/`、`products/`），
  构建脚本 `bundle-esbuild.js`、`jsconfig.json`（`@/* → src/*` 路径别名）、`.babelrc` 一并上提到根目录。
  因此内核的**所有 REST 接口原样可用**（`/api/proxy/parse`、`/api/subscriptions`、`/api/artifacts`、`/api/preview/*`、`/api/utils/node-info` …）。
* **其余 4 个项目不做代码复制，只吸收能力**：
  * subconverter → `/sub` 兼容语义、`list=true` 输出形态、snippets（emoji/rename）、rules 数据集、`insert` 语义；
  * SubConverter-Extended → 目标/分享链接一览（用于统一目标表与引擎能力描述）、Docker/自检脚本思路；
  * sublinkX → 节点/分组数据模型、模板（`template/clash.yaml`、`surge.conf` 放入 `config/templates/upstream/`）、自托管思路；
  * sub-web → 前端源码（`web/`），并把它默认指向本工程的自托管接口（含上传与短链）。
* 4 个上游仓库保留在 `engines/`（各自带 `.git`），既是**可选外部引擎**，也是**参照实现**与**素材来源**。

## 2. 模块职责

```
src/
├── main.js                 内核入口: migrate() -> serve()
├── restful/index.js        内核路由注册 + 合并层挂载点 (registerUnifiedRoutes)
├── core/proxy-utils/       协议解析(preprocessors/parsers) 与 15+ 客户端生成(producers)
├── core/rule-utils/        通用规则解析 + Clash/Surge/Loon/QX 规则生成
├── restful/*               单条订阅 / 组合订阅 / 文件 / 产物 / 同步 / 分享 / 预览 / 日志 …
├── products/*              其他形态产物 (Loon 插件、cron 同步、mini 版本)
└── unified/                ★ 本工程新增的合并层
    ├── config.js           读取 config/subhub.json + 环境变量覆盖
    ├── targets.js          统一目标表: 内核 producer、subconverter 别名、输出格式
    ├── pipeline.js         处理管线: 过滤 → 重命名/emoji → 排序 → 去重 (+ 统计)
    ├── convert.js          统一转换核心: 输入解析、目标解析、模板/节点列表分流
    ├── templates.js        模板加载与渲染 (整行缩进注入 + 行内 token + 过滤器)、节点注入
    ├── nodes.js            节点库/分组 CRUD、导出、TCP 延迟探测、IP 归属查询(带缓存)
    ├── rules.js            规则/规则集转换 + 规则集文件浏览
    ├── snippets.js         emoji / rename 片段解析 (PCRE→JS 正则适配)
    ├── engines.js          外部引擎(可选): 能力表、探活、委托转换
    ├── compat.js           subconverter 兼容层 + 自托管上传/短链/订阅页
    └── index.js            统一层路由注册 (同时挂 /api/v1/* 与 /v1/*)
```

## 3. 一次转换的完整链路

```
POST /api/v1/convert { url | data | selection, target, ...options }
        │
        ├─ fetchInput()          先把输入分成两类: http(s)/路径 才去下载, 分享链接与
        │                        base64 整段 (含 url-safe/折行) 当本地内容, data 与 url 合并
        ├─ resolveProxies()      远程订阅/内联内容 -> ProxyUtils.parse()；或从节点库按 tags/groups/ids 取
        ├─ runPipeline()         filter(include/exclude/include_remarks/exclude_remarks/types) ->
        │                        rename(片段或内联规则) + emoji/remove_emoji + prepend/append ->
        │                        sort -> dedupe；输出 stats
        └─ produceOutput()
              ├─ page           -> 渲染 subscription.html (节点表格 + 各客户端订阅链接)
              ├─ ss/ssr/ssd     -> 分享链接过滤后 Base64 / SSD 打包
              ├─ base64(通用)   -> 内核 v2ray producer
              ├─ config 类目标  -> 有模板就用模板渲染外壳(list=false)，否则回落到节点列表
              └─ 其它           -> 内核 producer 直接产出节点定义 (等价 list=true)
```

关键设计：**内核 producer 只负责"节点定义"，外壳（端口/DNS/策略组/规则）交给模板**。
这与 subconverter 的 `list=true` 语义一致（同样是"只输出节点列表"），也是 sublinkX 模板路线的自然延伸。

## 4. 内核挂载点的改动（与上游的差异面）

为便于日后同步上游，对内核源码的改动保持在最小：

| 文件 | 改动 |
| --- | --- |
| `src/restful/index.js` | 两处：`import registerUnifiedRoutes from '@/unified'` + 在 `$app.start()` 前调用一次 |
| `bundle-esbuild.js` | `.node-version` 路径由 `../` 改为 `__dirname`（工程根目录提升导致） |
| `package.json` | 更名 `subhub`、新增 `subhubVersion` 与脚本（deps 与内核一致） |

其余内核文件均未改动，因此上游更新时可以按 [`upstream.md`](upstream.md) 的流程用 `git diff` 精确对齐。

## 5. 数据与运行时

| 位置 | 内容 |
| --- | --- |
| `SUB_STORE_DATA_BASE_PATH`（默认 `./data`） | `sub-store.json`（订阅/组合/文件/产物设置）、`root.json`（分享令牌缓存、日志、以及本层的节点库/分组/上传与短链/节点探测缓存） |
| `config/subhub.json` | 合并层配置（默认目标、引擎地址、探测服务、素材目录） |
| `config/templates` `config/rulesets` `config/snippets` | 可随意增删的素材目录，接口自动发现 |

节点库、上传配置、短链映射等本层数据都写在 `root.json` 里（键名前缀 `#subhub.`），与内核自身数据互不干扰，便于整体备份/迁移。

## 6. 外部引擎的角色

统一层默认**不依赖**任何外部引擎，`engines/` 与 compose 里的引擎服务都是可选的：

* 作为**对照**：同一份订阅分别用 C++ 实现与本内核生成，比对差异（这也是本次合并过程中的验证方式）。
* 作为**兜底**：`/api/v1/engines` 可探活；`src/unified/engines.js` 的 `delegateConvert()` 能把请求转给 subconverter 的 `/sub`。
* 作为**参照**：内核暂不支持的细节（如 subconverter 的 external config 全套语义、mellow 特有字段）可回看 C++ 实现。
