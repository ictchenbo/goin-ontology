// 种子数据：用户、三个场景配置、样例案例
// 军事与公共安全样板复用相同引擎，只新增模型、规则、表单配置和合成样例数据
import { getDb, nowIso } from '../db/database';
import { runMigrations } from '../db/migrate';
import { newId } from '../shared/ids';
import { createUser, AuthUser } from '../modules/auth/auth-service';
import { createType, createLinkDef, publishType, getType, createTypeVersion,
  publishVersionWithMigration } from '../modules/ontology/ontology-service';
import { upsertActionType } from '../modules/actions/action-service';
import { createObject, createLink, updateObject } from '../modules/objects/object-service';
import { upsertRule } from '../modules/rules/rule-service';
import { upsertDecisionType, createCase, createAlternative, transitionCase } from '../modules/decision/decision-service';
import { buildSituationSnapshot } from '../modules/situation/situation-service';
import { recordSource, attachEvidence } from '../modules/sources/source-service';
import { scenarioPacks, sharedOntologyTypes } from './scenario-configs';

const SYSTEM_ACTOR = 'system';

function seedUsers(): AuthUser[] {
  const db = getDb();
  const existing = db.prepare('SELECT COUNT(*) AS c FROM users').get() as any;
  if (existing.c > 0) {
    // 已有用户则构造映射
    const rows = db.prepare('SELECT * FROM users').all() as any[];
    return rows.map((r) => ({
      id: r.id, username: r.username, displayName: r.display_name,
      roles: JSON.parse(r.roles || '[]'), securityClearance: r.security_clearance || 'PUBLIC',
    }));
  }
  const users = [
    { username: 'admin', displayName: '系统管理员', password: 'admin123', roles: ['admin' as const], securityClearance: 'TOP_SECRET' },
    { username: 'analyst', displayName: '业务分析师', password: 'analyst123', roles: ['analyst' as const], securityClearance: 'CONFIDENTIAL' },
    { username: 'approver', displayName: '审批人', password: 'approver123', roles: ['approver' as const], securityClearance: 'CONFIDENTIAL' },
    { username: 'operator', displayName: '执行人', password: 'operator123', roles: ['operator' as const], securityClearance: 'PUBLIC' },
    { username: 'observer', displayName: '观察员', password: 'observer123', roles: ['observer' as const], securityClearance: 'PUBLIC' },
    { username: 'intel', displayName: '情报参谋', password: 'intel123', roles: ['intelligence' as const, 'analyst' as const], securityClearance: 'SECRET' },
    { username: 'commander', displayName: '指挥员', password: 'commander123', roles: ['commander' as const, 'approver' as const], securityClearance: 'SECRET' },
    { username: 'safety', displayName: '安全审查员', password: 'safety123', roles: ['safety_officer' as const, 'approver' as const], securityClearance: 'CONFIDENTIAL' },
    { username: 'legal', displayName: '法律审核', password: 'legal123', roles: ['legal' as const, 'approver' as const], securityClearance: 'CONFIDENTIAL' },
  ];
  return users.map((u) => createUser(u));
}

function seedScenarioPack(packKey: string, actor: AuthUser): Record<string, string[]> {
  const pack = scenarioPacks.find((p) => p.key === packKey);
  if (!pack) throw new Error(`未知场景: ${packKey}`);
  const db = getDb();

  // 幂等：若已有该场景对象则跳过类型创建
  const typeExists = db.prepare('SELECT COUNT(*) AS c FROM ontology_type WHERE type_key = ?')
    .get(pack.types[0].typeKey) as any;

  for (const t of [...sharedOntologyTypes, ...pack.types]) {
    const exists = db.prepare('SELECT type_key FROM ontology_type WHERE type_key = ?').get(t.typeKey);
    if (!exists) {
      createType({
        typeKey: t.typeKey,
        displayName: t.displayName,
        description: t.description ?? '',
        category: t.category,
        definition: t.definition,
        createdBy: actor.username,
      });
      publishType(t.typeKey, actor.username, '场景初始化发布');
    } else if (packKey === 'military' && ['CommandOrder', 'Acknowledgement'].includes(t.typeKey)) {
      const current = getType(t.typeKey);
      const missing = t.definition.properties.some((p) =>
        !current.publishedDefinition.properties.some((old: { name: string }) => old.name === p.name));
      if (missing && current.currentVersion === 1) {
        const created = createTypeVersion(t.typeKey, t.definition, actor.username,
          { changeNote: '演训指令与回执关联字段' });
        publishVersionWithMigration(t.typeKey, created.currentVersion + 1, actor.username);
      }
    }
  }
  for (const l of pack.links) {
    const exists = db.prepare('SELECT link_key FROM link_def WHERE link_key = ?').get(l.linkKey);
    if (!exists) {
      createLinkDef({ ...l, actor: actor.username });
    }
  }
  if (!typeExists.c) {
    for (const r of pack.rules) {
      upsertRule({
        ruleKey: r.ruleKey,
        name: r.name,
        kind: r.kind as any,
        description: r.description,
        expression: r.expression,
        outputType: r.outputType,
        scopeType: r.scopeType,
        testCases: r.testCases as any,
      }, actor.username);
    }
    for (const a of pack.actionTypes) {
      upsertActionType(a as any, actor.username);
    }
    for (const d of pack.decisionTypes) {
      upsertDecisionType(d as any, actor.username);
    }
  }
  if (packKey === 'military' && typeExists.c) {
    // 仅升级尚未由用户修改的早期演训 Action 定义。
    for (const action of pack.actionTypes) {
      const old = db.prepare('SELECT version FROM action_type WHERE action_key = ?').get(action.actionKey) as any;
      if (old?.version === 1) upsertActionType(action as any, actor.username);
    }
  }

  // 创建对象（幂等：按 title 查重）
  const objectIds: string[] = [];
  for (const o of pack.objects) {
    const existingObj = db.prepare(
      'SELECT object_id FROM object_instance WHERE type_key = ? AND title = ? AND deleted = 0'
    ).get(o.typeKey, o.title ?? '') as any;
    if (existingObj) {
      objectIds.push(existingObj.object_id);
      continue;
    }
    const created = createObject({
      typeKey: o.typeKey,
      title: o.title,
      payload: o.payload,
      securityLabels: o.securityLabels,
      actor: actor.username,
      reason: '场景种子数据',
    });
    objectIds.push(created.objectId);
  }

  // 建立链接（幂等：检查是否已有同 key 的链接对）
  for (const l of pack.linksData) {
    const fromId = objectIds[l.fromIndex];
    const toId = objectIds[l.toIndex];
    if (!fromId || !toId) continue;
    const existingLink = db.prepare(
      'SELECT id FROM link_instance WHERE link_key = ? AND from_object_id = ? AND to_object_id = ? AND is_valid = 1'
    ).get(l.linkKey, fromId, toId) as any;
    if (existingLink) continue;
    try {
      createLink({ linkKey: l.linkKey, fromObjectId: fromId, toObjectId: toId, props: l.props, actor: actor.username });
    } catch (e) {
      console.warn(`[seed] 链接创建失败 ${l.linkKey}: ${(e as Error).message}`);
    }
  }

  // 来源与证据（给关键对象挂证据）
  if (!typeExists.c) {
    const sampleEvents = pack.objects.filter((o) => ['Disruption', 'IntelReport', 'ObservedEvent'].includes(o.typeKey));
    sampleEvents.forEach((o, i) => {
      const observedAt = String(o.payload.observedAt ?? o.payload.detectedAt ?? o.payload.eventTime ?? nowIso());
      const src = recordSource({
        sourceKey: pack.key,
        externalKey: `${pack.key}-seed-${i}`,
        sourceType: 'manual',
        observedAt,
        confidence: Number(o.payload.confidence ?? 0.8),
        purpose: pack.key === 'public-safety' ? 'public_safety_review' : '',
        expiresAt: pack.key === 'public-safety'
          ? new Date(Date.parse(observedAt) + 180 * 86400000).toISOString() : undefined,
        raw: o.payload,
        actor: actor.username,
      });
      const idx = pack.objects.indexOf(o);
      const objId = objectIds[idx];
      if (objId && src.id) {
        attachEvidence({
          objectId: objId,
          sourceId: src.id,
          claim: pack.key === 'public-safety'
            ? String(o.payload.description ?? o.title ?? o.typeKey)
            : `种子来源：${o.title ?? o.typeKey}`,
          observedAt,
          actor: actor.username,
        });
        if (pack.key === 'public-safety' && i === 1 && objectIds[2]) {
          attachEvidence({ objectId: objectIds[2], sourceId: src.id,
            claim: '独立巡逻记录反驳初始提示', stance: 'refute', observedAt, actor: actor.username });
        }
      }
    });
  }

  return { objectIds };
}

function seedSampleCase(packKey: string, analyst: AuthUser, objectIds: string[]) {
  const pack = scenarioPacks.find((p) => p.key === packKey);
  if (!pack?.sampleCase) return null;
  const db = getDb();
  const sc = pack.sampleCase;

  // 幂等：按标题查重，但只复用未终态的样例案例；已关闭/取消则重建一份供演示
  const existing = db.prepare(
    `SELECT id, state FROM decision_case
     WHERE title = ? AND state NOT IN ('Closed','Cancelled')
     ORDER BY created_at DESC LIMIT 1`
  ).get(sc.title) as any;
  if (existing) return existing.id;

  const rootObjectId = objectIds[sc.triggerObjectIndex];
  const caseRow = createCase({
    decisionTypeKey: sc.decisionTypeKey,
    title: sc.title,
    summary: sc.summary,
    triggerRef: rootObjectId,
    rootObjectId,
    owner: analyst.username,
    actor: analyst,
  });

  // 定向：构建情境快照（深度 5 以覆盖库存、销售订单等关键事实）
  buildSituationSnapshot({
    caseId: caseRow.id,
    rootObjectId,
    depth: 5,
    maxAgeDays: 30,
    actor: analyst,
    assumptions: packKey === 'military'
      ? [{ statement: '假设 24 小时内无新增情报', confidence: 0.6, owner: analyst.username }]
      : packKey === 'public-safety'
        ? [{ statement: '假设市民反映所述时间地点准确', confidence: 0.5, owner: analyst.username }]
        : [{ statement: '假设港口拥堵持续 5 天', confidence: 0.7, owner: analyst.username }],
  });

  // 创建备选：为拟议动作注入 objectId（种子配置中用占位，落库时替换为真实对象 ID）
  for (const [altIndex, alt] of sc.alternatives.entries()) {
    const proposedActions = (alt.proposedActions ?? []).map((pa: any) => {
      const params = { ...(pa.params ?? {}) };
      if (!params.objectId) params.objectId = rootObjectId;
      if (packKey === 'military' && pa.actionKey === 'mil_issue_order') {
        params.coaObjectId = objectIds[4 + altIndex];
      }
      return { ...pa, params };
    });
    createAlternative({
      caseId: caseRow.id,
      name: alt.name,
      description: alt.description,
      proposedActions,
      actor: analyst,
    });
  }

  // 状态推进到 OptionsReady（备选就绪）
  transitionCase(caseRow.id, 'Observed', analyst, '完成观察');
  transitionCase(caseRow.id, 'Oriented', analyst, '完成定向');
  transitionCase(caseRow.id, 'OptionsReady', analyst, '备选方案就绪');

  return caseRow.id;
}

export function seedAll() {
  runMigrations();
  const users = seedUsers();
  // 新建演示库先迁移后建用户，补齐初始领域的成员关系。
  const addInitialMember = getDb().prepare(`INSERT OR IGNORE INTO application_domain_member
    (domain_id, user_id, created_at) VALUES ('dom_existing', ?, ?)`);
  for (const user of users) addInitialMember.run(user.id, nowIso());
  const byName = Object.fromEntries(users.map((u) => [u.username, u]));
  console.log(`[seed] 用户: ${users.map((u) => u.username).join(', ')}`);

  const admin = byName.admin;
  const analyst = byName.analyst;

  for (const pack of scenarioPacks) {
    console.log(`[seed] 场景: ${pack.name}`);
    const { objectIds } = seedScenarioPack(pack.key, admin);
    const caseActor = pack.key === 'military' ? byName.intel : analyst;
    const caseId = seedSampleCase(pack.key, caseActor, objectIds);
    if (caseId) console.log(`[seed]  样例案例: ${caseId}`);
  }

  console.log('[seed] 完成');
}

// CLI 入口
if (require.main === module) {
  try {
    seedAll();
  } catch (e) {
    console.error('[seed] 失败:', e);
    process.exit(1);
  }
}
