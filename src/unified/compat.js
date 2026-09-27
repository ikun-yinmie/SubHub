/**
 * subconverter 兼容层
 *
 * 目标: 让 sub-web 以及任何 subconverter 客户端/脚本直接指向合并后的内核。
 * - GET  /sub?target=...&url=...&list=...   与 subconverter 相同的响应形态
 * - GET  /version                          版本信息 (sub-web 用于展示)
 * - POST /upload  + GET /c/:id             自托管外部配置 (替代第三方 oss)
 * - POST /short   + GET /s/:id             自托管短链接 (替代第三方短链服务)
 *
 * `config` 参数在本实现中表示「模板」: 可以是 config/templates 下的模板名,
 * 也可以是 http(s) 地址; 模板含 {{token}} 时按模板渲染, 否则按 insert 语义
 * 把节点注入到配置中 (等价 subconverter 的 insert=true)。
 */
import $ from '@/core/app';
import { Base64 } from 'js-base64';
import download from '@/utils/download';
import { KERNEL_VERSION, SUBHUB_VERSION, getConfig } from './config';
import { convert, makeError, resolveProcessed } from './convert';
import { FORMAT_CONTENT_TYPE, resolveTarget } from './targets';
import {
    buildRenderContext,
    injectProxies,
    readTemplate,
    renderTemplate,
} from './templates';
import { KEYS, nowISO, readJSON, shortId, writeJSON } from './store';

const TEXT_TARGET_EXTENSION = {
    qx: 'conf',
    surge: 'conf',
    loon: 'conf',
    surfboard: 'conf',
};

function isTrue(value) {
    if (value == null) return false;
    return ['true', '1', 'yes', 'on'].includes(`${value}`.toLowerCase());
}

function decodeBase64Query(raw) {
    if (!raw) return undefined;
    if (!/^[A-Za-z0-9+/=_-]+$/.test(raw)) return undefined;
    try {
        const decoded = Base64.decode(decodeURIComponent(raw));
        return `${decoded}`.includes('=') ? decoded : undefined;
    } catch (e) {
        return undefined;
    }
}

/**
 * 归一化查询参数, 支持 subconverter 的 "整段 base64 查询串" 写法
 */
export function normalizeParams(req = {}) {
    const params = {};

    for (const [key, value] of Object.entries(req.query ?? {})) {
        params[key] = Array.isArray(value) ? value.join('|') : value;
    }

    const hasTarget = ['target', 'client'].some(
        (key) => `${params[key] ?? ''}`.length > 0,
    );

    if (!hasTarget) {
        const raw = `${req.url ?? ''}`.split('?')[1];
        const decoded = decodeBase64Query(raw);
        if (decoded) {
            for (const [key, value] of new URLSearchParams(decoded).entries()) {
                params[key] = value;
            }
            params._decoded = true;
        }
    }

    return params;
}

function buildConvertPayload(params) {
    return {
        target: params.target ?? params.client,
        url: params.url,
        data: params.data ?? params.content,
        list: isTrue(params.list),
        include: params.include,
        exclude: params.exclude,
        include_remarks: params.include_remarks,
        exclude_remarks: params.exclude_remarks,
        rename: params.rename,
        emoji: isTrue(params.emoji) || isTrue(params.add_emoji),
        remove_emoji: isTrue(params.remove_emoji),
        prepend: params.prepend,
        append: params.append,
        sort: params.sort,
        dedupe: params.dedupe ?? true,
        types: params.types ?? params.node_type,
        exclude_types: params.exclude_types,
        includeUnsupportedProxy: isTrue(params.include_unsupported),
        name: params.new_name ?? params.filename,
    };
}

/**
 * 生成订阅页时需要透传的查询参数 (用于拼接各客户端订阅链接)
 */
function buildShareParams(params = {}) {
    const keep = [
        'url',
        'include',
        'exclude',
        'include_remarks',
        'exclude_remarks',
        'rename',
        'emoji',
        'add_emoji',
        'remove_emoji',
        'prepend',
        'append',
        'sort',
        'config',
    ];

    const result = {};
    for (const key of keep) {
        const value = params[key];
        if (value != null && `${value}`.length > 0) result[key] = value;
    }
    return result;
}

function extensionFor(target, format) {
    if (format === 'yaml') return 'yaml';
    if (format === 'json') return 'json';
    if (TEXT_TARGET_EXTENSION[target?.id]) return TEXT_TARGET_EXTENSION[target.id];
    return 'txt';
}

function contentDisposition(filename) {
    const safe = encodeURIComponent(`${filename}`.replace(/["\r\n]/g, ''));
    return `attachment; filename="${safe}"; filename*=UTF-8''${safe}`;
}

async function resolveConfig(config) {
    if (/^https?:\/\//i.test(config)) {
        try {
            const content = await download(config);
            return { name: config, content };
        } catch (e) {
            throw makeError('CONFIG_FETCH_FAILED', `拉取外部配置失败: ${config}`);
        }
    }

    const template = readTemplate(config);
    if (!template) {
        throw makeError('TEMPLATE_NOT_FOUND', `模板不存在: ${config}`);
    }
    return template;
}

export async function handleSub(req, res) {
    const params = normalizeParams(req);
    const payload = buildConvertPayload(params);
    // 订阅页 / 短链需要知道外部访问地址与原始订阅参数
    payload.baseUrl = baseUrlOf(req);
    payload.shareParams = buildShareParams(params);

    if (isTrue(params.insert) && !params.config) {
        throw makeError('INVALID_PARAM', 'insert=true 需要同时提供 config');
    }

    const target = resolveTarget(
        payload.target ?? getConfig().defaultTarget,
    );
    if (!target) {
        throw makeError(
            'UNSUPPORTED_TARGET',
            `不支持的目标平台: ${payload.target ?? ''}`,
        );
    }

    let content;
    let format = target.format;
    let count = 0;
    let template;

    if (params.config) {
        const external = await resolveConfig(params.config);
        const { proxies } = await resolveProcessed({
            ...payload,
            target: target.id,
            list: false,
        });
        count = proxies.length;

        if (external.content.includes('{{') && !isTrue(params.insert)) {
            const { context } = buildRenderContext({
                proxies,
                target,
                options: { name: payload.name },
                meta: { name: payload.name },
            });
            content = renderTemplate(external.content, context);
        } else {
            content = injectProxies(external.content, target, proxies);
        }
        format = target.format;
        template = external.name;
    } else {
        const result = await convert(payload);
        content = result.content;
        format = result.format;
        count = result.count;
    }

    if (params.interval && format !== 'yaml') {
        const managedUrl = params.new_name ?? params.filename ?? '';
        content = `#!MANAGED-CONFIG ${managedUrl} interval=${params.interval}\n${content}`;
    }

    res.status(200).set(
        'Content-Type',
        FORMAT_CONTENT_TYPE[format] ?? 'text/plain;charset=utf-8',
    );

    const filename = params.filename ?? params.new_name;
    if (filename) {
        const withExt = `${filename}`.includes('.')
            ? filename
            : `${filename}.${extensionFor(target, format)}`;
        res.set('Content-Disposition', contentDisposition(withExt));
    }
    if (params['profile-web-page-url']) {
        res.set('profile-web-page-url', params['profile-web-page-url']);
    }
    if (params.interval) {
        res.set('profile-update-interval', String(params.interval));
    }

    $.info(
        `[SUBHUB] /sub target=${target.id} count=${count} list=${isTrue(
            params.list,
        )}${template ? ` template=${template}` : ''}`,
    );

    res.send(content);
}

export function handleVersion(req, res) {
    const config = getConfig();
    res.status(200).set('Content-Type', 'text/plain;charset=utf-8');
    res.send(
        `${config.name} v${SUBHUB_VERSION} backend\nkernel: Sub-Store v${KERNEL_VERSION}`,
    );
}

/*****************************
 * 自托管的上传 / 短链服务
 *****************************/

function baseUrlOf(req) {
    const config = getConfig();
    if (config.publicBaseUrl) return config.publicBaseUrl.replace(/\/+$/, '');

    const forwardedProto = req.headers?.['x-forwarded-proto'];
    const protocol = forwardedProto ?? req.protocol ?? 'http';
    const host = req.headers?.host ?? '127.0.0.1';
    return `${protocol}://${host}`;
}

export function handleConfigUpload(req, res) {
    const content = req.body?.content;
    if (typeof content !== 'string' || content.length === 0) {
        throw makeError('NO_CONTENT', 'content 不能为空');
    }

    const pastes = readJSON(KEYS.pastes, {});
    const id = shortId('cfg').replace(/^cfg_/, '');
    pastes[id] = { content, createdAt: nowISO(), length: content.length };

    const keys = Object.keys(pastes);
    if (keys.length > 200) {
        keys.sort((a, b) => pastes[a].createdAt.localeCompare(pastes[b].createdAt))
            .slice(0, keys.length - 200)
            .forEach((key) => delete pastes[key]);
    }
    writeJSON(KEYS.pastes, pastes);

    res.status(200).json({
        code: 0,
        msg: 'ok',
        data: { url: `${baseUrlOf(req)}/api/c/${id}`, id },
    });
}

export function handlePaste(req, res) {
    const pastes = readJSON(KEYS.pastes, {});
    const entry = pastes[req.params?.id];
    if (!entry) {
        res.status(404).send('not found');
        return;
    }
    res.status(200).set('Content-Type', 'text/plain;charset=utf-8').send(
        entry.content,
    );
}

export function handleShortUrl(req, res) {
    let longUrl = req.body?.longUrl ?? req.body?.url ?? req.query?.longUrl;
    if (typeof longUrl !== 'string' || longUrl.length === 0) {
        throw makeError('NO_URL', 'longUrl 不能为空');
    }

    try {
        const decoded = Base64.decode(longUrl);
        if (/^https?:\/\//i.test(decoded)) longUrl = decoded;
    } catch (e) {
        // 不是 base64 就按原样处理
    }

    if (!/^https?:\/\//i.test(longUrl) && !longUrl.startsWith('/')) {
        throw makeError('INVALID_URL', '只支持 http(s) 链接');
    }

    const shorts = readJSON(KEYS.shorts, {});
    const existing = Object.entries(shorts).find(
        ([, value]) => value.url === longUrl,
    );
    const id =
        existing?.[0] ?? shortId('s').replace(/^s_/, '').slice(0, 8);
    shorts[id] = {
        url: longUrl,
        createdAt: existing?.[1]?.createdAt ?? nowISO(),
    };
    writeJSON(KEYS.shorts, shorts);

    res.status(200).json({
        Code: 1,
        ShortUrl: `${baseUrlOf(req)}/api/s/${id}`,
        Message: 'ok',
    });
}

export function handleShortRedirect(req, res) {
    const shorts = readJSON(KEYS.shorts, {});
    const entry = shorts[req.params?.id];
    if (!entry) {
        res.status(404).send('not found');
        return;
    }
    res.redirect(entry.url);
}
