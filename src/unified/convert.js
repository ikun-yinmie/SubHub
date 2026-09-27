/**
 * 统一转换核心
 *
 * 输入: 分享链接 / clash·sing-box·json 配置 / 订阅 URL / 节点库选择
 * 输出: 任意目标平台 (内核 producer) 或完整配置 (模板)
 */
import $ from '@/core/app';
import download from '@/utils/download';
import { Base64 } from 'js-base64';
import { ProxyUtils } from '@/core/proxy-utils';
import { getConfig } from './config';
import { resolveTarget, shareLinkTypes } from './targets';
import { runPipeline, summarize } from './pipeline';
import { listNodes } from './store';
import {
    buildRenderContext,
    defaultTemplateFor,
    readTemplate,
    renderTemplate,
} from './templates';

export function makeError(code, message, details) {
    const error = new Error(message);
    error.code = code;
    error.type = 'SUBHUB';
    if (details) error.details = details;
    return error;
}

function inputUrls(payload) {
    const raw = payload.urls ?? payload.url;
    if (!raw) return [];

    const list = Array.isArray(raw) ? raw : [`${raw}`];
    return list
        .flatMap((item) =>
            // 整段配置里的 | 是配置内容 (block scalar / 正则 / 名字), 不能当分隔符
            looksLikeConfig(item) ? [item] : `${item}`.split('|'),
        )
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

/**
 * 整段结构化配置 (Clash/mihomo YAML、sing-box JSON、Surge 分节…)
 *
 * 这种输入必须原样处理: 下面的逐行 trim 会把 YAML 缩进削平, YAML 解析直接失败,
 * 内核退回逐行解析后会把 `type: vless` 这种单行当成一条节点, 输出一屏
 * `vless://undefined@undefined:undefined`。
 */
const CONFIG_ROOT_KEY =
    /^[ \t]*(proxies|proxy-groups|proxy-providers|rule-providers|rules|outbounds|inbounds|listeners|dns|experimental|mixed-port|socks-port)[ \t]*:/m;

export function looksLikeConfig(value = '') {
    const text = `${value}`.trim();
    if (text.length === 0) return false;
    if (text.startsWith('{') || text.startsWith('[')) return true;
    if (!text.includes('\n')) return false;
    return CONFIG_ROOT_KEY.test(text);
}

const BASE64_BLOB = /^[A-Za-z0-9+/_=-]+$/;
const SHARE_LINK_LINE = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * subconverter 习惯把多条链接用 | 拼成一行 (它自己的 url 参数就是这种形态),
 * 但内核的解析器按行读——所以把"整行都是分享链接"的 | 还原成换行。
 * 只在每一段都是分享链接时才动手, 带 filter: "a|b" 的配置不会被误改。
 */
function splitLinkList(text = '') {
    if (text.includes('\n') || !text.includes('|')) return text;
    const parts = text
        .split('|')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    if (parts.length < 2) return text;
    return parts.every((part) => SHARE_LINK_LINE.test(part))
        ? parts.join('\n')
        : text;
}

/**
 * 整段 base64 (标准或 url-safe, 允许换行折行) 且解出来是有结构的文本时, 当作内容
 */
function decodeInlineBase64(value = '') {
    const compact = `${value}`.replace(/\s+/g, '');
    if (compact.length < 16) return undefined;
    if (!BASE64_BLOB.test(compact)) return undefined;
    try {
        const decoded = `${Base64.decode(
            compact.replace(/-/g, '+').replace(/_/g, '/'),
        )}`;
        return decoded.includes(':') ? splitLinkList(decoded) : undefined;
    } catch (e) {
        return undefined;
    }
}

/**
 * 分流"这段输入是手上就有的内容, 还是要联网去拉的订阅地址"。
 *
 * 为什么需要它: subconverter 的 url 参数本来就允许直接塞分享链接
 * (内置前端把输入框里的每一行用 | 拼进 url), 而 download() 只认 http(s)
 * 和本地路径, 不先分流就会把 ss:// 当成远程订阅去请求,
 * 报出误导人的"拉取订阅失败"——节点明明就在手上。
 *
 * 返回内容字符串 = 这段不用联网; 返回 undefined = 交给 download()
 * (认不出来的照样走老路径, 保留原有报错信息)。
 */
function asInlineContent(value = '') {
    const text = `${value}`.trim();
    if (text.length === 0) return undefined;

    const decoded = decodeInlineBase64(text);
    if (decoded !== undefined) return decoded;

    // 真正要去下载的: http(s) 订阅地址, 或者 /api/file/xxx、本地绝对路径
    if (/^https?:\/\//i.test(text) || text.startsWith('/')) return undefined;

    // 任意 scheme 的分享链接 (ss/ssr/vmess/vless/trojan/hysteria2/tuic/...) 都是内容
    if (SHARE_LINK_LINE.test(text)) return splitLinkList(text);

    return undefined;
}

/**
 * 内联内容归一化: 去掉 url-safe/缺 padding 的 base64 外壳, 把单行 | 拼接的多条链接拆回多行。
 * 内核自带的 base64 预处理只认标准形态, 这里先把能认的都认了。
 */
export function normalizeInlineContent(value = '') {
    const text = `${value}`.trim();
    if (text.length === 0) return text;
    return decodeInlineBase64(text) ?? splitLinkList(text);
}

export async function fetchInput(payload = {}) {
    // data/content 是内联内容, url/urls 里的分享链接也同样是内容, 两者可以混着给
    const inline = payload.data ?? payload.content;
    const parts = [];
    if (typeof inline === 'string' && inline.trim().length > 0) {
        parts.push(normalizeInlineContent(inline));
    }

    const timeout = Number(payload.timeout) || undefined;

    for (const url of inputUrls(payload)) {
        // 整段配置: 原样送进解析器, 不能逐行 trim (会削掉 YAML 缩进)
        if (looksLikeConfig(url)) {
            parts.push(normalizeInlineContent(url));
            continue;
        }

        // 一个 url 参数里可能塞了多行 (每行一个订阅或一条节点)
        const lines = `${url}`
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);

        for (const line of lines) {
            const content = asInlineContent(line);
            if (content !== undefined) {
                parts.push(content);
                continue;
            }
            try {
                parts.push(await download(line, undefined, timeout));
            } catch (e) {
                if (payload.ignoreFailedRemoteSub) {
                    $.error(`[SUBHUB] 拉取订阅失败(已忽略): ${line}`);
                    continue;
                }
                throw makeError(
                    'REMOTE_FETCH_FAILED',
                    `拉取订阅失败: ${line}`,
                    `${e.message ?? e}`,
                );
            }
        }
    }

    if (parts.length === 0) return undefined;
    return parts.join('\n');
}

export function selectNodes(selection = {}) {
    const nodes = listNodes();
    const ids = new Set(selection.ids ?? selection.nodeIds ?? []);
    const groups = new Set(selection.groups ?? []);
    const tags = new Set(selection.tags ?? []);
    const noFilter = ids.size === 0 && groups.size === 0 && tags.size === 0;

    return nodes.filter((node) => {
        if (node.enabled === false && !selection.includeDisabled) return false;
        if (noFilter) return true;
        if (ids.has(node.id)) return true;
        if (node.group && groups.has(node.group)) return true;
        if ((node.tags ?? []).some((tag) => tags.has(tag))) return true;
        return false;
    });
}

/**
 * 一条节点都没解析出来时, 说得再具体一点。
 * 目前最容易踩的是 sing-box 配置 (outbounds): 内核只认 Clash/mihomo YAML 输入,
 * 一股脑丢进去只会得到“解析不出任何节点”, 看不出到底哪儿不对。
 */
function describeEmptyInput(raw = '') {
    const text = `${raw}`.trim();
    if (text.startsWith('{') || text.startsWith('[')) {
        try {
            const json = JSON.parse(text);
            if (Array.isArray(json?.outbounds) || json?.inbounds !== undefined) {
                return '未能从输入中解析出任何节点: 这看起来是 sing-box 配置 (outbounds), 目前支持作为输入的是 Clash / mihomo YAML 与 Surge 配置';
            }
        } catch (e) {
            // 不是合法 JSON, 按普通输入给默认文案
        }
    }
    return '未能从输入中解析出任何节点';
}

export async function resolveProxies(payload = {}) {
    const selection =
        payload.selection ?? (payload.nodeIds ? { ids: payload.nodeIds } : undefined);

    if (selection) {
        const nodes = selectNodes(selection);
        if (nodes.length === 0) {
            throw makeError('EMPTY_SELECTION', '节点库中没有匹配的节点');
        }
        return {
            proxies: nodes.map((node) => JSON.parse(JSON.stringify(node.proxy))),
            source: 'library',
            count: nodes.length,
        };
    }

    const raw = await fetchInput(payload);
    if (raw === undefined) {
        throw makeError(
            'NO_INPUT',
            '缺少输入: 需要 data / content / url / selection 之一',
        );
    }

    let proxies;
    try {
        proxies = ProxyUtils.parse(raw);
    } catch (e) {
        throw makeError('PARSE_FAILED', `解析输入失败: ${e.message ?? e}`);
    }

    if (!Array.isArray(proxies) || proxies.length === 0) {
        throw makeError('NO_PROXY', describeEmptyInput(raw));
    }

    return { proxies, source: 'input', count: proxies.length, raw };
}

function buildSsd(proxies) {
    return {
        airport: 'SubHub',
        port: 1,
        encryption: 'aes-256-gcm',
        password: 'subhub',
        servers: proxies.map((proxy) => ({
            server: proxy.server,
            port: proxy.port,
            encryption: proxy.cipher ?? 'aes-256-gcm',
            password: proxy.password ?? '',
            remarks: proxy.name,
            id: Math.floor(Math.random() * 1000000),
        })),
    };
}

function shareLinkList(proxies) {
    try {
        return ProxyUtils.produce(proxies, 'uri', 'internal') ?? [];
    } catch (e) {
        return [];
    }
}

/**
 * 生成目标输出
 */
export function produceOutput(proxies, target, options = {}) {
    const listOnly = Boolean(options.list);
    const emitOptions = {
        'include-unsupported-proxy': options.includeUnsupportedProxy,
        'delete-underscore-fields': true,
    };
    const base = {
        targetId: target.id,
        targetLabel: target.label,
        format: target.format,
        kind: target.kind,
        count: proxies.length,
        warnings: [],
        template: undefined,
    };

    // 订阅页
    if (target.kind === 'page') {
        const template = readTemplate('subscription.html');
        const { context, warnings } = buildRenderContext({
            proxies,
            target: { ...target, format: 'text', kernel: 'uri' },
            options,
            meta: {
                name: options.name,
                baseUrl: options.baseUrl,
                shareParams: options.shareParams,
            },
        });
        return {
            ...base,
            format: 'html',
            warnings,
            content: template
                ? renderTemplate(template.content, context)
                : '<p>缺少 config/templates/subscription.html</p>',
            template: template?.name,
        };
    }

    // 分享链接类目标
    if (['ss', 'ssr', 'ssd', 'base64'].includes(target.id)) {
        let filtered = proxies;
        if (target.id === 'ss' || target.id === 'ssr') {
            const types = shareLinkTypes(target.id) ?? [target.id];
            filtered = proxies.filter((proxy) => types.includes(proxy.type));
        }

        if (target.id === 'ssd') {
            const ssProxies = filtered.filter((proxy) => proxy.type === 'ss');
            return {
                ...base,
                count: ssProxies.length,
                content: Base64.encode(
                    JSON.stringify(buildSsd(ssProxies), null, 2),
                ),
                format: 'base64',
            };
        }

        const links = shareLinkList(filtered);
        if (listOnly) {
            return { ...base, count: filtered.length, content: links.join('\n'), format: 'text' };
        }

        if (target.id === 'base64') {
            return {
                ...base,
                count: filtered.length,
                content: Base64.encode(links.join('\n')),
                format: 'base64',
            };
        }

        return {
            ...base,
            count: filtered.length,
            content: Base64.encode(links.join('\n')),
            format: 'base64',
        };
    }

    if (target.format === 'json' && target.kind === 'internal') {
        return {
            ...base,
            content: JSON.stringify(proxies, null, 2),
            format: 'json',
        };
    }

    // 完整配置: 优先使用模板 (config/templates/<target>.yaml|conf|json)
    if (!listOnly && target.kind === 'config') {
        const template =
            readTemplate(target.id) ??
            readTemplate(defaultTemplateFor(target.id));
        if (template && template.content) {
            const { context, warnings } = buildRenderContext({
                proxies,
                target,
                options,
                meta: { name: options.name, baseUrl: options.baseUrl },
            });
            return {
                ...base,
                content: renderTemplate(template.content, context),
                template: template.name,
                warnings,
            };
        }
    }

    // 节点列表 (list=true 或文本类目标)
    const emit = { ...emitOptions };
    if (target.format === 'yaml') emit.prettyYaml = true;

    return {
        ...base,
        content: ProxyUtils.produce(proxies, target.kernel, undefined, emit),
    };
}

/**
 * 解析输入并跑完处理管线
 */
export async function resolveProcessed(payload = {}) {
    const options = { ...payload, ...(payload.options ?? {}) };
    const { proxies, source, count } = await resolveProxies(payload);
    const { proxies: processed, stats } = runPipeline(proxies, options);

    if (processed.length === 0) {
        throw makeError('EMPTY_RESULT', '经过处理管线后没有剩余节点');
    }

    return { proxies: processed, stats, source, inputCount: count, options };
}

/**
 * 统一转换入口
 */
export async function convert(payload = {}) {
    const config = getConfig();
    const target = resolveTarget(
        payload.target ?? payload.client ?? payload.platform ?? config.defaultTarget,
    );
    if (!target) {
        throw makeError(
            'UNSUPPORTED_TARGET',
            `不支持的目标平台: ${payload.target ?? ''}`,
        );
    }

    const { proxies: processed, stats, source, inputCount, options } =
        await resolveProcessed(payload);
    const count = inputCount;
    const output = produceOutput(processed, target, options);

    return {
        target: {
            id: target.id,
            label: target.label,
            kernel: target.kernel,
            format: target.format,
            kind: target.kind,
        },
        source,
        inputCount: count,
        count: output.count,
        format: output.format,
        content: output.content,
        template: output.template,
        warnings: output.warnings,
        stats,
    };
}

/**
 * 只解析与统计, 不生成配置
 */
export async function inspect(payload = {}) {
    const options = { ...payload, ...(payload.options ?? {}) };
    const { proxies, source, count } = await resolveProxies(payload);
    const { proxies: processed, stats } = runPipeline(proxies, {
        ...options,
        dedupe: options.dedupe ?? false,
    });
    const limit = Number(payload.limit) || 50;
    const summary = summarize(processed);

    return {
        source,
        inputCount: count,
        count: processed.length,
        summary,
        stats,
        nodes: processed.slice(0, limit).map((proxy) => ({
            name: proxy.name,
            type: proxy.type,
            server: proxy.server,
            port: proxy.port,
        })),
        truncated: processed.length > limit,
    };
}
