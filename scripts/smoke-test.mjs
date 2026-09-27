#!/usr/bin/env node
/**
 * SubHub 冒烟测试
 *
 * 用法:
 *   node scripts/smoke-test.mjs                              # 默认 http://127.0.0.1:9635
 *   SUBHUB_BASE=http://127.0.0.1:9635 node scripts/smoke-test.mjs
 *   (默认读 SUBHUB_BASE, 未设置时用 http://127.0.0.1:9635)
 *
 * 覆盖: 统一 API / 转换 / 模板 / 节点库 / 规则 / 订阅页 / subconverter 兼容层
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.SUBHUB_BASE || 'http://127.0.0.1:9635').replace(/\/+$/, '');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NODES = readFileSync(join(ROOT, 'verify/nodes.txt'), 'utf8').trim();
// 一整份 Clash Verge 配置 (带注释 / proxy-groups / rules), 当输入用
const CLASH_CONFIG = readFileSync(
    join(ROOT, 'verify/clash-verge-input.yaml'),
    'utf8',
).trim();
// 这份配置里有多少个 proxies 条目（proxy-groups 里也有 `- name:`，所以按节点类型数）
const CLASH_CONFIG_NODES = (CLASH_CONFIG.match(/^\s*type: vless$/gm) ?? []).length;

let passed = 0;
const failures = [];

function check(name, condition, detail = '') {
    if (condition) {
        passed += 1;
        console.log(`  ✅ ${name}`);
    } else {
        failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
        console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`);
    }
}

async function api(path, options = {}) {
    const response = await fetch(`${BASE}${path}`, options);
    const text = await response.text();
    let json;
    try {
        json = JSON.parse(text);
    } catch (e) {
        json = undefined;
    }
    return { status: response.status, text, json, headers: response.headers };
}

function post(path, body) {
    return api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

function section(title) {
    console.log(`\n=== ${title} ===`);
}

// 分享链接里的名称是 URL 编码的, 断言时同时接受原文与编码后形态
function namedIncludes(content, text) {
    return (
        content.includes(text) ||
        content.includes(encodeURIComponent(text)) ||
        content.includes(`%5B${text}%5D`)
    );
}

async function main() {
    section('基础信息');
    const info = await api('/api/v1');
    check('/api/v1 返回 success', info.json?.status === 'success');
    check('/api/v1 含内核版本', Boolean(info.json?.data?.kernel?.version));
    check(
        '/api/v1 含目标表',
        (info.json?.data?.targets?.length ?? 0) > 10,
        `targets=${info.json?.data?.targets?.length}`,
    );

    const version = await api('/api/version');
    check('/api/version 文本可用', /SubHub v[\d.]+ backend/.test(version.text), version.text.slice(0, 60));

    const targets = await api('/api/v1/targets');
    check('/api/v1/targets 列出目标', (targets.json?.data?.targets?.length ?? 0) > 10);

    section('统一转换 /api/v1/convert');
    const mihomo = await post('/api/v1/convert', {
        data: NODES,
        target: 'mihomo',
        options: { emoji: false },
    });
    const yaml = mihomo.json?.data?.content ?? '';
    check('mihomo 完整配置返回', mihomo.json?.status === 'success', mihomo.json?.error?.message);
    check('mihomo 使用模板', Boolean(mihomo.json?.data?.template), String(mihomo.json?.data?.template));
    check('mihomo 输出含 proxy-groups', yaml.includes('proxy-groups:'));
    check('mihomo 输出含节点', yaml.includes('- name:') && yaml.includes('type: ss'));
    check('mihomo 节点数统计', (mihomo.json?.data?.count ?? 0) >= 4, `count=${mihomo.json?.data?.count}`);

    const socketMismatch = (mihomo.json?.data?.warnings ?? []).length;
    check('mihomo 无告警', socketMismatch === 0, JSON.stringify(mihomo.json?.data?.warnings));

    const listOnly = await post('/api/v1/convert', {
        data: NODES,
        target: 'mihomo',
        list: true,
    });
    check(
        'list=true 只输出节点列表',
        (listOnly.json?.data?.content ?? '').startsWith('proxies:') &&
            !(listOnly.json?.data?.content ?? '').includes('proxy-groups'),
    );

    const singbox = await post('/api/v1/convert', { data: NODES, target: 'sing-box' });
    const singboxContent = singbox.json?.data?.content ?? '';
    let singboxValid = false;
    try {
        const parsed = JSON.parse(singboxContent);
        singboxValid = Array.isArray(parsed.outbounds) && parsed.outbounds.length > 0;
    } catch (e) {
        singboxValid = false;
    }
    check('sing-box 输出为合法 JSON 且含 outbounds', singboxValid);

    const surge = await post('/api/v1/convert', { data: NODES, target: 'surge' });
    const surgeContent = surge.json?.data?.content ?? '';
    check(
        'surge 完整配置 (模板)',
        surgeContent.includes('[Proxy]') &&
            surgeContent.includes('[Proxy Group]') &&
            /node-ss\s*=\s*ss,/.test(surgeContent),
        surgeContent.slice(0, 80).replace(/\n/g, '|'),
    );

    const surgeList = await post('/api/v1/convert', {
        data: NODES,
        target: 'surge',
        list: true,
    });
    check(
        'surge list=true 只输出节点行',
        !(surgeList.json?.data?.content ?? '').includes('[Proxy]') &&
            /node-ss\s*=\s*ss,/.test(surgeList.json?.data?.content ?? ''),
    );

    const base64Out = await post('/api/v1/convert', { data: NODES, target: 'base64' });
    const decoded = Buffer.from(base64Out.json?.data?.content ?? '', 'base64').toString('utf8');
    check('Base64 订阅可解码且含分享链接', decoded.includes('://'));

    const qx = await post('/api/v1/convert', { data: NODES, target: 'qx' });
    check(
        'Quantumult X 转换 (默认节点列表)',
        (qx.json?.data?.count ?? 0) > 0 &&
            (qx.json?.data?.content ?? '').includes('shadowsocks'),
        qx.json?.error?.message,
    );

    const loon = await post('/api/v1/convert', { data: NODES, target: 'loon' });
    check('Loon 转换', (loon.json?.data?.count ?? 0) > 0);

    const withFilter = await post('/api/v1/convert', {
        data: NODES,
        target: 'uri',
        include: 'vmess|trojan',
        sort: 'name',
    });
    check(
        'include 过滤生效',
        withFilter.json?.data?.count === 2,
        `filtered=${withFilter.json?.data?.count}`,
    );

    const withExclude = await post('/api/v1/convert', {
        data: NODES,
        target: 'uri',
        exclude: 'hy2|node-ss',
    });
    check(
        'exclude 过滤生效',
        withExclude.json?.data?.count === 3,
        `filtered=${withExclude.json?.data?.count}`,
    );

    const withRename = await post('/api/v1/convert', {
        data: NODES,
        target: 'uri',
        rename: 'node-@node-✅',
        prepend: '[Sub] ',
    });
    const renamed = withRename.json?.data?.content ?? '';
    check(
        'rename/prepend 生效',
        namedIncludes(renamed, 'Sub') && namedIncludes(renamed, '✅'),
        renamed.split('\n')[0]?.slice(0, 80),
    );

    const bad = await post('/api/v1/convert', { data: NODES, target: 'not-exist' });
    check('非法目标返回失败', bad.json?.status === 'failed' && bad.status >= 400);

    section('解析统计 /api/v1/inspect');
    const inspect = await post('/api/v1/inspect', { data: NODES });
    check('inspect 返回节点统计', (inspect.json?.data?.count ?? 0) > 0);
    check(
        'inspect 含协议分布',
        Object.keys(inspect.json?.data?.summary?.byType ?? {}).length > 0,
    );

    section('模板与规则');
    const templates = await api('/api/v1/templates');
    const templateNames = (templates.json?.data?.templates ?? []).map((item) => item.name);
    check('模板目录可读', templateNames.length >= 4, templateNames.join(','));
    check('默认模板存在', ['mihomo.yaml', 'surge.conf', 'singbox.json', 'subscription.html'].every((name) => templateNames.includes(name)));

    const rulesets = await api('/api/v1/rulesets');
    check('规则集目录可读', (rulesets.json?.data?.total ?? 0) > 0, `total=${rulesets.json?.data?.total}`);

    const snippets = await api('/api/v1/snippets');
    check('片段目录可读', (snippets.json?.data?.total ?? 0) > 0);

    const rules = await post('/api/v1/rules/convert', {
        ruleset: 'LocalAreaNetwork.list',
        target: 'Clash',
    });
    check('规则集 -> Clash rule-provider', (rules.json?.data?.content ?? '').includes('payload:'));

    const rulesSurge = await post('/api/v1/rules/convert', {
        ruleset: 'LocalAreaNetwork.list',
        target: 'Surge',
    });
    check('规则集 -> Surge rule-set', (rulesSurge.json?.data?.content ?? '').length > 0);

    section('节点库');
    await api('/api/v1/nodes?all=true', { method: 'DELETE' });
    const importResult = await post('/api/v1/nodes', {
        raw: NODES,
        tags: ['smoke'],
        group: 'smoke-group',
    });
    check('导入节点', (importResult.json?.data?.added ?? 0) > 0, JSON.stringify(importResult.json?.data));
    const nodes = await api('/api/v1/nodes');
    check('列出节点', (nodes.json?.data?.total ?? 0) > 0);
    check(
        '节点带分享链接',
        Boolean(nodes.json?.data?.nodes?.[0]?.shareLink),
    );

    const fromLibrary = await post('/api/v1/convert', {
        target: 'mihomo',
        selection: { tags: ['smoke'] },
    });
    check('从节点库生成配置', (fromLibrary.json?.data?.count ?? 0) > 0);

    const exportUri = await api('/api/v1/nodes/export?format=uri');
    check('导出分享链接', exportUri.text.includes('://'));

    // url-safe base64 外壳 + 单行 | 拼接：与 /api/v1/convert 同样的宽容度
    const blobImport = await post('/api/v1/nodes', {
        raw: Buffer.from(
            NODES.split('\n')
                .map((line) => line.trim())
                .filter(Boolean)
                .join('|'),
        ).toString('base64url'),
        tags: ['blob'],
    });
    check(
        '节点库导入吃 url-safe base64 / | 拼接',
        blobImport.json?.status === 'success' &&
            (blobImport.json?.data?.added ?? 0) +
                (blobImport.json?.data?.skipped ?? 0) >
                0,
        JSON.stringify(blobImport.json?.data ?? blobImport.json?.error),
    );

    const prune = await post('/api/v1/nodes/prune', {});
    check('去重接口可用', prune.json?.status === 'success');

    if (process.env.SMOKE_PROBE === '1') {
        const probe = await post('/api/v1/nodes/probe', { timeout: 2000, ip: false });
        check('探测接口可用', Array.isArray(probe.json?.data?.results));
    }

    section('裸节点直转（不经过订阅地址）');
    const nodeLinks = NODES.split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
    const joinedLinks = nodeLinks.join('|');

    const rawViaUrl = await api(
        `/api/sub?target=mihomo&url=${encodeURIComponent(joinedLinks)}`,
    );
    check(
        '兼容层 url= 直接塞节点链接',
        rawViaUrl.status === 200 &&
            rawViaUrl.text.includes('proxy-groups:') &&
            rawViaUrl.text.includes('node-ss'),
        `status=${rawViaUrl.status}`,
    );

    const rawSingle = await api(
        `/api/sub?target=mihomo&url=${encodeURIComponent(nodeLinks[3])}`,
    );
    check(
        '兼容层 url= 单条分享链接',
        rawSingle.status === 200 && rawSingle.text.includes('node-ss'),
        `status=${rawSingle.status}`,
    );

    const rawBase64 = Buffer.from(joinedLinks).toString('base64url');
    const rawBase64Out = await api(
        `/api/sub?target=singbox&url=${encodeURIComponent(rawBase64)}`,
    );
    let rawBase64Valid = false;
    try {
        rawBase64Valid =
            JSON.parse(rawBase64Out.text).outbounds.length >= nodeLinks.length;
    } catch (e) {
        rawBase64Valid = false;
    }
    check('兼容层 url= 整段 base64（url-safe）', rawBase64Valid);

    const rawList = await api(
        `/api/sub?list=true&target=clash&url=${encodeURIComponent(joinedLinks)}`,
    );
    check(
        '裸节点 + list=true 只输出节点列表',
        rawList.text.startsWith('proxies:') && !rawList.text.includes('proxy-groups'),
    );

    const rawApi = await post('/api/v1/convert', { url: joinedLinks, target: 'uri' });
    check(
        '统一 API 直接吃节点链接',
        (rawApi.json?.data?.count ?? 0) === nodeLinks.length,
        `count=${rawApi.json?.data?.count}`,
    );

    const mixedApi = await post('/api/v1/convert', {
        data: nodeLinks[0],
        url: nodeLinks.slice(1).join('|'),
        target: 'mihomo',
    });
    check(
        'data 与 url 混着给会合并',
        (mixedApi.json?.data?.count ?? 0) === nodeLinks.length,
        `count=${mixedApi.json?.data?.count}`,
    );

    const urlsafeApi = await post('/api/v1/convert', {
        data: rawBase64,
        target: 'singbox',
    });
    check(
        'data 支持 url-safe（无 padding）base64',
        urlsafeApi.json?.status === 'success',
        urlsafeApi.json?.error?.message,
    );

    section('整段配置作为输入');
    // 回归：配置靠缩进表达结构, 一旦被逐行 trim 再拼回去就成了非法 YAML,
    // 内核退回逐行解析会把 `type: vless` 当成一条节点, 输出一屏 undefined。
    const configApi = await post('/api/v1/convert', {
        data: CLASH_CONFIG,
        target: 'uri',
        list: true,
    });
    check(
        '整段 Clash YAML（data）解析出全部节点',
        (configApi.json?.data?.count ?? 0) === CLASH_CONFIG_NODES,
        `count=${configApi.json?.data?.count} 期望=${CLASH_CONFIG_NODES}`,
    );
    check(
        '整段 Clash YAML 结果不含 undefined',
        (configApi.json?.data?.count ?? 0) > 0 &&
            !/undefined/.test(configApi.json.data.content),
        configApi.json?.data?.error?.message,
    );
    check(
        '整段 Clash YAML 保留了 name / uuid / ws 细节',
        configApi.json?.data?.content?.includes('Vls-SG-Alibaba') &&
            configApi.json?.data?.content?.includes(
                '7fe2618c-b013-4d14-a4ea-835cf2a0e1d7',
            ) &&
            configApi.json?.data?.content?.includes('type=ws'),
    );
    check(
        'YAML 的 proxy-groups / rules 不会被当成节点',
        (configApi.json?.data?.count ?? 0) === CLASH_CONFIG_NODES,
    );

    const configViaUrl = await post('/api/v1/convert', {
        url: CLASH_CONFIG,
        target: 'uri',
        list: true,
    });
    check(
        '整段配置走 url 参数同样可用',
        (configViaUrl.json?.data?.count ?? 0) === CLASH_CONFIG_NODES,
        `count=${configViaUrl.json?.data?.count}`,
    );

    const singboxInput = await post('/api/v1/convert', {
        data: JSON.stringify({ outbounds: [{ type: 'vless', tag: 'x' }] }),
        target: 'uri',
    });
    check(
        'sing-box 配置作为输入时给出明确提示',
        singboxInput.json?.status === 'failed' &&
            /sing-box/.test(singboxInput.json?.error?.message ?? ''),
        singboxInput.json?.error?.message,
    );

    const badRemote = await api(
        `/api/sub?target=mihomo&url=${encodeURIComponent('example.com/sub')}`,
    );
    check(
        '认不出的地址仍报拉取失败（不误判成节点）',
        badRemote.status >= 400 && badRemote.json?.error?.code === 'REMOTE_FETCH_FAILED',
        `status=${badRemote.status}`,
    );

    section('订阅页与兼容层');
    const page = await api(
        '/api/sub?target=page&data=' +
            encodeURIComponent(
                'ss://YWVzLTI1Ni1nY206cGFzc0AxLjIuMy40OjQ0Mw==#smoke-page',
            ),
    );
    check(
        '订阅页 HTML',
        page.status === 200 && page.text.includes('<!DOCTYPE html>'),
        `status=${page.status}`,
    );
    check(
        '订阅页含节点行与复制按钮',
        page.text.includes('data-copy=') && page.text.includes('smoke-page'),
    );

    const upload = await post('/api/upload', { content: NODES });
    const pasteUrl = upload.json?.data?.url;
    check('上传外部配置返回 url', typeof pasteUrl === 'string' && pasteUrl.length > 0, JSON.stringify(upload.json));
    const paste = await api(new URL(pasteUrl).pathname);
    check('外部配置可读回', paste.text.trim().endsWith(NODES.trim().split('\n').pop()?.trim() ?? ''));

    const compat = await api(
        `/api/sub?target=mihomo&url=${encodeURIComponent(pasteUrl)}`,
    );
    check(
        '兼容层 /sub 取远程订阅 + 模板',
        compat.status === 200 && compat.text.includes('proxy-groups:'),
        `status=${compat.status} len=${compat.text.length}`,
    );

    const compatPage = await api(
        `/api/sub?target=page&url=${encodeURIComponent(pasteUrl)}`,
    );
    check(
        '订阅页生成各客户端订阅链接',
        compatPage.text.includes('/api/sub?target=mihomo') &&
            compatPage.text.includes('/api/sub?target=singbox'),
        `links=${(compatPage.text.match(/api\/sub\?target=/g) ?? []).length}`,
    );

    const upstreamTemplate = await api(
        `/api/sub?target=mihomo&config=${encodeURIComponent(
            'upstream/sublinkx-clash.yaml',
        )}&url=${encodeURIComponent(pasteUrl)}`,
    );
    check(
        '吸收的上游模板 (无 token) 走注入路径',
        upstreamTemplate.status === 200 &&
            /proxies:\s*\n\s*-/.test(upstreamTemplate.text) &&
            upstreamTemplate.text.includes('proxy-groups:'),
        `status=${upstreamTemplate.status} len=${upstreamTemplate.text.length}`,
    );

    const compatList = await api(
        `/api/sub?list=true&target=clash&url=${encodeURIComponent(pasteUrl)}`,
    );
    check(
        '兼容层 list=true',
        compatList.text.startsWith('proxies:') && !compatList.text.includes('proxy-groups'),
    );

    const compatInsert = await api(
        `/api/sub?target=mihomo&url=${encodeURIComponent(pasteUrl)}&config=${encodeURIComponent(pasteUrl)}&insert=true`,
    );
    check(
        '兼容层 config+insert 注入节点',
        compatInsert.status === 200 && compatInsert.text.includes('proxies:'),
        `status=${compatInsert.status}`,
    );

    const short = await post('/api/short', {
        longUrl: Buffer.from('https://example.com/sub?target=clash').toString('base64'),
    });
    check('短链接服务', short.json?.Code === 1 && Boolean(short.json?.ShortUrl), JSON.stringify(short.json));
    if (short.json?.ShortUrl) {
        const redirect = await fetch(short.json.ShortUrl, { redirect: 'manual' });
        check('短链接跳转', [301, 302, 303, 307, 308].includes(redirect.status), `status=${redirect.status}`);
    }

    const kernel = await post('/api/proxy/parse', {
        data: NODES.split('\n')[0],
        client: 'ClashMeta',
    });
    check('内核原生接口仍可用', kernel.json?.status === 'success');

    section('内置前端（单端口）');
    const rootPage = await api('/');
    const hasFrontend =
        rootPage.status === 200 && rootPage.text.includes('<div id="app">');
    if (hasFrontend) {
        check('根路径返回前端页面', true);
        const parsePage = await api('/parse');
        check(
            '解析页路由 /parse 回退到前端',
            parsePage.status === 200 &&
                parsePage.text.includes('<div id="app">'),
            `status=${parsePage.status}`,
        );
    } else {
        console.log('  — 跳过 (web/dist 未构建, 当前只有 API)');
    }

    console.log(
        `\n结果: ${passed} 项通过, ${failures.length} 项失败${
            failures.length > 0 ? `\n失败项:\n - ${failures.join('\n - ')}` : ''
        }`,
    );

    process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error(`冒烟测试异常: ${error.stack ?? error}`);
    process.exit(1);
});
