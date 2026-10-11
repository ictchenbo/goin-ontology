// Action Engine：权限、前置条件、事务写回、幂等、审计与 Outbox
import { getDb, nowIso, withTransaction } from '../../db/database';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import { sha256, stableStringify } from '../../shared/hash';
import { writeAudit } from '../audit/audit-service';
import { AuthUser, requireRole, hasRole, requireCaseAccess, requireObjectAccess, clearanceAllows, redactFields } from '../auth/auth-service';
import { evaluateBoolean } from '../../shared/rule-dsl';
import { updateObject, createObject, createLink, softDeleteObject } from '../objects/object-service';
import { getAlternative, getDecisionTypeForCase } from '../decision/decision-service';
import { invalidateCasesForObject } from '../decision/staleness-service';

export interface ActionTypeInput {
  actionKey: string;
  name: string;
  description?: string;
  paramsSchema?: Record<string, unknown>;
  preconditions?: string[];
  writeSet?: Array<Record<string, unknown>>;
  approvalPolicy?: {
    allowAutomation?: boolean;
    requiredRoles?: string[];
    thresholdScore?: number;
    legalAuthorityParam?: string;
    requiredAuthorityType?: string;
    requireVerifiedField?: string;
    relatedObjectParam?: string;
    relatedObjectType?: string;
    relatedRequiredField?: string;
    relatedRequiredValue?: unknown;
  };
  requiredRoles?: string[];
  externalEffects?: Array<{ target: string; template: string }>;
  compensation?: { actionKey?: string; note?: string };
}

export function upsertActionType(input: ActionTypeInput, actor: string) {
  const db = getDb();
  const now = nowIso();
  const existing = db.prepare('SELECT version FROM action_type WHERE action_key = ?').get(input.actionKey) as any;
  const version = existing ? existing.version + 1 : 1;
  const values = {
    name: input.name,
    description: input.description ?? '',
    paramsSchema: JSON.stringify(input.paramsSchema ?? {}),
    preconditions: JSON.stringify(input.preconditions ?? []),
    writeSet: JSON.stringify(input.writeSet ?? []),
    approvalPolicy: JSON.stringify(input.approvalPolicy ?? {}),
    requiredRoles: JSON.stringify(input.requiredRoles ?? ['operator']),
    externalEffects: JSON.stringify(input.externalEffects ?? []),
    compensation: JSON.stringify(input.compensation ?? {}),
    version,
  };
  if (existing) {
    db.prepare(`UPDATE action_type SET name=?, description=?, params_schema=?, preconditions=?, write_set=?,
      approval_policy=?, required_roles=?, external_effects=?, compensation=?, version=?, state='published', updated_at=?
      WHERE action_key=?`).run(
      values.name, values.description, values.paramsSchema, values.preconditions, values.writeSet,
      values.approvalPolicy, values.requiredRoles, values.externalEffects, values.compensation,
      version, now, input.actionKey
    );
  } else {
    db.prepare(`INSERT INTO action_type
      (action_key, name, description, params_schema, preconditions, write_set, approval_policy,
       required_roles, external_effects, compensation, version, state, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?, 'published', ?, ?)`).run(
      input.actionKey, values.name, values.description, values.paramsSchema, values.preconditions,
      values.writeSet, values.approvalPolicy, values.requiredRoles, values.externalEffects,
      values.compensation, version, now, now
    );
  }
  writeAudit({
    actor, eventType: 'action_type.upserted', resourceType: 'action_type',
    resourceId: input.actionKey, after: input,
  });
  return getActionType(input.actionKey);
}

export function getActionType(actionKey: string) {
  const row = getDb().prepare('SELECT * FROM action_type WHERE action_key = ?').get(actionKey) as any;
  if (!row) throw new AppError('NOT_FOUND', `Action 类型不存在: ${actionKey}`);
  return {
    actionKey: row.action_key,
    name: row.name,
    description: row.description,
    paramsSchema: JSON.parse(row.params_schema || '{}'),
    preconditions: JSON.parse(row.preconditions || '[]'),
    writeSet: JSON.parse(row.write_set || '[]'),
    approvalPolicy: JSON.parse(row.approval_policy || '{}'),
    requiredRoles: JSON.parse(row.required_roles || '[]'),
    externalEffects: JSON.parse(row.external_effects || '[]'),
    compensation: JSON.parse(row.compensation || '{}'),
    version: row.version,
    state: row.state,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listActionTypes() {
  return (getDb().prepare('SELECT action_key FROM action_type ORDER BY action_key').all() as any[])
    .map((r) => getActionType(r.action_key));
}

/**
 * 删除行动类型
 * 存在执行记录时默认软删（state=archived），force=true 才物理删除
 */
export function deleteActionType(actionKey: string, actor: string, opts: { force?: boolean } = {}) {
  const db = getDb();
  const before = getActionType(actionKey);
  const runCount = (db.prepare('SELECT COUNT(*) AS c FROM action_run WHERE action_key = ?').get(actionKey) as any).c as number;
  const now = nowIso();
  if (runCount > 0 && !opts.force) {
    db.prepare("UPDATE action_type SET state = 'archived' WHERE action_key = ?").run(actionKey);
    writeAudit({
      actor, eventType: 'action_type.archived', resourceType: 'action_type',
      resourceId: actionKey, before, detail: { runCount },
    });
    return { actionKey, deleted: false, archived: true, runCount };
  }
  db.prepare('DELETE FROM action_type WHERE action_key = ?').run(actionKey);
  writeAudit({
    actor, eventType: 'action_type.deleted', resourceType: 'action_type',
    resourceId: actionKey, before, detail: { runCount, force: !!opts.force },
  });
  return { actionKey, deleted: true, archived: false, runCount };
}

export interface ExecuteActionInput {
  actionKey: string;
  params: Record<string, unknown>;
  caseId?: string;
  alternativeId?: string;
  idempotencyKey: string;
  actor: AuthUser;
  /** 是否已获得审批 */
  approvalId?: string;
  /** 自动化触发的 Action 不再次触发自动化，避免自激循环。 */
  skipAutomation?: boolean;
}

export interface ValidationPreview {
  valid: boolean;
  preconditionResults: Array<{ expression: string; passed: boolean; message?: string }>;
  writePlan: Array<{ op: string; target: string; detail: string }>;
  requiredRoles: string[];
  errors: string[];
}

// 验证预览：不执行
export function validateAction(input: ExecuteActionInput): ValidationPreview {
  const at = getActionType(input.actionKey);
  const errors: string[] = [];
  if (at.requiredRoles.length && !hasRole(input.actor, at.requiredRoles)) {
    errors.push(`需要角色: ${at.requiredRoles.join('/')}`);
  }
  // 参数 Schema 校验（精简）
  for (const [k, spec] of Object.entries(at.paramsSchema.properties ?? {}) as any) {
    const req = (at.paramsSchema.required ?? []).includes(k);
    if (req && (input.params[k] === undefined || input.params[k] === null)) {
      errors.push(`缺少参数: ${k}`);
    }
    if (input.params[k] !== undefined && spec?.type) {
      const v = input.params[k];
      const t = Array.isArray(v) ? 'array' : typeof v === 'boolean' ? 'boolean' : typeof v === 'number' ? 'number' : typeof v === 'object' && v !== null ? 'object' : 'string';
      if (spec.type !== t && !(spec.type === 'datetime' && t === 'string')) {
        errors.push(`参数 ${k} 类型应为 ${spec.type}，实际 ${t}`);
      }
    }
  }

  // 前置条件
  const objectId = typeof input.params.objectId === 'string' ? input.params.objectId : '';
  let currentObject: Record<string, unknown> = {};
  if (objectId) {
    requireObjectAccess(input.actor, objectId);
    const row = getDb().prepare('SELECT payload_json FROM object_instance WHERE object_id = ?').get(objectId) as any;
    currentObject = JSON.parse(row.payload_json || '{}');
  }
  const ctx = {
    params: input.params,
    object: currentObject,
    caseId: input.caseId ?? null,
    now: nowIso(),
  };
  const policy = at.approvalPolicy as ActionTypeInput['approvalPolicy'];
  if (policy?.requireVerifiedField && currentObject[policy.requireVerifiedField] !== 'verified') {
    errors.push('目标事实尚未核实，不能执行该 Action');
  }
  if (policy?.legalAuthorityParam) {
    const authorityId = String(input.params[policy.legalAuthorityParam] ?? '');
    const authority = authorityId ? getDb().prepare(`SELECT type_key, payload_json, security_labels
      FROM object_instance WHERE object_id = ? AND deleted = 0`).get(authorityId) as any : null;
    if (!authority || (policy.requiredAuthorityType && authority.type_key !== policy.requiredAuthorityType)) {
      errors.push('缺少有效法定授权对象');
    } else {
      const p = JSON.parse(authority.payload_json || '{}');
      const now = Date.now();
      if (!p.active || (p.validFrom && Date.parse(p.validFrom) > now) ||
        (p.validTo && Date.parse(p.validTo) <= now)) {
        errors.push('法定授权未生效或已过期');
      }
      if (!clearanceAllows(input.actor, JSON.parse(authority.security_labels || '["PUBLIC"]'))) {
        errors.push('无权使用该法定授权');
      }
    }
  }
  if (policy?.relatedObjectParam) {
    const relatedId = String(input.params[policy.relatedObjectParam] ?? '');
    const related = relatedId ? getDb().prepare(`SELECT type_key, payload_json, security_labels
      FROM object_instance WHERE object_id = ? AND deleted = 0`).get(relatedId) as any : null;
    if (!related || (policy.relatedObjectType && related.type_key !== policy.relatedObjectType)) {
      errors.push('关联对象不存在或类型不匹配');
    } else {
      if (!clearanceAllows(input.actor, JSON.parse(related.security_labels || '["PUBLIC"]'))) {
        errors.push('无权使用关联对象');
      }
      if (policy.relatedRequiredField &&
        JSON.parse(related.payload_json || '{}')[policy.relatedRequiredField] !== policy.relatedRequiredValue) {
        errors.push('关联对象未满足授权或状态要求');
      }
      if (input.caseId && !getDb().prepare('SELECT 1 FROM case_object WHERE case_id = ? AND object_id = ?')
        .get(input.caseId, relatedId)) {
        errors.push('关联对象不在案例情境快照中');
      }
    }
  }
  const preconditionResults = at.preconditions.map((expr: string) => {
    try {
      const passed = evaluateBoolean(expr, ctx);
      return { expression: expr, passed, message: passed ? undefined : `前置条件未满足: ${expr}` };
    } catch (e: any) {
      return { expression: expr, passed: false, message: `前置条件计算失败: ${e.message}` };
    }
  });
  for (const p of preconditionResults) {
    if (!p.passed) errors.push(p.message ?? '前置条件未满足');
  }

  const writePlan = at.writeSet.map((w: Record<string, unknown>) => ({
    op: String(w.op ?? 'update'),
    target: String(w.type ?? w.objectId ?? 'object'),
    detail: JSON.stringify(w),
  }));

  return {
    valid: errors.length === 0,
    preconditionResults,
    writePlan,
    requiredRoles: at.requiredRoles,
    errors,
  };
}

/**
 * 执行顺序：授权 → 新鲜度/修订校验 → 硬约束 → 原子写入 → 审计及 Outbox
 * 同一幂等键重复请求只产生一次业务效果
 */
export function executeAction(input: ExecuteActionInput) {
  const db = getDb();
  const requestHash = sha256(stableStringify({ actionKey: input.actionKey, params: input.params,
    caseId: input.caseId ?? null, alternativeId: input.alternativeId ?? null, actor: input.actor.username }));

  // 幂等：已存在则返回首次结果
  const existing = db.prepare('SELECT * FROM action_run WHERE idempotency_key = ?').get(input.idempotencyKey) as any;
  if (existing) {
    if (existing.request_hash && existing.request_hash !== requestHash) {
      throw new AppError('IDEMPOTENCY_CONFLICT', '幂等键已用于不同 Action 请求');
    }
    return {
      ...mapRun(existing),
      idempotentReplay: true,
    };
  }

  const at = getActionType(input.actionKey);
  // 角色校验先于参数校验，权限不足直接 403
  if (at.requiredRoles?.length && !at.requiredRoles.some((r: string) => hasRole(input.actor, r))) {
    throw new AppError('FORBIDDEN', `需要角色: ${at.requiredRoles.join('/')}`);
  }
  const preview = validateAction(input);
  if (!preview.valid) {
    throw new AppError('PRECONDITION_FAILED', `Action 验证失败: ${preview.errors.join('; ')}`, {
      errors: preview.errors,
      preconditionResults: preview.preconditionResults,
    });
  }

  // 审批要求：未显式传入 approvalId 时，从案例已批准的审批记录解析
  // （决策审批即动作审批，避免客户端必须二次传递审批 ID）
  if (at.approvalPolicy?.requiredRoles?.length) {
    let approvalId = input.approvalId || '';
    if (!approvalId && input.caseId) {
      const row = input.alternativeId
        ? db.prepare(
            `SELECT id FROM approval WHERE case_id = ? AND alternative_id = ? AND status = 'approved'
             ORDER BY decided_at DESC LIMIT 1`
          ).get(input.caseId, input.alternativeId)
        : db.prepare(
            `SELECT id FROM approval WHERE case_id = ? AND status = 'approved'
             ORDER BY decided_at DESC LIMIT 1`
          ).get(input.caseId);
      approvalId = (row as any)?.id ?? '';
    }
    if (!approvalId) {
      throw new AppError('FORBIDDEN', '该 Action 需要审批后才能执行');
    }
    const apr = db.prepare('SELECT * FROM approval WHERE id = ?').get(approvalId) as any;
    if (!apr || apr.status !== 'approved' || apr.case_id !== input.caseId ||
      (input.alternativeId && apr.alternative_id !== input.alternativeId)) {
      throw new AppError('FORBIDDEN', '审批无效或未通过');
    }
  }

  const runId = newId('act');
  const now = nowIso();
  // 空字符串 ID 会导致外键失败，统一归一为 null
  const caseId = input.caseId || null;
  const alternativeId = input.alternativeId || null;
  const affectedObjectIds = new Set<string>();

  // 终态案例不允许再执行动作（避免关闭后仍能写回业务对象）
  if (caseId) {
    requireCaseAccess(input.actor, caseId);
    const decisionType = getDecisionTypeForCase(caseId);
    requireRole(input.actor, decisionType.roleMatrix.execute ?? ['operator']);
    const caseRow = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(caseId) as any;
    if (caseRow && ['Closed', 'Cancelled'].includes(caseRow.state)) {
      throw new AppError('STATE_TRANSITION_INVALID', `案例已${caseRow.state}，不能再执行动作`, { state: caseRow.state });
    }
    if (!['Approved', 'Executing'].includes(caseRow.state)) {
      throw new AppError('PRECONDITION_FAILED', '案例尚未获得有效批准');
    }
    if (!alternativeId) throw new AppError('VALIDATION_ERROR', '案例 Action 必须指定已批准的方案');
    const alt = db.prepare('SELECT * FROM alternative WHERE id = ? AND case_id = ?').get(alternativeId, caseId) as any;
    if (!alt) throw new AppError('VALIDATION_ERROR', '方案不属于该案例');
    const selected = db.prepare('SELECT selected_alternative_id FROM decision_record WHERE case_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(caseId) as any;
    if (selected?.selected_alternative_id !== alternativeId) {
      throw new AppError('CONFLICT', '执行方案与已批准决策不一致');
    }
    const proposed = JSON.parse(alt.proposed_actions || '[]') as Array<{ actionKey: string; params?: Record<string, unknown> }>;
    if (!proposed.some((action) => action.actionKey === input.actionKey &&
      stableStringify(action.params ?? {}) === stableStringify(input.params))) {
      throw new AppError('CONFLICT', 'Action 或参数与已批准方案不一致');
    }
    const frozen = db.prepare(`SELECT co.object_id, co.frozen_revision, oi.revision
      FROM case_object co JOIN object_instance oi ON oi.object_id = co.object_id WHERE co.case_id = ?`).all(caseId) as any[];
    const changed = frozen.find((r) => r.frozen_revision !== r.revision);
    if (changed) {
      invalidateCasesForObject(changed.object_id, `对象 ${changed.object_id} 修订已变化`, input.actor.username);
      throw new AppError('CONFLICT', `事实快照已过期，请重新定向: ${changed.object_id}`, {
        objectId: changed.object_id, frozenRevision: changed.frozen_revision, currentRevision: changed.revision,
      });
    }
    const approval = db.prepare(`SELECT id, action_versions_json FROM approval WHERE case_id = ? AND alternative_id = ? AND status = 'approved'
      ORDER BY decided_at DESC LIMIT 1`).get(caseId, alternativeId);
    if (!approval) throw new AppError('FORBIDDEN', '案例没有有效审批');
    const approvedVersion = (JSON.parse((approval as any).action_versions_json || '{}') as Record<string, number>)[input.actionKey];
    if (approvedVersion !== undefined && approvedVersion !== at.version) {
      db.prepare("UPDATE approval SET status = 'invalidated', invalidated_reason = ? WHERE id = ?")
        .run(`Action ${input.actionKey} 定义已变化`, (approval as any).id);
      db.prepare("UPDATE decision_case SET state = 'OptionsReady', updated_at = ? WHERE id = ?")
        .run(nowIso(), caseId);
      writeAudit({ actor: input.actor.username, eventType: 'approval.invalidated',
        resourceType: 'approval', resourceId: (approval as any).id,
        detail: { actionKey: input.actionKey, approvedVersion, currentVersion: at.version } });
      throw new AppError('CONFLICT', `Action ${input.actionKey} 定义已变化，请重新评分和审批`);
    }
    const score = db.prepare('SELECT ranking_json, facts_json FROM score_run WHERE case_id = ? ORDER BY created_at DESC LIMIT 1')
      .get(caseId) as any;
    if (!score) throw new AppError('PRECONDITION_FAILED', '缺少方案评分，请重新比选');
    const facts = JSON.parse(score.facts_json || '{}');
    if (facts.factsComplete === false || facts.stale === true) {
      throw new AppError('PRECONDITION_FAILED', '关键事实缺失或过期，请重新定向');
    }
    if (alternativeId) {
      const ranked = (JSON.parse(score.ranking_json || '[]') as any[]).find((r) => r.alternativeId === alternativeId);
      if (!ranked?.feasible) throw new AppError('CONSTRAINT_FAILED', '所选方案未通过硬约束');
    }
  }

  try {
    withTransaction((d) => {
      // 写入执行记录（pending -> executing）
      d.prepare(`INSERT INTO action_run
        (id, case_id, alternative_id, action_key, params_json, status, idempotency_key, result_json, error,
         actor, executed_at, created_at, retry_count, request_hash, action_version, action_definition_json)
        VALUES (?,?,?,?,?, 'executing', ?, '{}', '', ?, NULL, ?, 0, ?, ?, ?)`).run(
        runId, caseId, alternativeId, input.actionKey,
        JSON.stringify(input.params), input.idempotencyKey, input.actor.username, now, requestHash,
        at.version, JSON.stringify(at)
      );

      // 应用写集合
      const results: any[] = [];
      for (const w of at.writeSet) {
        const result = applyWriteSet(w, input, results) as { objectId?: string };
        results.push(result);
        if (result?.objectId) affectedObjectIds.add(result.objectId);
      }

      // 外部副作用 → Outbox（至少一次发送语义）
      for (const eff of at.externalEffects) {
        const payload = renderTemplate(eff.template, input.params, results);
        d.prepare(`INSERT INTO outbox_message
          (id, aggregate_type, aggregate_id, event_type, payload_json, delivery_state, attempts, last_error, created_at, delivered_at)
          VALUES (?,?,?,?,?, 'pending', 0, '', ?, NULL)`).run(
          newId('out'), 'action_run', runId, eff.target, JSON.stringify(payload), now
        );
      }

      d.prepare(`UPDATE action_run SET status = 'succeeded', result_json = ?, executed_at = ? WHERE id = ?`)
        .run(JSON.stringify({ writes: results, preview: preview.writePlan }), now, runId);

      // 若有关联案例，推进到 Executing
      if (input.caseId) {
        const c = d.prepare('SELECT state FROM decision_case WHERE id = ?').get(input.caseId) as any;
        if (c && ['Approved', 'Executing'].includes(c.state)) {
          d.prepare('UPDATE decision_case SET state = ?, updated_at = ? WHERE id = ?')
            .run('Executing', now, input.caseId);
        }
      }
      writeAudit({
        actor: input.actor.username, eventType: 'action.executed', resourceType: 'action_run',
        resourceId: runId, after: { actionKey: input.actionKey, params: input.params, caseId },
      });
    });
    if (!input.skipAutomation) {
      const { processObjectChange } = require('../automation/automation-service') as typeof import('../automation/automation-service');
      for (const objectId of affectedObjectIds) {
        try { processObjectChange(objectId); }
        catch (automationError) { console.error('[automation]', automationError); }
      }
    }
  } catch (e: any) {
    db.prepare(`INSERT OR IGNORE INTO action_run
      (id, case_id, alternative_id, action_key, params_json, status, idempotency_key, result_json, error,
       actor, executed_at, created_at, retry_count, request_hash, action_version, action_definition_json)
      VALUES (?,?,?,?,?,'failed',?,'{}',?,?,NULL,?,1,?,?,?)`).run(runId, caseId, alternativeId,
      input.actionKey, JSON.stringify(input.params), input.idempotencyKey, e.message, input.actor.username, now,
      requestHash, at.version, JSON.stringify(at));
    writeAudit({
      actor: input.actor.username, eventType: 'action.failed', resourceType: 'action_run',
      resourceId: runId, detail: { error: e.message },
    });
    throw e;
  }

  return mapRun(db.prepare('SELECT * FROM action_run WHERE id = ?').get(runId));
}

function applyWriteSet(w: Record<string, unknown>, input: ExecuteActionInput, results: unknown[]): unknown {
  const op = String(w.op ?? 'update');
  switch (op) {
    case 'create': {
      const caseRow = input.caseId
        ? getDb().prepare('SELECT security_labels FROM decision_case WHERE id = ?').get(input.caseId) as any
        : null;
      return createObject({
        typeKey: String(w.type),
        payload: resolveValue(w.payload ?? {}, input.params, results) as Record<string, unknown>,
        securityLabels: caseRow ? JSON.parse(caseRow.security_labels || '["PUBLIC"]') : ['PUBLIC'],
        actor: input.actor.username,
        reason: `Action ${input.actionKey}`,
        skipAutomation: true,
      });
    }
    case 'update': {
      const objectId = String(resolveValue(w.objectId ?? input.params.objectId ?? '', input.params, results));
      if (!objectId) throw new AppError('VALIDATION_ERROR', 'write_set.update 缺少 objectId');
      requireObjectAccess(input.actor, objectId);
      return updateObject({
        objectId,
        payload: resolveValue(w.payload ?? w.fields ?? {}, input.params, results) as Record<string, unknown>,
        expectedRevision: w.expectedRevision !== undefined
          ? Number(resolveValue(w.expectedRevision, input.params, results))
          : undefined,
        actor: input.actor.username,
        reason: `Action ${input.actionKey}`,
        skipAudit: true,
      });
    }
    case 'delete': {
      const objectId = String(resolveValue(w.objectId ?? input.params.objectId ?? '', input.params, results));
      requireObjectAccess(input.actor, objectId);
      return softDeleteObject(objectId, input.actor.username, `Action ${input.actionKey}`, true);
    }
    case 'link': {
      const fromObjectId = String(resolveValue(w.fromObjectId ?? input.params.fromObjectId ?? '', input.params, results));
      const toObjectId = String(resolveValue(w.toObjectId ?? input.params.toObjectId ?? '', input.params, results));
      requireObjectAccess(input.actor, fromObjectId);
      requireObjectAccess(input.actor, toObjectId);
      return createLink({
        linkKey: String(w.linkKey),
        fromObjectId,
        toObjectId,
        props: resolveValue(w.props ?? {}, input.params, results) as Record<string, unknown>,
        actor: input.actor.username,
      });
    }
    default:
      throw new AppError('VALIDATION_ERROR', `不支持的 write_set 操作: ${op}`);
  }
}

// 解析参数及前序写入结果引用，供同一事务内建立关联。
function resolveValue(value: unknown, params: Record<string, unknown>, results: unknown[] = []): unknown {
  if (typeof value === 'string') {
    return value.replace(/\$\{(params|results)\.([\w.]+)\}/g, (_m, source, path) => {
      const parts = path.split('.');
      let cur: any = source === 'results' ? results : params;
      for (const p of parts) cur = cur?.[p];
      return cur === undefined || cur === null ? '' : String(cur);
    });
  }
  if (Array.isArray(value)) return value.map((v) => resolveValue(v, params, results));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveValue(v, params, results);
    return out;
  }
  return value;
}

function renderTemplate(template: string, params: Record<string, unknown>, results: unknown[] = []): unknown {
  const resolved = resolveValue(template, params, results);
  if (typeof resolved === 'string') {
    try { return JSON.parse(resolved); } catch { return { text: resolved }; }
  }
  return resolved;
}

function mapRun(r: any) {
  return {
    id: r.id,
    caseId: r.case_id,
    alternativeId: r.alternative_id,
    actionKey: r.action_key,
    actionVersion: r.action_version ?? null,
    actionDefinition: JSON.parse(r.action_definition_json || '{}'),
    params: JSON.parse(r.params_json || '{}'),
    status: r.status,
    idempotencyKey: r.idempotency_key,
    result: JSON.parse(r.result_json || '{}'),
    error: r.error,
    actor: r.actor,
    executedAt: r.executed_at,
    createdAt: r.created_at,
    retryCount: r.retry_count,
  };
}

export function getActionRun(runId: string) {
  const r = getDb().prepare('SELECT * FROM action_run WHERE id = ?').get(runId) as any;
  if (!r) throw new AppError('NOT_FOUND', `Action 运行不存在: ${runId}`);
  return mapRun(r);
}

export function listActionRuns(filter: { caseId?: string; status?: string; limit?: number } = {}, user?: AuthUser) {
  const db = getDb();
  let sql = 'SELECT * FROM action_run WHERE 1=1';
  const params: unknown[] = [];
  if (filter.caseId) { sql += ' AND case_id = ?'; params.push(filter.caseId); }
  if (filter.status) { sql += ' AND status = ?'; params.push(filter.status); }
  sql += ' ORDER BY created_at DESC';
  return (db.prepare(sql).all(...params) as any[]).filter((r) => {
    if (!user) return true;
    if (!r.case_id) return r.actor === user.username || hasRole(user, ['admin']);
    const c = db.prepare('SELECT security_labels FROM decision_case WHERE id = ?').get(r.case_id) as any;
    return c && clearanceAllows(user, JSON.parse(c.security_labels || '["PUBLIC"]'));
  }).slice(0, Math.min(filter.limit ?? 50, 200)).map((r) => user ? redactFields(user, mapRun(r)) : mapRun(r));
}

// Outbox：重试投递
export async function deliverOutbox(limit = 20) {
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM outbox_message WHERE delivery_state IN ('pending','failed') ORDER BY created_at LIMIT ?`
  ).all(limit) as any[];
  const results: Array<{ id: string; state: string; error?: string }> = [];
  for (const r of rows) {
    results.push(await deliverMessage(r));
  }
  return results;
}

async function deliverMessage(r: any): Promise<{ id: string; state: string; error?: string }> {
  const db = getDb();
  try {
    const targets = JSON.parse(process.env.OUTBOX_TARGETS_JSON || '{}') as Record<string, string>;
    const address = targets[r.event_type];
    if (!address) throw new Error(`未配置投递目标: ${r.event_type}`);
    const url = new URL(address);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
      throw new Error('投递目标必须使用 HTTPS（本机测试除外）');
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': r.id },
      body: r.payload_json,
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`目标返回 HTTP ${response.status}`);
    db.prepare(`UPDATE outbox_message SET delivery_state = 'sent', attempts = attempts + 1,
      last_error = '', delivered_at = ? WHERE id = ?`).run(nowIso(), r.id);
    return { id: r.id, state: 'sent' };
  } catch (e: any) {
    const attempts = r.attempts + 1;
    const state = attempts >= 5 ? 'dead' : 'failed';
    db.prepare(`UPDATE outbox_message SET delivery_state = ?, attempts = ?, last_error = ? WHERE id = ?`)
      .run(state, attempts, String(e?.message ?? e), r.id);
    return { id: r.id, state, error: String(e?.message ?? e) };
  }
}

export function listOutbox(filter: { state?: string; limit?: number } = {}) {
  const db = getDb();
  let sql = 'SELECT * FROM outbox_message WHERE 1=1';
  const params: unknown[] = [];
  if (filter.state) { sql += ' AND delivery_state = ?'; params.push(filter.state); }
  sql += ' ORDER BY created_at DESC LIMIT ?';
  params.push(Math.min(filter.limit ?? 50, 200));
  return (db.prepare(sql).all(...params) as any[]).map((r: any) => ({
    id: r.id,
    aggregateType: r.aggregate_type,
    aggregateId: r.aggregate_id,
    eventType: r.event_type,
    payload: JSON.parse(r.payload_json || '{}'),
    deliveryState: r.delivery_state,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
    deliveredAt: r.delivered_at,
  }));
}

// 外部失败后的重试
export async function retryOutbox(messageId: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM outbox_message WHERE id = ?').get(messageId) as any;
  if (!row) throw new AppError('NOT_FOUND', `Outbox 消息不存在: ${messageId}`);
  if (row.delivery_state === 'sent') throw new AppError('CONFLICT', '消息已经投递成功');
  return [await deliverMessage(row)];
}

// 补偿记录（不自动回滚业务，只记录补偿动作）
export function recordCompensation(runId: string, compensationActionKey: string, actor: AuthUser) {
  requireRole(actor, ['admin', 'operator']);
  const db = getDb();
  const run = db.prepare('SELECT * FROM action_run WHERE id = ?').get(runId) as any;
  if (!run) throw new AppError('NOT_FOUND', `Action 运行不存在: ${runId}`);
  if (run.case_id) requireCaseAccess(actor, run.case_id);
  if (!['failed', 'succeeded'].includes(run.status)) throw new AppError('CONFLICT', '当前执行状态不允许登记补偿');
  if (!compensationActionKey?.trim()) throw new AppError('VALIDATION_ERROR', '补偿动作标识不能为空');
  db.prepare(`UPDATE action_run SET status = 'compensated' WHERE id = ?`).run(runId);
  writeAudit({
    actor: actor.username, eventType: 'action.compensated', resourceType: 'action_run',
    resourceId: runId, after: { compensationActionKey },
  });
  return { runId, status: 'compensated', compensationActionKey };
}
