// 写入“城市燃气安全”演示领域：领域、成员、本体模型、对象、证据与两条演示案例
// 可重复运行；--dry-run 只预演并在结束时回滚。
import { closeDb, getDb, nowIso } from '../db/database';
import { runMigrations } from '../db/migrate';
import { createDomain, runInDomain, setDomainMember } from '../modules/domains/domain-service';
import { createLinkDef, createType, publishType } from '../modules/ontology/ontology-service';
import { upsertRule } from '../modules/rules/rule-service';
import { upsertFunction } from '../modules/functions/function-service';
import { upsertActionType, getActionType } from '../modules/actions/action-service';
import {
  createCase, createAlternative, transitionCase, scoreAlternatives, recordDecision,
  requestApproval, upsertDecisionType,
} from '../modules/decision/decision-service';
import { createLink, createObject } from '../modules/objects/object-service';
import { attachEvidence, recordSource } from '../modules/sources/source-service';
import { buildSituationSnapshot } from '../modules/situation/situation-service';
import type { AuthUser } from '../modules/auth/auth-service';
import {
  GAS_SEED_ACTOR, gasActionTypes, gasCases, gasDecisionType, gasDomain, gasEvidence,
  gasFunctions, gasLinks, gasLinksData, gasObjects, gasRules, gasSources, gasTypes,
  type DemoCase,
} from './urban-gas-demo-config';

class DryRunRollback extends Error {}

function loadUsers(): AuthUser[] {
  const rows = getDb().prepare('SELECT * FROM users WHERE disabled = 0').all() as any[];
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    roles: JSON.parse(row.roles || '[]'),
    securityClearance: row.security_clearance || 'PUBLIC',
  }));
}

/** 相对时间占位符：@now-2h → 当前时间减 2 小时 */
function resolveTime(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const match = /^@now(?:-(\d+)h)?$/.exec(value);
  if (!match) return value;
  const hours = Number(match[1] ?? 0);
  return new Date(Date.now() - hours * 3600_000).toISOString();
}

function withRelativeTimes(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => [key, resolveTime(value)]));
}

/** 把方案参数中的 @对象键 替换为真实对象 ID */
function resolveParams(params: Record<string, unknown>, objectIds: Map<string, string>, triggerId: string) {
  const resolved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' && value.startsWith('@')) {
      const objectId = objectIds.get(value.slice(1));
      if (!objectId) throw new Error(`方案参数引用了未定义的对象: ${value}`);
      resolved[key] = objectId;
    } else {
      resolved[key] = value;
    }
  }
  if (!resolved.objectId) resolved.objectId = triggerId;
  return resolved;
}

function ensureModel(domainId: string, actor: string) {
  const db = getDb();
  const summary = { types: 0, links: 0, rules: 0, functions: 0, actions: 0, decisionTypes: 0 };

  for (const type of gasTypes) {
    const existing = db.prepare('SELECT domain_id FROM ontology_type WHERE type_key = ?')
      .get(type.typeKey) as { domain_id: string } | undefined;
    if (existing) {
      if (existing.domain_id !== domainId) throw new Error(`对象类型标识已被其他领域占用: ${type.typeKey}`);
      continue;
    }
    createType({ ...type, createdBy: actor });
    publishType(type.typeKey, actor, '城市燃气演示领域初始化');
    summary.types++;
  }

  for (const link of gasLinks) {
    const existing = db.prepare('SELECT domain_id FROM link_def WHERE link_key = ?')
      .get(link.linkKey) as { domain_id: string } | undefined;
    if (existing) {
      if (existing.domain_id !== domainId) throw new Error(`关系标识已被其他领域占用: ${link.linkKey}`);
      continue;
    }
    createLinkDef({ ...link, actor });
    summary.links++;
  }

  for (const rule of gasRules) {
    const existing = db.prepare(`SELECT kind, description, expression, scope_type, test_cases
      FROM rule_def WHERE rule_key = ?`).get(rule.ruleKey) as any;
    const same = existing && existing.kind === rule.kind &&
      existing.expression === rule.expression && existing.scope_type === (rule.scopeType ?? '') &&
      existing.description === (rule.description ?? '') &&
      existing.test_cases === JSON.stringify(rule.testCases ?? []);
    if (!same) {
      upsertRule({ ...rule, outputType: rule.outputType ?? 'number' }, actor);
      summary.rules++;
    }
  }

  for (const fn of gasFunctions) {
    const existing = db.prepare(`SELECT parameters_json, expression, output_type FROM function_def
      WHERE function_key = ?`).get(fn.functionKey) as any;
    const same = existing && existing.parameters_json === JSON.stringify(fn.parameters) &&
      existing.expression === fn.expression && existing.output_type === (fn.outputType ?? 'number');
    if (!same) {
      upsertFunction(fn, actor);
      summary.functions++;
    }
  }

  for (const action of gasActionTypes) {
    const existing = db.prepare('SELECT action_key FROM action_type WHERE action_key = ?')
      .get(action.actionKey as string);
    if (!existing) {
      upsertActionType(action as any, actor);
      summary.actions++;
      continue;
    }
    const current = getActionType(action.actionKey as string);
    const same = current.name === action.name && current.description === (action.description ?? '') &&
      JSON.stringify(current.paramsSchema) === JSON.stringify(action.paramsSchema ?? {}) &&
      JSON.stringify(current.preconditions) === JSON.stringify(action.preconditions ?? []) &&
      JSON.stringify(current.writeSet) === JSON.stringify(action.writeSet ?? []) &&
      JSON.stringify(current.approvalPolicy) === JSON.stringify(action.approvalPolicy ?? {}) &&
      JSON.stringify(current.requiredRoles) === JSON.stringify(action.requiredRoles ?? ['operator']);
    if (!same) {
      upsertActionType(action as any, actor);
      summary.actions++;
    }
  }

  // 决策类型定义未变化时不升版本，避免重复导入产生冗余历史。
  const existingDecision = db.prepare(`SELECT domain_id, display_name, description, trigger_config,
    target_object_type, required_facts, role_matrix, policy_version, criteria, constraints, approval_route
    FROM decision_type WHERE type_key = ?`).get(gasDecisionType.typeKey) as any;
  const expectedDecision = {
    display_name: gasDecisionType.displayName,
    description: gasDecisionType.description ?? '',
    trigger_config: JSON.stringify((gasDecisionType as any).triggerConfig ?? {}),
    target_object_type: gasDecisionType.targetObjectType ?? '',
    required_facts: JSON.stringify(gasDecisionType.requiredFacts ?? []),
    role_matrix: JSON.stringify(gasDecisionType.roleMatrix ?? { propose: ['analyst'], approve: ['approver'], execute: ['operator'] }),
    policy_version: gasDecisionType.policyVersion ?? 'v1',
    criteria: JSON.stringify(gasDecisionType.criteria ?? []),
    constraints: JSON.stringify(gasDecisionType.constraints ?? []),
    approval_route: JSON.stringify((gasDecisionType as any).approvalRoute ?? []),
  };
  if (existingDecision && existingDecision.domain_id !== domainId) {
    throw new Error(`决策类型标识已被其他领域占用: ${gasDecisionType.typeKey}`);
  }
  const sameDecision = existingDecision &&
    Object.entries(expectedDecision).every(([key, value]) => existingDecision[key] === value);
  if (!sameDecision) {
    upsertDecisionType(gasDecisionType as any, actor);
    summary.decisionTypes++;
  }

  return summary;
}

function ensureObjects(domainId: string, actor: string) {
  const db = getDb();
  const objectIds = new Map<string, string>();
  let created = 0;
  for (const sample of gasObjects) {
    const existing = db.prepare(`SELECT object_id FROM object_instance
      WHERE domain_id = ? AND type_key = ? AND title = ? AND deleted = 0`)
      .get(domainId, sample.typeKey, sample.title) as { object_id: string } | undefined;
    if (existing) {
      objectIds.set(sample.key, existing.object_id);
      continue;
    }
    const object = createObject({
      typeKey: sample.typeKey,
      title: sample.title,
      payload: withRelativeTimes(sample.payload),
      actor,
      reason: '城市燃气演示领域样例',
      skipAutomation: true,
    });
    objectIds.set(sample.key, object.objectId);
    created++;
  }

  let links = 0;
  for (const link of gasLinksData) {
    const fromObjectId = objectIds.get(link.from);
    const toObjectId = objectIds.get(link.to);
    if (!fromObjectId || !toObjectId) throw new Error(`演示关系引用未定义对象: ${link.linkKey}`);
    const existing = db.prepare(`SELECT 1 FROM link_instance
      WHERE domain_id = ? AND link_key = ? AND from_object_id = ? AND to_object_id = ? AND is_valid = 1`)
      .get(domainId, link.linkKey, fromObjectId, toObjectId);
    if (existing) continue;
    createLink({ linkKey: link.linkKey, fromObjectId, toObjectId, actor });
    links++;
  }

  return { objectIds, created, links };
}

function ensureSources(actor: string) {
  const sourceIds = new Map<string, string>();
  let created = 0;
  for (const source of gasSources) {
    const observedAt = new Date(Date.now() + source.observedOffsetHours * 3600_000).toISOString();
    const result = recordSource({
      sourceKey: source.sourceKey,
      externalKey: source.externalKey,
      sourceType: source.sourceType,
      observedAt,
      confidence: source.confidence,
      purpose: source.purpose,
      raw: source.raw,
      actor,
    });
    sourceIds.set(source.key, result.id);
    if (!result.deduplicated) created++;
  }
  return { sourceIds, created };
}

function ensureEvidence(objectIds: Map<string, string>, sourceIds: Map<string, string>, actor: string) {
  const db = getDb();
  let created = 0;
  for (const item of gasEvidence) {
    const objectId = objectIds.get(item.objectKey);
    const sourceId = sourceIds.get(item.sourceKey);
    if (!objectId || !sourceId) throw new Error(`证据引用未定义对象或来源: ${item.objectKey}/${item.sourceKey}`);
    const existing = db.prepare(`SELECT 1 FROM evidence
      WHERE object_id = ? AND source_id = ? AND claim = ? AND status = 'active'`)
      .get(objectId, sourceId, item.claim);
    if (existing) continue;
    const observedAt = new Date(Date.now() + item.observedOffsetHours * 3600_000).toISOString();
    attachEvidence({ objectId, sourceId, claim: item.claim, observedAt, actor });
    created++;
  }
  return created;
}

function ensureCase(
  definition: DemoCase,
  objectIds: Map<string, string>,
  actor: AuthUser,
) {
  const db = getDb();
  const existing = db.prepare(`SELECT id, state FROM decision_case
    WHERE title = ? AND state NOT IN ('Closed', 'Cancelled') ORDER BY created_at DESC LIMIT 1`)
    .get(definition.title) as { id: string; state: string } | undefined;
  if (existing) return { caseId: existing.id, created: false, state: existing.state };

  const rootObjectId = objectIds.get(definition.triggerKey);
  if (!rootObjectId) throw new Error(`演示案例引用未定义对象: ${definition.triggerKey}`);

  const caseRow = createCase({
    decisionTypeKey: definition.decisionTypeKey,
    title: definition.title,
    summary: definition.summary,
    triggerRef: rootObjectId,
    rootObjectId,
    owner: actor.username,
    actor,
  });

  buildSituationSnapshot({
    caseId: caseRow.id,
    rootObjectId,
    depth: 5,
    maxAgeDays: 30,
    actor,
    assumptions: [],
  });

  const alternativesByName = new Map<string, string>();
  for (const alternative of definition.alternatives) {
    const proposedActions = alternative.proposedActions.map((proposed) => ({
      ...proposed,
      params: resolveParams((proposed.params ?? {}) as Record<string, unknown>, objectIds, rootObjectId),
    }));
    const created = createAlternative({
      caseId: caseRow.id,
      name: alternative.name,
      description: alternative.description,
      proposedActions,
      actor,
    });
    alternativesByName.set(alternative.name, created.id);
  }

  transitionCase(caseRow.id, 'Observed', actor, '完成观察');
  transitionCase(caseRow.id, 'Oriented', actor, '完成定向');
  transitionCase(caseRow.id, 'OptionsReady', actor, '备选方案就绪');

  if (definition.stage === 'PendingApproval') {
    const selectedName = definition.selectedAlternativeName;
    const selectedId = selectedName ? alternativesByName.get(selectedName) : undefined;
    if (!selectedId) throw new Error(`演示案例缺少已选方案: ${definition.title}`);
    scoreAlternatives({ caseId: caseRow.id, scenarioRunId: 'adhoc', weights: definition.weights, actor });
    recordDecision({
      caseId: caseRow.id,
      selectedAlternativeId: selectedId,
      rationale: definition.rationale ?? '',
      actor,
    });
    requestApproval({
      caseId: caseRow.id,
      alternativeId: selectedId,
      actor,
      comment: '演示数据：先派巡检班组核实，提交审批。',
    });
  }

  return { caseId: caseRow.id, created: true, state: definition.stage };
}

export function seedUrbanGasDemo(dryRun = false) {
  runMigrations();
  const db = getDb();
  const users = loadUsers();
  const admin = users.find((user) => user.username === 'admin') ?? users[0];
  const analyst = users.find((user) => user.username === 'analyst');
  if (!admin || !analyst) {
    throw new Error('缺少 admin/analyst 演示账号，请先运行 npm run seed 初始化账号');
  }

  const counts = {
    domain: '' as string,
    domainCreated: false,
    members: 0,
    types: 0, links: 0, rules: 0, functions: 0, actions: 0, decisionTypes: 0,
    objects: 0, objectLinks: 0, evidence: 0,
    cases: [] as Array<{ caseId: string; title: string; state: string; created: boolean }>,
  };

  const apply = db.transaction(() => {
    let domain = db.prepare('SELECT id, status FROM application_domain WHERE domain_key = ?')
      .get(gasDomain.domainKey) as { id: string; status: string } | undefined;
    if (domain && domain.status !== 'active') {
      throw new Error(`应用领域 ${gasDomain.domainKey} 已归档，请先在应用领域管理中恢复`);
    }
    if (!domain) {
      const created = createDomain(gasDomain, admin);
      domain = { id: created.id, status: created.status };
      counts.domainCreated = true;
    }
    counts.domain = domain.id;

    for (const user of users) {
      setDomainMember(domain.id, user.id, true);
      counts.members++;
    }

    runInDomain(domain.id, () => {
      const model = ensureModel(domain.id, GAS_SEED_ACTOR);
      counts.types = model.types;
      counts.links = model.links;
      counts.rules = model.rules;
      counts.functions = model.functions;
      counts.actions = model.actions;
      counts.decisionTypes = model.decisionTypes;

      const objects = ensureObjects(domain.id, GAS_SEED_ACTOR);
      counts.objects = objects.created;
      counts.objectLinks = objects.links;
      const sources = ensureSources(GAS_SEED_ACTOR);
      counts.evidence = ensureEvidence(objects.objectIds, sources.sourceIds, GAS_SEED_ACTOR);

      for (const definition of gasCases) {
        const owner = users.find((user) => user.username === definition.ownerUsername) ?? analyst;
        const result = ensureCase(definition, objects.objectIds, owner);
        counts.cases.push({ caseId: result.caseId, title: definition.title, state: result.state, created: result.created });
      }
    });

    if (dryRun) throw new DryRunRollback();
  });

  try {
    apply();
  } catch (error) {
    if (!(dryRun && error instanceof DryRunRollback)) throw error;
  }

  return {
    domainKey: gasDomain.domainKey,
    domainName: gasDomain.displayName,
    dryRun,
    seededAt: nowIso(),
    ...counts,
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(seedUrbanGasDemo(process.argv.includes('--dry-run')), null, 2));
  } catch (error) {
    console.error('[urban-gas-demo] 导入失败:', error);
    process.exitCode = 1;
  } finally {
    closeDb();
  }
}
