// 修复已确认的历史乱码；原文不可恢复，明确标记并保留审计记录。
import { getDb } from '../db/database';
import { writeAudit } from '../modules/audit/audit-service';

const caseId = 'case_j5dJxTTEK4azssm9';
const repairs = [
  {
    table: 'decision_record',
    id: 'drec_TidqKLHkaQeyPefr',
    column: 'rationale',
    expected: '�ۺϵ÷����',
    replacement: '原决策理由因历史编码损坏，原文无法恢复',
  },
  {
    table: 'approval',
    id: 'apr_8AKiSKztpHK38sZ9',
    column: 'comment',
    expected: '������',
    replacement: '原审批备注因历史编码损坏，原文无法恢复',
  },
] as const;

function main(): void {
  const db = getDb();
  const updated: string[] = [];
  const skipped: string[] = [];
  db.transaction(() => {
    for (const repair of repairs) {
      const row = db.prepare(`SELECT ${repair.column} AS text FROM ${repair.table} WHERE id = ? AND case_id = ?`)
        .get(repair.id, caseId) as { text: string } | undefined;
      if (!row) throw new Error(`未找到目标记录: ${repair.table}/${repair.id}`);
      if (row.text === repair.replacement) {
        skipped.push(repair.id);
        continue;
      }
      if (row.text !== repair.expected) {
        throw new Error(`记录内容与预期不符，停止修复: ${repair.table}/${repair.id}`);
      }
      db.prepare(`UPDATE ${repair.table} SET ${repair.column} = ? WHERE id = ? AND case_id = ?`)
        .run(repair.replacement, repair.id, caseId);
      writeAudit({
        actor: 'system', eventType: `${repair.table}.text_repaired`,
        resourceType: repair.table, resourceId: repair.id,
        before: { [repair.column]: row.text },
        after: { [repair.column]: repair.replacement },
        detail: { caseId, reason: '历史文本包含不可逆的编码替换字符，原文无法恢复' },
      });
      updated.push(repair.id);
    }
  })();
  console.log(JSON.stringify({ updated, skipped }));
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
