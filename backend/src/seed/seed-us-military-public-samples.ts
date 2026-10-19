// 将可追溯的美国军力公开样例写入“战场态势”领域；可重复运行，也可先预演。
import { closeDb, getDb } from '../db/database';
import { runMigrations } from '../db/migrate';
import { runInDomain } from '../modules/domains/domain-service';
import { createLink, createObject } from '../modules/objects/object-service';
import { attachEvidence, recordSource } from '../modules/sources/source-service';
import { syncBattlefieldModel } from './sync-battlefield-model';
import { links, objects, sources, type SourceKey } from './us-military-public-samples';

const actor = 'public-data-seed';
class DryRunRollback extends Error {}

export function seedUsMilitaryPublicSamples(dryRun = false) {
  runMigrations();
  const db = getDb();
  const domain = db.prepare("SELECT id FROM application_domain WHERE domain_key = 'battlefield' AND status = 'active'")
    .get() as { id: string } | undefined;
  if (!domain) throw new Error('战场态势应用领域不存在或已归档');

  const counts = { modelTypes: 0, modelLinks: 0, sources: 0, objects: 0, evidence: 0, links: 0 };
  const apply = db.transaction(() => {
    // 与数据导入共用外层事务，预演时一并回滚缺失的模型定义。
    const model = syncBattlefieldModel();
    counts.modelTypes = model.createdTypes.length;
    counts.modelLinks = model.createdLinks.length;
    runInDomain(domain.id, () => {
    const observedAt = new Date().toISOString();
    const sourceIds = {} as Record<SourceKey, string>;
    for (const [key, source] of Object.entries(sources) as Array<[SourceKey, typeof sources[SourceKey]]>) {
      const result = recordSource({
        sourceKey: 'us-military-official-v1', externalKey: key, sourceType: 'official-publication',
        observedAt, purpose: '战场态势对象浏览公开资料样例', raw: source, actor,
      });
      sourceIds[key] = result.id;
      if (!result.deduplicated) counts.sources++;
    }

    const objectIds = new Map<string, string>();
    for (const sample of objects) {
      if (objectIds.has(sample.key)) throw new Error(`样例对象键重复: ${sample.key}`);
      const existing = db.prepare(`SELECT o.object_id, r.changed_by FROM object_instance o
        LEFT JOIN object_revision r ON r.object_id = o.object_id AND r.revision = 1
        WHERE o.domain_id = ? AND o.type_key = ? AND o.title = ? AND o.deleted = 0`)
        .all(domain.id, sample.typeKey, sample.title) as Array<{ object_id: string; changed_by: string | null }>;
      if (existing.length > 1 || (existing.length === 1 && existing[0].changed_by !== actor)) {
        throw new Error(`同名对象已存在且不属于此样例，停止以避免修改用户数据: ${sample.title}`);
      }
      const objectId = existing[0]?.object_id ?? createObject({
        typeKey: sample.typeKey, title: sample.title, payload: sample.payload,
        actor, reason: '导入美国军力公开资料样例', skipAutomation: true,
      }).objectId;
      if (!existing.length) counts.objects++;
      objectIds.set(sample.key, objectId);

      const sourceId = sourceIds[sample.source];
      const hasEvidence = db.prepare(`SELECT 1 FROM evidence WHERE object_id = ? AND source_id = ?
        AND claim = ? AND status = 'active'`).get(objectId, sourceId, sample.claim);
      if (!hasEvidence) {
        attachEvidence({ objectId, sourceId, claim: sample.claim, observedAt, actor });
        counts.evidence++;
      }
    }

    for (const link of links) {
      const fromObjectId = objectIds.get(link.from);
      const toObjectId = objectIds.get(link.to);
      if (!fromObjectId || !toObjectId) throw new Error(`样例关系引用未定义对象: ${link.linkKey}`);
      const existing = db.prepare(`SELECT 1 FROM link_instance WHERE domain_id = ? AND link_key = ?
        AND from_object_id = ? AND to_object_id = ? AND is_valid = 1`)
        .get(domain.id, link.linkKey, fromObjectId, toObjectId);
      if (existing) continue;
      createLink({
        linkKey: link.linkKey, fromObjectId, toObjectId, sourceId: sourceIds[link.source],
        props: link.note ? { note: link.note } : {}, actor,
      });
      counts.links++;
    }
    if (dryRun) throw new DryRunRollback();
    });
  });

  try {
    apply();
  } catch (error) {
    if (!(dryRun && error instanceof DryRunRollback)) throw error;
  }
  return { domainId: domain.id, dryRun, ...counts };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(seedUsMilitaryPublicSamples(process.argv.includes('--dry-run')), null, 2));
  } catch (error) {
    console.error('[us-military-samples] 导入失败:', error);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
