# 与上游同步

`engines/` 下保留了 5 个上游仓库的浅克隆（各自带 `.git`），它们是**素材与参照的来源**，
而本工程的可运行代码在 `src/`（内核已被吸收成自己的代码）。因此"升级上游"分两类情况：

## A. 拉取参照项目（subconverter / SubConverter-Extended / sublinkX / sub-web）

```bash
cd engines/subconverter && git pull --depth 1 origin master && cd -
cd engines/SubConverter-Extended && git pull --depth 1 origin main && cd -
cd engines/sublinkX && git pull --depth 1 origin main && cd -
cd engines/sub-web && git pull --depth 1 origin master && cd -
```

拉完通常**不需要改本工程代码**，除非你打算同步它们的新能力（比如新协议、新目标）。若确实要吸收：

* 新协议 / 新目标：优先看内核 `src/core/proxy-utils/` 是否已支持；内核不支持时再考虑移植 C++ 解析器（`engines/subconverter/src/parser/subparser.cpp`）。
* 新的 subconverter 查询参数：在 `src/unified/compat.js::buildConvertPayload` 里加映射。
* 新的 snippets / rules：直接复制进 `config/snippets`、`config/rulesets`。
* 前端更新：`git -C engines/sub-web log` 看变化，必要时把 diff 手动搬到 `web/`。

## B. 升级内核（Sub-Store）

内核已被吸收为 `src/`，升级要"对齐上游 + 保住本工程的挂载点"。推荐流程：

```bash
# 1) 拉上游
cd engines/Sub-Store && git pull --depth 1 origin main && cd -

# 2) 看上游改了什么（针对内核源码目录）
git -C engines/Sub-Store log --oneline -20 -- backend/src

# 3) 把新源码整体覆盖到本工程, 然后用 git 看差异
rsync -a --delete engines/Sub-Store/backend/src/ src/ --exclude 'unified/'
#   ↑ 注意: 上面的 --exclude 只保证 src/unified 目录本身不被删除,
#     更稳妥的写法是先把 src/unified 临时挪走再覆盖, 见下面"推荐做法"

git diff --stat
```

### 推荐做法（避免误删统一层）

```bash
# 1) 把统一层与挂载点备份出来
cp -r src/unified /tmp/subhub-unified

# 2) 用上游覆盖内核源码
rsync -a --delete engines/Sub-Store/backend/src/ src/

# 3) 放回统一层
cp -r /tmp/subhub-unified src/unified

# 4) 重新挂载 + 同步构建脚本
#    a. src/restful/index.js 需要两处改动 (若上游改动过该文件, 手动再合一次):
#         import registerUnifiedRoutes from '@/unified';
#         registerUnifiedRoutes($app);   // 在 $app.start() 之前
#    b. 根目录的 bundle-esbuild.js / jsconfig.json / .babelrc / patches/ 与
#       engines/Sub-Store/backend/ 下同名文件对齐 (bundle-esbuild.js 的
#       .node-version 读取路径要保持 __dirname)

# 5) 回归
bash scripts/dev.sh &
node scripts/smoke-test.mjs     # 默认打 http://127.0.0.1:9635
SUBHUB_BASE=http://127.0.0.1:9635 node scripts/smoke-test.mjs
```

判断"哪里需要手工合"的技巧：本工程对内核的改动面只有 3 个文件（见
[architecture.md](architecture.md) 第 4 节），所以

```bash
diff -u engines/Sub-Store/backend/src/restful/index.js src/restful/index.js
```

的输出里应当只有那两处挂载改动；多出来的差异就是需要留意的上游变更。

## C. 内核升级后的自查清单

1. `node scripts/smoke-test.mjs` 45 项是否全绿（尤其是目标表与模板渲染）。
2. `node bundle-esbuild.js` 是否成功（产物路径、注入 polyfill 是否变化）。
3. `config/templates/*.yaml` 生成的目标配置是否仍能被对应客户端加载（用 `verify/` 样例比对）。
4. `src/unified/targets.js` 里的 `kernel` 字段是否仍与内核 producer 的键名一致
   （上游若重命名 producer，会在这里报"不支持的目标平台"）。
5. 内核若有新的环境变量或新的 REST 路由，按需补进 `.env.example` 与 `docs/api.md`。
