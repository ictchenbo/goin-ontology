// 将战场态势样板中的类型与关系补齐到现有应用领域，不改动用户对象。
import { closeDb, getDb } from '../db/database';
import { runMigrations } from '../db/migrate';
import { runInDomain } from '../modules/domains/domain-service';
import { createLinkDef, createType, getType, publishType } from '../modules/ontology/ontology-service';
import { scenarioPacks } from './scenario-configs';

class DryRunRollback extends Error {}

export function syncBattlefieldModel(dryRun = false) {
  runMigrations();
  const db = getDb();
  const domain = db.prepare("SELECT id FROM application_domain WHERE domain_key = 'battlefield' AND status = 'active'")
    .get() as { id: string } | undefined;
  if (!domain) throw new Error('战场态势应用领域不存在或已归档');
  const pack = scenarioPacks.find((item) => item.key === 'military');
  if (!pack) throw new Error('缺少军事场景定义');

  const createdTypes: string[] = [];
  const createdLinks: string[] = [];
  const apply = db.transaction(() => runInDomain(domain.id, () => {
    for (const type of pack.types) {
      const existing = db.prepare('SELECT domain_id FROM ontology_type WHERE type_key = ?')
        .get(type.typeKey) as { domain_id: string } | undefined;
      if (existing) {
        if (existing.domain_id !== domain.id) throw new Error(`对象类型标识已被其他领域占用: ${type.typeKey}`);
        const published = getType(type.typeKey).publishedDefinition.properties;
        if (type.definition.properties.some((property) => !published.some((current: { name: string; type: string }) =>
          current.name === property.name && current.type === property.type))) {
          throw new Error(`对象类型与样板定义不兼容: ${type.typeKey}`);
        }
        continue;
      }
      createType({ ...type, createdBy: 'system' });
      publishType(type.typeKey, 'system', '补齐战场态势基础模型');
      createdTypes.push(type.typeKey);
    }

    for (const link of pack.links) {
      const existing = db.prepare('SELECT domain_id, from_type, to_type, cardinality FROM link_def WHERE link_key = ?')
        .get(link.linkKey) as { domain_id: string; from_type: string; to_type: string; cardinality: string } | undefined;
      if (existing) {
        if (existing.domain_id !== domain.id || existing.from_type !== link.fromType ||
          existing.to_type !== link.toType || existing.cardinality !== (link.cardinality ?? '1:N')) {
          throw new Error(`关系定义与样板定义不兼容: ${link.linkKey}`);
        }
        continue;
      }
      createLinkDef({ ...link, actor: 'system' });
      createdLinks.push(link.linkKey);
    }
    if (dryRun) throw new DryRunRollback();
  }));

  try {
    apply();
  } catch (error) {
    if (!(dryRun && error instanceof DryRunRollback)) throw error;
  }
  return { domainId: domain.id, dryRun, createdTypes, createdLinks };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(syncBattlefieldModel(process.argv.includes('--dry-run')), null, 2));
  } catch (error) {
    console.error('[battlefield-model] 同步失败:', error);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
