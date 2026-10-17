// Outcome：预期/实际、偏差、归因与复盘，完成 OODA 反馈环
import { getDb, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import { writeAudit } from '../audit/audit-service';
import { AuthUser, requireRole, hasRole, clearanceAllows, redactFields } from '../auth/auth-service';
import { assertTransition, getDecisionTypeForCase } from '../decision/decision-service';
import { currentDomainId } from '../domains/domain-service';

export interface RecordOutcomeInput {
  caseId: string;
  expected: Record<string, number | string>;
  actual: Record<string, number | string>;
  metrics?: Record<string, unknown>;
  units?: Record<string, string>;
  evidenceRefs?: string[];
  reviewNotes?: string;
  attribution?: string;
  actor: AuthUser;
}

export function recordOutcome(input: RecordOutcomeInput) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(input.caseId) as any;
  if (!c) throw new AppError('NOT_FOUND', `案例不存在: ${input.caseId}`);

  // 结果记录属于 Act/Review 阶段：未执行或已终态的案例不允许补记结果
  const recordable = ['Executing', 'Completed', 'Failed', 'OutcomeReviewed'];
  if (!recordable.includes(c.state)) {
    throw new AppError('STATE_TRANSITION_INVALID', `当前状态 ${c.state} 不允许记录执行结果`, {
      state: c.state, allowed: recordable,
    });
  }
  // 记录结果由执行角色完成（与 roleMatrix.execute 一致）
  const dt = getDecisionTypeForCase(input.caseId);
  requireRole(input.actor, dt.roleMatrix.execute ?? ['operator']);

  const evidenceRefs = [...new Set(input.evidenceRefs ?? [])];
  if (!evidenceRefs.length) throw new AppError('VALIDATION_ERROR', '结果必须引用至少一条证据');
  const validEvidence = db.prepare(`SELECT e.id FROM evidence e JOIN case_object co ON co.object_id = e.object_id
    WHERE co.case_id = ?`).all(input.caseId) as Array<{ id: string }>;
  const allowedIds = new Set(validEvidence.map((e) => e.id));
  if (evidenceRefs.some((id) => !allowedIds.has(id))) {
    throw new AppError('VALIDATION_ERROR', '结果证据必须关联本案例对象');
  }
  const criteriaUnits = new Map((dt.criteria as Array<{ key: string; unit?: string }>)
    .filter((item) => item.unit).map((item) => [item.key, item.unit!]));
  for (const key of Object.keys(input.actual)) {
    const requiredUnit = criteriaUnits.get(key);
    if (requiredUnit && input.units?.[key] !== requiredUnit) {
      throw new AppError('VALIDATION_ERROR', `指标 ${key} 的单位应为 ${requiredUnit}`);
    }
  }

  // 无效单位或缺少证据时拒绝提交
  for (const [k, v] of Object.entries(input.actual)) {
    if (v === undefined || v === null || v === '') {
      throw new AppError('VALIDATION_ERROR', `实际结果缺少指标: ${k}`);
    }
    if (typeof v === 'number' && !Number.isFinite(v)) {
      throw new AppError('VALIDATION_ERROR', `指标 ${k} 不是有效数值`);
    }
  }
  if (!Object.keys(input.expected).length) {
    throw new AppError('VALIDATION_ERROR', '必须提供预期值以便计算偏差');
  }

  const deviation: Record<string, unknown> = {};
  for (const [k, exp] of Object.entries(input.expected)) {
    const act = input.actual[k];
    if (typeof exp === 'number' && typeof act === 'number') {
      deviation[k] = {
        expected: exp,
        actual: act,
        delta: act - exp,
        deltaPct: exp !== 0 ? Math.round(((act - exp) / Math.abs(exp)) * 10000) / 100 : null,
      };
    } else {
      deviation[k] = { expected: exp, actual: act, delta: act === exp ? 0 : 1 };
    }
  }

  const id = newId('out');
  db.prepare(`INSERT INTO outcome
    (id, case_id, expected_json, actual_json, deviation_json, metrics_json, review_notes,
     attribution, recorded_by, created_at, reviewed_at, evidence_refs, units_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,NULL,?,?)`).run(
    id, input.caseId, JSON.stringify(input.expected), JSON.stringify(input.actual),
    JSON.stringify(deviation), JSON.stringify(input.metrics ?? {}),
    input.reviewNotes ?? '', input.attribution ?? '', input.actor.username, nowIso(),
    JSON.stringify(evidenceRefs), JSON.stringify(input.units ?? {})
  );

  // 案例推进到 Completed（若还在 Executing）
  if (c.state === 'Executing') {
    assertTransition('Executing', 'Completed');
    db.prepare('UPDATE decision_case SET state = ?, updated_at = ? WHERE id = ?')
      .run('Completed', nowIso(), input.caseId);
  }

  writeAudit({
    actor: input.actor.username, eventType: 'outcome.recorded', resourceType: 'outcome',
    resourceId: id, after: { caseId: input.caseId, deviation },
  });
  return getOutcome(id);
}

export function getOutcome(outcomeId: string) {
  const row = getDb().prepare('SELECT * FROM outcome WHERE id = ?').get(outcomeId) as any;
  if (!row) throw new AppError('NOT_FOUND', `结果不存在: ${outcomeId}`);
  return {
    id: row.id,
    caseId: row.case_id,
    expected: JSON.parse(row.expected_json || '{}'),
    actual: JSON.parse(row.actual_json || '{}'),
    deviation: JSON.parse(row.deviation_json || '{}'),
    metrics: JSON.parse(row.metrics_json || '{}'),
    reviewNotes: row.review_notes,
    attribution: row.attribution,
    recordedBy: row.recorded_by,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    evidenceRefs: JSON.parse(row.evidence_refs || '[]'),
    units: JSON.parse(row.units_json || '{}'),
  };
}

export function reviewOutcome(outcomeId: string, reviewNotes: string, attribution: string, actor: AuthUser) {
  const db = getDb();
  const o = getOutcome(outcomeId);
  const c = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(o.caseId) as any;
  if (!c) throw new AppError('NOT_FOUND', `案例不存在: ${o.caseId}`);
  // 复盘属于审批/监督职责：与 decideApproval 同一角色源
  const dt = getDecisionTypeForCase(o.caseId);
  requireRole(actor, dt.roleMatrix.approve ?? ['approver']);
  db.prepare('UPDATE outcome SET review_notes = ?, attribution = ?, reviewed_at = ? WHERE id = ?')
    .run(reviewNotes, attribution, nowIso(), outcomeId);
  // 案例推进到 OutcomeReviewed
  if (c.state === 'Completed') {
    assertTransition('Completed', 'OutcomeReviewed');
    db.prepare('UPDATE decision_case SET state = ?, updated_at = ? WHERE id = ?')
      .run('OutcomeReviewed', nowIso(), o.caseId);
  }
  writeAudit({
    actor: actor.username, eventType: 'outcome.reviewed', resourceType: 'outcome',
    resourceId: outcomeId, after: { reviewNotes, attribution },
  });
  return getOutcome(outcomeId);
}

export function closeCase(caseId: string, actor: AuthUser) {
  const db = getDb();
  const c = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(caseId) as any;
  if (!c) throw new AppError('NOT_FOUND', `案例不存在: ${caseId}`);
  // 关闭案例需审批角色（或案例负责人）
  const dt = getDecisionTypeForCase(caseId);
  if (!hasRole(actor, dt.roleMatrix.approve ?? ['approver']) && actor.username !== c.owner) {
    throw new AppError('FORBIDDEN', '仅审批角色或案例负责人可关闭案例');
  }
  assertTransition(c.state, 'Closed');
  db.prepare('UPDATE decision_case SET state = ?, updated_at = ?, closed_at = ? WHERE id = ?')
    .run('Closed', nowIso(), nowIso(), caseId);
  writeAudit({
    actor: actor.username, eventType: 'case.closed', resourceType: 'decision_case', resourceId: caseId,
  });
  return { caseId, state: 'Closed' };
}

export function listOutcomes(caseId?: string, user?: AuthUser) {
  const db = getDb();
  const domainId = currentDomainId();
  const rows = caseId
    ? db.prepare('SELECT o.* FROM outcome o JOIN decision_case c ON c.id = o.case_id WHERE o.case_id = ? AND c.domain_id = ? ORDER BY o.created_at DESC').all(caseId, domainId) as any[]
    : db.prepare('SELECT o.* FROM outcome o JOIN decision_case c ON c.id = o.case_id WHERE c.domain_id = ? ORDER BY o.created_at DESC LIMIT 100').all(domainId) as any[];
  return rows.filter((r) => {
    if (!user) return true;
    const c = db.prepare('SELECT security_labels FROM decision_case WHERE id = ?').get(r.case_id) as any;
    return c && clearanceAllows(user, JSON.parse(c.security_labels || '["PUBLIC"]'));
  }).map((r) => user ? redactFields(user, getOutcome(r.id)) : getOutcome(r.id));
}

// 预测 vs 实际对比，用于触发下一轮 Observe
export function comparePredictedVsActual(caseId: string) {
  const db = getDb();
  const scoreRun = db.prepare(
    'SELECT * FROM score_run WHERE case_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(caseId) as any;
  const outcome = db.prepare(
    'SELECT * FROM outcome WHERE case_id = ? ORDER BY created_at DESC LIMIT 1'
  ).get(caseId) as any;
  if (!scoreRun || !outcome) {
    return { hasComparison: false, message: '缺少评分或结果记录' };
  }
  const ranking = JSON.parse(scoreRun.ranking_json || '[]');
  const selected = ranking.find((r: any) => r.alternativeId === scoreRun.winner_alternative_id);
  const deviation = JSON.parse(outcome.deviation_json || '{}');
  return {
    hasComparison: true,
    predictedMetrics: selected?.metrics ?? {},
    predictedScore: selected?.totalScore ?? null,
    actual: JSON.parse(outcome.actual_json || '{}'),
    deviation,
  };
}
