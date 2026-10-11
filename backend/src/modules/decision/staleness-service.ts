// 事实变化使依赖旧快照的批准失效，并要求重新定向。
import { getDb, nowIso } from '../../db/database';
import { writeAudit } from '../audit/audit-service';

export function invalidateCasesForObject(objectId: string, reason: string, actor: string): number {
  const db = getDb();
  const rows = db.prepare(`SELECT DISTINCT c.id, c.state FROM decision_case c
    JOIN case_object co ON co.case_id = c.id
    WHERE co.object_id = ? AND c.state NOT IN ('Closed', 'Cancelled')`).all(objectId) as any[];
  let invalidated = 0;
  for (const row of rows) {
    const result = db.prepare(`UPDATE approval SET status = 'invalidated', invalidated_reason = ?
      WHERE case_id = ? AND status IN ('pending', 'approved')`).run(reason, row.id);
    if (result.changes === 0) continue;
    db.prepare(`UPDATE decision_case SET state = 'Observed', updated_at = ? WHERE id = ?`).run(nowIso(), row.id);
    writeAudit({ actor, eventType: 'approval.invalidated', resourceType: 'decision_case',
      resourceId: row.id, detail: { reason, objectId, count: result.changes } });
    invalidated += result.changes;
  }
  return invalidated;
}
