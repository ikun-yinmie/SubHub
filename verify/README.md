# 回归样例

这套样例是合并过程中实测产出的"基线"，用来验证内核 + 统一层的转换结果是否稳定。

## 输入

`nodes.txt`：5 种协议各一条（vmess / vless / trojan / ss / hysteria2），是最小的可用输入集。

`clash-verge-input.yaml`：一整份 Clash Verge 配置片段（顶部注释 + 5 条 vless + `proxy-groups` + `rules`），用来验证"整段配置当输入"这条路。
这类输入的缩进就是结构，**不能按行 trim 后重拼**：削平缩进后 YAML 解析会失败，内核退回逐行解析，把 `type: vless` 这种单行当成一条节点，输出一屏 `vless://undefined@undefined:undefined`。`scripts/smoke-test.mjs` 的「整段配置作为输入」一节就是这项回归。

## 输出（由内核在本机实测生成，可作为比对基线）

| 文件 | 生成方式 | 内容 |
| --- | --- | --- |
| `out_mihomo.yaml` | `target=mihomo`（节点列表） | mihomo / Clash.Meta 节点定义 |
| `out_singbox.json` | `target=singbox` | sing-box outbounds |
| `out_surge.txt` | `target=surge` | Surge 节点行 |
| `out_uri.txt` | `target=uri` | 分享链接（每行一个） |
| `out_v2ray.txt` | `target=base64` | Base64 订阅 |
| `clashmeta.yaml` | 用于反向测试 | mihomo 配置 → 分享链接 |

## 自己跑一遍

```bash
# 1) 启动服务 (见 README「快速开始」)
bash scripts/dev.sh

# 2) 全量冒烟测试 (覆盖统一层、兼容层与内置前端)
node scripts/smoke-test.mjs

# 3) 单项对照: 用样例输入生成 mihomo 配置
curl -s -X POST http://127.0.0.1:9635/api/v1/convert \
  -H 'Content-Type: application/json' \
  --data-binary @<(python3 - <<'PY'
import json
nodes = open('verify/nodes.txt').read()
print(json.dumps({"data": nodes, "target": "mihomo"}))
PY
  ) | python3 -c 'import json,sys; print(json.load(sys.stdin)["data"]["content"])'
```

`convert_demo.py` 是早期针对内核 `/api/proxy/parse` 的调用示例（端口 3211），保留作为最小调用参考。
