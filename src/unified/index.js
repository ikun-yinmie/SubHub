/**
 * SubHub 统一层路由
 *
 * 全部路由同时挂在 /api/... (与内核前端合并模式兼容) 与根路径 (独立部署时更直观)。
 * - /api/v1/*    统一 API
 * - /api/sub      subconverter 兼容入口
 * - /api/version  版本信息
 * - /api/upload + /api/c/:id   自托管外部配置
 * - /api/short  + /api/s/:id   自托管短链接
 */
import $ from '@/core/app';
import { failed, success } from '@/restful/response';
import { KERNEL_VERSION, SUBHUB_VERSION, getConfig } from './config';
import { getStorageStats, listGroups } from './store';
import { listTargets, resolveTarget } from './targets';
import { convert, inspect, makeError } from './convert';
import {
    convertRules,
    listRuleTargets,
    listRulesets,
    readRuleset,
} from './rules';
import {
    decorate,
    deleteGroup,
    deleteNodes,
    exportNodes,
    importNodes,
    listGroups as listNodeGroups,
    probeNodes,
    pruneNodes,
    queryNodes,
    updateNode,
    upsertGroup,
} from './nodes';
import { listSnippets } from './snippets';
import { listTemplates } from './templates';
import { listEngines, probeEngines } from './engines';
import {
    handleConfigUpload,
    handlePaste,
    handleShortRedirect,
    handleShortUrl,
    handleSub,
    handleVersion,
} from './compat';

function wrap(handler) {
    const report = (error) => {
        $.error(
            `[SUBHUB] 请求失败: ${error?.code ?? ''} ${error?.message ?? error}\n${
                error?.stack ?? ''
            }`,
        );
        return error;
    };

    return (req, res, next) => {
        try {
            const result = handler(req, res, next);
            if (result && typeof result.then === 'function') {
                result.catch((error) => failed(res, report(error)));
            }
        } catch (error) {
            failed(res, report(error));
        }
    };
}

function register($app, method, pattern, handler) {
    $app[method](pattern, wrap(handler));
}

function bodyOf(req) {
    const body = req.body;
    if (body && typeof body === 'object' && Object.keys(body).length > 0) {
        return body;
    }
    // 允许 GET 传参 (非对象或空对象时回退到 query)
    return { ...(req.query ?? {}) };
}

function baseUrlOf(req) {
    const forwardedProto = req.headers?.['x-forwarded-proto'];
    const protocol = forwardedProto ?? req.protocol ?? 'http';
    return `${protocol}://${req.headers?.host ?? '127.0.0.1'}`;
}

/*****************************
 * 处理函数
 *****************************/

function infoHandler(req, res) {
    const config = getConfig();
    success(res, {
        name: config.name,
        version: SUBHUB_VERSION,
        kernel: { name: 'Sub-Store', version: KERNEL_VERSION },
        defaultTarget: config.defaultTarget,
        targets: listTargets(),
        engines: listEngines(),
        templates: listTemplates().map((template) => template.name),
        rulesets: listRulesets().length,
        snippets: listSnippets().length,
        storage: getStorageStats(),
        routes: [
            'GET  /api/v1',
            'GET  /api/v1/targets',
            'GET  /api/v1/templates',
            'GET  /api/v1/rulesets',
            'GET  /api/v1/snippets',
            'GET  /api/v1/engines',
            'POST /api/v1/convert',
            'POST /api/v1/inspect',
            'POST /api/v1/rules/convert',
            'POST /api/v1/render',
            'GET  /api/v1/nodes',
            'POST /api/v1/nodes',
            'PUT  /api/v1/nodes/:id',
            'DELETE /api/v1/nodes/:id',
            'POST /api/v1/nodes/probe',
            'GET  /api/v1/nodes/export',
            'GET  /api/v1/groups',
            'POST /api/v1/groups',
            'DELETE /api/v1/groups/:name',
            'GET  /api/sub (subconverter 兼容)',
            'GET  /api/version',
            'POST /api/upload + GET /api/c/:id',
            'POST /api/short  + GET /api/s/:id',
        ],
    });
}

function convertHandler(req, res) {
    const payload = bodyOf(req);
    return convert(payload).then((result) =>
        success(res, {
            target: result.target,
            source: result.source,
            inputCount: result.inputCount,
            count: result.count,
            format: result.format,
            template: result.template,
            warnings: result.warnings,
            stats: result.stats,
            content: result.content,
        }),
    );
}

async function inspectHandler(req, res) {
    const result = await inspect(bodyOf(req));
    success(res, result);
}

async function renderHandler(req, res) {
    const payload = bodyOf(req);
    const target = resolveTarget(
        payload.target ?? getConfig().defaultTarget,
    );
    if (!target) {
        throw makeError('UNSUPPORTED_TARGET', `不支持的目标平台: ${payload.target}`);
    }

    const result = await convert({ ...payload, list: false });
    success(res, {
        target: target.id,
        template: result.template,
        format: result.format,
        count: result.count,
        content: result.content,
    });
}

function listNodesHandler(req, res) {
    const nodes = queryNodes(req.query ?? bodyOf(req)).map(decorate);
    success(res, { total: nodes.length, nodes });
}

async function importNodesHandler(req, res) {
    const payload = bodyOf(req);
    const result = importNodes(payload);
    success(res, {
        added: result.added,
        skipped: result.skipped,
        skippedNames: result.skippedNames,
        total: result.total,
        nodes: result.nodes,
    });
}

function updateNodeHandler(req, res) {
    const id = req.params?.id ?? bodyOf(req).id;
    const node = updateNode(id, bodyOf(req));
    success(res, node);
}

function deleteNodeHandler(req, res) {
    const id = req.params?.id ?? (req.query ?? {}).id;
    const all = ['true', '1', 'yes'].includes(`${(req.query ?? {}).all}`);
    if (!id && !all) throw makeError('NO_ID', '需要提供 id 或 all=true');
    success(res, deleteNodes(id, { all }));
}

async function probeNodesHandler(req, res) {
    const payload = bodyOf(req);
    const result = await probeNodes(payload);
    success(res, result);
}

function exportNodesHandler(req, res) {
    const query = req.query ?? {};
    const content = exportNodes(
        {
            ids: query.ids
                ? `${query.ids}`.split(',').map((id) => id.trim())
                : undefined,
            groups: query.groups
                ? `${query.groups}`.split(',').map((id) => id.trim())
                : undefined,
            tags: query.tags
                ? `${query.tags}`.split(',').map((id) => id.trim())
                : undefined,
        },
        { format: query.format ?? 'uri' },
    );
    res.status(200)
        .set('Content-Type', 'text/plain;charset=utf-8')
        .send(content);
}

function listGroupsHandler(req, res) {
    success(res, { total: listGroups().length, groups: listNodeGroups() });
}

function upsertGroupHandler(req, res) {
    success(res, upsertGroup(bodyOf(req)));
}

function deleteGroupHandler(req, res) {
    success(res, deleteGroup(req.params?.name));
}

function pruneNodesHandler(req, res) {
    success(res, pruneNodes());
}

async function rulesHandler(req, res) {
    const result = await convertRules(bodyOf(req));
    success(res, result);
}

function rulesetHandler(req, res) {
    const name = req.params?.name ?? (req.query ?? {}).name;
    const ruleset = readRuleset(name);
    success(res, { name: ruleset.name, content: ruleset.content });
}

function templatesHandler(req, res) {
    const templates = listTemplates();
    const query = (req.query ?? {}).name;
    if (query) {
        const matched = templates.find(
            (template) => template.name === query || template.id === query,
        );
        success(res, { templates, matched });
        return;
    }
    success(res, { total: templates.length, templates });
}

function rulesetsHandler(req, res) {
    const rulesets = listRulesets();
    const query = (req.query ?? {}).name;
    if (query) {
        success(res, { rulesets, content: readRuleset(query).content });
        return;
    }
    success(res, { total: rulesets.length, rulesets, targets: listRuleTargets() });
}

function snippetsHandler(req, res) {
    success(res, { total: listSnippets().length, snippets: listSnippets() });
}

async function enginesHandler(req, res) {
    const only = (req.query ?? {}).id;
    const shouldProbe =
        ['true', '1', 'yes'].includes(`${(req.query ?? {}).probe}`) ||
        Boolean(only);
    if (!shouldProbe) {
        success(res, { engines: listEngines() });
        return;
    }
    const result = await probeEngines({ only });
    success(res, result);
}

/*****************************
 * 注册
 *****************************/

export default function registerUnifiedRoutes($app) {
    const v1 = (pattern) => [`/api/v1${pattern}`, `/v1${pattern}`];
    const api = (pattern) => [`/api${pattern}`, pattern];

    // 信息
    for (const pattern of v1('')) {
        register($app, 'get', pattern, infoHandler);
    }
    for (const pattern of v1('/info')) {
        register($app, 'get', pattern, infoHandler);
    }
    for (const pattern of v1('/targets')) {
        register($app, 'get', pattern, (req, res) =>
            success(res, { targets: listTargets() }),
        );
    }
    for (const pattern of v1('/templates')) {
        register($app, 'get', pattern, templatesHandler);
    }
    for (const pattern of v1('/rulesets')) {
        register($app, 'get', pattern, rulesetsHandler);
    }
    for (const pattern of v1('/snippets')) {
        register($app, 'get', pattern, snippetsHandler);
    }
    for (const pattern of v1('/engines')) {
        register($app, 'get', pattern, enginesHandler);
    }

    // 转换
    for (const pattern of v1('/convert')) {
        register($app, 'post', pattern, convertHandler);
        register($app, 'get', pattern, convertHandler);
    }
    for (const pattern of v1('/inspect')) {
        register($app, 'post', pattern, inspectHandler);
        register($app, 'get', pattern, inspectHandler);
    }
    for (const pattern of v1('/render')) {
        register($app, 'post', pattern, renderHandler);
        register($app, 'get', pattern, renderHandler);
    }
    for (const pattern of v1('/rules/convert')) {
        register($app, 'post', pattern, rulesHandler);
        register($app, 'get', pattern, rulesHandler);
    }
    for (const pattern of v1('/rulesets/:name')) {
        register($app, 'get', pattern, rulesetHandler);
    }

    // 节点库
    for (const pattern of v1('/nodes')) {
        register($app, 'get', pattern, listNodesHandler);
        register($app, 'post', pattern, importNodesHandler);
        register($app, 'delete', pattern, deleteNodeHandler);
    }
    for (const pattern of v1('/nodes/export')) {
        register($app, 'get', pattern, exportNodesHandler);
    }
    for (const pattern of v1('/nodes/prune')) {
        register($app, 'post', pattern, pruneNodesHandler);
    }
    for (const pattern of v1('/nodes/probe')) {
        register($app, 'post', pattern, probeNodesHandler);
    }
    for (const pattern of v1('/nodes/:id')) {
        register($app, 'put', pattern, updateNodeHandler);
        register($app, 'post', pattern, updateNodeHandler);
        register($app, 'delete', pattern, deleteNodeHandler);
        register($app, 'get', pattern, (req, res) => {
            const nodes = queryNodes({ q: req.params.id });
            success(res, { total: nodes.length, nodes: nodes.map(decorate) });
        });
    }
    for (const pattern of v1('/groups')) {
        register($app, 'get', pattern, listGroupsHandler);
        register($app, 'post', pattern, upsertGroupHandler);
    }
    for (const pattern of v1('/groups/:name')) {
        register($app, 'delete', pattern, deleteGroupHandler);
    }

    // subconverter 兼容
    for (const pattern of api('/sub')) {
        register($app, 'get', pattern, handleSub);
    }
    for (const pattern of api('/version')) {
        register($app, 'get', pattern, handleVersion);
    }
    for (const pattern of api('/upload')) {
        register($app, 'post', pattern, handleConfigUpload);
    }
    for (const pattern of api('/short')) {
        register($app, 'post', pattern, handleShortUrl);
    }
    for (const pattern of api('/c/:id')) {
        register($app, 'get', pattern, handlePaste);
    }
    for (const pattern of api('/s/:id')) {
        register($app, 'get', pattern, handleShortRedirect);
    }

    $.info(`[SUBHUB] 统一层已挂载: v${SUBHUB_VERSION} (内核 v${KERNEL_VERSION})`);
}
