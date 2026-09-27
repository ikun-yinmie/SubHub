# 上游归属与许可证（NOTICE）

本工程（SubHub）是多个开源项目的**深度合并产物**。下表逐项说明"吸收了谁的什么"，
以便合规与后续追溯。若你是原作者并认为某处归属描述不准确，请直接修改本文件。

## 1. 主内核：Sub-Store（AGPL-3.0）

* 仓库：<https://github.com/sub-store-org/Sub-Store>（`engines/Sub-Store/`）
* 许可证：AGPL-3.0 — 见 `LICENSE`
* 吸收方式：**后端源码整体复制为本工程 `src/`**
  * `src/core/proxy-utils/*` 协议解析器、预处理器、15+ 客户端生产者
  * `src/core/rule-utils/*` 规则解析与 Clash/Surge/Loon/QX 生成
  * `src/restful/*`、`src/utils/*`、`src/vendor/*`、`src/runtime/*`、`src/products/*`、`src/main.js`、`src/constants.js`
  * 构建链：`bundle-esbuild.js`、`esbuild-dev.js`、`dev-esbuild.js`、`jsconfig.json`、`.babelrc`、`patches/`、`package.json` 依赖清单
  * `verify/` 中的样例由本次合并实测过程产出（输入 `nodes.txt` + 各目标输出）
* 本工程对内核源码的改动：`src/restful/index.js` 增加统一层挂载；`bundle-esbuild.js` 的 `.node-version` 读取路径调整。
* **因此本工程整体按 AGPL-3.0 发布**：任何对外提供网络服务的部署都必须公开对应源码。

## 2. subconverter（GPL-3.0）

* 仓库：<https://github.com/tindy2013/subconverter>（`engines/subconverter/`）
* 许可证：GPL-3.0
* 吸收的**能力/语义**（未复制 C++ 代码，按其行为在 JS 中重新实现）：
  * `/sub` 查询参数与响应形态：`target`、`url`（多订阅 `|` 分隔）、`list=true`、`include`/`exclude`、`include_remarks`/`exclude_remarks`、`rename`、`emoji`/`add_emoji`/`remove_emoji`、`prepend`/`append`、`sort`、`insert`、`interval`、`filename`/`new_name`、整段 base64 查询串
  * `list=true` 的语义：只输出节点定义（对照 `src/generator/config/subexport.cpp` 中 `ext.nodelist` 分支）
  * 节点清洗顺序：`remove_emoji` → `rename` → `add_emoji`（对照 `src/generator/config/nodemanip.cpp::preprocessNodes` 与 `addEmoji`）
  * `rename_node=正则@替换` 与 `emoji.txt` 的 `正则,emoji` 片段格式
* 吸收的**数据资产**：
  * `config/rulesets/` ← `engines/subconverter/base/rules/`（ACL4SSR、DivineEngine、lhie1、NobyDa 等规则集）
  * `config/snippets/` ← `engines/subconverter/base/snippets/`（`emoji.txt`、`rename_node.txt`、`groups*.txt`、`rulesets*.txt`）
* 本项目对新实现部分（`src/unified/*`）拥有版权，并同样按 AGPL-3.0 发布；上游素材保留其原始归属与 GPL-3.0 约束。

## 3. SubConverter-Extended（GPL-3.0）

* 仓库：<https://github.com/Aethersailor/SubConverter-Extended>（`engines/SubConverter-Extended/`）
* 许可证：GPL-3.0
* 吸收的**能力描述**：目标平台与分享链接输出清单（用于 `src/unified/engines.js` 的能力表与 `docs/api.md` 的目标对照）；
  其 `docker/`、`scripts/run-subconverter-smoke.py` 等自检与打包思路被参考（未复制）。
* 该项目作为**可选外部引擎**保留：`docker compose --profile extended up -d`（需先本地构建镜像）。

## 4. sublinkX（MIT）

* 仓库：<https://github.com/gooaclok819/sublinkX>（`engines/sublinkX/`）
* 许可证：MIT
* 吸收的**设计与素材**：
  * 节点 / 分组数据模型（`models/node.go`、`models/subcription.go`）→ 对应本工程 `src/unified/nodes.js` + `src/unified/store.js`
  * 模板文件 `template/clash.yaml`、`template/surge.conf` → 复制到 `config/templates/upstream/`（保留其策略组命名风格，作为参考模板）
  * "自托管订阅页 / 模板渲染"的思路 → `config/templates/subscription.html` 与 `src/unified/templates.js`
* 本项目保留其 MIT 归属声明。

## 5. sub-web（MIT）

* 仓库：<https://github.com/CareyWang/sub-web>（`engines/sub-web/`）
* 许可证：MIT
* 吸收方式：前端源码复制到 `web/`，并做了两处适配：
  * `web/.env`：后端指向本工程兼容层 `/api`，短链 `/api/short`、配置上传 `/api/upload`（均为自托管，不再依赖第三方服务）
  * `web/vite.config.js`：开发模式下 `/api` 反向代理到本工程后端
* 本项目保留其 MIT 归属声明（`web/LICENSE`）。

## 6. 许可证兼容性说明

| 组件 | 许可证 | 与 AGPL-3.0 合并后的义务 |
| --- | --- | --- |
| Sub-Store（内核，代码级吸收） | AGPL-3.0 | 整体必须 AGPL-3.0；对外提供网络服务需公开源码 |
| subconverter 系（语义与素材吸收） | GPL-3.0 | 素材/衍生部分按 GPL-3.0，整体以 AGPL-3.0 兼容发布 |
| sublinkX / sub-web（设计、素材、前端源码） | MIT | 保留版权与许可声明即可，可与 AGPL 共存 |

结论：**本工程整体以 AGPL-3.0 发布**，各部分归属见上。若要对外提供服务（包括局域网内给他人用），
必须公开本工程的完整源码（含你的个性化改动）。
