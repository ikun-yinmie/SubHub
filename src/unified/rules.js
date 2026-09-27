/**
 * 规则与规则集 (吸收自 subconverter 的 base/rules)
 *
 * 内核已具备通用规则解析 (RuleUtils.parse) 与四种输出:
 * Surge / Loon / QX / Clash(rule-provider)
 * 这里补上规则集文件的浏览与读取, 以及 subconverter 风格的 target 命名映射。
 */
import $ from '@/core/app';
import getFs from '@/runtime/fs';
import getPath from '@/runtime/path';
import download from '@/utils/download';
import { RuleUtils } from '@/core/rule-utils';
import { getPathConfig } from './config';
import { makeError } from './convert';

export const RULE_TARGETS = [
    { id: 'Clash', label: 'Clash / Mihomo rule-provider', aliases: ['clash', 'mihomo', 'meta', 'clashmeta', 'stash', 'yaml'] },
    { id: 'Surge', label: 'Surge rule-set', aliases: ['surge', 'surge-list'] },
    { id: 'Loon', label: 'Loon rules', aliases: ['loon'] },
    { id: 'QX', label: 'Quantumult X filter', aliases: ['qx', 'quanx', 'quantumultx'] },
];

export function resolveRuleTarget(name) {
    const key = `${name ?? ''}`.trim().toLowerCase();
    if (!key) return 'Clash';

    const matched = RULE_TARGETS.find(
        (target) => target.id.toLowerCase() === key || target.aliases.includes(key),
    );
    return matched?.id ?? 'Clash';
}

export function listRuleTargets() {
    return RULE_TARGETS.map(({ id, label, aliases }) => ({ id, label, aliases }));
}

export function rulesetsDir() {
    return getPathConfig().rulesets;
}

/**
 * 递归列出规则集文件 (最多 4 层)
 */
export function listRulesets() {
    const fs = getFs();
    const path = getPath();
    if (!fs || !path) return [];

    const root = rulesetsDir();
    const result = [];

    const walk = (dir, depth) => {
        if (depth > 4) return;
        let entries = [];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (e) {
            return;
        }
        for (const entry of entries) {
            const file = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                walk(file, depth + 1);
            } else if (entry.isFile() && !entry.name.startsWith('.')) {
                result.push({
                    name: path.relative(root, file),
                    size: fs.statSync(file).size,
                });
            }
        }
    };

    walk(root, 0);
    return result.sort((a, b) => a.name.localeCompare(b.name));
}

export function readRuleset(name) {
    const fs = getFs();
    const path = getPath();

    const root = rulesetsDir();
    const target = path.resolve(root, name);
    if (!target.startsWith(path.resolve(root))) {
        throw makeError('INVALID_RULESET', `规则集路径越界: ${name}`);
    }
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
        throw makeError('RULESET_NOT_FOUND', `规则集不存在: ${name}`);
    }

    return { name, content: fs.readFileSync(target, 'utf8') };
}

async function resolveRulesInput(payload = {}) {
    const inline = payload.data ?? payload.content;
    if (typeof inline === 'string' && inline.trim().length > 0) return inline;

    if (payload.ruleset) {
        return readRuleset(payload.ruleset).content;
    }

    if (payload.url) {
        try {
            return await download(payload.url);
        } catch (e) {
            throw makeError('REMOTE_FETCH_FAILED', `拉取规则失败: ${payload.url}`);
        }
    }

    throw makeError('NO_INPUT', '缺少输入: 需要 data / ruleset / url 之一');
}

export async function convertRules(payload = {}) {
    const target = resolveRuleTarget(payload.target ?? payload.client);
    const raw = await resolveRulesInput(payload);
    const rules = RuleUtils.parse(raw);

    if (!Array.isArray(rules) || rules.length === 0) {
        throw makeError('NO_RULE', '未能解析出任何规则');
    }

    let rules_ = rules;
    if (payload.include) {
        const regex = new RegExp(`${payload.include}`);
        rules_ = rules_.filter((rule) => regex.test(`${rule.content}`));
    }
    if (payload.exclude) {
        const regex = new RegExp(`${payload.exclude}`);
        rules_ = rules_.filter((rule) => !regex.test(`${rule.content}`));
    }

    const content = RuleUtils.produce(rules_, target);

    return {
        target,
        count: rules_.length,
        total: rules.length,
        type: target === 'Clash' ? 'yaml' : 'text',
        content,
        byType: rules_.reduce((result, rule) => {
            result[rule.type] = (result[rule.type] ?? 0) + 1;
            return result;
        }, {}),
    };
}
