// 条件触发只创建人工处理任务或案例；不自动执行高影响 Action。
import { z } from 'zod';
import { getDb, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import { evaluateBoolean, expressionDependencies } from '../../shared/rule-dsl';
import { writeAudit } from '../audit/audit-service';
import { AuthUser } from '../auth/auth-service';
import { createCase } from '../decision/decision-service';
import { getRule } from '../rules/rule-service';
import { executeAction, getActionType } from '../actions/action-service';

const ruleSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  typeKey: z.string().min(1),
  expression: z.string().optional(),
  ruleKey: z.string().optional(),
  effect: z.discriminatedUnion('type', [
    z.object({ type: z.literal('create_case'), decisionTypeKey: z.string().min(1), title: z.string().min(1) }),
    z.object({ type: z.literal('create_review_request'), taskTypeKey: z.string().min(1), title: z.string().min(1) }),
    z.object({ type: z.literal('execute_action'), actionKey: z.string().min(1),
      params: z.record(z.unknown()).default({}) }),
  ]),
  enabled: z.boolean().default(true),
}).refine((value) => !!value.ruleKey || !!value.expression?.trim(), {
  message: '必须配置触发规则或条件表达式',
});

function resolveCondition(typeKey: string, expression: string | undefined, ruleKey: string | undefined): string {
  if (!ruleKey) return expression!;
  const rule = getRule(ruleKey);
  if (rule.kind !== 'trigger' || rule.state !== 'published' ||
    (rule.scopeType && rule.scopeType !== typeKey)) {
    throw new AppError('VALIDATION_ERROR', `触发规则 ${ruleKey} 与对象类型 ${typeKey} 不兼容`);
  }
  return rule.expression;
}

function assertAutomationActionSafe(actionKey: string): void {
  const action = getActionType(actionKey);
  const policy = action.approvalPolicy ?? {};
  if (action.state !== 'published' || policy.allowAutomation !== true ||
    Object.keys(policy).some((key) => key !== 'allowAutomation') ||
    action.externalEffects.length || !action.writeSet.length ||
    !action.writeSet.every((write: Record<string, unknown>) => write.op === 'update' &&
      (write.objectId === undefined || write.objectId === '${params.objectId}'))) {
    throw new AppError('VALIDATION_ERROR', `Action ${actionKey} 不允许自动执行；仅限显式授权、无需审批且只更新触发对象的 Action`);
  }
}

function resolveAutomationParam(value: unknown, objectId: string, payload: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    if (value === '${objectId}') return objectId;
    const match = /^\$\{object\.([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(value);
    return match ? payload[match[1]] : value;
  }
  if (Array.isArray(value)) return value.map((part) => resolveAutomationParam(part, objectId, payload));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, part]) =>
      [key, resolveAutomationParam(part, objectId, payload)]));
  }
  return value;
}

const SYSTEM_USER: AuthUser = {
  id: 'system', username: 'system', displayName: '自动化',
  roles: ['admin'], securityClearance: 'TOP_SECRET',
};

export function upsertAutomation(input: unknown, actor: AuthUser) {
  const parsed = ruleSchema.safeParse(input);
  if (!parsed.success) throw new AppError('VALIDATION_ERROR', '自动化配置无效', parsed.error.flatten());
  const value = parsed.data;
  const dependencies = expressionDependencies(resolveCondition(value.typeKey, value.expression, value.ruleKey));
  const unavailable = dependencies.filter((dependency) =>
    dependency !== 'object' && !dependency.startsWith('object.') && dependency !== 'now');
  if (unavailable.length) {
    throw new AppError('VALIDATION_ERROR', `自动化条件只能读取 object.属性名 或 now，不能读取: ${unavailable.join(', ')}`);
  }
  if (value.effect.type === 'execute_action') assertAutomationActionSafe(value.effect.actionKey);
  const db = getDb();
  const id = value.id ?? newId('auto');
  const old = db.prepare('SELECT id FROM automation_rule WHERE id = ?').get(id);
  if (old) {
    db.prepare(`UPDATE automation_rule SET name = ?, condition_json = ?, effect_json = ?,
      enabled = ?, updated_at = ? WHERE id = ?`).run(value.name,
      JSON.stringify({ typeKey: value.typeKey, expression: value.expression ?? '', ruleKey: value.ruleKey ?? '' }),
      JSON.stringify(value.effect), value.enabled ? 1 : 0, nowIso(), id);
  } else {
    db.prepare(`INSERT INTO automation_rule
      (id, name, trigger_type, condition_json, effect_json, enabled, created_at, updated_at)
      VALUES (?,?,'object_change',?,?,?,?,?)`).run(id, value.name,
      JSON.stringify({ typeKey: value.typeKey, expression: value.expression ?? '', ruleKey: value.ruleKey ?? '' }),
      JSON.stringify(value.effect), value.enabled ? 1 : 0, nowIso(), nowIso());
  }
  writeAudit({ actor: actor.username, eventType: old ? 'automation.updated' : 'automation.created',
    resourceType: 'automation_rule', resourceId: id, after: value });
  return getAutomation(id);
}

export function getAutomation(id: string) {
  const row = getDb().prepare('SELECT * FROM automation_rule WHERE id = ?').get(id) as any;
  if (!row) throw new AppError('NOT_FOUND', `自动化规则不存在: ${id}`);
  return {
    id: row.id, name: row.name, triggerType: row.trigger_type,
    condition: JSON.parse(row.condition_json || '{}'), effect: JSON.parse(row.effect_json || '{}'),
    enabled: !!row.enabled, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export function listAutomations() {
  return (getDb().prepare('SELECT id FROM automation_rule ORDER BY created_at DESC').all() as any[])
    .map((r) => getAutomation(r.id));
}

export function listAutomationRuns(ruleId?: string) {
  const db = getDb();
  const rows = ruleId
    ? db.prepare('SELECT * FROM automation_run WHERE rule_id = ? ORDER BY created_at DESC').all(ruleId)
    : db.prepare('SELECT * FROM automation_run ORDER BY created_at DESC LIMIT 100').all();
  return (rows as any[]).map((r) => ({ id: r.id, ruleId: r.rule_id, objectId: r.object_id,
    objectRevision: r.object_revision, effectType: r.effect_type, status: r.status,
    result: JSON.parse(r.result_json || '{}'), createdAt: r.created_at }));
}

export function processObjectChange(objectId: string) {
  const db = getDb();
  const object = db.prepare('SELECT * FROM object_instance WHERE object_id = ? AND deleted = 0').get(objectId) as any;
  if (!object) return [];
  const rules = db.prepare("SELECT * FROM automation_rule WHERE trigger_type = 'object_change' AND enabled = 1").all() as any[];
  const results: unknown[] = [];
  for (const rule of rules) {
    const condition = JSON.parse(rule.condition_json || '{}');
    if (condition.typeKey !== object.type_key) continue;
    try {
      const payload = JSON.parse(object.payload_json || '{}');
      const expression = resolveCondition(condition.typeKey, condition.expression, condition.ruleKey);
      if (!evaluateBoolean(expression, { object: payload, now: nowIso() })) continue;
      const old = db.prepare('SELECT * FROM automation_run WHERE rule_id = ? AND object_id = ? AND object_revision = ?')
        .get(rule.id, objectId, object.revision) as any;
      if (old?.status === 'succeeded') continue;
      const effect = JSON.parse(rule.effect_json || '{}');
      const runId = old?.id ?? newId('arun');
      if (!old) {
        db.prepare(`INSERT INTO automation_run
          (id, rule_id, object_id, object_revision, effect_type, status, result_json, created_at)
          VALUES (?,?,?,?,?,'pending','{}',?)`).run(runId, rule.id, objectId, object.revision, effect.type, nowIso());
      }
      let result: unknown;
      if (effect.type === 'create_case') {
        result = createCase({ decisionTypeKey: effect.decisionTypeKey, title: effect.title,
          owner: 'review-queue', rootObjectId: objectId,
          securityLabels: JSON.parse(object.security_labels || '["PUBLIC"]'), actor: SYSTEM_USER });
      } else if (effect.type === 'create_review_request') {
        // 延迟引入以避免对象服务与自动化服务的循环初始化。
        const { createObject } = require('../objects/object-service') as typeof import('../objects/object-service');
        result = createObject({ typeKey: effect.taskTypeKey, payload: {
          name: effect.title, status: 'open', subjectObjectId: objectId,
          reason: `自动化规则 ${rule.name} 命中，待人工核查`,
        }, actor: 'system', securityLabels: JSON.parse(object.security_labels || '["PUBLIC"]'),
          skipAutomation: true });
      } else if (effect.type === 'execute_action') {
        assertAutomationActionSafe(effect.actionKey);
        const params = resolveAutomationParam(effect.params ?? {}, objectId, payload) as Record<string, unknown>;
        result = executeAction({ actionKey: effect.actionKey, params: { ...params, objectId },
          idempotencyKey: `automation:${rule.id}:${objectId}:${object.revision}`, actor: SYSTEM_USER,
          skipAutomation: true });
      } else {
        throw new AppError('VALIDATION_ERROR', `不支持自动化效果: ${effect.type}`);
      }
      db.prepare("UPDATE automation_run SET status = 'succeeded', result_json = ? WHERE id = ?")
        .run(JSON.stringify(result), runId);
      writeAudit({ actor: 'system', eventType: 'automation.executed', resourceType: 'automation_run',
        resourceId: runId, detail: { ruleId: rule.id, objectId } });
      results.push({ runId, status: 'succeeded', result });
    } catch (e: any) {
      const run = db.prepare('SELECT id FROM automation_run WHERE rule_id = ? AND object_id = ? AND object_revision = ?')
        .get(rule.id, objectId, object.revision) as any;
      if (run) db.prepare("UPDATE automation_run SET status = 'failed', result_json = ? WHERE id = ?")
        .run(JSON.stringify({ error: String(e?.message ?? e) }), run.id);
      results.push({ ruleId: rule.id, status: 'failed', error: String(e?.message ?? e) });
    }
  }
  return results;
}
