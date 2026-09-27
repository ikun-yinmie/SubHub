/**
 * 订阅模板系统
 *
 * 吸收自 sublinkX 的 template/ (clash.yaml / surge.conf) 与 SubConverter 的
 * 外部配置思路: 内核 producer 负责生成节点定义, 模板负责生成完整配置外壳。
 *
 * 模板语法:
 *   {{token}}            整行占位 (按占位行缩进注入, 可缩进多行内容)
 *   文本 {{token}} 文本  行内占位
 *   {{token|json}}       过滤器: json / yaml / lines / base64 / csv
 */
import $ from '@/core/app';
import YAML from '@/utils/yaml';
import getFs from '@/runtime/fs';
import getPath from '@/runtime/path';
import { Base64 } from 'js-base64';
import { ProxyUtils } from '@/core/proxy-utils';
import { getPathConfig } from './config';
import { pageClientTargets } from './targets';

const DEFAULT_TEMPLATE_BY_TARGET = {
    mihomo: 'mihomo.yaml',
    clash: 'clash.yaml',
    surge: 'surge.conf',
    singbox: 'singbox.json',
    // Stash / Egern / QX / Loon / Surfboard / Shadowrocket 默认只输出节点列表;
    // 在 config/templates/ 下放一个 <target>.yaml|conf|json 即会自动启用
};

const TEMPLATE_EXTENSIONS = [
    '.yaml',
    '.yml',
    '.json',
    '.conf',
    '.ini',
    '.txt',
    '.html',
];

export function templatesDir() {
    return getPathConfig().templates;
}

function templateFile(name) {
    const path = getPath();
    if (!path) return name;
    return path.join(templatesDir(), name);
}

/**
 * 列出 config/templates 下所有模板 (不含 upstream/ 子目录)
 */
export function listTemplates() {
    const fs = getFs();
    const path = getPath();
    if (!fs || !path) return [];

    const dir = templatesDir();
    try {
        return fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
            .map((entry) => ({
                name: entry.name,
                id: entry.name.replace(/\.[^.]+$/, ''),
                target: Object.entries(DEFAULT_TEMPLATE_BY_TARGET).find(
                    ([, file]) => file === entry.name,
                )?.[0],
                size: fs.statSync(path.join(dir, entry.name)).size,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
        $.error(`[SUBHUB] 读取模板目录失败: ${dir}`);
        return [];
    }
}

export function readTemplate(name) {
    const fs = getFs();
    if (!fs || !name) return undefined;
    const path = getPath();

    const candidates = [name];
    if (path && !path.extname(name)) {
        for (const ext of TEMPLATE_EXTENSIONS) candidates.push(`${name}${ext}`);
    }

    for (const candidate of candidates) {
        const file = templateFile(candidate);
        try {
            if (fs.existsSync(file) && fs.statSync(file).isFile()) {
                return { name: candidate, content: fs.readFileSync(file, 'utf8') };
            }
        } catch (e) {
            // 继续尝试
        }
    }

    return undefined;
}

export function defaultTemplateFor(targetId) {
    return DEFAULT_TEMPLATE_BY_TARGET[targetId];
}

function indentLines(value, indent) {
    return `${value}`
        .split('\n')
        .map((line) => (line.length > 0 ? `${indent}${line}` : line))
        .join('\n');
}

function applyFilter(value, filter) {
    if (!filter) return value;
    const key = `${filter}`.toLowerCase();
    const list = Array.isArray(value) ? value : undefined;

    if (key === 'json') {
        return JSON.stringify(value);
    }
    if (key === 'yaml') {
        return YAML.safeDump(value, { lineWidth: -1 });
    }
    if (key === 'lines') {
        return (list ?? `${value}`.split('\n')).join('\n');
    }
    if (key === 'csv' || key === 'join') {
        return (list ?? [value]).join(', ');
    }
    if (key === 'base64') {
        return Base64.encode((list ?? [`${value}`]).join('\n'));
    }
    return value;
}

function stringifyToken(value, filter, inline) {
    if (value == null) return '';
    const filtered = applyFilter(value, filter);
    if (typeof filtered === 'string') return filtered;
    if (Array.isArray(filtered)) {
        return inline ? filtered.join(', ') : filtered.join('\n');
    }
    return `${filtered}`;
}

const WHOLE_LINE_TOKEN =
    /^([ \t]*)\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*([a-zA-Z0-9_]+)\s*)?\}\}[ \t]*$/gm;
const INLINE_TOKEN = /\{\{\s*([a-zA-Z0-9_.]+)\s*(?:\|\s*([a-zA-Z0-9_]+)\s*)?\}\}/g;

function resolveToken(context, key, filter, inline) {
    if (!(key in context)) return undefined;
    return stringifyToken(context[key], filter, inline);
}

export function renderTemplate(content, context) {
    let output = `${content}`.replace(
        WHOLE_LINE_TOKEN,
        (match, indent, key, filter) => {
            const value = resolveToken(context, key, filter, false);
            if (value === undefined) return match;
            return indentLines(value, indent);
        },
    );

    output = output.replace(INLINE_TOKEN, (match, key, filter) => {
        const value = resolveToken(context, key, filter, true);
        return value === undefined ? match : value;
    });

    return output;
}

function htmlEscape(value) {
    return `${value}`
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildShareQuery(shareParams = {}) {
    return Object.entries(shareParams)
        .filter(([, value]) => value != null && `${value}`.length > 0)
        .map(
            ([key, value]) =>
                `${encodeURIComponent(key)}=${encodeURIComponent(`${value}`)}`,
        )
        .join('&');
}

function buildClientLinks(meta = {}) {
    if (meta.clientLinks) {
        return meta.clientLinks
            .map(
                (link) =>
                    `<li><a href="${htmlEscape(link.url)}">${htmlEscape(
                        link.label,
                    )}</a></li>`,
            )
            .join('\n');
    }

    if (!meta.baseUrl) return '';

    const query = buildShareQuery(meta.shareParams);
    return pageClientTargets()
        .map(({ id, label }) => {
            const url = `${meta.baseUrl}/api/sub?target=${id}${
                query ? `&${query}` : ''
            }`;
            return `<li><a href="${htmlEscape(url)}">${htmlEscape(label)}</a></li>`;
        })
        .join('\n');
}

function buildNodeRows(proxies) {
    return proxies
        .map((proxy) => {
            let shareLink = '';
            try {
                shareLink = ProxyUtils.produce([proxy], 'uri', 'internal')[0];
            } catch (e) {
                shareLink = '';
            }
            return `<tr><td>${htmlEscape(proxy.name)}</td><td>${
                proxy.type ?? ''
            }</td><td>${htmlEscape(proxy.server)}:${
                proxy.port
            }</td><td><code>${htmlEscape(
                shareLink,
            )}</code> <button data-copy="${htmlEscape(
                shareLink,
            )}">复制</button></td></tr>`;
        })
        .join('\n');
}

/**
 * 构造模板渲染上下文 (token -> value)
 */
export function buildRenderContext({ proxies, target, options = {}, meta = {} }) {
    const warnings = [];
    const emitOptions = {
        'include-unsupported-proxy': options.includeUnsupportedProxy,
        'delete-underscore-fields': true,
    };

    let nodeOutput = '';
    try {
        if (target.format === 'yaml') {
            // YAML 目标需要的是 proxies: 下的列表项, 不能带 "proxies:" 包装
            const list =
                ProxyUtils.produce(
                    proxies,
                    target.kernel,
                    'internal',
                    emitOptions,
                ) ?? [];
            nodeOutput = YAML.safeDump(list, { lineWidth: -1 });
        } else if (target.format === 'json' && target.id !== 'singbox') {
            const list =
                ProxyUtils.produce(
                    proxies,
                    target.kernel,
                    'internal',
                    emitOptions,
                ) ?? [];
            nodeOutput = JSON.stringify(list, null, 2);
        } else {
            nodeOutput = ProxyUtils.produce(
                proxies,
                target.kernel,
                undefined,
                emitOptions,
            );
        }
    } catch (e) {
        warnings.push(`生成 ${target.id} 节点定义失败: ${e.message ?? e}`);
        $.error(`[SUBHUB] produce ${target.id} 失败: ${e.message ?? e}`);
    }

    let shareLinks = '';
    try {
        shareLinks = (ProxyUtils.produce(proxies, 'uri', 'internal') ?? []).join(
            '\n',
        );
    } catch (e) {
        warnings.push(`生成分享链接失败: ${e.message ?? e}`);
    }

    const names = proxies.map((proxy) => proxy.name);
    const context = {
        proxies: nodeOutput,
        names,
        names_json: JSON.stringify(names),
        count: proxies.length,
        time: new Date().toISOString(),
        target: target.id,
        target_label: target.label,
        title: options.name || meta.name || 'SubHub 订阅',
        name: options.name || meta.name || 'SubHub',
        share_links: shareLinks,
        node_rows: buildNodeRows(proxies),
        client_links: buildClientLinks(meta),
        base_url: meta.baseUrl ?? '',
    };

    if (target.id === 'singbox') {
        let nodeOutbounds = [];
        let endpoints = [];
        try {
            const produced = ProxyUtils.produce(
                proxies,
                'singbox',
                'internal',
                {
                    ...emitOptions,
                    'include-unsupported-proxy': true,
                },
            );
            nodeOutbounds = produced?.outbounds ?? produced ?? [];
            if (produced?.endpoints) endpoints = produced.endpoints;
        } catch (e) {
            warnings.push(`生成 sing-box outbounds 失败: ${e.message ?? e}`);
        }

        const groupOutbounds = [
            {
                type: 'selector',
                tag: '🚀 节点选择',
                outbounds: ['♻️ 自动选择', 'DIRECT', ...names],
            },
            {
                type: 'urltest',
                tag: '♻️ 自动选择',
                outbounds: names,
                url: 'http://www.gstatic.com/generate_204',
                interval: '5m',
                tolerance: 50,
            },
            { type: 'direct', tag: 'DIRECT' },
        ];

        context.outbounds = [...nodeOutbounds, ...groupOutbounds];
        context.endpoints = endpoints;
        context.outbounds_json = JSON.stringify(context.outbounds, null, 2);
        context.endpoints_json = JSON.stringify(endpoints, null, 2);
    }

    return { context, warnings };
}

/**
 * 把节点注入到已有配置里 (等价于 subconverter 的 insert 语义)
 */
export function injectProxies(content, target, proxies) {
    const text = `${content}`;
    const emitOptions = {
        'delete-underscore-fields': true,
        'include-unsupported-proxy': false,
    };

    if (target.format === 'yaml') {
        let items = '';
        try {
            const list =
                ProxyUtils.produce(
                    proxies,
                    target.kernel,
                    'internal',
                    emitOptions,
                ) ?? [];
            items = YAML.safeDump(list, { lineWidth: -1 });
        } catch (e) {
            $.error(`[SUBHUB] 注入 YAML 节点失败: ${e.message ?? e}`);
            return text;
        }

        const lines = text.split('\n');
        const index = lines.findIndex((line) => /^proxies:\s*(~)?\s*$/.test(line));
        const block = items.split('\n');
        if (index !== -1) {
            lines.splice(index + 1, 0, ...block);
            return lines.join('\n');
        }
        return `${text.replace(/\s*$/, '')}\nproxies:\n${block.join('\n')}\n`;
    }

    if (target.format === 'json') {
        try {
            const config = JSON.parse(text);
            const produced = ProxyUtils.produce(
                proxies,
                target.kernel,
                'internal',
                { ...emitOptions, 'include-unsupported-proxy': true },
            );
            const outbounds = Array.isArray(produced)
                ? produced
                : produced?.outbounds ?? [];
            config.outbounds = [...(config.outbounds ?? []), ...outbounds];
            if (produced?.endpoints) {
                config.endpoints = [...(config.endpoints ?? []), ...produced.endpoints];
            }
            return JSON.stringify(config, null, 2);
        } catch (e) {
            $.error(`[SUBHUB] 注入 JSON 节点失败: ${e.message ?? e}`);
            return text;
        }
    }

    let block = '';
    try {
        block = ProxyUtils.produce(proxies, target.kernel, undefined, emitOptions);
    } catch (e) {
        $.error(`[SUBHUB] 注入节点失败: ${e.message ?? e}`);
        return text;
    }

    const lines = text.split('\n');
    const index = lines.findIndex((line) => /^\[proxy\]\s*$/i.test(line.trim()));
    if (index !== -1) {
        lines.splice(index + 1, 0, block);
        return lines.join('\n');
    }
    return `${text.replace(/\s*$/, '')}\n[Proxy]\n${block}\n`;
}
