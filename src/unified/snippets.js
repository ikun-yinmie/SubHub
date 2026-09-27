/**
 * 片段 (snippet) 支持
 *
 * 吸收自 subconverter 的 base/snippets:
 * - emoji.txt:       `正则,emoji` 命中则把 emoji 前置到节点名
 * - rename_node.txt: `正则@替换` 对节点名做替换 (替换为空串即删除匹配)
 * - groups.txt 等:   保留原样, 供模板/人工参考
 *
 * 注意: 这些片段是 PCRE 语法, 这里做了到 JS 正则的适配 (主要是 (?i:...) 内联标志)。
 */
import $ from '@/core/app';
import getFs from '@/runtime/fs';
import getPath from '@/runtime/path';
import { getPathConfig } from './config';

const EMOJI_FILE = 'emoji.txt';
const RENAME_FILE = 'rename_node.txt';

const EMOJI_CHARS =
    '[\\u{1F1E6}-\\u{1F1FF}\\u{1F300}-\\u{1FAFF}\\u{2600}-\\u{27BF}\\u{FE0F}\\u{2B00}-\\u{2BFF}\\u{2190}-\\u{21FF}\\u{2B05}\\u{2B06}\\u{2B07}\\u{25AA}\\u{25AB}\\u{25B6}\\u{25C0}\\u{25FB}-\\u{25FE}]';
const EMOJI_PATTERN = new RegExp(EMOJI_CHARS, 'u');
const EMOJI_PATTERN_GLOBAL = new RegExp(EMOJI_CHARS, 'gu');

let emojiCache = null;
let renameCache = null;

function snippetsDir() {
    return getPathConfig().snippets;
}

function snippetPath(name) {
    const path = getPath();
    if (!path) return name;
    return path.join(snippetsDir(), name);
}

function relativeToCwd(path, file) {
    try {
        const cwd = eval('process.cwd()');
        return cwd ? path.relative(cwd, file) : file;
    } catch (e) {
        return file;
    }
}

function readSnippet(name) {
    const fs = getFs();
    if (!fs) return undefined;

    for (const candidate of [name, `${name}.txt`, `${name}.toml`]) {
        const file = snippetPath(candidate);
        try {
            if (fs.existsSync(file) && fs.statSync(file).isFile()) {
                return { file, content: fs.readFileSync(file, 'utf8') };
            }
        } catch (e) {
            // 忽略, 继续尝试
        }
    }
    return undefined;
}

export function listSnippets() {
    const fs = getFs();
    const path = getPath();
    if (!fs || !path) return [];

    const dir = snippetsDir();
    try {
        return fs
            .readdirSync(dir)
            .filter((name) => !name.startsWith('.'))
            .map((name) => {
                const file = path.join(dir, name);
                let size = 0;
                try {
                    size = fs.statSync(file).size;
                } catch (e) {
                    size = 0;
                }
                return {
                    name,
                    id: name.replace(/\.[^.]+$/, ''),
                    file: relativeToCwd(path, file),
                    size,
                };
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) {
        $.error(`[SUBHUB] 读取片段目录失败: ${dir}`);
        return [];
    }
}

/**
 * PCRE -> JS 正则适配
 */
export function toJsRegex(pattern) {
    if (!pattern) return undefined;

    let source = `${pattern}`.trim();
    let flags = '';

    if (source.includes('(?i:') || source.includes('(?i)')) {
        source = source.replace(/\(\?i:/g, '(?:').replace(/\(\?i\)/g, '');
        flags += 'i';
    }
    // JS 不支持在正则内部局部关闭大小写敏感, 这里近似处理
    source = source.replace(/\(\?-i:/g, '(?:');

    try {
        return new RegExp(source, flags);
    } catch (e) {
        try {
            // 退化为主串匹配, 避免整条片段失效
            return new RegExp(
                source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
                flags,
            );
        } catch (e2) {
            return undefined;
        }
    }
}

function isComment(line) {
    const trimmed = line.trim();
    return (
        trimmed.length === 0 ||
        trimmed.startsWith(';') ||
        trimmed.startsWith('#')
    );
}

export function loadEmojiRules(force = false) {
    if (emojiCache && !force) return emojiCache;

    const snippet = readSnippet(EMOJI_FILE);
    const rules = [];

    if (snippet) {
        for (const line of snippet.content.split('\n')) {
            if (isComment(line)) continue;
            const index = line.lastIndexOf(',');
            if (index === -1) continue;
            const pattern = line.slice(0, index).trim();
            const emoji = line.slice(index + 1).trim();
            const regex = toJsRegex(pattern);
            if (regex && emoji) rules.push({ pattern, emoji, regex });
        }
        $.info(`[SUBHUB] 载入 emoji 规则 ${rules.length} 条: ${snippet.file}`);
    }

    emojiCache = rules;
    return rules;
}

export function loadRenameRules(force = false) {
    if (renameCache && !force) return renameCache;

    const snippet = readSnippet(RENAME_FILE);
    const rules = [];
    if (snippet) {
        for (const line of snippet.content.split('\n')) {
            if (isComment(line)) continue;
            const parsed = parseRenameRule(line);
            if (parsed) rules.push(parsed);
        }
        $.info(`[SUBHUB] 载入重命名规则 ${rules.length} 条: ${snippet.file}`);
    }

    renameCache = rules;
    return rules;
}

/**
 * `正则@替换` -> { pattern, replacement, regex }
 */
export function parseRenameRule(spec) {
    if (!spec) return undefined;
    const index = spec.indexOf('@');
    if (index === -1) return undefined;

    const pattern = spec.slice(0, index).trim();
    const replacement = spec.slice(index + 1).trim();
    const regex = toJsRegex(pattern);
    if (!regex) return undefined;

    return { pattern, replacement, regex };
}

/**
 * 支持 `rename=旧@新,旧2@新2` 或 `rename=<片段文件名>`
 */
export function resolveRenameRules(spec) {
    if (!spec) return [];
    const trimmed = `${spec}`.trim();
    if (trimmed.length === 0) return [];

    if (!trimmed.includes('@')) {
        const snippet = readSnippet(trimmed);
        if (snippet) {
            return snippet.content
                .split('\n')
                .filter((line) => !isComment(line))
                .map((line) => parseRenameRule(line))
                .filter(Boolean);
        }
        return [];
    }

    return trimmed
        .split(',')
        .map((item) => parseRenameRule(item))
        .filter(Boolean);
}

export function stripEmoji(name) {
    return `${name}`
        .replace(EMOJI_PATTERN_GLOBAL, '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function hasEmoji(name) {
    return EMOJI_PATTERN.test(`${name}`);
}

/**
 * 命中第一条规则即前置 emoji (与 subconverter 行为一致)
 */
export function addEmoji(name, rules = loadEmojiRules()) {
    const value = `${name}`;
    for (const rule of rules) {
        if (rule.regex.test(value)) {
            if (value.includes(rule.emoji)) return value;
            return `${rule.emoji} ${value}`.trim();
        }
    }
    return value;
}

export function applyRename(name, rules = []) {
    let value = `${name}`;
    for (const rule of rules) {
        value = value.replace(rule.regex, rule.replacement);
    }
    return value.trim();
}
