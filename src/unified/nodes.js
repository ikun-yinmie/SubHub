/**
 * 节点库 (吸收自 sublinkX 的节点/分组模型)
 *
 * - 节点: 解析后的标准 proxy 对象 + 原始分享链接 + 标签/分组/备注
 * - 分组: 仅做归类, 不参与生成逻辑 (生成时用 selection 选择)
 * - 探测: TCP 握手延迟 + IP 归属 (复用内核 HTTP 与 ip-api 约定)
 */
import $ from '@/core/app';
import { HTTP } from '@/vendor/open-api';
import getNet from '@/runtime/net';
import { Base64 } from 'js-base64';
import { ProxyUtils } from '@/core/proxy-utils';
import { getConfig } from './config';
import { nodeIdentity } from './pipeline';
import { normalizeInlineContent } from './convert';
import {
    KEYS,
    listGroups,
    listNodes,
    nowISO,
    readJSON,
    saveGroups,
    saveNodes,
    shortId,
    writeJSON,
} from './store';
import { makeError } from './convert';

export { listGroups };

function shareLinkOf(proxy) {
    try {
        return ProxyUtils.produce([proxy], 'uri', 'internal')?.[0];
    } catch (e) {
        return undefined;
    }
}

function toRecord(proxy, extra = {}) {
    const timestamp = nowISO();
    return {
        id: shortId('node'),
        name: proxy.name,
        type: proxy.type,
        server: proxy.server,
        port: proxy.port,
        raw: extra.raw ?? shareLinkOf(proxy),
        proxy,
        tags: extra.tags ?? [],
        group: extra.group ?? undefined,
        note: extra.note ?? undefined,
        enabled: extra.enabled !== false,
        createdAt: timestamp,
        updatedAt: timestamp,
    };
}

export function decorate(node) {
    return {
        id: node.id,
        name: node.name,
        type: node.type,
        server: node.server,
        port: node.port,
        tags: node.tags ?? [],
        group: node.group,
        note: node.note,
        enabled: node.enabled !== false,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        shareLink: node.raw ?? shareLinkOf(node.proxy),
    };
}

export function queryNodes(query = {}) {
    const keyword = `${query.q ?? ''}`.trim().toLowerCase();
    const tags = `${query.tags ?? ''}`
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    return listNodes().filter((node) => {
        if (query.group && node.group !== query.group) return false;
        if (query.type && node.type !== query.type) return false;
        if (query.enabled != null) {
            const enabled = ['true', '1', 'yes'].includes(`${query.enabled}`);
            if ((node.enabled !== false) !== enabled) return false;
        }
        if (tags.length > 0 && !tags.every((tag) => (node.tags ?? []).includes(tag))) {
            return false;
        }
        if (keyword) {
            const haystack =
                `${node.name} ${node.server} ${node.type} ${node.note ?? ''}`.toLowerCase();
            if (!haystack.includes(keyword)) return false;
        }
        return true;
    });
}

/**
 * 解析原始内容 (分享链接 / clash 配置 / JSON) 并入库
 */
export function importNodes(payload = {}) {
    const input = payload.raw ?? payload.data ?? payload.content;
    if (typeof input !== 'string' || input.trim().length === 0) {
        throw makeError('NO_INPUT', '缺少 raw/data/content');
    }

    // 与 /api/v1/convert 一致: 落掉 url-safe base64 外壳, 单行 | 拼接的多条链接拆回多行
    const raw = normalizeInlineContent(input);
    const proxies = ProxyUtils.parse(raw);
    if (!Array.isArray(proxies) || proxies.length === 0) {
        throw makeError('NO_PROXY', '未能解析出任何节点');
    }

    const nodes = listNodes();
    const existing = new Set(nodes.map((node) => nodeIdentity(node.proxy)));
    const rawLines = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const added = [];
    const skipped = [];
    const tags = payload.tags ?? [];
    const group = payload.group;
    const note = payload.note;

    for (const proxy of proxies) {
        const identity = nodeIdentity(proxy);
        if (existing.has(identity)) {
            skipped.push(proxy.name);
            continue;
        }
        const matchedLine = rawLines.find((line) => {
            try {
                const parsed = ProxyUtils.parse(line);
                return (
                    parsed?.length === 1 &&
                    nodeIdentity(parsed[0]) === identity
                );
            } catch (e) {
                return false;
            }
        });

        existing.add(identity);
        const record = toRecord(proxy, {
            tags,
            group,
            note,
            raw: matchedLine,
        });
        nodes.push(record);
        added.push(record);
    }

    saveNodes(nodes);

    return {
        added: added.length,
        skipped: skipped.length,
        skippedNames: skipped,
        nodes: added.map(decorate),
        total: nodes.length,
    };
}

export function updateNode(id, patch = {}) {
    const nodes = listNodes();
    const index = nodes.findIndex((node) => node.id === id);
    if (index === -1) throw makeError('NODE_NOT_FOUND', `节点不存在: ${id}`);

    const node = nodes[index];

    if (patch.raw || patch.data || patch.content) {
        const raw = normalizeInlineContent(
            patch.raw ?? patch.data ?? patch.content,
        );
        const parsed = ProxyUtils.parse(raw);
        if (!Array.isArray(parsed) || parsed.length === 0) {
            throw makeError('NO_PROXY', '未能解析出节点');
        }
        node.proxy = parsed[0];
        node.raw = raw.trim();
        node.name = node.proxy.name;
        node.type = node.proxy.type;
        node.server = node.proxy.server;
        node.port = node.proxy.port;
    }

    for (const field of ['tags', 'group', 'note', 'enabled']) {
        if (patch[field] !== undefined) node[field] = patch[field];
    }

    if (patch.name) {
        node.name = patch.name;
        node.proxy.name = patch.name;
        node.raw = shareLinkOf(node.proxy);
    }

    node.updatedAt = nowISO();
    nodes[index] = node;
    saveNodes(nodes);

    return decorate(node);
}

export function deleteNodes(ids, { all = false } = {}) {
    const nodes = listNodes();
    if (all) {
        saveNodes([]);
        return { removed: nodes.length, total: 0 };
    }

    const targets = new Set(Array.isArray(ids) ? ids : [ids]);
    const kept = nodes.filter((node) => !targets.has(node.id));
    saveNodes(kept);

    return { removed: nodes.length - kept.length, total: kept.length };
}

export function pruneNodes() {
    const nodes = listNodes();
    const seen = new Set();
    const kept = [];
    const removed = [];

    for (const node of nodes) {
        const identity = nodeIdentity(node.proxy);
        if (seen.has(identity)) {
            removed.push(node.name);
            continue;
        }
        seen.add(identity);
        kept.push(node);
    }

    saveNodes(kept);
    return { removed: removed.length, removedNames: removed, total: kept.length };
}

export function upsertGroup(payload = {}) {
    const name = `${payload.name ?? ''}`.trim();
    if (!name) throw makeError('INVALID_GROUP', '分组名不能为空');

    const groups = listGroups();
    const index = groups.findIndex((group) => group.name === name);
    const record = {
        name,
        description: payload.description ?? '',
        updatedAt: nowISO(),
        createdAt: index === -1 ? nowISO() : groups[index].createdAt,
    };

    if (index === -1) groups.push(record);
    else groups[index] = record;

    saveGroups(groups);
    return record;
}

export function deleteGroup(name) {
    const groups = listGroups();
    const kept = groups.filter((group) => group.name !== name);
    saveGroups(kept);

    // 解除节点上的分组引用
    const nodes = listNodes();
    let cleared = 0;
    for (const node of nodes) {
        if (node.group === name) {
            node.group = undefined;
            cleared += 1;
        }
    }
    if (cleared > 0) saveNodes(nodes);

    return { removed: groups.length - kept.length, cleared, total: kept.length };
}

export function exportNodes(selection = {}, { format = 'uri' } = {}) {
    const nodes = selectNodesForExport(selection);
    if (nodes.length === 0) throw makeError('EMPTY_SELECTION', '没有匹配的节点');

    const proxies = nodes.map((node) => node.proxy);
    if (format === 'json') {
        return JSON.stringify(proxies, null, 2);
    }
    if (format === 'base64') {
        const links = ProxyUtils.produce(proxies, 'uri', 'internal') ?? [];
        return Base64.encode(links.join('\n'));
    }

    return (ProxyUtils.produce(proxies, 'uri', 'internal') ?? []).join('\n');
}

function selectNodesForExport(selection = {}) {
    const ids = new Set(selection.ids ?? selection.nodeIds ?? []);
    const groups = new Set(selection.groups ?? []);
    const tags = new Set(selection.tags ?? []);
    const noFilter = ids.size === 0 && groups.size === 0 && tags.size === 0;

    return listNodes().filter((node) => {
        if (noFilter) return true;
        if (ids.has(node.id)) return true;
        if (node.group && groups.has(node.group)) return true;
        if ((node.tags ?? []).some((tag) => tags.has(tag))) return true;
        return false;
    });
}

/*****************************
 * 探测
 *****************************/

function cleanHost(server) {
    return `${server ?? ''}`.trim().replace(/^\[/, '').replace(/\]$/, '');
}

export function tcpPing(server, port, timeout = 3000) {
    const net = getNet();
    if (!net) return Promise.resolve(undefined);

    return new Promise((resolve) => {
        const startedAt = Date.now();
        let settled = false;
        const socket = net.connect({ host: cleanHost(server), port: Number(port) });

        const finish = (value) => {
            if (settled) return;
            settled = true;
            try {
                socket.destroy();
            } catch (e) {
                // ignore
            }
            resolve(value);
        };

        socket.setTimeout(timeout);
        socket.once('connect', () => finish(Date.now() - startedAt));
        socket.once('timeout', () => finish(undefined));
        socket.once('error', () => finish(undefined));
    });
}

function infoCache() {
    return readJSON(KEYS.nodeInfoCache, {});
}

function cachedInfo(server) {
    const config = getConfig();
    const cache = infoCache();
    const entry = cache[server];
    if (!entry) return undefined;
    if (Date.now() - entry.at > (config.nodeInfo.cacheTTL ?? 0)) return undefined;
    return entry.info;
}

function storeInfo(server, info) {
    const cache = infoCache();
    cache[server] = { at: Date.now(), info };
    const keys = Object.keys(cache);
    // 简单的容量控制
    if (keys.length > 500) {
        keys.sort((a, b) => cache[a].at - cache[b].at)
            .slice(0, keys.length - 500)
            .forEach((key) => delete cache[key]);
    }
    writeJSON(KEYS.nodeInfoCache, cache);
}

export async function lookupIPInfo(server) {
    const host = cleanHost(server);
    if (!host) return undefined;

    const cached = cachedInfo(host);
    if (cached !== undefined) return cached;

    const config = getConfig();
    const $http = HTTP();
    try {
        const response = await $http.get({
            url: `${config.nodeInfo.provider}/${encodeURIComponent(host)}?lang=${
                config.nodeInfo.lang
            }`,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 12_4) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.4 Safari/605.1.15',
            },
            timeout: config.nodeInfo.timeout,
        });
        const data = JSON.parse(response.body);
        if (data.status !== 'success') return undefined;
        delete data.status;
        storeInfo(host, data);
        return data;
    } catch (e) {
        $.error(`[SUBHUB] 查询节点归属失败: ${host}`);
        return undefined;
    }
}

async function withConcurrency(items, limit, worker) {
    const results = [];
    let cursor = 0;

    const runners = new Array(Math.min(limit, items.length))
        .fill(0)
        .map(async () => {
            while (cursor < items.length) {
                const index = cursor;
                cursor += 1;
                results[index] = await worker(items[index], index);
            }
        });

    await Promise.all(runners);
    return results;
}

/**
 * 批量探测: TCP 延迟 + IP 归属
 */
export async function probeNodes(payload = {}) {
    const nodes = selectNodesForExport(payload.selection ?? payload);
    if (nodes.length === 0) throw makeError('EMPTY_SELECTION', '没有匹配的节点');

    const timeout = Number(payload.timeout) || 3000;
    const concurrency = Math.min(Number(payload.concurrency) || 8, 32);
    const withIPInfo = payload.ip !== false && payload.ip !== 'false';

    const results = await withConcurrency(nodes, concurrency, async (node) => {
        const latency = await tcpPing(node.server, node.port, timeout);
        const info = withIPInfo ? await lookupIPInfo(node.server) : undefined;
        return {
            id: node.id,
            name: node.name,
            type: node.type,
            server: node.server,
            port: node.port,
            latency: latency ?? null,
            reachable: latency != null,
            info: info
                ? {
                      country: info.country,
                      countryCode: info.countryCode,
                      city: info.city,
                      isp: info.isp,
                      as: info.as,
                      query: info.query,
                  }
                : undefined,
            shareLink: node.raw ?? shareLinkOf(node.proxy),
        };
    });

    return {
        total: nodes.length,
        reachable: results.filter((item) => item.reachable).length,
        results,
    };
}
