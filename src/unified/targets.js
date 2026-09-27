/**
 * 统一目标表
 *
 * 把内核 (Sub-Store) 的 producer、subconverter/sub-web 的 target 命名、
 * 以及合并层自有的分享链接输出统一到一套 id 上。
 */
import { getConfig } from './config';

export const TARGETS = [
    {
        id: 'mihomo',
        label: 'Mihomo / Clash.Meta',
        kernel: 'ClashMeta',
        format: 'yaml',
        kind: 'config',
        aliases: ['mihomo', 'meta', 'clashmeta', 'clash.meta', 'clash-meta'],
        subconverter: ['mihomo', 'meta', 'clashmeta', 'clash.meta'],
        description: 'Mihomo (原 Clash.Meta) 完整配置, 协议支持最全',
    },
    {
        id: 'clash',
        label: 'Clash / Clash Premium',
        kernel: 'Clash',
        format: 'yaml',
        kind: 'config',
        aliases: ['clash', 'clashpremium', 'clash-premium'],
        subconverter: ['clashr', 'clash-premium'],
        description: 'Clash Premium 语义 (vless/hysteria 等新协议会被过滤)',
    },
    {
        id: 'stash',
        label: 'Stash',
        kernel: 'Stash',
        format: 'yaml',
        kind: 'config',
        aliases: ['stash'],
        subconverter: ['stash'],
        description: 'Stash 配置',
    },
    {
        id: 'surge',
        label: 'Surge',
        kernel: 'Surge',
        format: 'text',
        kind: 'config',
        aliases: ['surge', 'surge4', 'surge5'],
        subconverter: ['surge'],
        description: 'Surge 代理列表 (Proxy 段)',
    },
    {
        id: 'surgemac',
        label: 'Surge Mac',
        kernel: 'SurgeMac',
        format: 'text',
        kind: 'config',
        aliases: ['surgemac', 'surge-mac'],
        subconverter: [],
        description: 'Surge Mac (支持 external 代理程序)',
    },
    {
        id: 'qx',
        label: 'Quantumult X',
        kernel: 'qx',
        format: 'text',
        kind: 'config',
        aliases: ['qx', 'quanx', 'quantumultx', 'quantumult-x'],
        subconverter: ['quan', 'quanx', 'quantumult', 'quantumultx'],
        description: 'Quantumult X 服务/server_local 段',
    },
    {
        id: 'loon',
        label: 'Loon',
        kernel: 'Loon',
        format: 'text',
        kind: 'config',
        aliases: ['loon'],
        subconverter: ['loon'],
        description: 'Loon 节点行',
    },
    {
        id: 'singbox',
        label: 'sing-box',
        kernel: 'singbox',
        format: 'json',
        kind: 'config',
        aliases: ['singbox', 'sing-box'],
        subconverter: ['singbox', 'sing-box'],
        description: 'sing-box outbounds 数组 (经 mihomo 中转生成)',
    },
    {
        id: 'surfboard',
        label: 'Surfboard',
        kernel: 'surfboard',
        format: 'text',
        kind: 'config',
        aliases: ['surfboard'],
        subconverter: ['surfboard'],
        description: 'Surfboard 节点行',
    },
    {
        id: 'shadowrocket',
        label: 'Shadowrocket',
        kernel: 'shadowrocket',
        format: 'text',
        kind: 'config',
        aliases: ['shadowrocket', 'shadow-rocket', 'sr'],
        subconverter: ['shadowrocket'],
        description: 'Shadowrocket 节点行',
    },
    {
        id: 'egern',
        label: 'Egern',
        kernel: 'egern',
        format: 'yaml',
        kind: 'config',
        aliases: ['egern'],
        subconverter: ['egern'],
        description: 'Egern 配置',
    },
    {
        id: 'uri',
        label: '分享链接 (明文)',
        kernel: 'uri',
        format: 'text',
        kind: 'share-link',
        aliases: ['uri', 'links', 'link', 'mixed', 'plain'],
        subconverter: ['mixed'],
        description: '每行一个分享链接 (ss:// vmess:// trojan:// ...)',
    },
    {
        id: 'base64',
        label: '分享链接 (Base64 订阅)',
        kernel: 'v2ray',
        format: 'base64',
        kind: 'share-link',
        aliases: ['base64', 'v2ray', 'v2rayn', 'v2rayng', 'sub'],
        subconverter: ['sub', 'v2ray', 'v2rayn', 'v2rayng'],
        description: 'Base64 编码的分享链接订阅 (通用订阅)',
    },
    {
        id: 'ss',
        label: 'SS 订阅',
        kernel: 'uri',
        format: 'base64',
        kind: 'share-link',
        aliases: ['ss', 'shadowsocks'],
        subconverter: ['ss'],
        description: '仅 shadowsocks 节点的 Base64 订阅',
    },
    {
        id: 'ssr',
        label: 'SS/SSR 订阅',
        kernel: 'uri',
        format: 'base64',
        kind: 'share-link',
        aliases: ['ssr'],
        subconverter: ['ssr'],
        description: 'shadowsocks + shadowsocksr 节点的 Base64 订阅',
    },
    {
        id: 'ssd',
        label: 'SSD 订阅',
        kernel: 'uri',
        format: 'base64',
        kind: 'share-link',
        aliases: ['ssd'],
        subconverter: ['ssd'],
        description: 'SSD (shadowsocks 订阅) 格式, 仅支持 ss 节点',
    },
    {
        id: 'page',
        label: '订阅页 (HTML)',
        kernel: 'uri',
        format: 'html',
        kind: 'page',
        aliases: ['page', 'html', 'subhub-page'],
        subconverter: ['page', 'html'],
        description: '自托管订阅主页: 节点列表 + 各客户端订阅链接',
    },
    {
        id: 'json',
        label: '内部 JSON',
        kernel: 'json',
        format: 'json',
        kind: 'internal',
        aliases: ['json', 'internal'],
        subconverter: ['json'],
        description: 'Sub-Store 标准化节点数组, 便于二次处理',
    },
];

export const FORMAT_CONTENT_TYPE = {
    yaml: 'text/yaml;charset=utf-8',
    json: 'application/json;charset=utf-8',
    text: 'text/plain;charset=utf-8',
    base64: 'text/plain;charset=utf-8',
    html: 'text/html;charset=utf-8',
};

// 订阅页里推荐的客户端链接
const PAGE_CLIENT_TARGETS = [
    ['mihomo', 'Mihomo / Clash.Meta'],
    ['singbox', 'sing-box'],
    ['surge', 'Surge'],
    ['qx', 'Quantumult X'],
    ['loon', 'Loon'],
    ['stash', 'Stash'],
    ['base64', '通用订阅 (Base64)'],
    ['uri', '分享链接 (明文)'],
];

export function pageClientTargets() {
    return PAGE_CLIENT_TARGETS.map(([id, label]) => ({ id, label }));
}

const SHARE_LINK_TYPE_FILTER = {
    ss: ['ss'],
    ssr: ['ss', 'ssr'],
};

function normalize(name) {
    return `${name}`.trim().toLowerCase();
}

export function findByAlias(name) {
    const key = normalize(name);
    if (!key) return undefined;

    return TARGETS.find(
        (target) =>
            target.id === key ||
            target.aliases.includes(key) ||
            normalize(target.kernel) === key,
    );
}

export function listTargets() {
    return TARGETS.map((target) => ({
        id: target.id,
        label: target.label,
        format: target.format,
        kind: target.kind,
        aliases: target.aliases,
        subconverter: target.subconverter,
        description: target.description,
    }));
}

/**
 * 解析用户传入的 target (统一 id / 别名 / subconverter 名称)
 * 返回目标定义对象, 未匹配返回 undefined
 */
export function resolveTarget(name) {
    const key = normalize(name);
    if (!key) return undefined;

    const direct = findByAlias(key);
    if (direct) return direct;

    // 兼容 subconverter 命名
    const config = getConfig();
    if (['clash', 'clashr'].includes(key)) {
        return config.clashIsMihomo
            ? findByAlias('mihomo')
            : findByAlias('clash');
    }
    if (['mellow'].includes(key)) {
        // mellow 为 mihomo 系配置, 用 mihomo 生成
        return findByAlias('mihomo');
    }

    const matched = TARGETS.find((target) =>
        target.subconverter.includes(key),
    );
    return matched;
}

export function targetSummary() {
    return TARGETS.map((target) => `${target.id} (${target.label})`).join(', ');
}

export function shareLinkTypes(targetId) {
    return SHARE_LINK_TYPE_FILTER[targetId];
}
