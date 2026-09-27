/**
 * 节点处理管线
 *
 * 把 subconverter 常用的节点清洗能力 (include/exclude/rename/emoji/sort/...)
 * 与合并层自有的去重、类型过滤统一到一条管线里。
 */
import $ from '@/core/app';
import {
    addEmoji,
    applyRename,
    hasEmoji,
    loadEmojiRules,
    resolveRenameRules,
    stripEmoji,
    toJsRegex,
} from './snippets';

function asList(value) {
    if (value == null) return [];
    if (Array.isArray(value)) return value.filter((item) => `${item}`.trim());
    return `${value}`
        .split(/[,\n]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
}

function asBool(value, fallback = false) {
    if (value == null) return fallback;
    if (typeof value === 'boolean') return value;
    return ['true', '1', 'yes', 'on'].includes(`${value}`.toLowerCase());
}

function matchesAny(name, patterns) {
    return patterns.some((pattern) => pattern && pattern.test(name));
}

function compileFilters(specs) {
    return asList(specs)
        .map((spec) => toJsRegex(spec))
        .filter(Boolean);
}

export function nodeIdentity(proxy) {
    return [
        proxy.type,
        proxy.server,
        proxy.port,
        proxy.uuid ?? '',
        proxy.password ?? '',
        proxy['private-key'] ?? '',
        proxy.psk ?? '',
        proxy.name,
    ].join('|');
}

export function dedupeProxies(proxies) {
    const seen = new Set();
    const result = [];
    let removed = 0;

    for (const proxy of proxies) {
        const key = nodeIdentity(proxy);
        if (seen.has(key)) {
            removed += 1;
            continue;
        }
        seen.add(key);
        result.push(proxy);
    }

    return { proxies: result, removed };
}

export function renameProxies(proxies, options = {}) {
    const renameRules = resolveRenameRules(options.rename);
    const emojiRules = asBool(options.emoji ?? options.add_emoji)
        ? loadEmojiRules()
        : [];
    const removeEmoji = asBool(options.remove_emoji);
    const prepend = options.prepend ?? options.name_prefix ?? '';
    const append = options.append ?? options.name_suffix ?? '';
    const useUniqueNames = asBool(options.unique_names, true);

    const names = new Set();
    let renamed = 0;

    for (const proxy of proxies) {
        let name = `${proxy.name ?? ''}`.trim();

        if (removeEmoji) name = stripEmoji(name);
        if (renameRules.length > 0) {
            const renamedName = applyRename(name, renameRules);
            if (renamedName !== name) renamed += 1;
            name = renamedName;
        }
        if (emojiRules.length > 0) name = addEmoji(name, emojiRules);

        if (prepend) name = `${prepend}${name}`;
        if (append) name = `${name}${append}`;

        if (useUniqueNames && names.has(name)) {
            let index = 2;
            const base = name;
            while (names.has(name)) {
                name = `${base} ${index}`;
                index += 1;
            }
        }

        names.add(name);
        proxy.name = name;
    }

    return { renamed };
}

export function filterProxies(proxies, options = {}) {
    const include = compileFilters(options.include);
    const exclude = compileFilters(options.exclude);
    const includeRemarks = compileFilters(
        options.include_remarks ?? options['include-remarks'],
    );
    const excludeRemarks = compileFilters(
        options.exclude_remarks ?? options['exclude-remarks'],
    );
    const types = new Set(asList(options.types ?? options.type).map((t) => t.toLowerCase()));
    const excludeTypes = new Set(
        asList(options.exclude_types ?? options['exclude-types']).map((t) =>
            t.toLowerCase(),
        ),
    );
    const keepRemoved = asBool(options.keep_removed, false);

    const kept = [];
    const removed = [];

    for (const proxy of proxies) {
        const name = `${proxy.name ?? ''}`;
        const type = `${proxy.type ?? ''}`.toLowerCase();
        let ok = true;

        if (include.length > 0 && !matchesAny(name, include)) ok = false;
        if (ok && exclude.length > 0 && matchesAny(name, exclude)) ok = false;
        if (ok && includeRemarks.length > 0 && !matchesAny(name, includeRemarks))
            ok = false;
        if (ok && excludeRemarks.length > 0 && matchesAny(name, excludeRemarks))
            ok = false;
        if (ok && types.size > 0 && !types.has(type)) ok = false;
        if (ok && excludeTypes.size > 0 && excludeTypes.has(type)) ok = false;

        if (ok) kept.push(proxy);
        else removed.push(proxy);
    }

    if (keepRemoved && removed.length > 0) {
        for (const proxy of removed) {
            proxy.name = `${proxy.name} [已过滤]`;
            proxy['_removed'] = true;
            kept.push(proxy);
        }
    }

    return { proxies: kept, removed: removed.length };
}

export function sortProxies(proxies, mode) {
    if (!mode) return proxies;

    const key = `${mode}`.toLowerCase();
    const list = [...proxies];
    const compareName = (a, b) =>
        `${a.name}`.localeCompare(`${b.name}`, 'zh-Hans-CN', {
            numeric: true,
        });

    if (['true', '1', 'name', 'yes', 'on'].includes(key)) {
        list.sort(compareName);
    } else if (key === 'server' || key === 'host') {
        list.sort((a, b) => `${a.server}`.localeCompare(`${b.server}`));
    } else if (key === 'port') {
        list.sort((a, b) => Number(a.port ?? 0) - Number(b.port ?? 0));
    } else if (key === 'type') {
        list.sort((a, b) => `${a.type}`.localeCompare(`${b.type}`));
    } else if (key === 'none' || key === 'false' || key === '0') {
        // 保持原顺序
    } else {
        list.sort(compareName);
    }

    return list;
}

/**
 * 名称去重/统计用
 */
export function summarize(proxies) {
    const byType = {};
    for (const proxy of proxies) {
        byType[proxy.type] = (byType[proxy.type] ?? 0) + 1;
    }

    const regions = {};
    for (const proxy of proxies) {
        const flag = `${proxy.name ?? ''}`.match(
            /[\u{1F1E6}-\u{1F1FF}]{2}/u,
        );
        const key = flag ? flag[0] : '未标注';
        regions[key] = (regions[key] ?? 0) + 1;
    }

    return {
        total: proxies.length,
        byType,
        byFlag: regions,
        emojiNamed: proxies.filter((proxy) => hasEmoji(proxy.name)).length,
    };
}

function runStage(name, fn, stats) {
    const startedAt = Date.now();
    const result = fn();
    stats.stages.push({
        name,
        cost: Date.now() - startedAt,
        ...result.meta,
    });
    return result.proxies;
}

/**
 * 依次执行: 过滤 -> 重命名/emoji -> 去重 -> 排序
 */
export function runPipeline(proxies, options = {}) {
    const stats = { input: proxies.length, stages: [], byType: {}, duration: 0 };
    const startedAt = Date.now();

    let list = runStage('filter', () => {
        const result = filterProxies(proxies, options);
        return {
            proxies: result.proxies,
            meta: { removed: result.removed },
        };
    }, stats);

    list = runStage('rename', () => {
        const result = renameProxies(list, options);
        return { proxies: list, meta: { renamed: result.renamed } };
    }, stats);

    if (options.sort) {
        list = runStage('sort', () => ({ proxies: sortProxies(list, options.sort), meta: {} }), stats);
    }

    if (asBool(options.dedupe, true)) {
        list = runStage('dedupe', () => {
            const result = dedupeProxies(list);
            return { proxies: result.proxies, meta: { removed: result.removed } };
        }, stats);
    }

    stats.output = list.length;
    stats.byType = summarize(list).byType;
    stats.duration = Date.now() - startedAt;

    $.info(
        `[SUBHUB] 管线完成: ${stats.input} -> ${stats.output} (${stats.duration}ms)`,
    );

    return { proxies: list, stats };
}
