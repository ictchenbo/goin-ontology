// Decision Engine：案例状态机、备选、约束、评分、解释与审批
import { getDb, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import { writeAudit } from '../audit/audit-service';
import { AuthUser, requireRole, hasRole, clearanceAllows, redactFields, requireCaseAccess, requireObjectAccess, mergeLabels } from '../auth/auth-service';
import { checkConstraints, ConstraintCheck } from '../rules/rule-service';
import { evaluate, evaluateBoolean } from '../../shared/rule-dsl';
import { buildSituationSnapshot, getSnapshot } from '../situation/situation-service';
import { sha256, stableStringify } from '../../shared/hash';
import { currentDomainId } from '../domains/domain-service';

// 案例状态机：New → Observed → Oriented → OptionsReady → PendingApproval → Approved
//           → Executing → Completed / Failed → OutcomeReviewed → Closed
// 取消与退回作为显式转换保存原因
const STATE_TRANSITIONS: Record<string, string[]> = {
  New: ['Observed', 'Cancelled'],
  Observed: ['Oriented', 'Cancelled', 'New'],
  Oriented: ['OptionsReady', 'Observed', 'Cancelled'],
  OptionsReady: ['PendingApproval', 'Oriented', 'Cancelled'],
  PendingApproval: ['Approved', 'OptionsReady', 'Cancelled'],
  Approved: ['Executing', 'OptionsReady', 'Cancelled'],
  Executing: ['Completed', 'Failed', 'Cancelled'],
  Completed: ['OutcomeReviewed', 'Failed'],
  Failed: ['Oriented', 'Executing', 'OutcomeReviewed', 'Closed'],
  OutcomeReviewed: ['Closed', 'Oriented'],
  Closed: [],
  Cancelled: [],
};

export const CASE_STATES = Object.keys(STATE_TRANSITIONS);

// 拒绝已经丢失原文的编码替换字符，避免决策与审批记录写入乱码。
function assertReadableText(value: unknown, field: string): void {
  if (typeof value === 'string' && value.includes('\uFFFD')) {
    throw new AppError('VALIDATION_ERROR', `${field}包含乱码替换字符，请检查输入编码并使用 UTF-8 重试`);
  }
}

export function assertTransition(from: string, to: string): void {
  const allowed = STATE_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new AppError('STATE_TRANSITION_INVALID', `非法状态转换: ${from} → ${to}`, {
      from, to, allowed,
    });
  }
}

export interface DecisionTypeInput {
  typeKey: string;
  displayName: string;
  description?: string;
  triggerConfig?: unknown;
  targetObjectType?: string;
  requiredFacts?: string[];
  roleMatrix?: { propose?: string[]; approve?: string[]; execute?: string[] };
  policyVersion?: string;
  criteria?: Array<CriterionDef>;
  constraints?: Array<ConstraintDef>;
  approvalRoute?: string[];
}

export interface CriterionDef {
  key: string;
  name: string;
  direction: 'higher_better' | 'lower_better';
  unit?: string;
  weight: number;
  /** 归一化：min-max / target / fixed */
  normalize: 'min_max' | 'target' | 'fixed';
  target?: number;
  min?: number;
  max?: number;
  expression: string;
  explanationTemplate?: string;
}

export interface ConstraintDef {
  key: string;
  name: string;
  severity: 'hard' | 'soft';
  scope?: string;
  expression: string;
  message?: string;
  basis?: string;
}

export function upsertDecisionType(input: DecisionTypeInput, actor: string) {
  const db = getDb();
  const now = nowIso();
  const existing = db.prepare('SELECT type_key, domain_id FROM decision_type WHERE type_key = ?').get(input.typeKey) as any;
  if (existing && existing.domain_id !== currentDomainId()) throw new AppError('CONFLICT', '决策类型标识已被其他领域使用');
  const row = {
    typeKey: input.typeKey,
    displayName: input.displayName,
    description: input.description ?? '',
    triggerConfig: JSON.stringify(input.triggerConfig ?? {}),
    targetObjectType: input.targetObjectType ?? '',
    requiredFacts: JSON.stringify(input.requiredFacts ?? []),
    roleMatrix: JSON.stringify(input.roleMatrix ?? { propose: ['analyst'], approve: ['approver'], execute: ['operator'] }),
    policyVersion: input.policyVersion ?? 'v1',
    criteria: JSON.stringify(input.criteria ?? []),
    constraints: JSON.stringify(input.constraints ?? []),
    approvalRoute: JSON.stringify(input.approvalRoute ?? []),
  };
  if (existing) {
    db.prepare(`UPDATE decision_type SET display_name=?, description=?, trigger_config=?, target_object_type=?,
      required_facts=?, role_matrix=?, policy_version=?, criteria=?, constraints=?, approval_route=?, updated_at=?
      WHERE type_key=?`).run(
      row.displayName, row.description, row.triggerConfig, row.targetObjectType,
      row.requiredFacts, row.roleMatrix, row.policyVersion, row.criteria, row.constraints,
      row.approvalRoute, now, input.typeKey
    );
  } else {
    db.prepare(`INSERT INTO decision_type
      (type_key, display_name, description, trigger_config, target_object_type, required_facts,
       role_matrix, policy_version, criteria, constraints, approval_route, state, created_at, updated_at, domain_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?, 'published', ?,?,?)`).run(
      row.typeKey, row.displayName, row.description, row.triggerConfig, row.targetObjectType,
      row.requiredFacts, row.roleMatrix, row.policyVersion, row.criteria, row.constraints,
      row.approvalRoute, now, now, currentDomainId()
    );
  }
  writeAudit({
    actor, eventType: 'decision_type.upserted', resourceType: 'decision_type',
    resourceId: input.typeKey, after: input,
  });
  const current = getDecisionType(input.typeKey);
  db.prepare(`INSERT INTO decision_type_version
    (id, type_key, policy_version, definition_json, created_by, created_at) VALUES (?,?,?,?,?,?)`)
    .run(newId('dtv'), input.typeKey, current.policyVersion, JSON.stringify(current), actor, nowIso());
  return current;
}

export function getDecisionType(typeKey: string) {
  const row = getDb().prepare('SELECT * FROM decision_type WHERE type_key = ? AND domain_id = ?')
    .get(typeKey, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', `决策类型不存在: ${typeKey}`);
  return {
    typeKey: row.type_key,
    displayName: row.display_name,
    description: row.description,
    triggerConfig: JSON.parse(row.trigger_config || '{}'),
    targetObjectType: row.target_object_type,
    requiredFacts: JSON.parse(row.required_facts || '[]'),
    roleMatrix: JSON.parse(row.role_matrix || '{}'),
    policyVersion: row.policy_version,
    criteria: JSON.parse(row.criteria || '[]'),
    constraints: JSON.parse(row.constraints || '[]'),
    approvalRoute: JSON.parse(row.approval_route || '[]'),
    state: row.state,
    updatedAt: row.updated_at,
  };
}

export function listDecisionTypes() {
  return (getDb().prepare('SELECT type_key FROM decision_type WHERE domain_id = ? ORDER BY type_key')
    .all(currentDomainId()) as any[])
    .map((r) => getDecisionType(r.type_key));
}

export function getDecisionTypeForCase(caseId: string) {
  const db = getDb();
  const c = db.prepare('SELECT decision_type_key, model_version_ref FROM decision_case WHERE id = ?').get(caseId) as any;
  if (!c) throw new AppError('NOT_FOUND', `案例不存在: ${caseId}`);
  const ref = JSON.parse(c.model_version_ref || '{}');
  if (ref.decisionTypeVersionId) {
    const version = db.prepare('SELECT definition_json FROM decision_type_version WHERE id = ?')
      .get(ref.decisionTypeVersionId) as any;
    if (version) return JSON.parse(version.definition_json) as ReturnType<typeof getDecisionType>;
  }
  return getDecisionType(c.decision_type_key);
}

// ===== 案例 =====
export interface CreateCaseInput {
  decisionTypeKey: string;
  title: string;
  summary?: string;
  triggerRef?: string;
  rootObjectId?: string;
  owner: string;
  priority?: string;
  deadline?: string;
  securityLabels?: string[];
  actor: AuthUser;
}

export function createCase(input: CreateCaseInput) {
  if (typeof input.title !== 'string' || !input.title.trim()) {
    throw new AppError('VALIDATION_ERROR', '案例标题不能为空');
  }
  if (input.title.includes('\uFFFD')) {
    throw new AppError('VALIDATION_ERROR', '案例标题包含乱码替换字符，请检查输入编码并使用 UTF-8 重试');
  }
  const dt = getDecisionType(input.decisionTypeKey);
  requireRole(input.actor, dt.roleMatrix.propose ?? ['analyst']);
  const db = getDb();
  const id = newId('case');
  const caseKey = `CASE-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${id.slice(-6).toUpperCase()}`;
  const now = nowIso();
  // rootObjectId 无独立列：落库到 trigger_ref（seed/前端同一约定），getCase 回读为 rootObjectId
  const triggerRef = input.triggerRef || input.rootObjectId || '';
  let labels = input.securityLabels ?? ['PUBLIC'];
  if (triggerRef) {
    requireObjectAccess(input.actor, triggerRef);
    const root = db.prepare('SELECT type_key, security_labels FROM object_instance WHERE object_id = ?').get(triggerRef) as any;
    if (dt.targetObjectType && root.type_key !== dt.targetObjectType) {
      throw new AppError('VALIDATION_ERROR', `该决策类型要求 ${dt.targetObjectType} 作为触发对象`);
    }
    labels = mergeLabels(labels, JSON.parse(root.security_labels || '["PUBLIC"]'));
  }
  const version = db.prepare('SELECT id FROM decision_type_version WHERE type_key = ? ORDER BY rowid DESC LIMIT 1')
    .get(input.decisionTypeKey) as any;
  db.prepare(`INSERT INTO decision_case
    (id, case_key, decision_type_key, title, summary, state, owner, priority, deadline, trigger_ref,
     snapshot_id, model_version_ref, security_labels, created_at, updated_at, domain_id)
    VALUES (?,?,?,?,?, 'New', ?,?,?,?,?,?,?,?,?,?)`).run(
    id, caseKey, input.decisionTypeKey, input.title.trim(), input.summary ?? '', input.owner,
    input.priority ?? 'normal', input.deadline ?? null, triggerRef,
    null, JSON.stringify({ policy: dt.policyVersion, decisionTypeVersionId: version?.id ?? null }),
    JSON.stringify(labels), now, now, currentDomainId()
  );
  writeAudit({
    actor: input.actor.username, eventType: 'case.created', resourceType: 'decision_case',
    resourceId: id, after: { title: input.title.trim(), type: input.decisionTypeKey },
  });
  return getCase(id, input.actor);
}

export function getCase(caseId: string, user?: AuthUser) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM decision_case WHERE id = ? AND domain_id = ?')
    .get(caseId, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', `案例不存在: ${caseId}`);
  const labels = JSON.parse(row.security_labels || '["PUBLIC"]');
  if (user) requireCaseAccess(user, caseId);
  const safe = <T>(value: T): T => user && value && typeof value === 'object'
    ? (Array.isArray(value) ? value.map((item) => safe(item))
      : redactFields(user, value as Record<string, unknown>)) as T : value;
  const alternatives = db.prepare('SELECT * FROM alternative WHERE case_id = ? ORDER BY created_at').all(caseId) as any[];
  const approvals = db.prepare('SELECT * FROM approval WHERE case_id = ? ORDER BY created_at DESC').all(caseId) as any[];
  const actionRuns = db.prepare('SELECT * FROM action_run WHERE case_id = ? ORDER BY created_at DESC').all(caseId) as any[];
  const outcomes = db.prepare('SELECT * FROM outcome WHERE case_id = ? ORDER BY created_at DESC').all(caseId) as any[];
  const caseObjects = db.prepare('SELECT * FROM case_object WHERE case_id = ?').all(caseId) as any[];
  const decisionRecord = db.prepare('SELECT * FROM decision_record WHERE case_id = ? ORDER BY created_at DESC LIMIT 1').get(caseId) as any;
  // 最新评分结果：刷新后仍可回放排序与事实完备性
  const scoreRunRow = db.prepare('SELECT * FROM score_run WHERE case_id = ? ORDER BY created_at DESC LIMIT 1').get(caseId) as any;
  const decisionType = getDecisionTypeForCase(caseId);

  let scoreRun: any = null;
  let scores: any[] = [];
  let facts: { factsComplete: boolean; missing: string[]; stale: boolean } | null = null;
  if (scoreRunRow) {
    scores = JSON.parse(scoreRunRow.ranking_json || '[]');
    const weights = JSON.parse(scoreRunRow.weights_json || '{}');
    const factsMeta = JSON.parse(scoreRunRow.facts_json || '{}');
    facts = {
      factsComplete: factsMeta.factsComplete !== false,
      missing: factsMeta.missingFacts ?? factsMeta.missing ?? [],
      stale: !!factsMeta.stale,
    };
    scoreRun = {
      id: scoreRunRow.id,
      scenarioRunId: scoreRunRow.scenario_run_id,
      winnerAlternativeId: scoreRunRow.winner_alternative_id,
      weights: weights.normalized ?? weights,
      rawWeights: weights.raw ?? weights,
      createdBy: scoreRunRow.created_by,
      createdAt: scoreRunRow.created_at,
      factsComplete: facts.factsComplete,
      missingFacts: facts.missing,
    };
  }

  const decision = decisionRecord ? {
    id: decisionRecord.id,
    selectedAlternativeId: decisionRecord.selected_alternative_id,
    alternativeId: decisionRecord.selected_alternative_id,
    rationale: decisionRecord.rationale,
    dissent: decisionRecord.dissent,
    overridden: !!decisionRecord.overridden,
    createdBy: decisionRecord.created_by,
    createdAt: decisionRecord.created_at,
  } : null;

  const objects = caseObjects.map((c) => ({
    objectId: c.object_id, role: c.role,
    frozenRevision: c.frozen_revision,
    frozenPayload: user ? redactFields(user, JSON.parse(c.frozen_payload_json || '{}'),
      (db.prepare('SELECT type_key FROM object_instance WHERE object_id = ?').get(c.object_id) as any)?.type_key)
      : JSON.parse(c.frozen_payload_json || '{}'),
  }));

  return {
    id: row.id,
    caseKey: row.case_key,
    decisionTypeKey: row.decision_type_key,
    title: row.title,
    summary: row.summary,
    state: row.state,
    owner: row.owner,
    priority: row.priority,
    deadline: row.deadline,
    triggerRef: row.trigger_ref,
    // 前端/脚本统一用 rootObjectId 定位案例根对象（与 trigger_ref 同值）
    rootObjectId: row.trigger_ref || (caseObjects.find((co: any) => co.role === 'trigger')?.object_id ?? null),
    snapshotId: row.snapshot_id,
    modelVersionRef: JSON.parse(row.model_version_ref || '{}'),
    securityLabels: labels,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at,
    alternatives: alternatives.map((a) => safe(mapAlternative(a))),
    approvals: approvals.map(mapApproval),
    actionRuns: actionRuns.map((a) => safe(mapActionRun(a))),
    outcomes: outcomes.map((o) => safe({
      id: o.id, expected: JSON.parse(o.expected_json || '{}'),
      actual: JSON.parse(o.actual_json || '{}'),
      deviation: JSON.parse(o.deviation_json || '{}'),
      evidenceRefs: JSON.parse(o.evidence_refs || '[]'),
      units: JSON.parse(o.units_json || '{}'),
      reviewNotes: o.review_notes, attribution: o.attribution,
      recordedBy: o.recorded_by, createdAt: o.created_at,
    })),
    caseObjects: objects,
    decisionRecord: decisionRecord ? {
      id: decisionRecord.id,
      selectedAlternativeId: decisionRecord.selected_alternative_id,
      rationale: decisionRecord.rationale,
      dissent: decisionRecord.dissent,
      overridden: !!decisionRecord.overridden,
      createdBy: decisionRecord.created_by,
      createdAt: decisionRecord.created_at,
    } : null,
    // 决策类型定义：评分准则 / 硬约束 / 角色矩阵，供 UI 动态渲染权重与方案参数
    decisionType: {
      typeKey: decisionType.typeKey,
      displayName: decisionType.displayName,
      criteria: decisionType.criteria ?? [],
      constraints: decisionType.constraints ?? [],
      requiredFacts: decisionType.requiredFacts ?? [],
      roleMatrix: decisionType.roleMatrix ?? {},
    },
    // 评分回放
    scoreRun,
    scores: safe(scores),
    facts,
    // 兼容字段（前端/脚本常用别名）
    status: row.state,
    description: row.summary,
    decision,
    objects,
  };
}

function mapAlternative(r: any) {
  return {
    id: r.id,
    caseId: r.case_id,
    name: r.name,
    description: r.description,
    proposedActions: JSON.parse(r.proposed_actions || '[]'),
    assumptionIds: JSON.parse(r.assumption_ids || '[]'),
    status: r.status,
    infeasibleReasons: JSON.parse(r.infeasible_reasons || '[]'),
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function mapApproval(r: any) {
  const roles = parseRoleList(r.required_role);
  return {
    id: r.id,
    caseId: r.case_id,
    alternativeId: r.alternative_id,
    requestedBy: r.requested_by,
    actor: r.actor,
    decision: r.decision,
    comment: r.comment,
    // requiredRole 保持单值字符串用于展示；requiredRoles 给出完整审批角色
    requiredRole: roles[0] ?? String(r.required_role ?? ''),
    requiredRoles: roles,
    actionVersions: JSON.parse(r.action_versions_json || '{}'),
    status: r.status,
    invalidatedReason: r.invalidated_reason,
    createdAt: r.created_at,
    decidedAt: r.decided_at,
  };
}

/** 解析 required_role：JSON 数组或单角色字符串 */
function parseRoleList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  const s = String(raw ?? '').trim();
  if (!s) return [];
  if (s.startsWith('[')) {
    try {
      const parsed = JSON.parse(s);
      return Array.isArray(parsed) ? parsed.map(String) : [s];
    } catch {
      return [s];
    }
  }
  return [s];
}

function mapActionRun(r: any) {
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

export function listCases(filter: { state?: string; decisionTypeKey?: string; owner?: string; text?: string; limit?: number; offset?: number } = {}, user?: AuthUser) {
  const db = getDb();
  const where: string[] = ['domain_id = ?'];
  const params: unknown[] = [currentDomainId()];
  if (filter.state) { where.push('state = ?'); params.push(filter.state); }
  if (filter.decisionTypeKey) { where.push('decision_type_key = ?'); params.push(filter.decisionTypeKey); }
  if (filter.owner) { where.push('owner = ?'); params.push(filter.owner); }
  if (filter.text) {
    where.push('(title LIKE ? OR summary LIKE ? OR case_key LIKE ?)');
    params.push(`%${filter.text}%`, `%${filter.text}%`, `%${filter.text}%`);
  }
  const limit = Math.min(filter.limit ?? 50, 200);
  const offset = filter.offset ?? 0;
  const sql = `SELECT * FROM decision_case ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY updated_at DESC LIMIT ? OFFSET ?`;
  const visible = (db.prepare(`SELECT * FROM decision_case ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY updated_at DESC`).all(...params) as any[]).filter((r) =>
    !user || clearanceAllows(user, JSON.parse(r.security_labels || '["PUBLIC"]'))
  );
  const rows = visible.slice(offset, offset + limit);
  const total = visible.length;
  return {
    items: rows.map((r) => ({
      id: r.id,
      caseKey: r.case_key,
      decisionTypeKey: r.decision_type_key,
      title: r.title,
      summary: r.summary,
      description: r.summary,
      state: r.state,
      status: r.state,
      owner: r.owner,
      priority: r.priority,
      deadline: r.deadline,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      securityLabels: JSON.parse(r.security_labels || '[]'),
    })),
    total, limit, offset,
  };
}

export function transitionCase(caseId: string, toState: string, actor: AuthUser, reason?: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(caseId) as any;
  if (!row) throw new AppError('NOT_FOUND', `案例不存在: ${caseId}`);
  assertTransition(row.state, toState);
  // 角色约束：提案/审批/执行/复盘关闭需相应角色
  const dt = getDecisionTypeForCase(caseId);
  if (['New', 'Observed', 'Oriented', 'OptionsReady'].includes(toState)) {
    requireRole(actor, dt.roleMatrix.propose ?? ['analyst']);
  }
  if (toState === 'PendingApproval' || toState === 'Approved' || toState === 'OutcomeReviewed') {
    requireRole(actor, dt.roleMatrix.approve ?? ['approver']);
  }
  if (toState === 'Executing' || toState === 'Completed') {
    requireRole(actor, dt.roleMatrix.execute ?? ['operator']);
  }
  if (toState === 'Closed' && !hasRole(actor, dt.roleMatrix.approve ?? ['approver']) && actor.username !== row.owner) {
    throw new AppError('FORBIDDEN', '仅审批角色或案例负责人可关闭案例');
  }
  // 取消：提案/审批角色或案例负责人（此前无门槛，任意登录用户可取消）
  if (toState === 'Cancelled'
    && !hasRole(actor, dt.roleMatrix.propose ?? ['analyst'])
    && !hasRole(actor, dt.roleMatrix.approve ?? ['approver'])
    && actor.username !== row.owner) {
    throw new AppError('FORBIDDEN', '仅提案/审批角色或案例负责人可取消案例');
  }
  // 标记失败：执行/审批角色（执行结果判定，不属提案职责）
  if (toState === 'Failed'
    && !hasRole(actor, dt.roleMatrix.execute ?? ['operator'])
    && !hasRole(actor, dt.roleMatrix.approve ?? ['approver'])) {
    throw new AppError('FORBIDDEN', '仅执行/审批角色可标记案例失败');
  }
  // 退回或取消后，旧审批不再对应当前流程状态。
  if (['PendingApproval', 'Approved'].includes(row.state)
    && ['OptionsReady', 'Cancelled'].includes(toState)) {
    const invalidated = db.prepare(`UPDATE approval SET status = 'invalidated', invalidated_reason = ?
      WHERE case_id = ? AND status IN ('pending', 'approved')`)
      .run(`案例状态已转为 ${toState}`, caseId);
    if (invalidated.changes > 0) {
      writeAudit({ actor: actor.username, eventType: 'approval.invalidated',
        resourceType: 'decision_case', resourceId: caseId,
        detail: { toState, count: invalidated.changes } });
    }
  }
  db.prepare('UPDATE decision_case SET state = ?, updated_at = ?, closed_at = ? WHERE id = ?')
    .run(toState, nowIso(), toState === 'Closed' || toState === 'Cancelled' ? nowIso() : row.closed_at, caseId);
  writeAudit({
    actor: actor.username, eventType: 'case.transition', resourceType: 'decision_case',
    resourceId: caseId, before: { state: row.state }, after: { state: toState },
    detail: { reason: reason ?? '' },
  });
  return getCase(caseId, actor);
}

// ===== 备选方案 =====
export function createAlternative(input: {
  caseId: string;
  name: string;
  description?: string;
  proposedActions?: Array<Record<string, unknown>>;
  /** 兼容：前端可直接传预测指标/参数对象，会被包装为 proposedActions[0] */
  params?: Record<string, unknown>;
  assumptionIds?: string[];
  actor: AuthUser;
}) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(input.caseId) as any;
  if (!c) throw new AppError('NOT_FOUND', `案例不存在: ${input.caseId}`);
  // 提案职责：与 createCase 同一 roleMatrix.propose
  const dt = getDecisionTypeForCase(input.caseId);
  requireRole(input.actor, dt.roleMatrix.propose ?? ['analyst']);
  // 终态案例不允许再增补方案
  if (['Closed', 'Cancelled'].includes(c.state)) {
    throw new AppError('STATE_TRANSITION_INVALID', `案例已${c.state}，不能再添加方案`, { state: c.state });
  }
  // 归一化 proposedActions：优先用显式数组；否则把 params 包成单条拟议动作
  let proposedActions = input.proposedActions ?? [];
  if (!proposedActions.length && input.params && typeof input.params === 'object') {
    proposedActions = [input.params];
  }
  if (!proposedActions.length) {
    throw new AppError('VALIDATION_ERROR', '方案必须包含预测指标（proposedActions 或 params）');
  }
  const id = newId('alt');
  const now = nowIso();
  db.prepare(`INSERT INTO alternative
    (id, case_id, name, description, proposed_actions, assumption_ids, status, infeasible_reasons, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?, 'draft', '[]', ?,?,?)`).run(
    id, input.caseId, input.name, input.description ?? '',
    JSON.stringify(proposedActions), JSON.stringify(input.assumptionIds ?? []),
    input.actor.username, now, now
  );
  writeAudit({
    actor: input.actor.username, eventType: 'alternative.created', resourceType: 'alternative',
    resourceId: id, after: { name: input.name, caseId: input.caseId },
  });
  return mapAlternative(db.prepare('SELECT * FROM alternative WHERE id = ?').get(id));
}

export function updateAlternativeStatus(
  alternativeId: string,
  status: string,
  infeasibleReasons: string[],
  actor: AuthUser
) {
  const db = getDb();
  const alt = db.prepare('SELECT * FROM alternative WHERE id = ?').get(alternativeId) as any;
  if (!alt) throw new AppError('NOT_FOUND', `备选不存在: ${alternativeId}`);
  // 方案状态维护属提案职责（此前任意登录用户可改可行性）
  const c = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(alt.case_id) as any;
  if (!c) throw new AppError('NOT_FOUND', `案例不存在: ${alt.case_id}`);
  const dt = getDecisionTypeForCase(alt.case_id);
  requireRole(actor, dt.roleMatrix.propose ?? ['analyst']);
  if (['Closed', 'Cancelled'].includes(c.state)) {
    throw new AppError('STATE_TRANSITION_INVALID', `案例已${c.state}，不能再维护方案状态`, { state: c.state });
  }
  const allowed = ['draft', 'infeasible', 'rejected'];
  if (!allowed.includes(status)) {
    throw new AppError('VALIDATION_ERROR', `非法方案状态: ${status}`, { allowed });
  }
  db.prepare('UPDATE alternative SET status = ?, infeasible_reasons = ?, updated_at = ? WHERE id = ?')
    .run(status, JSON.stringify(infeasibleReasons), nowIso(), alternativeId);
  writeAudit({
    actor: actor.username, eventType: 'alternative.status', resourceType: 'alternative',
    resourceId: alternativeId, after: { status, infeasibleReasons },
  });
  return mapAlternative(db.prepare('SELECT * FROM alternative WHERE id = ?').get(alternativeId));
}

export function getAlternative(altId: string) {
  const row = getDb().prepare('SELECT * FROM alternative WHERE id = ?').get(altId) as any;
  if (!row) throw new AppError('NOT_FOUND', `备选不存在: ${altId}`);
  return mapAlternative(row);
}

// ===== 评分 =====
export interface ScoreInput {
  caseId: string;
  scenarioRunId: string;
  weights?: Record<string, number>;
  actor: AuthUser;
}

/**
 * 评分顺序（方案 §05）：
 * 1. 事实完整性/新鲜度 → 2. 硬约束 → 3. 级联预测 → 4. 加权评分
 */
export function scoreAlternatives(input: ScoreInput) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(input.caseId) as any;
  if (!c) throw new AppError('NOT_FOUND', `案例不存在: ${input.caseId}`);
  const dt = getDecisionTypeForCase(input.caseId);
  const alts = db.prepare('SELECT * FROM alternative WHERE case_id = ?').all(input.caseId) as any[];
  if (!alts.length) throw new AppError('VALIDATION_ERROR', '案例尚无备选方案');

  const snapshot = c.snapshot_id ? getSnapshot(c.snapshot_id) : null;
  if (!snapshot) throw new AppError('PRECONDITION_FAILED', '缺少情境快照，请先执行定向');

  // 确保 scenario_run 存在（约束/评分结果外键引用它）；无推演时创建基线运行
  let scenarioRunId = input.scenarioRunId;
  const existingRun = db.prepare('SELECT id FROM scenario_run WHERE id = ?').get(scenarioRunId) as any;
  if (!existingRun) {
    scenarioRunId = newId('scn');
    db.prepare(`INSERT INTO scenario_run
      (id, case_id, alternative_id, overlay_json, inputs_json, outputs_json, metric_vector_json, diffs_json, status, run_by, created_at)
      VALUES (?,?,NULL,'{}','{}','{}','{}','[]','baseline',?,?)`).run(
      scenarioRunId, input.caseId, input.actor.username, nowIso()
    );
  }

  // 事实完整性：required_facts 必须能在快照、冻结对象或指标中找到
  const missingFacts: string[] = [];
  const caseObjects = db.prepare('SELECT frozen_payload_json FROM case_object WHERE case_id = ?').all(input.caseId) as any[];
  for (const fact of dt.requiredFacts as string[]) {
    const found =
      snapshot.objects.some((o: any) =>
        o.payload && o.payload[fact] !== undefined && o.payload[fact] !== null
      ) ||
      snapshot.metrics[fact] !== undefined ||
      caseObjects.some((c) => {
        const p = JSON.parse(c.frozen_payload_json || '{}');
        return p[fact] !== undefined && p[fact] !== null;
      });
    if (!found) missingFacts.push(fact);
  }
  const factsComplete = missingFacts.length === 0;
  const stale = snapshot.freshness?.some((f) => !f.fresh) ?? false;

  // 权重归一
  const criteria = dt.criteria as CriterionDef[];
  const rawWeights: Record<string, number> = {};
  for (const cr of criteria) {
    rawWeights[cr.key] = input.weights?.[cr.key] ?? cr.weight;
  }
  const totalWeight = Object.values(rawWeights).reduce((a, b) => a + Math.max(0, b), 0) || 1;
  const weightsVersion = `${dt.policyVersion}:${sha256(stableStringify(rawWeights)).slice(0, 12)}`;

  const results: Array<{
    alternativeId: string;
    name: string;
    feasible: boolean;
    constraints: ConstraintCheck[];
    metrics: Record<string, number>;
    scores: Array<{ criterionKey: string; raw: number; normalized: number; weight: number; weighted: number }>;
    totalScore: number;
    infeasibleReasons: string[];
  }> = [];

  // 先算所有备选的原始指标向量，便于 min-max 归一
  const metricVectors: Record<string, Record<string, number>> = {};
  const scenarioByAlt: Record<string, any> = {};
  for (const alt of alts) {
    const run = db.prepare(`SELECT * FROM scenario_run WHERE case_id = ? AND alternative_id = ?
      ORDER BY created_at DESC LIMIT 1`).get(input.caseId, alt.id) as any;
    const inputs = run ? JSON.parse(run.inputs_json || '{}') : {};
    scenarioByAlt[alt.id] = inputs.snapshotId === snapshot.id ? run : null;
    const ctx = buildScoreContext(snapshot, JSON.parse(alt.proposed_actions || '[]'),
      JSON.parse(alt.assumption_ids || '[]'), scenarioByAlt[alt.id]);
    const vec: Record<string, number> = {};
    for (const cr of criteria) {
      try {
        vec[cr.key] = Number(evaluate(cr.expression, ctx));
      } catch {
        vec[cr.key] = Number.NaN;
      }
    }
    metricVectors[alt.id] = vec;
  }

  // min-max 边界
  const bounds: Record<string, { min: number; max: number }> = {};
  for (const cr of criteria) {
    const values = Object.values(metricVectors).map((v) => v[cr.key]).filter((n) => Number.isFinite(n));
    bounds[cr.key] = {
      min: cr.min ?? (values.length ? Math.min(...values) : 0),
      max: cr.max ?? (values.length ? Math.max(...values) : 1),
    };
  }

  for (const alt of alts) {
    const proposed = JSON.parse(alt.proposed_actions || '[]');
    const ctx = buildScoreContext(snapshot, proposed, JSON.parse(alt.assumption_ids || '[]'), scenarioByAlt[alt.id]);
    // 硬约束（decision_type.constraints + 方案内附带约束）
    const constraintDefs = (dt.constraints as ConstraintDef[]).concat(
      (proposed as any[]).flatMap((p) => p.constraints ?? [])
    );
    const constraintResults = checkConstraints(constraintDefs, ctx);
    const hardFailed = constraintResults.filter((r) => r.severity === 'hard' && !r.passed);
    const softFailed = constraintResults.filter((r) => r.severity === 'soft' && !r.passed);

    const reasons = hardFailed.map((r) => r.message);
    if (!factsComplete) reasons.push(`缺少关键事实: ${missingFacts.join(', ')}`);
    if (stale) reasons.push('关键证据已过期，请重新定向');

    const vec = metricVectors[alt.id];
    const scores: Array<{ criterionKey: string; raw: number; normalized: number; weight: number; weighted: number }> = [];
    let totalScore = 0;
    for (const cr of criteria) {
      const raw = vec[cr.key];
      const normalized = normalizeValue(cr, raw, bounds[cr.key]);
      const weight = rawWeights[cr.key] / totalWeight;
      const weighted = normalized * weight * 100;
      scores.push({ criterionKey: cr.key, raw, normalized, weight, weighted });
      if (Number.isFinite(weighted)) totalScore += weighted;
    }

    const feasible = hardFailed.length === 0 && factsComplete && !stale;
    results.push({
      alternativeId: alt.id,
      name: alt.name,
      feasible,
      constraints: constraintResults,
      metrics: vec,
      scores,
      totalScore: Math.round(totalScore * 100) / 100,
      infeasibleReasons: reasons,
    });

    // 写约束结果
    for (const cr of constraintResults) {
      db.prepare(`INSERT INTO constraint_result
        (id, scenario_run_id, alternative_id, constraint_key, constraint_name, severity, passed, message, detail_json, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        newId('cst'), scenarioRunId, alt.id, cr.constraintKey, cr.name, cr.severity,
        cr.passed ? 1 : 0, cr.message, JSON.stringify(cr.detail ?? {}), nowIso()
      );
    }
    for (const s of scores) {
      const raw = Number.isFinite(s.raw) ? s.raw : 0;
      const normalized = Number.isFinite(s.normalized) ? s.normalized : 0;
      const weighted = Number.isFinite(s.weighted) ? s.weighted : 0;
      db.prepare(`INSERT INTO score_result
        (id, scenario_run_id, alternative_id, criterion_key, raw_value, normalized, weight, weighted, weights_version, created_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        newId('scr'), scenarioRunId, alt.id, s.criterionKey, raw, normalized, s.weight, weighted,
        weightsVersion, nowIso()
      );
    }
    // 更新备选状态
    db.prepare('UPDATE alternative SET status = ?, infeasible_reasons = ?, updated_at = ? WHERE id = ?')
      .run(feasible ? 'feasible' : 'infeasible', JSON.stringify(reasons), nowIso(), alt.id);
  }

  // 排序：可行优先，再按分数
  const ranking = [...results].sort((a, b) =>
    Number(b.feasible) - Number(a.feasible) || b.totalScore - a.totalScore
  );
  const winner = ranking.find((r) => r.feasible) ?? null;

  const scoreRunId = newId('srun');
  db.prepare(`INSERT INTO score_run
    (id, case_id, scenario_run_id, weights_json, ranking_json, winner_alternative_id, created_by, created_at, facts_json)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    scoreRunId, input.caseId, scenarioRunId,
    JSON.stringify({ raw: rawWeights, normalized: Object.fromEntries(Object.entries(rawWeights).map(([k, v]) => [k, v / totalWeight])) }),
    JSON.stringify(ranking), winner?.alternativeId ?? null, input.actor.username, nowIso(),
    JSON.stringify({ factsComplete, missingFacts, stale })
  );

  writeAudit({
    actor: input.actor.username, eventType: 'decision.scored', resourceType: 'decision_case',
    resourceId: input.caseId,
    after: { scoreRunId, winner: winner?.alternativeId ?? null, ranking: ranking.map((r) => ({ id: r.alternativeId, score: r.totalScore, feasible: r.feasible })) },
  });

  return {
    scoreRunId,
    factsComplete,
    missingFacts,
    stale,
    ranking,
    winnerAlternativeId: winner?.alternativeId ?? null,
    weights: Object.fromEntries(Object.entries(rawWeights).map(([k, v]) => [k, v / totalWeight])),
    weightsVersion,
  };
}

function normalizeValue(cr: CriterionDef, raw: number, bounds: { min: number; max: number }): number {
  if (!Number.isFinite(raw)) return 0;
  if (cr.normalize === 'fixed') return Math.max(0, Math.min(1, raw));
  if (cr.normalize === 'target' && cr.target !== undefined) {
    // 距目标越近越好
    const span = Math.max(Math.abs((cr.max ?? cr.target * 2) - cr.target), 1e-9);
    const dist = Math.abs(raw - cr.target) / span;
    return cr.direction === 'lower_better' ? Math.max(0, 1 - dist) : Math.max(0, 1 - dist);
  }
  // min-max
  const { min, max } = bounds;
  const span = max - min;
  if (Math.abs(span) < 1e-12) return 0.5;
  const n = (raw - min) / span;
  return cr.direction === 'lower_better' ? 1 - n : n;
}

function buildScoreContext(snapshot: any, proposedActions: any[], assumptionIds: string[], run?: any) {
  const assumptions = (snapshot.assumptions ?? []).filter((a: any) => assumptionIds.includes(a.id));
  const overlay = run ? JSON.parse(run.overlay_json || '{}') : {};
  const objects = (snapshot.objects ?? []).map((o: any) => ({
    ...o, payload: { ...(o.payload ?? {}), ...(overlay[o.objectId] ?? {}) },
  }));
  const root = objects.find((o: any) => o.isRoot) ?? objects[0] ?? {};
  return {
    object: root.payload ?? {},
    root,
    objects: Object.fromEntries(objects.map((o: any) => [o.objectId, o])),
    metrics: { ...(snapshot.metrics ?? {}), ...(run ? JSON.parse(run.metric_vector_json || '{}') : {}) },
    links: snapshot.links ?? [],
    proposed: proposedActions,
    actions: proposedActions,
    assumptions,
    assumptionCount: assumptions.length,
    now: nowIso(),
  };
}

// ===== 决策记录 =====
export function recordDecision(input: {
  caseId: string;
  selectedAlternativeId: string;
  rationale: string;
  dissent?: string;
  actor: AuthUser;
}) {
  assertReadableText(input.rationale, '决策理由');
  assertReadableText(input.dissent, '不同意见');
  const db = getDb();
  const c = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(input.caseId) as any;
  if (!c) throw new AppError('NOT_FOUND', `案例不存在: ${input.caseId}`);
  // 决策记录属提案职责
  const dt = getDecisionTypeForCase(input.caseId);
  requireRole(input.actor, dt.roleMatrix.propose ?? ['analyst']);
  if (['Closed', 'Cancelled'].includes(c.state)) {
    throw new AppError('STATE_TRANSITION_INVALID', `案例已${c.state}，不能再记录决策`, { state: c.state });
  }
  const alt = db.prepare('SELECT * FROM alternative WHERE id = ? AND case_id = ?')
    .get(input.selectedAlternativeId, input.caseId) as any;
  if (!alt) throw new AppError('NOT_FOUND', '备选方案不属于该案例');

  // 检查硬约束是否通过（不通过不可选）
  const infeasible = JSON.parse(alt.infeasible_reasons || '[]');
  if (alt.status !== 'feasible' && alt.status !== 'selected') {
    throw new AppError('CONSTRAINT_FAILED', `方案不可选: ${infeasible.join('; ')}`, { infeasible });
  }

  // 是否选择非最高分方案
  const lastScore = db.prepare(
    'SELECT * FROM score_run WHERE case_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(input.caseId) as any;
  if (!lastScore) throw new AppError('PRECONDITION_FAILED', '尚未评分，不能记录决策');
  const ranked = (JSON.parse(lastScore.ranking_json || '[]') as any[])
    .find((r) => r.alternativeId === input.selectedAlternativeId);
  if (!ranked?.feasible) throw new AppError('CONSTRAINT_FAILED', '所选方案未通过硬约束');
  const facts = JSON.parse(lastScore.facts_json || '{}');
  if (facts.factsComplete === false || facts.stale === true) {
    throw new AppError('PRECONDITION_FAILED', '关键事实缺失或过期，请重新定向');
  }
  const overridden = lastScore
    ? lastScore.winner_alternative_id !== input.selectedAlternativeId
    : false;

  const id = newId('drec');
  db.prepare(`INSERT INTO decision_record
    (id, case_id, selected_alternative_id, rationale, dissent, overridden, score_run_id, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    id, input.caseId, input.selectedAlternativeId, input.rationale, input.dissent ?? '',
    overridden ? 1 : 0, lastScore?.id ?? null, input.actor.username, nowIso()
  );
  writeAudit({
    actor: input.actor.username, eventType: 'decision.recorded', resourceType: 'decision_case',
    resourceId: input.caseId,
    after: { selected: input.selectedAlternativeId, overridden, rationale: input.rationale },
  });
  const after = db.prepare('SELECT state FROM decision_case WHERE id = ?').get(input.caseId) as any;
  return { decisionRecordId: id, overridden, state: after?.state ?? null };
}

// ===== 审批 =====
export function requestApproval(input: {
  caseId: string;
  alternativeId: string;
  actor: AuthUser;
  comment?: string;
}) {
  assertReadableText(input.comment, '审批备注');
  const db = getDb();
  const c = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(input.caseId) as any;
  if (!c) throw new AppError('NOT_FOUND', `案例不存在: ${input.caseId}`);
  assertTransition(c.state, 'PendingApproval');
  const dt = getDecisionTypeForCase(input.caseId);
  // 提交审批属提案动作：由提案人发起，审批人再决定（职责分离）
  requireRole(input.actor, dt.roleMatrix.propose ?? ['analyst']);
  const latestDecision = db.prepare('SELECT * FROM decision_record WHERE case_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(input.caseId) as any;
  if (!latestDecision) throw new AppError('PRECONDITION_FAILED', '尚未记录方案选择');
  if (input.alternativeId && latestDecision.selected_alternative_id !== input.alternativeId) {
    throw new AppError('CONFLICT', '审批方案与决策记录不一致');
  }
  input.alternativeId = latestDecision.selected_alternative_id;
  const alternative = db.prepare('SELECT proposed_actions FROM alternative WHERE id = ? AND case_id = ?')
    .get(input.alternativeId, input.caseId) as any;
  if (!alternative) throw new AppError('NOT_FOUND', '所选方案不存在');
  const actionVersions: Record<string, number> = {};
  for (const proposed of JSON.parse(alternative.proposed_actions || '[]') as Array<{ actionKey?: string }>) {
    if (!proposed.actionKey) continue;
    const action = db.prepare('SELECT version FROM action_type WHERE action_key = ? AND state = ?')
      .get(proposed.actionKey, 'published') as { version: number } | undefined;
    if (!action) throw new AppError('PRECONDITION_FAILED', `方案中的 Action 不可用: ${proposed.actionKey}`);
    actionVersions[proposed.actionKey] = action.version;
  }
  const approveRoles = dt.roleMatrix.approve ?? ['approver'];
  const id = newId('apr');
  // 完整保存审批角色列表，供列表页 canApprove 与 decideApproval 使用同一判定
  db.prepare(`INSERT INTO approval
    (id, case_id, alternative_id, requested_by, actor, decision, comment, required_role, status, invalidated_reason, created_at, decided_at, action_versions_json)
    VALUES (?,?,?,?,NULL,NULL,?,?, 'pending', '', ?, NULL, ?)`).run(
    id, input.caseId, input.alternativeId, input.actor.username,
    input.comment ?? '', JSON.stringify(approveRoles), nowIso(), JSON.stringify(actionVersions)
  );
  // 重新提交时使历史待审申请失效，避免同一案例同时存在多条可批准记录。
  const superseded = db.prepare(`UPDATE approval SET status = 'invalidated', invalidated_reason = ?
    WHERE case_id = ? AND id <> ? AND status = 'pending'`)
    .run('已由新的审批申请替代', input.caseId, id);
  if (superseded.changes > 0) {
    writeAudit({ actor: input.actor.username, eventType: 'approval.superseded',
      resourceType: 'decision_case', resourceId: input.caseId,
      detail: { newApprovalId: id, count: superseded.changes } });
  }
  db.prepare('UPDATE decision_case SET state = ?, updated_at = ? WHERE id = ?')
    .run('PendingApproval', nowIso(), input.caseId);
  writeAudit({
    actor: input.actor.username, eventType: 'approval.requested', resourceType: 'approval',
    resourceId: id, after: { caseId: input.caseId, alternativeId: input.alternativeId },
  });
  return mapApproval(db.prepare('SELECT * FROM approval WHERE id = ?').get(id));
}

export function decideApproval(input: {
  approvalId: string;
  decision: 'approved' | 'rejected';
  comment?: string;
  actor: AuthUser;
}) {
  assertReadableText(input.comment, '审批备注');
  const db = getDb();
  const apr = db.prepare('SELECT * FROM approval WHERE id = ?').get(input.approvalId) as any;
  if (!apr) throw new AppError('NOT_FOUND', `审批不存在: ${input.approvalId}`);
  if (apr.status !== 'pending') {
    throw new AppError('CONFLICT', `审批已处理: ${apr.status}`);
  }
  const c = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(apr.case_id) as any;
  if (c.state !== 'PendingApproval') throw new AppError('CONFLICT', '案例状态已变化，请重新提交审批');
  const frozen = db.prepare(`SELECT co.object_id, co.frozen_revision, oi.revision FROM case_object co
    JOIN object_instance oi ON oi.object_id = co.object_id WHERE co.case_id = ?`).all(apr.case_id) as any[];
  if (frozen.some((o) => o.frozen_revision !== o.revision)) {
    throw new AppError('CONFLICT', '事实快照已变化，请重新定向和评分');
  }
  const dt = getDecisionTypeForCase(apr.case_id);
  requireRole(input.actor, dt.roleMatrix.approve ?? ['approver']);
  const actionVersions = JSON.parse(apr.action_versions_json || '{}') as Record<string, number>;
  for (const [actionKey, version] of Object.entries(actionVersions)) {
    const current = db.prepare('SELECT version FROM action_type WHERE action_key = ? AND state = ?')
      .get(actionKey, 'published') as { version: number } | undefined;
    if (current?.version !== version) {
      db.prepare("UPDATE approval SET status = 'invalidated', invalidated_reason = ? WHERE id = ?")
        .run(`Action ${actionKey} 定义已变化`, apr.id);
      db.prepare("UPDATE decision_case SET state = 'OptionsReady', updated_at = ? WHERE id = ?")
        .run(nowIso(), apr.case_id);
      writeAudit({ actor: input.actor.username, eventType: 'approval.invalidated',
        resourceType: 'approval', resourceId: apr.id, detail: { actionKey, version } });
      throw new AppError('CONFLICT', `Action ${actionKey} 定义已变化，请重新评分和提交审批`);
    }
  }

  // 职责分离：提案人不能自批
  if (apr.requested_by === input.actor.username && !input.actor.roles.includes('admin')) {
    throw new AppError('FORBIDDEN', '提案人不能审批自己的方案（职责分离）');
  }

  const now = nowIso();
  db.prepare('UPDATE approval SET actor = ?, decision = ?, comment = ?, status = ?, decided_at = ? WHERE id = ?')
    .run(input.actor.username, input.decision, input.comment ?? '', input.decision, now, input.approvalId);

  if (input.decision === 'approved') {
    assertTransition(c.state, 'Approved');
    db.prepare('UPDATE decision_case SET state = ?, updated_at = ? WHERE id = ?')
      .run('Approved', now, apr.case_id);
  } else {
    assertTransition(c.state, 'OptionsReady');
    db.prepare('UPDATE decision_case SET state = ?, updated_at = ? WHERE id = ?')
      .run('OptionsReady', now, apr.case_id);
  }
  writeAudit({
    actor: input.actor.username, eventType: `approval.${input.decision}`, resourceType: 'approval',
    resourceId: input.approvalId,
    after: { decision: input.decision, comment: input.comment ?? '' },
  });
  return mapApproval(db.prepare('SELECT * FROM approval WHERE id = ?').get(input.approvalId));
}

// 审批后关键事实或对象修订发生变化 → 批准自动失效
export function invalidateApprovals(caseId: string, reason: string, actor: AuthUser) {
  const db = getDb();
  const caseRow = db.prepare('SELECT decision_type_key FROM decision_case WHERE id = ?').get(caseId) as any;
  if (!caseRow) throw new AppError('NOT_FOUND', `案例不存在: ${caseId}`);
  // 失效批准是监督动作：审批角色或提案角色均可触发（事实变化后强制重批）
  const dt = getDecisionTypeForCase(caseId);
  if (!hasRole(actor, dt.roleMatrix.approve ?? ['approver']) && !hasRole(actor, dt.roleMatrix.propose ?? ['analyst'])) {
    throw new AppError('FORBIDDEN', '仅提案/审批角色可使批准失效');
  }
  const rows = db.prepare(`SELECT * FROM approval WHERE case_id = ? AND status = 'approved'`).all(caseId) as any[];
  for (const r of rows) {
    db.prepare(`UPDATE approval SET status = 'invalidated', invalidated_reason = ? WHERE id = ?`)
      .run(reason, r.id);
  }
  const c = db.prepare('SELECT state FROM decision_case WHERE id = ?').get(caseId) as any;
  if (c && ['Approved', 'PendingApproval'].includes(c.state)) {
    db.prepare('UPDATE decision_case SET state = ?, updated_at = ? WHERE id = ?')
      .run('OptionsReady', nowIso(), caseId);
  }
  writeAudit({
    actor: actor.username, eventType: 'approval.invalidated', resourceType: 'decision_case',
    resourceId: caseId, detail: { reason, count: rows.length },
  });
  return { invalidated: rows.length, reason };
}

export function listPendingApprovals(user?: AuthUser, status?: string) {
  const where = status ? 'a.status = ?' : `a.status IN ('pending','approved','rejected','invalidated')`;
  const params: unknown[] = status ? [status] : [];
  const rows = getDb().prepare(
    `SELECT a.*, c.title AS case_title, c.case_key, c.state AS case_state, c.decision_type_key,
            c.security_labels,
            alt.name AS alternative_name
     FROM approval a
     JOIN decision_case c ON c.id = a.case_id
     LEFT JOIN alternative alt ON alt.id = a.alternative_id
     WHERE ${where} AND c.domain_id = ? ORDER BY a.created_at DESC LIMIT 200`
  ).all(...params, currentDomainId()) as any[];
  return rows.filter((r) => !user || clearanceAllows(user, JSON.parse(r.security_labels || '["PUBLIC"]'))).map((r) => {
    // 与 decideApproval 同一判定源：决策类型 roleMatrix.approve（含 admin 隐式放行）
    let approveRoles = parseRoleList(r.required_role);
    try {
      const dt = getDecisionTypeForCase(r.case_id);
      if (dt.roleMatrix?.approve?.length) approveRoles = dt.roleMatrix.approve;
    } catch {
      // 决策类型缺失时回退到审批快照中的角色列表
    }
    return {
      ...mapApproval(r),
      caseTitle: r.case_title,
      caseKey: r.case_key,
      caseState: r.case_state,
      alternativeName: r.alternative_name ?? null,
      requestedAt: r.created_at,
      requestedBy: r.requested_by,
      canApprove: user ? hasRole(user, approveRoles.length ? approveRoles : ['approver']) : true,
    };
  });
}
