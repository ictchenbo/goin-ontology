// 案例导出：使用保存时的事实、规则和评分结果，不重新计算历史。
import { getDb, nowIso } from '../../db/database';
import { AuthUser, requireCaseAccess, requireRole, redactFields } from '../auth/auth-service';
import { getCase } from './decision-service';
import { getSnapshot } from '../situation/situation-service';
import { getScenarioRun } from '../scenario/scenario-service';
import { getHistory } from '../objects/object-service';
import { writeAudit } from '../audit/audit-service';

export function exportCaseReplay(caseId: string, actor: AuthUser) {
  requireRole(actor, ['admin', 'analyst', 'approver']);
  requireCaseAccess(actor, caseId);
  const db = getDb();
  const decisionCase = getCase(caseId, actor);
  const snapshotRows = db.prepare('SELECT id FROM case_snapshot WHERE case_id = ? ORDER BY created_at').all(caseId) as any[];
  const scenarioRows = db.prepare('SELECT id FROM scenario_run WHERE case_id = ? ORDER BY created_at').all(caseId) as any[];
  const scoreRows = db.prepare('SELECT * FROM score_run WHERE case_id = ? ORDER BY created_at').all(caseId) as any[];
  const decisions = db.prepare('SELECT * FROM decision_record WHERE case_id = ? ORDER BY created_at').all(caseId) as any[];
  const audits = db.prepare(`SELECT * FROM audit_event WHERE
    (resource_type = 'decision_case' AND resource_id = ?) OR
    (resource_type = 'approval' AND resource_id IN (SELECT id FROM approval WHERE case_id = ?)) OR
    (resource_type = 'action_run' AND resource_id IN (SELECT id FROM action_run WHERE case_id = ?)) OR
    (resource_type = 'outcome' AND resource_id IN (SELECT id FROM outcome WHERE case_id = ?))
    ORDER BY created_at`).all(caseId, caseId, caseId, caseId) as any[];
  const replay = {
    formatVersion: 1,
    exportedAt: nowIso(),
    case: decisionCase,
    snapshots: snapshotRows.map((r) => getSnapshot(r.id, actor)),
    scenarios: scenarioRows.map((r) => redactFields(actor, getScenarioRun(r.id))),
    scores: scoreRows.map((r) => ({
      id: r.id, scenarioRunId: r.scenario_run_id,
      weights: JSON.parse(r.weights_json || '{}'), ranking: JSON.parse(r.ranking_json || '[]'),
      facts: JSON.parse(r.facts_json || '{}'), winnerAlternativeId: r.winner_alternative_id,
      createdBy: r.created_by, createdAt: r.created_at,
    })).map((r) => redactFields(actor, r)),
    decisions: decisions.map((r) => ({
      id: r.id, alternativeId: r.selected_alternative_id, rationale: r.rationale,
      dissent: r.dissent, overridden: !!r.overridden, scoreRunId: r.score_run_id,
      createdBy: r.created_by, createdAt: r.created_at,
    })),
    objectHistory: decisionCase.caseObjects.map((o) => ({
      objectId: o.objectId, revisions: getHistory(o.objectId, actor),
    })),
    audit: audits.map((r) => ({
      id: r.id, actor: r.actor, eventType: r.event_type, resourceType: r.resource_type,
      resourceId: r.resource_id, beforeHash: r.before_hash, afterHash: r.after_hash,
      detail: redactFields(actor, JSON.parse(r.detail_json || '{}')), createdAt: r.created_at,
    })),
  };
  writeAudit({ actor: actor.username, eventType: 'case.exported', resourceType: 'decision_case',
    resourceId: caseId, detail: { formatVersion: 1 } });
  return replay;
}
