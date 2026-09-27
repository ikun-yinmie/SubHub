/**
 * 合并层数据存储
 *
 * 复用内核 (Sub-Store) 的持久化能力:
 * - 带 `#` 前缀的 key 存放在 root.json
 * - 普通 key 存放在 sub-store.json
 * 数据目录由内核的 SUB_STORE_DATA_BASE_PATH 控制 (默认 .)
 */
import $ from '@/core/app';

export const NS = '#subhub';

export const KEYS = {
    nodes: `${NS}.nodes`,
    groups: `${NS}.groups`,
    meta: `${NS}.meta`,
    nodeInfoCache: `${NS}.node-info-cache`,
    pastes: `${NS}.pastes`,
    shorts: `${NS}.shorts`,
};

export function readJSON(key, fallback) {
    try {
        const raw = $.read(key);
        if (typeof raw === 'string' && raw.length > 0) {
            return JSON.parse(raw);
        }
        if (raw && typeof raw === 'object') return raw;
    } catch (e) {
        $.error(`[SUBHUB] 读取数据失败: ${key}\nReason: ${e.message ?? e}`);
    }
    return fallback;
}

export function writeJSON(key, value) {
    $.write(JSON.stringify(value), key);
    return value;
}

export function nowISO() {
    return new Date().toISOString();
}

/**
 * 生成短 id, 避免额外依赖
 */
export function shortId(prefix = 'n') {
    return `${prefix}_${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 8)}`;
}

export function listNodes() {
    const nodes = readJSON(KEYS.nodes, []);
    return Array.isArray(nodes) ? nodes : [];
}

export function saveNodes(nodes) {
    return writeJSON(KEYS.nodes, nodes);
}

export function listGroups() {
    const groups = readJSON(KEYS.groups, []);
    return Array.isArray(groups) ? groups : [];
}

export function saveGroups(groups) {
    return writeJSON(KEYS.groups, groups);
}

export function getMeta() {
    return readJSON(KEYS.meta, {});
}

export function saveMeta(meta) {
    return writeJSON(KEYS.meta, meta);
}

export function getStorageStats() {
    const nodes = listNodes();
    const groups = listGroups();
    const byType = {};
    for (const node of nodes) {
        const type = node.proxy?.type ?? 'unknown';
        byType[type] = (byType[type] ?? 0) + 1;
    }

    return {
        nodes: nodes.length,
        groups: groups.length,
        enabled: nodes.filter((node) => node.enabled !== false).length,
        byType,
    };
}
