// API 路由：面向用例而非直接暴露数据库
import { Router, Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import {
  login, listUsers, createUser, requireRole, hasRole,
} from '../modules/auth/auth-service';
import {
  createType, getType, listTypes, publishType, createTypeVersion,
  previewMigration, publishVersionWithMigration, createLinkDef, listLinkDefs,
  createInterface, listInterfaces, validatePayload,
  updateTypeMeta, deleteType, upsertProperty, removeProperty,
  updateLinkDef, deleteLinkDef, updateInterface, deleteInterface, getLinkDef, getInterface,
  rollbackTypeVersion,
  listSharedProperties, createSharedProperty, updateSharedProperty,
} from '../modules/ontology/ontology-service';
import {
  createObject, getObject, updateObject, softDeleteObject, queryObjects,
  getNeighborhood, createLink, replaceLink, invalidateLink, getHistory, listLinks,
} from '../modules/objects/object-service';
import {
  upsertRule, listRules, getRule, deleteRule,
} from '../modules/rules/rule-service';
import { upsertFunction, listFunctions, getFunction, deleteFunction, evaluateFunction } from '../modules/functions/function-service';
import {
  recordSource, listSources, getSource, attachEvidence, retractEvidence, correctSource,
} from '../modules/sources/source-service';
import {
  createCase, getCase, listCases, transitionCase, createAlternative,
  updateAlternativeStatus, scoreAlternatives, recordDecision, requestApproval,
  decideApproval, invalidateApprovals, listPendingApprovals, getDecisionType,
  listDecisionTypes, upsertDecisionType,
} from '../modules/decision/decision-service';
import {
  buildSituationSnapshot, getSnapshot, listSnapshots, reorientCase,
} from '../modules/situation/situation-service';
import {
  runScenario, getScenarioRun, listScenarioRuns, compareAlternatives,
} from '../modules/scenario/scenario-service';
import {
  upsertActionType, listActionTypes, getActionType, validateAction, executeAction,
  getActionRun, listActionRuns, deliverOutbox, listOutbox, retryOutbox, recordCompensation,
  deleteActionType,
} from '../modules/actions/action-service';
import {
  recordOutcome, listOutcomes, reviewOutcome, closeCase, comparePredictedVsActual, getOutcome,
} from '../modules/outcomes/outcome-service';
import {
  parseCsv, createIngestJob, getIngestJob, listIngestJobs, setMapping, applyIngestJob, listRejectedRows,
} from '../modules/ingestion/ingest-service';
import { listAudit, getAuditChain } from '../modules/audit/audit-service';
import { exportCaseReplay } from '../modules/decision/replay-service';
import { upsertAutomation, listAutomations, listAutomationRuns, processObjectChange } from '../modules/automation/automation-service';
import { requestSuggestion, listSuggestions, getSuggestion, reviewSuggestion } from '../modules/ai/ai-service';
import { saveAttachment, listAttachments, getAttachment } from '../modules/sources/attachment-service';
import { ingestWebhook } from '../modules/ingestion/webhook-service';
import { AppError } from '../shared/errors';
import { requireAuth, asyncHandler, idempotencyGuard, storeIdempotent } from './middleware';
import { getDb } from '../db/database';
import { evaluate, expressionDependencies } from '../shared/rule-dsl';
import { requireCaseAccess, requireObjectAccess, requireClearance, clearanceAllows, redactFields } from '../modules/auth/auth-service';

export const apiRouter = Router();
const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

function guardResourceCase(table: 'alternative' | 'scenario_run' | 'approval' | 'action_run' | 'outcome', param: string) {
  return asyncHandler((req, _res, next) => {
    const row = getDb().prepare(`SELECT case_id FROM ${table} WHERE id = ?`).get(req.params[param]) as any;
    if (!row) throw new AppError('NOT_FOUND', '资源不存在');
    if (row.case_id) requireCaseAccess(req.user!, row.case_id);
    next();
  });
}

// ===== 健康检查（无鉴权） =====
apiRouter.get('/health', (_req, res) => {
  try {
    const db = getDb();
    const row = db.prepare('SELECT COUNT(*) AS c FROM schema_migrations').get() as any;
    res.json({
      status: 'ok',
      migrations: row.c,
      time: new Date().toISOString(),
      version: '1.0.0',
    });
  } catch (e: any) {
    res.status(500).json({ status: 'error', message: e.message });
  }
});

// ===== 认证 =====
apiRouter.post('/auth/login', asyncHandler((req: Request, res: Response) => {
  const schema = z.object({ username: z.string().min(1), password: z.string().min(1) });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '用户名或密码格式错误', parsed.error.flatten());
  const result = login(parsed.data.username, parsed.data.password);
  res.json(result);
}));

apiRouter.get('/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

apiRouter.get('/users', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'approver']);
  res.json({ items: listUsers() });
}));

apiRouter.post('/users', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  const user = createUser(req.body);
  res.status(201).json(user);
}));

// ===== Ontology =====
apiRouter.get('/ontology/shared-properties', requireAuth, asyncHandler((_req, res) => {
  res.json({ items: listSharedProperties() });
}));

apiRouter.post('/ontology/shared-properties', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.status(201).json(createSharedProperty(req.body.propertyKey, req.body.definition, req.user!.username));
}));

apiRouter.put('/ontology/shared-properties/:propertyKey', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.json(updateSharedProperty(req.params.propertyKey, req.body.definition,
    Number(req.body.expectedVersion), req.user!.username));
}));

apiRouter.get('/ontology/types', requireAuth, asyncHandler((req, res) => {
  res.json({ items: listTypes(req.query.category as string | undefined) });
}));

apiRouter.get('/ontology/types/:typeKey', requireAuth, asyncHandler((req, res) => {
  res.json(getType(req.params.typeKey));
}));

apiRouter.post('/ontology/types', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  const t = createType({ ...req.body, createdBy: req.user!.username });
  res.status(201).json(t);
}));

apiRouter.post('/ontology/types/:typeKey/versions', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.status(201).json(createTypeVersion(
    req.params.typeKey, req.body.definition, req.user!.username,
    { changeNote: req.body.changeNote, migration: req.body.migration }
  ));
}));

apiRouter.post('/ontology/types/:typeKey/publish', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.json(publishType(req.params.typeKey, req.user!.username, req.body?.changeNote));
}));

apiRouter.post('/ontology/types/:typeKey/publish-version', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  res.json(publishVersionWithMigration(
    req.params.typeKey, Number(req.body.schemaVersion), req.user!.username, req.body.migration
  ));
}));

apiRouter.post('/ontology/types/:typeKey/rollback', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  res.json(rollbackTypeVersion(req.params.typeKey, Number(req.body.schemaVersion),
    req.user!.username, req.body.migration));
}));

apiRouter.post('/ontology/types/:typeKey/migration-preview', requireAuth, asyncHandler((req, res) => {
  res.json(previewMigration(req.params.typeKey, req.body.migration ?? {}));
}));

apiRouter.get('/ontology/links', requireAuth, asyncHandler((req, res) => {
  res.json({ items: listLinkDefs(req.query.fromType as string, req.query.toType as string) });
}));

apiRouter.post('/ontology/links', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.status(201).json(createLinkDef({ ...req.body, actor: req.user!.username }));
}));

apiRouter.get('/ontology/interfaces', requireAuth, asyncHandler((req, res) => {
  res.json({ items: listInterfaces() });
}));

apiRouter.post('/ontology/interfaces', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.status(201).json(createInterface(req.body));
}));

apiRouter.post('/ontology/validate', requireAuth, asyncHandler((req, res) => {
  res.json(validatePayload(req.body.typeKey, req.body.payload ?? {}));
}));

// 类型元数据更新与删除
apiRouter.patch('/ontology/types/:typeKey', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.json(updateTypeMeta(req.params.typeKey, req.body, req.user!.username));
}));

apiRouter.delete('/ontology/types/:typeKey', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  res.json(deleteType(req.params.typeKey, req.user!.username, {
    force: req.query.force === 'true' || req.body?.force === true,
  }));
}));

// 属性级管理（自动生成新 schema 版本）
apiRouter.post('/ontology/types/:typeKey/properties', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.status(201).json(upsertProperty(req.params.typeKey, req.body, req.user!.username, {
    changeNote: req.body?.changeNote,
  }));
}));

apiRouter.delete('/ontology/types/:typeKey/properties/:propName', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.json(removeProperty(req.params.typeKey, req.params.propName, req.user!.username, {
    force: req.query.force === 'true' || req.body?.force === true,
    migration: req.body?.migration,
    changeNote: req.body?.changeNote,
  }));
}));

// 链接类型：单查 / 更新 / 删除
apiRouter.get('/ontology/links/:linkKey', requireAuth, asyncHandler((req, res) => {
  res.json(getLinkDef(req.params.linkKey));
}));

apiRouter.patch('/ontology/links/:linkKey', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.json(updateLinkDef(req.params.linkKey, req.body, req.user!.username));
}));

apiRouter.delete('/ontology/links/:linkKey', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  res.json(deleteLinkDef(req.params.linkKey, req.user!.username, {
    force: req.query.force === 'true' || req.body?.force === true,
  }));
}));

// 接口：单查 / 更新 / 删除
apiRouter.get('/ontology/interfaces/:interfaceKey', requireAuth, asyncHandler((req, res) => {
  res.json(getInterface(req.params.interfaceKey));
}));

apiRouter.patch('/ontology/interfaces/:interfaceKey', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.json(updateInterface(req.params.interfaceKey, req.body, req.user!.username));
}));

apiRouter.delete('/ontology/interfaces/:interfaceKey', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  res.json(deleteInterface(req.params.interfaceKey, req.user!.username));
}));

// ===== Objects =====
apiRouter.get('/objects', requireAuth, asyncHandler((req, res) => {
  const filters = req.query.filters ? JSON.parse(String(req.query.filters)) : undefined;
  res.json(queryObjects({
    typeKey: req.query.typeKey as string,
    text: req.query.text as string,
    filters,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  }, req.user!));
}));

apiRouter.use('/objects/:objectId', requireAuth, asyncHandler((req, _res, next) => {
  requireObjectAccess(req.user!, req.params.objectId);
  next();
}));

apiRouter.get('/objects/:objectId', requireAuth, asyncHandler((req, res) => {
  res.json(getObject(req.params.objectId, {
    actor: req.user!,
    includeHistory: req.query.includeHistory === 'true',
  }));
}));

apiRouter.post('/objects', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst', 'operator']);
  const labels = req.body.securityLabels ?? ['PUBLIC'];
  if (!Array.isArray(labels) || !labels.every((item: unknown) => typeof item === 'string')) {
    throw new AppError('VALIDATION_ERROR', 'securityLabels 必须是字符串数组');
  }
  requireClearance(req.user!, labels);
  const payload = req.body.payload ?? {};
  if (Object.keys(redactFields(req.user!, payload, req.body.typeKey)).length !== Object.keys(payload).length) {
    throw new AppError('FORBIDDEN', '不能写入无权读取的敏感字段');
  }
  const obj = createObject({
    typeKey: req.body.typeKey,
    title: req.body.title,
    payload,
    securityLabels: labels,
    actor: req.user!.username,
    reason: req.body.reason,
  });
  res.status(201).json(obj);
}));

apiRouter.patch('/objects/:objectId', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst', 'operator']);
  requireObjectAccess(req.user!, req.params.objectId);
  const target = getDb().prepare('SELECT type_key FROM object_instance WHERE object_id = ?')
    .get(req.params.objectId) as { type_key: string };
  const payload = req.body.payload ?? {};
  if (Object.keys(redactFields(req.user!, payload, target.type_key)).length !== Object.keys(payload).length) {
    throw new AppError('FORBIDDEN', '不能写入无权读取的敏感字段');
  }
  res.json(updateObject({
    objectId: req.params.objectId,
    payload,
    title: req.body.title,
    expectedRevision: req.body.expectedRevision,
    actor: req.user!.username,
    reason: req.body.reason,
  }));
}));

apiRouter.delete('/objects/:objectId', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  requireObjectAccess(req.user!, req.params.objectId);
  res.json(softDeleteObject(req.params.objectId, req.user!.username, req.body?.reason));
}));

apiRouter.get('/objects/:objectId/neighborhood', requireAuth, asyncHandler((req, res) => {
  res.json(getNeighborhood(
    req.params.objectId,
    req.query.depth ? Number(req.query.depth) : 2,
    req.query.maxNodes ? Number(req.query.maxNodes) : 80,
    req.user!
  ));
}));

apiRouter.get('/objects/:objectId/history', requireAuth, asyncHandler((req, res) => {
  res.json({ items: getHistory(req.params.objectId, req.user!) });
}));

apiRouter.get('/objects/:objectId/attachments', requireAuth, asyncHandler((req, res) => {
  res.json({ items: listAttachments(req.params.objectId, req.user!) });
}));

apiRouter.post('/objects/:objectId/attachments', requireAuth, attachmentUpload.single('file'), asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst', 'operator']);
  res.status(201).json(saveAttachment(req.params.objectId, req.file!, req.user!));
}));

apiRouter.get('/attachments/:attachmentId/download', requireAuth, asyncHandler((req, res) => {
  const attachment = getAttachment(req.params.attachmentId, req.user!);
  res.type(attachment.meta.mediaType);
  res.attachment(attachment.meta.filename);
  res.sendFile(attachment.path);
}));

// 链接实例：列表 / 创建 / 失效
apiRouter.get('/links', requireAuth, asyncHandler((req, res) => {
  const items = listLinks({
    linkKey: req.query.linkKey as string | undefined,
    fromObjectId: req.query.fromObjectId as string | undefined,
    toObjectId: req.query.toObjectId as string | undefined,
    includeInvalid: req.query.includeInvalid === 'true',
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  }).filter((link) => {
    try {
      requireObjectAccess(req.user!, link.fromObjectId);
      requireObjectAccess(req.user!, link.toObjectId);
      return true;
    } catch { return false; }
  });
  res.json({ items });
}));

apiRouter.post('/links', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst', 'operator']);
  requireObjectAccess(req.user!, req.body.fromObjectId);
  requireObjectAccess(req.user!, req.body.toObjectId);
  res.status(201).json(createLink({ ...req.body, actor: req.user!.username }));
}));

apiRouter.patch('/links/:linkId', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  const old = getDb().prepare('SELECT from_object_id, to_object_id FROM link_instance WHERE id = ? AND is_valid = 1')
    .get(req.params.linkId) as { from_object_id: string; to_object_id: string } | undefined;
  if (!old) throw new AppError('NOT_FOUND', '有效关联不存在');
  requireObjectAccess(req.user!, old.from_object_id);
  requireObjectAccess(req.user!, old.to_object_id);
  requireObjectAccess(req.user!, req.body.fromObjectId);
  requireObjectAccess(req.user!, req.body.toObjectId);
  res.json(replaceLink(req.params.linkId, { ...req.body, actor: req.user!.username }));
}));

apiRouter.delete('/links/:linkId', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  const link = getDb().prepare('SELECT from_object_id, to_object_id FROM link_instance WHERE id = ?')
    .get(req.params.linkId) as { from_object_id: string; to_object_id: string } | undefined;
  if (!link) throw new AppError('NOT_FOUND', '链接不存在');
  requireObjectAccess(req.user!, link.from_object_id);
  requireObjectAccess(req.user!, link.to_object_id);
  res.json(invalidateLink(req.params.linkId, req.user!.username));
}));

// ===== Rules =====
apiRouter.get('/functions', requireAuth, asyncHandler((_req, res) => {
  res.json({ items: listFunctions() });
}));

apiRouter.get('/functions/:functionKey', requireAuth, asyncHandler((req, res) => {
  res.json(getFunction(req.params.functionKey));
}));

apiRouter.post('/functions', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.status(201).json(upsertFunction(req.body, req.user!.username));
}));

apiRouter.delete('/functions/:functionKey', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  res.json(deleteFunction(req.params.functionKey, req.user!.username));
}));

apiRouter.post('/functions/:functionKey/evaluate', requireAuth, asyncHandler((req, res) => {
  res.json(evaluateFunction(req.params.functionKey, req.body?.args ?? {}));
}));

// ===== Rules =====
apiRouter.get('/rules', requireAuth, asyncHandler((req, res) => {
  res.json({ items: listRules(req.query.kind as string, req.query.scopeType as string) });
}));

apiRouter.get('/rules/:ruleKey', requireAuth, asyncHandler((req, res) => {
  res.json(getRule(req.params.ruleKey));
}));

apiRouter.post('/rules', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.status(201).json(upsertRule(req.body, req.user!.username));
}));

apiRouter.delete('/rules/:ruleKey', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  deleteRule(req.params.ruleKey, req.user!.username);
  res.json({ deleted: true });
}));

apiRouter.post('/rules/preview', requireAuth, asyncHandler((req, res) => {
  const result = evaluate(req.body.expression, req.body.context ?? {});
  res.json({ result, deps: expressionDependencies(req.body.expression) });
}));

// ===== Sources =====
apiRouter.get('/sources', requireAuth, asyncHandler((req, res) => {
  res.json(listSources(req.query.limit ? Number(req.query.limit) : 50,
    req.query.offset ? Number(req.query.offset) : 0, req.user!));
}));

apiRouter.get('/sources/:sourceId', requireAuth, asyncHandler((req, res) => {
  res.json(getSource(req.params.sourceId, req.user!));
}));

apiRouter.post('/sources', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.status(201).json(recordSource({ ...req.body, actor: req.user!.username }));
}));

apiRouter.post('/sources/:sourceId/correct', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  getSource(req.params.sourceId, req.user!);
  res.json(correctSource(req.params.sourceId, req.user!.username, String(req.body?.reason ?? '')));
}));

apiRouter.post('/evidence', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  requireObjectAccess(req.user!, req.body.objectId);
  res.status(201).json(attachEvidence({ ...req.body, actor: req.user!.username }));
}));

apiRouter.post('/evidence/:evidenceId/retract', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  const evidence = getDb().prepare('SELECT object_id FROM evidence WHERE id = ?').get(req.params.evidenceId) as any;
  if (!evidence) throw new AppError('NOT_FOUND', '证据不存在');
  requireObjectAccess(req.user!, evidence.object_id);
  res.json(retractEvidence(req.params.evidenceId, req.user!.username, req.body?.reason ?? ''));
}));

// ===== Ingestion =====
apiRouter.get('/ingest/jobs', requireAuth, asyncHandler((_req, res) => {
  requireRole(_req.user!, ['admin', 'analyst']);
  res.json({ items: listIngestJobs() });
}));

apiRouter.get('/ingest/jobs/:jobId', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.json(getIngestJob(req.params.jobId));
}));

apiRouter.post('/ingest/jobs', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  let rows = req.body.rows as Array<Record<string, unknown>>;
  if (req.body.csv && typeof req.body.csv === 'string') {
    rows = parseCsv(req.body.csv) as any[];
  }
  if (!Array.isArray(rows)) throw new AppError('VALIDATION_ERROR', 'rows 必须是数组，或提供 csv 文本');
  res.status(201).json(createIngestJob({
    sourceType: req.body.csv ? 'csv' : 'json',
    filename: req.body.filename ?? 'upload',
    rows,
    mapping: req.body.mapping,
    createdBy: req.user!.username,
  }));
}));

apiRouter.post('/ingest/jobs/:jobId/mapping', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.json(setMapping(req.params.jobId, req.body, req.user!.username));
}));

apiRouter.post('/ingest/jobs/:jobId/apply', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.json(applyIngestJob(req.params.jobId, req.user!.username));
}));

apiRouter.get('/ingest/jobs/:jobId/rejected', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.json({ items: listRejectedRows(req.params.jobId) });
}));

apiRouter.post('/ingest/webhook/:sourceKey', asyncHandler((req, res) => {
  res.status(201).json(ingestWebhook({
    sourceKey: req.params.sourceKey,
    secret: String(req.header('X-Webhook-Secret') || ''),
    deliveryKey: String(req.header('X-Delivery-Key') || ''),
    rows: Array.isArray(req.body) ? req.body : req.body?.rows,
  }));
}));

// ===== Decision Types =====
apiRouter.get('/decision-types', requireAuth, asyncHandler((_req, res) => {
  res.json({ items: listDecisionTypes() });
}));

apiRouter.get('/decision-types/:typeKey', requireAuth, asyncHandler((req, res) => {
  res.json(getDecisionType(req.params.typeKey));
}));

apiRouter.post('/decision-types', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.status(201).json(upsertDecisionType(req.body, req.user!.username));
}));

// ===== Cases =====
apiRouter.get('/cases', requireAuth, asyncHandler((req, res) => {
  res.json(listCases({
    state: req.query.state as string,
    decisionTypeKey: req.query.decisionTypeKey as string,
    owner: req.query.owner as string,
    text: req.query.text as string,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  }, req.user!));
}));

apiRouter.use('/cases/:caseId', requireAuth, asyncHandler((req, _res, next) => {
  requireCaseAccess(req.user!, req.params.caseId);
  next();
}));

apiRouter.get('/cases/:caseId', requireAuth, asyncHandler((req, res) => {
  res.json(getCase(req.params.caseId, req.user!));
}));

apiRouter.get('/cases/:caseId/replay', requireAuth, asyncHandler((req, res) => {
  res.json(exportCaseReplay(req.params.caseId, req.user!));
}));

apiRouter.post('/cases', requireAuth, asyncHandler((req, res) => {
  res.status(201).json(createCase({
    ...req.body,
    // 兼容前端传 description 字段
    summary: req.body.summary ?? req.body.description ?? '',
    owner: req.body.owner ?? req.user!.username,
    actor: req.user!,
  }));
}));

apiRouter.post('/cases/:caseId/transition', requireAuth, asyncHandler((req, res) => {
  res.json(transitionCase(req.params.caseId, req.body.toState, req.user!, req.body.reason));
}));

apiRouter.post('/cases/:caseId/orient', requireAuth, asyncHandler((req, res) => {
  const c = getCase(req.params.caseId, req.user!);
  res.json(buildSituationSnapshot({
    caseId: req.params.caseId,
    rootObjectId: req.body.rootObjectId ?? c.rootObjectId,
    depth: req.body.depth,
    maxAgeDays: req.body.maxAgeDays,
    assumptions: req.body.assumptions,
    actor: req.user!,
  }));
}));

apiRouter.post('/cases/:caseId/reorient', requireAuth, asyncHandler((req, res) => {
  const c = getCase(req.params.caseId, req.user!);
  res.json(reorientCase(req.params.caseId, req.user!, req.body.rootObjectId ?? c.rootObjectId));
}));

apiRouter.get('/cases/:caseId/snapshots', requireAuth, asyncHandler((req, res) => {
  res.json({ items: listSnapshots(req.params.caseId) });
}));

apiRouter.get('/snapshots/:snapshotId', requireAuth, asyncHandler((req, res) => {
  res.json(getSnapshot(req.params.snapshotId, req.user!));
}));

apiRouter.post('/cases/:caseId/alternatives', requireAuth, asyncHandler((req, res) => {
  res.status(201).json(createAlternative({
    caseId: req.params.caseId,
    name: req.body.name,
    description: req.body.description,
    proposedActions: req.body.proposedActions,
    params: req.body.params,
    assumptionIds: req.body.assumptionIds,
    actor: req.user!,
  }));
}));

apiRouter.use('/alternatives/:altId', requireAuth, guardResourceCase('alternative', 'altId'));

apiRouter.patch('/alternatives/:altId', requireAuth, asyncHandler((req, res) => {
  updateAlternativeStatus(req.params.altId, req.body.status, req.body.infeasibleReasons ?? [], req.user!);
  res.json({ updated: true });
}));

apiRouter.use('/scenarios/:runId', requireAuth, guardResourceCase('scenario_run', 'runId'));

// ===== Scenario =====
apiRouter.post('/cases/:caseId/scenarios', requireAuth, asyncHandler((req, res) => {
  res.status(201).json(redactFields(req.user!, runScenario({
    caseId: req.params.caseId,
    alternativeId: req.body.alternativeId,
    overlay: req.body.overlay,
    metricOverlay: req.body.metricOverlay,
    runBy: req.user!,
  }) as unknown as Record<string, unknown>));
}));

apiRouter.get('/cases/:caseId/scenarios', requireAuth, asyncHandler((req, res) => {
  res.json({ items: listScenarioRuns(req.params.caseId).map((item) => redactFields(req.user!, item)) });
}));

apiRouter.get('/scenarios/:runId', requireAuth, asyncHandler((req, res) => {
  res.json(redactFields(req.user!, getScenarioRun(req.params.runId)));
}));

apiRouter.get('/cases/:caseId/comparison', requireAuth, asyncHandler((req, res) => {
  res.json(redactFields(req.user!, compareAlternatives(req.params.caseId)));
}));

// ===== Scoring & Decision =====
apiRouter.post('/cases/:caseId/score', requireAuth, asyncHandler((req, res) => {
  res.json(scoreAlternatives({
    caseId: req.params.caseId,
    scenarioRunId: req.body.scenarioRunId ?? 'adhoc',
    weights: req.body.weights,
    actor: req.user!,
  }));
}));

apiRouter.post('/cases/:caseId/decision', requireAuth, asyncHandler((req, res) => {
  res.status(201).json(recordDecision({
    caseId: req.params.caseId,
    selectedAlternativeId: req.body.selectedAlternativeId,
    rationale: req.body.rationale,
    dissent: req.body.dissent,
    actor: req.user!,
  }));
}));

// ===== Approvals =====
apiRouter.get('/approvals', requireAuth, asyncHandler((req, res) => {
  res.json({ items: listPendingApprovals(req.user!, req.query.status as string | undefined) });
}));

apiRouter.use('/approvals/:approvalId', requireAuth, guardResourceCase('approval', 'approvalId'));

apiRouter.post('/cases/:caseId/approvals', requireAuth, asyncHandler((req, res) => {
  res.status(201).json(requestApproval({
    caseId: req.params.caseId,
    alternativeId: req.body.alternativeId,
    comment: req.body.comment,
    actor: req.user!,
  }));
}));

apiRouter.post('/approvals/:approvalId/decide', requireAuth, asyncHandler((req, res) => {
  res.json(decideApproval({
    approvalId: req.params.approvalId,
    decision: req.body.decision,
    comment: req.body.comment,
    actor: req.user!,
  }));
}));

apiRouter.post('/cases/:caseId/invalidate-approvals', requireAuth, asyncHandler((req, res) => {
  res.json(invalidateApprovals(req.params.caseId, req.body.reason ?? '关键事实变化', req.user!));
}));

// ===== Actions =====
apiRouter.get('/action-types', requireAuth, asyncHandler((_req, res) => {
  res.json({ items: listActionTypes() });
}));

apiRouter.get('/action-types/:actionKey', requireAuth, asyncHandler((req, res) => {
  res.json(getActionType(req.params.actionKey));
}));

apiRouter.post('/action-types', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.status(201).json(upsertActionType(req.body, req.user!.username));
}));

apiRouter.delete('/action-types/:actionKey', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  res.json(deleteActionType(req.params.actionKey, req.user!.username, {
    force: req.query.force === 'true' || req.body?.force === true,
  }));
}));

apiRouter.post('/actions/validate', requireAuth, asyncHandler((req, res) => {
  res.json(validateAction({
    actionKey: req.body.actionKey,
    params: req.body.params ?? {},
    caseId: req.body.caseId,
    alternativeId: req.body.alternativeId,
    idempotencyKey: req.body.idempotencyKey ?? 'preview',
    actor: req.user!,
    approvalId: req.body.approvalId,
  }));
}));

apiRouter.post('/actions/execute', requireAuth, idempotencyGuard('POST /actions/execute'), asyncHandler((req, res) => {
  const key = (res.locals.idempotencyKey as string) || req.body.idempotencyKey || `auto-${Date.now()}`;
  const result = executeAction({
    actionKey: req.body.actionKey,
    params: req.body.params ?? {},
    caseId: req.body.caseId,
    alternativeId: req.body.alternativeId,
    idempotencyKey: key,
    actor: req.user!,
    approvalId: req.body.approvalId,
  });
  const safeResult = redactFields(req.user!, result);
  if (res.locals.idempotencyKey) {
    storeIdempotent(res, key, 'POST /actions/execute', 200, safeResult);
  }
  res.json(safeResult);
}));

apiRouter.get('/actions/runs', requireAuth, asyncHandler((req, res) => {
  res.json({ items: listActionRuns({
    caseId: req.query.caseId as string,
    status: req.query.status as string,
  }, req.user!) });
}));

apiRouter.use('/actions/runs/:runId', requireAuth, guardResourceCase('action_run', 'runId'));

apiRouter.get('/actions/runs/:runId', requireAuth, asyncHandler((req, res) => {
  res.json(redactFields(req.user!, getActionRun(req.params.runId)));
}));

apiRouter.post('/actions/runs/:runId/compensate', requireAuth, asyncHandler((req, res) => {
  res.json(recordCompensation(req.params.runId, req.body.compensationActionKey, req.user!));
}));

// ===== Outbox =====
apiRouter.get('/outbox', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  res.json({ items: listOutbox({ state: req.query.state as string }) });
}));

apiRouter.post('/outbox/deliver', requireAuth, asyncHandler(async (_req, res) => {
  requireRole(_req.user!, ['admin', 'operator']);
  res.json({ results: await deliverOutbox() });
}));

apiRouter.post('/outbox/:messageId/retry', requireAuth, asyncHandler(async (req, res) => {
  requireRole(req.user!, ['admin', 'operator']);
  res.json({ results: await retryOutbox(req.params.messageId) });
}));

// ===== Outcomes =====
apiRouter.get('/outcomes', requireAuth, asyncHandler((req, res) => {
  res.json({ items: listOutcomes(req.query.caseId as string, req.user!) });
}));

apiRouter.use('/outcomes/:outcomeId', requireAuth, guardResourceCase('outcome', 'outcomeId'));

apiRouter.get('/outcomes/:outcomeId', requireAuth, asyncHandler((req, res) => {
  res.json(redactFields(req.user!, getOutcome(req.params.outcomeId)));
}));

apiRouter.post('/cases/:caseId/outcomes', requireAuth, asyncHandler((req, res) => {
  res.status(201).json(recordOutcome({
    caseId: req.params.caseId,
    expected: req.body.expected ?? {},
    actual: req.body.actual ?? {},
    metrics: req.body.metrics,
    units: req.body.units,
    evidenceRefs: req.body.evidenceRefs,
    reviewNotes: req.body.reviewNotes,
    attribution: req.body.attribution,
    actor: req.user!,
  }));
}));

apiRouter.post('/outcomes/:outcomeId/review', requireAuth, asyncHandler((req, res) => {
  res.json(reviewOutcome(req.params.outcomeId, req.body.reviewNotes ?? '', req.body.attribution ?? '', req.user!));
}));

apiRouter.post('/cases/:caseId/close', requireAuth, asyncHandler((req, res) => {
  res.json(closeCase(req.params.caseId, req.user!));
}));

apiRouter.get('/cases/:caseId/prediction-comparison', requireAuth, asyncHandler((req, res) => {
  res.json(comparePredictedVsActual(req.params.caseId));
}));

// ===== Audit =====
apiRouter.get('/audit', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'approver', 'observer']);
  res.json(listAudit({
    actor: req.query.actor as string,
    resourceType: req.query.resourceType as string,
    resourceId: req.query.resourceId as string,
    eventType: req.query.eventType as string,
    correlationId: req.query.correlationId as string,
    from: req.query.from as string,
    to: req.query.to as string,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    offset: req.query.offset ? Number(req.query.offset) : undefined,
  }, req.user!));
}));

apiRouter.get('/audit/chain/:resourceType/:resourceId', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'approver', 'observer']);
  res.json({ items: getAuditChain(req.params.resourceType, req.params.resourceId, req.user!) });
}));

// ===== 仪表盘统计 =====
apiRouter.get('/automations', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.json({ items: listAutomations() });
}));

apiRouter.post('/automations', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  res.status(201).json(upsertAutomation(req.body, req.user!));
}));

apiRouter.get('/automations/runs', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin', 'analyst']);
  res.json({ items: listAutomationRuns(req.query.ruleId as string | undefined) });
}));

apiRouter.post('/automations/process-object', requireAuth, asyncHandler((req, res) => {
  requireRole(req.user!, ['admin']);
  requireObjectAccess(req.user!, req.body.objectId);
  res.json({ results: processObjectChange(req.body.objectId) });
}));

apiRouter.get('/cases/:caseId/ai-suggestions', requireAuth, asyncHandler((req, res) => {
  res.json({ items: listSuggestions(req.params.caseId, req.user!) });
}));

apiRouter.post('/cases/:caseId/ai-suggestions', requireAuth, asyncHandler(async (req, res) => {
  res.status(201).json(await requestSuggestion(req.params.caseId, req.body.kind, req.user!));
}));

apiRouter.get('/ai-suggestions/:suggestionId', requireAuth, asyncHandler((req, res) => {
  res.json(getSuggestion(req.params.suggestionId, req.user!));
}));

apiRouter.post('/ai-suggestions/:suggestionId/review', requireAuth, asyncHandler((req, res) => {
  res.json(reviewSuggestion(req.params.suggestionId, req.body.status, req.body.note ?? '', req.user!));
}));

apiRouter.get('/dashboard', requireAuth, asyncHandler((req, res) => {
  const db = getDb();
  const cases = (db.prepare('SELECT id, state, security_labels FROM decision_case').all() as any[])
    .filter((c) => clearanceAllows(req.user!, JSON.parse(c.security_labels || '["PUBLIC"]')));
  const caseIds = new Set(cases.map((c) => c.id));
  const caseCount = cases.length;
  const openCases = cases.filter((c) => !['Closed', 'Cancelled'].includes(c.state)).length;
  const pendingApprovals = (db.prepare("SELECT case_id FROM approval WHERE status = 'pending'").all() as any[])
    .filter((a) => caseIds.has(a.case_id)).length;
  const failedActions = (db.prepare("SELECT case_id FROM action_run WHERE status = 'failed'").all() as any[])
    .filter((a) => a.case_id && caseIds.has(a.case_id)).length;
  const pendingOutbox = hasRole(req.user!, ['admin', 'operator'])
    ? (db.prepare("SELECT COUNT(*) AS c FROM outbox_message WHERE delivery_state IN ('pending','failed')").get() as any).c : 0;
  const objectCount = (db.prepare('SELECT security_labels FROM object_instance WHERE deleted = 0').all() as any[])
    .filter((o) => clearanceAllows(req.user!, JSON.parse(o.security_labels || '["PUBLIC"]'))).length;
  const stateRows = [...new Set(cases.map((c) => c.state))].map((state) => ({
    state, c: cases.filter((c) => c.state === state).length,
  }));
  res.json({
    caseCount, openCases, pendingApprovals, failedActions, pendingOutbox, objectCount,
    casesByState: Object.fromEntries(stateRows.map((r) => [r.state, r.c])),
  });
}));
