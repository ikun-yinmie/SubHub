/**
 * SubHub 合并层配置
 *
 * 配置来源优先级: 内置默认值 < config/subhub.json < 环境变量
 */
import $ from '@/core/app';
import getFs from '@/runtime/fs';
import getPath from '@/runtime/path';
import kernelPackage from '../../package.json';

const DEFAULT_CONFIG_PATH = 'config/subhub.json';

// 合并层自身版本 (与内核版本分开维护)
export const SUBHUB_VERSION =
    kernelPackage.subhubVersion ?? kernelPackage.version;
// 内核 (Sub-Store) 版本
export const KERNEL_VERSION = kernelPackage.version;

export const DEFAULT_CONFIG = {
    version: 1,
    // 名称: 合并后的项目标识, 会出现在 /version 与订阅文件名中
    name: 'SubHub',
    // target=clash 在兼容层中的默认语义: true => 按 Mihomo 生成(协议更全)
    clashIsMihomo: true,
    defaultTarget: 'mihomo',
    engines: {
        subconverter: {
            label: 'subconverter (C++ 原版)',
            url: 'http://127.0.0.1:25500',
            enabled: false,
        },
        subconverterExtended: {
            label: 'SubConverter-Extended (C++ 增强)',
            url: 'http://127.0.0.1:25501',
            enabled: false,
        },
        sublinkx: {
            label: 'sublinkX (Go)',
            url: 'http://127.0.0.1:8000',
            enabled: false,
        },
    },
    nodeInfo: {
        // 兼容 ip-api.com 的响应格式
        provider: 'http://ip-api.com/json',
        lang: 'zh-CN',
        timeout: 8000,
        cacheTTL: 6 * 60 * 60 * 1000,
    },
    paths: {
        templates: 'config/templates',
        rulesets: 'config/rulesets',
        snippets: 'config/snippets',
    },
};

let cache = null;

function env(key) {
    if (!$.env.isNode) return undefined;

    try {
        return eval('process.env')[key];
    } catch (e) {
        return undefined;
    }
}

export function getProjectRoot() {
    return env('SUBHUB_HOME') || (eval('process.cwd()') ?? '.');
}

export function resolveProjectPath(target) {
    const path = getPath();
    if (!path) return target;
    if (path.isAbsolute(target)) return target;
    return path.resolve(getProjectRoot(), target);
}

function configFilePath() {
    return env('SUBHUB_CONFIG') || DEFAULT_CONFIG_PATH;
}

function readConfigFile() {
    const fs = getFs();
    if (!fs) return {};

    const file = resolveProjectPath(configFilePath());

    try {
        if (!fs.existsSync(file)) return {};
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
        $.error(`[SUBHUB] 读取配置文件失败: ${file}\nReason: ${e.message ?? e}`);
        return {};
    }
}

function mergeConfig(file = {}) {
    return {
        ...DEFAULT_CONFIG,
        ...file,
        engines: {
            ...DEFAULT_CONFIG.engines,
            ...(file.engines || {}),
        },
        nodeInfo: { ...DEFAULT_CONFIG.nodeInfo, ...(file.nodeInfo || {}) },
        paths: { ...DEFAULT_CONFIG.paths, ...(file.paths || {}) },
    };
}

function applyEnvOverrides(config) {
    const defaultTarget = env('SUBHUB_DEFAULT_TARGET');
    if (defaultTarget) config.defaultTarget = defaultTarget;

    // 对外访问地址。放环境变量 (.env 已被 gitignore) 而不是写进 config/subhub.json，
    // 是为了让私人域名/反代地址不必跟着仓库公开；启动脚本也用同一个值填 CORS 白名单。
    const publicBaseUrl = env('SUBHUB_PUBLIC_URL');
    if (typeof publicBaseUrl === 'string' && publicBaseUrl.trim().length > 0) {
        config.publicBaseUrl = publicBaseUrl.trim().replace(/\/+$/, '');
    }

    const clashIsMihomo = env('SUBHUB_CLASH_IS_MIHOMO');
    if (typeof clashIsMihomo === 'string' && clashIsMihomo.length > 0) {
        config.clashIsMihomo = !['false', '0', 'off'].includes(
            clashIsMihomo.toLowerCase(),
        );
    }

    const engines = [
        ['subconverter', 'SUBHUB_SUBCONVERTER_URL'],
        ['subconverterExtended', 'SUBHUB_SUBCONVERTER_EXTENDED_URL'],
        ['sublinkx', 'SUBHUB_SUBLINKX_URL'],
    ];
    for (const [name, key] of engines) {
        const url = env(key);
        if (url) {
            config.engines[name] = {
                ...config.engines[name],
                url: url.replace(/\/+$/, ''),
                enabled: true,
            };
        }
    }

    return config;
}

export function getConfig() {
    if (cache) return cache;
    cache = applyEnvOverrides(mergeConfig(readConfigFile()));
    return cache;
}

export function reloadConfig() {
    cache = null;
    return getConfig();
}

/**
 * 写入 config/subhub.json (只覆盖传入的字段)
 */
export function saveConfig(patch) {
    const fs = getFs();
    const current = getConfig();
    const next = mergeConfig({ ...current, ...patch });
    const file = resolveProjectPath(configFilePath());

    if (fs) {
        try {
            fs.writeFileSync(file, `${JSON.stringify(next, null, 4)}\n`);
        } catch (e) {
            $.error(`[SUBHUB] 写入配置文件失败: ${file}`);
        }
    }

    reloadConfig();
    return next;
}

export function getPathConfig() {
    const { paths } = getConfig();
    return {
        templates: resolveProjectPath(paths.templates),
        rulesets: resolveProjectPath(paths.rulesets),
        snippets: resolveProjectPath(paths.snippets),
    };
}
