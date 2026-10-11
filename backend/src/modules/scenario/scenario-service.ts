// Scenario Engine：基于当前快照的隔离沙盒、方案差异与级联规则重算
// 覆盖值不修改正式对象
import { getDb, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import { getSnapshot } from '../situation/situation-service';
import { computeDerivedMetrics } from '../rules/rule-service';
import { writeAudit } from '../audit/audit-service';
import { AuthUser } from '../auth/auth-service';

export interface ScenarioInput {
  caseId: string;
  alternativeId: string;
  /** 对象字段覆盖：{ objectId: { field: value } } */
  overlay?: Record<string, Record<string, unknown>>;
  /** 指标覆盖，用于假设推演 */
  metricOverlay?: Record<string, unknown>;
  runBy: AuthUser;
}

export interface ScenarioResult {
  id: string;
  caseId: string;
  alternativeId: string | null;
  overlay: Record<string, Record<string, unknown>>;
  metricVector: Record<string, unknown>;
  diffs: Array<{ objectId: string; field: string; from: unknown; to: unknown }>;
  outputs: {
    metrics: Record<string, unknown>;
    projectedActions: any[];
    notes: string[];
  };
  status: string;
  createdAt: string;
}

// 在隔离沙盒中推演：不写对象表
export function runScenario(input: ScenarioInput): ScenarioResult {
  const db = getDb();
  const c = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(input.caseId) as any;
  if (!c) throw new AppError('NOT_FOUND', `案例不存在: ${input.caseId}`);
  if (!c.snapshot_id) throw new AppError('PRECONDITION_FAILED', '缺少情境快照，请先定向');

  const snapshot = getSnapshot(c.snapshot_id);
  const alt = input.alternativeId
    ? db.prepare('SELECT * FROM alternative WHERE id = ? AND case_id = ?').get(input.alternativeId, input.caseId) as any
    : null;

  const overlay = input.overlay ?? {};
  const diffs: ScenarioResult['diffs'] = [];

  // 应用覆盖（仅内存）
  const sandboxObjects = snapshot.objects.map((o: any) => {
    const ov = overlay[o.objectId];
    if (!ov) return { ...o };
    const patched = { ...o, payload: { ...(o.payload ?? {}) } };
    for (const [field, value] of Object.entries(ov)) {
      diffs.push({
        objectId: o.objectId,
        field,
        from: (o.payload ?? {})[field],
        to: value,
      });
      patched.payload[field] = value;
    }
    return patched;
  });

  // 级联规则重算
  const root = sandboxObjects.find((o: any) => o.isRoot) || sandboxObjects[0] || {};
  const ctx = {
    object: root.payload ?? {},
    root,
    objects: Object.fromEntries(sandboxObjects.map((o: any) => [o.objectId, o])),
    links: snapshot.links,
    metrics: { ...snapshot.metrics, ...(input.metricOverlay ?? {}) },
    proposed: alt ? JSON.parse(alt.proposed_actions || '[]') : [],
    actions: alt ? JSON.parse(alt.proposed_actions || '[]') : [],
    now: nowIso(),
  };
  const { metrics: recomputed, errors } = computeDerivedMetrics(ctx);

  // 合并指标覆盖
  const metricVector: Record<string, unknown> = {
    ...recomputed,
    ...(input.metricOverlay ?? {}),
  };
  const notes: string[] = [];
  if (Object.keys(errors).length) {
    notes.push(`规则错误: ${Object.keys(errors).join(', ')}`);
  }
  if (diffs.length) {
    notes.push(`沙盒覆盖 ${diffs.length} 处字段，正式对象未变更`);
  }

  const id = newId('scn');
  const result: ScenarioResult = {
    id,
    caseId: input.caseId,
    alternativeId: input.alternativeId || null,
    overlay,
    metricVector,
    diffs,
    outputs: {
      metrics: metricVector,
      projectedActions: alt ? JSON.parse(alt.proposed_actions || '[]') : [],
      notes,
    },
    status: 'completed',
    createdAt: nowIso(),
  };

  db.prepare(`INSERT INTO scenario_run
    (id, case_id, alternative_id, overlay_json, inputs_json, outputs_json, metric_vector_json, diffs_json, status, run_by, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, input.caseId, input.alternativeId || null,
    JSON.stringify(overlay),
    JSON.stringify({ metricOverlay: input.metricOverlay ?? {}, snapshotId: snapshot.id }),
    JSON.stringify(result.outputs),
    JSON.stringify(metricVector),
    JSON.stringify(diffs),
    'completed', input.runBy.username, nowIso()
  );

  writeAudit({
    actor: input.runBy.username, eventType: 'scenario.run', resourceType: 'scenario_run',
    resourceId: id, after: { caseId: input.caseId, alternativeId: input.alternativeId, diffCount: diffs.length },
  });

  return result;
}

export function getScenarioRun(runId: string) {
  const row = getDb().prepare('SELECT * FROM scenario_run WHERE id = ?').get(runId) as any;
  if (!row) throw new AppError('NOT_FOUND', `推演不存在: ${runId}`);
  return {
    id: row.id,
    caseId: row.case_id,
    alternativeId: row.alternative_id,
    overlay: JSON.parse(row.overlay_json || '{}'),
    inputs: JSON.parse(row.inputs_json || '{}'),
    outputs: JSON.parse(row.outputs_json || '{}'),
    metricVector: JSON.parse(row.metric_vector_json || '{}'),
    diffs: JSON.parse(row.diffs_json || '[]'),
    status: row.status,
    runBy: row.run_by,
    createdAt: row.created_at,
  };
}

export function listScenarioRuns(caseId: string) {
  const rows = getDb().prepare(
    'SELECT * FROM scenario_run WHERE case_id = ? ORDER BY created_at DESC'
  ).all(caseId) as any[];
  return rows.map((r) => ({
    id: r.id,
    alternativeId: r.alternative_id,
    status: r.status,
    runBy: r.run_by,
    createdAt: r.created_at,
    diffCount: JSON.parse(r.diffs_json || '[]').length,
  }));
}

// 比较多个备选的推演结果
export function compareAlternatives(caseId: string) {
  const db = getDb();
  const alts = db.prepare('SELECT * FROM alternative WHERE case_id = ?').all(caseId) as any[];
  const runs = db.prepare('SELECT * FROM scenario_run WHERE case_id = ?').all(caseId) as any[];
  const comparisons = alts.map((a) => {
    const lastRun = runs.filter((r) => r.alternative_id === a.id).sort((x, y) =>
      String(y.created_at).localeCompare(String(x.created_at))
    )[0];
    const constraintRows = lastRun
      ? db.prepare('SELECT * FROM constraint_result WHERE scenario_run_id = ? AND alternative_id = ?').all(lastRun.id, a.id) as any[]
      : [];
    const scoreRows = lastRun
      ? db.prepare('SELECT * FROM score_result WHERE scenario_run_id = ? AND alternative_id = ?').all(lastRun.id, a.id) as any[]
      : [];
    return {
      alternativeId: a.id,
      name: a.name,
      status: a.status,
      infeasibleReasons: JSON.parse(a.infeasible_reasons || '[]'),
      proposedActions: JSON.parse(a.proposed_actions || '[]'),
      lastRun: lastRun ? {
        id: lastRun.id,
        metricVector: JSON.parse(lastRun.metric_vector_json || '{}'),
        diffs: JSON.parse(lastRun.diffs_json || '[]'),
        createdAt: lastRun.created_at,
      } : null,
      constraints: constraintRows.map((r) => ({
        key: r.constraint_key, name: r.constraint_name,
        severity: r.severity, passed: !!r.passed, message: r.message,
      })),
      scores: scoreRows.map((r) => ({
        criterionKey: r.criterion_key, raw: r.raw_value,
        normalized: r.normalized, weight: r.weight, weighted: r.weighted,
      })),
    };
  });
  return { caseId, alternatives: comparisons };
}

// 校验：覆盖不得落库（测试与审计用）
export function assertNoOverlayLeak(caseId: string, beforeObjectRevisions: Record<string, number>) {
  const db = getDb();
  const rows = db.prepare('SELECT object_id, revision FROM object_instance').all() as any[];
  for (const r of rows) {
    const before = beforeObjectRevisions[r.object_id];
    if (before !== undefined && r.revision !== before) {
      throw new AppError('CONFLICT', `推演意外修改了正式对象 ${r.object_id}`);
    }
  }
  void caseId;
}
