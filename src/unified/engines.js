/**
 * 外部引擎桥
 *
 * 合并后的内核 (JS) 已覆盖绝大多数转换场景; subconverter / SubConverter-Extended /
 * sublinkX 作为**可选**引擎保留:
 * - 作为"参照实现"验证内核输出
 * - 内核暂不支持的子集 (如 subconverter 的 external config / 特殊 target) 时委托
 */
import $ from '@/core/app';
import { HTTP } from '@/vendor/open-api';
import { getConfig } from './config';
import { makeError } from './convert';

export const ENGINE_CAPABILITIES = {
    subconverter: {
        protocol: 'http',
        probePath: '/version',
        targets: [
            'clash',
            'clashr',
            'stash',
            'surge',
            'surfboard',
            'loon',
            'quan',
            'quanx',
            'mellow',
            'singbox',
            'mixed',
            'v2ray',
            'v2rayn',
            'v2rayng',
            'ss',
            'ssr',
            'ssd',
        ],
        notes: '支持 external config / insert / 完整规则生成, 不支持 XHTTP 等新协议',
    },
    subconverterExtended: {
        protocol: 'http',
        probePath: '/version',
        targets: [
            'clash',
            'clashr',
            'stash',
            'surge',
            'surfboard',
            'loon',
            'quan',
            'quanx',
            'mellow',
            'singbox',
            'mixed',
            'v2ray',
            'v2rayn',
            'v2rayng',
            'trojan',
            'vless',
            'hysteria2',
            'ss',
            'ssr',
            'ssd',
        ],
        notes: '增强分支: 分享链接输出更全 (hysteria2/vless/trojan), Mihomo Provider 支持',
    },
    sublinkx: {
        protocol: 'http',
        probePath: '/',
        targets: ['v2ray', 'clash', 'surge'],
        notes: 'Go 实现, 带管理面板与 SQLite 存储; 转换走其 /api/v1 需登录, 这里只做探活',
    },
};

export function listEngines() {
    const { engines } = getConfig();

    return Object.entries(engines).map(([id, engine]) => ({
        id,
        label: engine.label,
        url: engine.url,
        enabled: engine.enabled !== false,
        ...(ENGINE_CAPABILITIES[id] ?? {}),
    }));
}

async function probeOne(id, engine) {
    const capability = ENGINE_CAPABILITIES[id] ?? {};
    const timeout = 5000;
    const startedAt = Date.now();
    const $http = HTTP();

    try {
        const response = await $http.get({
            url: `${engine.url}${capability.probePath ?? '/'}`,
            timeout,
        });
        const body = `${response.body ?? ''}`.trim();
        return {
            id,
            label: engine.label,
            url: engine.url,
            enabled: engine.enabled !== false,
            online: response.status >= 200 && response.status < 400,
            latency: Date.now() - startedAt,
            version: body.slice(0, 200),
        };
    } catch (e) {
        return {
            id,
            label: engine.label,
            url: engine.url,
            enabled: engine.enabled !== false,
            online: false,
            latency: null,
            error: `${e.message ?? e}`,
        };
    }
}

export async function probeEngines({ only } = {}) {
    const { engines } = getConfig();
    const entries = Object.entries(engines).filter(
        ([id, engine]) => engine.enabled !== false && (!only || only === id),
    );

    const results = await Promise.all(
        entries.map(([id, engine]) => probeOne(id, engine)),
    );

    return { engines: results };
}

/**
 * 统一 target -> 各引擎的 target 参数
 */
export function engineTarget(engineId, targetId) {
    const maps = {
        subconverter: {
            mihomo: 'clash',
            clash: 'clashr',
            stash: 'stash',
            surge: 'surge',
            qx: 'quanx',
            loon: 'loon',
            singbox: 'singbox',
            surfboard: 'surfboard',
            uri: 'mixed',
            base64: 'v2ray',
            ss: 'ss',
            ssr: 'ssr',
            ssd: 'ssd',
        },
        sublinkx: {
            mihomo: 'clash',
            clash: 'clash',
            surge: 'surge',
            uri: 'v2ray',
            base64: 'v2ray',
        },
    };

    const map = maps[engineId] ?? maps.subconverter;
    return map[targetId];
}

function buildQuery(params) {
    return Object.entries(params)
        .filter(([, value]) => value != null && `${value}`.length > 0)
        .map(
            ([key, value]) =>
                `${encodeURIComponent(key)}=${encodeURIComponent(`${value}`)}`,
        )
        .join('&');
}

/**
 * 委托给 subconverter 系引擎 (HTTP /sub)
 */
export async function delegateConvert(payload = {}) {
    const engineId = payload.engine ?? 'subconverter';
    const { engines } = getConfig();
    const engine = engines[engineId];
    if (!engine) throw makeError('ENGINE_NOT_FOUND', `未配置引擎: ${engineId}`);

    const target = payload.target ?? 'mihomo';
    const engineTargetName = engineTarget(engineId, target);
    if (!engineTargetName) {
        throw makeError(
            'ENGINE_TARGET_UNSUPPORTED',
            `${engineId} 不支持目标平台: ${target}`,
        );
    }

    const query = buildQuery({
        target: engineTargetName,
        url: payload.url,
        list: payload.list,
        include: payload.include,
        exclude: payload.exclude,
        rename: payload.rename,
        emoji: payload.emoji,
        interval: payload.interval,
        config: payload.config,
    });

    const $http = HTTP();
    const startedAt = Date.now();

    try {
        const response = await $http.get({
            url: `${engine.url}/sub?${query}`,
            timeout: Number(payload.timeout) || 30000,
        });
        return {
            engine: engineId,
            engineUrl: engine.url,
            target,
            engineTarget: engineTargetName,
            latency: Date.now() - startedAt,
            content: response.body ?? '',
        };
    } catch (e) {
        throw makeError(
            'ENGINE_REQUEST_FAILED',
            `请求引擎失败: ${engineId}`,
            `${e.message ?? e}`,
        );
    }
}

export function logEngineUsage(engineId, target) {
    $.info(`[SUBHUB] 委托引擎 ${engineId} 生成 ${target}`);
}
