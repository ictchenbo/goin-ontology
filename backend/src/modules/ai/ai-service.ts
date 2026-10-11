// 可选建议适配器：结果始终停留在人工审查阶段，不写入正式对象或执行 Action。
import { z } from 'zod';
import { getDb, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import { AuthUser, requireCaseAccess, requireRole, clearanceAllows, redactFields } from '../auth/auth-service';
import { getCase, getDecisionTypeForCase } from '../decision/decision-service';
import { getSnapshot } from '../situation/situation-service';
import { writeAudit } from '../audit/audit-service';

const responseSchema = z.object({
  text: z.string().min(1),
  citations: z.array(z.string()).default([]),
  constraintsMentioned: z.array(z.string()).default([]),
  alternatives: z.array(z.record(z.unknown())).default([]),
  modelVersion: z.string().default('unknown'),
});

export type SuggestionKind = 'explain' | 'missing_facts' | 'alternative_draft';

export function evaluateSuggestionContent(
  content: z.infer<typeof responseSchema>, evidenceIds: string[], hardConstraintKeys: string[], kind: SuggestionKind
) {
  const checks = {
    citationValid: content.citations.length > 0 && content.citations.every((id) => evidenceIds.includes(id)),
    constraintCoverage: hardConstraintKeys.every((key) => content.constraintsMentioned.includes(key)),
    proposalQuality: content.text.trim().length >= 20 &&
      (kind !== 'alternative_draft' || content.alternatives.length > 0),
    factualReview: 'requires_human_review',
  };
  return { checks, passed: checks.citationValid && checks.constraintCoverage && checks.proposalQuality };
}

export async function requestSuggestion(caseId: string, kind: SuggestionKind, actor: AuthUser) {
  requireRole(actor, ['admin', 'analyst', 'commander', 'safety_officer']);
  requireCaseAccess(actor, caseId);
  if (!['explain', 'missing_facts', 'alternative_draft'].includes(kind)) {
    throw new AppError('VALIDATION_ERROR', '建议类型无效');
  }
  const address = process.env.AI_ADAPTER_URL;
  if (!address) throw new AppError('PRECONDITION_FAILED', '未配置 AI 建议适配器');
  const url = new URL(address);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw new AppError('VALIDATION_ERROR', 'AI 适配器须使用 HTTPS（本机测试除外）');
  }
  const decisionCase = getCase(caseId, actor);
  if (!decisionCase.snapshotId) throw new AppError('PRECONDITION_FAILED', '请先形成情境快照');
  const snapshot = getSnapshot(decisionCase.snapshotId, actor);
  const decisionType = getDecisionTypeForCase(caseId);
  const evidenceIds = snapshot.objects.flatMap((o: any) => (o.evidence ?? []).map((e: any) => e.evidenceId));
  const hardKeys = decisionType.constraints.filter((c: any) => c.severity === 'hard').map((c: any) => c.key);
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(process.env.AI_ADAPTER_KEY ? { authorization: `Bearer ${process.env.AI_ADAPTER_KEY}` } : {}),
    },
    body: JSON.stringify({ kind, caseId, promptVersion: 'v1', snapshot,
      constraints: decisionType.constraints, requiredFacts: decisionType.requiredFacts }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new AppError('EXTERNAL_ERROR', `AI 适配器返回 HTTP ${response.status}`);
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new AppError('EXTERNAL_ERROR', 'AI 适配器响应格式无效');
  const content = parsed.data;
  const evaluation = evaluateSuggestionContent(content, evidenceIds, hardKeys, kind);
  const id = newId('ais');
  const db = getDb();
  db.transaction(() => {
    db.prepare(`INSERT INTO ai_suggestion
      (id, case_id, kind, prompt_version, model_version, input_labels, content_json,
       status, correction_note, created_at, created_by)
      VALUES (?,?,?,'v1',?,?,?,'suggestion','',?,?)`).run(id, caseId, kind, content.modelVersion,
      JSON.stringify(decisionCase.securityLabels), JSON.stringify(content), nowIso(), actor.username);
    db.prepare(`INSERT INTO ai_evaluation
      (id, suggestion_id, checks_json, passed, reviewed_by, created_at) VALUES (?,?,?,?,?,?)`)
      .run(newId('aiev'), id, JSON.stringify(evaluation.checks), evaluation.passed ? 1 : 0, '', nowIso());
    writeAudit({ actor: actor.username, eventType: 'ai.suggestion.created',
      resourceType: 'ai_suggestion', resourceId: id,
      detail: { caseId, kind, evaluationPassed: evaluation.passed } });
  })();
  return getSuggestion(id, actor);
}

export function getSuggestion(id: string, actor: AuthUser) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ai_suggestion WHERE id = ?').get(id) as any;
  if (!row) throw new AppError('NOT_FOUND', '建议不存在');
  requireCaseAccess(actor, row.case_id);
  if (!clearanceAllows(actor, JSON.parse(row.input_labels || '["PUBLIC"]'))) {
    throw new AppError('FORBIDDEN', '无权查看此建议');
  }
  const evaluations = db.prepare('SELECT * FROM ai_evaluation WHERE suggestion_id = ? ORDER BY created_at')
    .all(id) as any[];
  return { id: row.id, caseId: row.case_id, kind: row.kind, promptVersion: row.prompt_version,
    modelVersion: row.model_version, inputLabels: JSON.parse(row.input_labels || '[]'),
    content: redactFields(actor, JSON.parse(row.content_json || '{}')), status: row.status,
    correctionNote: row.correction_note, createdAt: row.created_at, createdBy: row.created_by,
    evaluations: evaluations.map((e) => ({ checks: JSON.parse(e.checks_json), passed: !!e.passed,
      reviewedBy: e.reviewed_by, createdAt: e.created_at })) };
}

export function listSuggestions(caseId: string, actor: AuthUser) {
  requireCaseAccess(actor, caseId);
  return (getDb().prepare('SELECT id FROM ai_suggestion WHERE case_id = ? ORDER BY created_at DESC')
    .all(caseId) as any[]).map((r) => getSuggestion(r.id, actor));
}

export function reviewSuggestion(id: string, status: 'accepted' | 'corrected' | 'rejected', note: string, actor: AuthUser) {
  requireRole(actor, ['admin', 'analyst', 'commander', 'safety_officer']);
  getSuggestion(id, actor);
  if (!['accepted', 'corrected', 'rejected'].includes(status)) throw new AppError('VALIDATION_ERROR', '复核状态无效');
  if ((status === 'corrected' || status === 'rejected') && !note.trim()) {
    throw new AppError('VALIDATION_ERROR', '纠正或拒绝须说明原因');
  }
  getDb().prepare('UPDATE ai_suggestion SET status = ?, correction_note = ? WHERE id = ?')
    .run(status, note, id);
  writeAudit({ actor: actor.username, eventType: 'ai.suggestion.reviewed',
    resourceType: 'ai_suggestion', resourceId: id, detail: { status, note } });
  return getSuggestion(id, actor);
}
