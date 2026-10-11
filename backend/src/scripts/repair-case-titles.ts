// 修复历史测试案例的已损坏标题；仅处理已核对的 ID 与替换字符。
import { getDb, nowIso } from '../db/database';
import { writeAudit } from '../modules/audit/audit-service';

const replacements: Array<{ id: string; title: string }> = [
  { id: 'case_F6ubncbmdC3qQrzr', title: '审批失效演示（历史案例 1）' },
  { id: 'case_tRxSC394n9WCK6gV', title: '审批失效演示（历史案例 2）' },
  { id: 'case_kWnnLTfShxgqJLza', title: 'E2E 新建案例（历史案例 1）' },
  { id: 'case_HmjhzHbaXKsE9hZj', title: 'E2E 新建案例（历史案例 2）' },
];

function main() {
  const db = getDb();
  const updated: string[] = [];
  const skipped: string[] = [];
  db.transaction(() => {
    for (const replacement of replacements) {
      const row = db.prepare('SELECT title FROM decision_case WHERE id = ?')
        .get(replacement.id) as { title: string } | undefined;
      if (!row || row.title === replacement.title) {
        skipped.push(replacement.id);
        continue;
      }
      if (!row.title.includes('\uFFFD')) {
        throw new Error(`案例 ${replacement.id} 的标题已被其他方式修改，停止修复`);
      }
      db.prepare('UPDATE decision_case SET title = ?, updated_at = ? WHERE id = ?')
        .run(replacement.title, nowIso(), replacement.id);
      writeAudit({
        actor: 'system', eventType: 'case.title_repaired', resourceType: 'decision_case',
        resourceId: replacement.id, before: { title: row.title }, after: { title: replacement.title },
        detail: {
          oldTitle: row.title,
          newTitle: replacement.title,
          reason: '历史标题含不可逆的编码替换字符，依据可识别片段与案例用途重新命名',
        },
      });
      updated.push(replacement.id);
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
