#!/usr/bin/env python3
"""Sub-Store /api/proxy/parse 双向转换演示（无第三方依赖）。"""
import json
import urllib.request

PORT = 3211
URL = f"http://127.0.0.1:{PORT}/api/proxy/parse"


def convert(data: str, client: str) -> str:
    body = json.dumps({"data": data, "client": client}).encode()
    req = urllib.request.Request(
        URL, data=body, headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        payload = json.loads(resp.read().decode())
    result = payload.get("data", payload)
    if isinstance(result, dict):
        result = result.get("par_res") or result
    return result if isinstance(result, str) else json.dumps(result, ensure_ascii=False, indent=2)


def show(title: str, text: str, outfile: str, head: int = 500) -> None:
    with open(outfile, "w") as f:
        f.write(text)
    print(f"\n########## {title}  ->  {outfile}")
    print(text[:head])
    if len(text) > head:
        print("...")


nodes = open("nodes.txt").read()
clash = open("clashmeta.yaml").read()

show("输入=节点分享链接(5条) -> 目标 ClashMeta/mihomo", convert(nodes, "ClashMeta"), "out_mihomo.yaml")
show("输入=节点分享链接 -> 目标 sing-box", convert(nodes, "sing-box"), "out_singbox.json")
show("输入=节点分享链接 -> 目标 Surge", convert(nodes, "Surge"), "out_surge.txt")
show("输入=节点分享链接 -> 目标 V2Ray(base64 订阅)", convert(nodes, "V2Ray"), "out_v2ray.txt")
show("反向: 输入=mihomo 配置 -> 节点分享链接(URI)", convert(clash, "URI"), "out_uri.txt")
