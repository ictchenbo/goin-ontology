// Situation Engine：事实快照、规则计算、冲突及新鲜度
import { getDb, nowIso } from '../../db/database';
import { currentDomainId } from '../domains/domain-service';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import { getNeighborhood, getObject } from '../objects/object-service';
import { computeDerivedMetrics, listRules } from '../rules/rule-service';
import { evaluateBoolean } from '../../shared/rule-dsl';
import { checkFreshness } from '../sources/source-service';
import { writeAudit } from '../audit/audit-service';
import { AuthUser, clearanceAllows, mergeLabels, redactFields, requireCaseAccess } from '../auth/auth-service';

export interface OrientInput {
  caseId: string;
  rootObjectId: string;
  depth?: number;
  maxAgeDays?: number;
  actor: AuthUser;
  assumptions?: Array<{ statement: string; confidence?: number; owner?: string }>;
}

export interface SituationSnapshot {
  id: string;
  caseId: string;
  kind: string;
  objects: any[];
  links: any[];
  metrics: Record<string, unknown>;
  ruleVersions: Record<string, number>;
  ruleChecks: Array<{
    objectId: string;
    ruleKey: string;
    name: string;
    description: string;
    version: number;
    expression: string;
    inputDeps: string[];
    matched: boolean | null;
    error?: string;
  }> | null;
  conflicts: Array<{ kind: string; message: string; refs: string[] }>;
  assumptions: any[];
  freshness: { fresh: boolean; ageDays: number }[];
  createdAt: string;
}

// 为 Decision Case 构建情境快照：冻结对象修订、模型版本、规则版本和证据引用
export function buildSituationSnapshot(input: OrientInput): SituationSnapshot {
  const db = getDb();
  const caseRow = db.prepare('SELECT * FROM decision_case WHERE id = ?').get(input.caseId) as any;
  if (!caseRow) throw new AppError('NOT_FOUND', `案例不存在: ${input.caseId}`);
  requireCaseAccess(input.actor, input.caseId);
  if (caseRow.trigger_ref && input.rootObjectId !== caseRow.trigger_ref) {
    throw new AppError('VALIDATION_ERROR', '情境根对象必须与案例触发对象一致');
  }

  const depth = input.depth ?? 2;
  const maxAgeDays = input.maxAgeDays ?? 7;
  const modelRef = JSON.parse(caseRow.model_version_ref || '{}');
  const frozenPolicy = modelRef.decisionTypeVersionId
    ? db.prepare('SELECT definition_json FROM decision_type_version WHERE id = ?')
      .get(modelRef.decisionTypeVersionId) as any : null;
  const currentPolicy = db.prepare('SELECT trigger_config FROM decision_type WHERE type_key = ?')
    .get(caseRow.decision_type_key) as any;
  const requiredPurpose = (frozenPolicy
    ? JSON.parse(frozenPolicy.definition_json).triggerConfig
    : JSON.parse(currentPolicy?.trigger_config || '{}')).requiredPurpose as string | undefined;

  // 提取关系邻域
  const nb = getNeighborhood(input.rootObjectId, depth, 80, input.actor);
  const objects: any[] = [];
  const freshness: { fresh: boolean; ageDays: number }[] = [];

  for (const node of nb.nodes) {
    // 密级裁剪
    if (!clearanceAllows(input.actor, node.securityLabels ?? [])) {
      objects.push({
        objectId: node.objectId,
        typeKey: node.typeKey,
        title: '(无权查看)',
        redacted: true,
        revision: 0,
      });
      continue;
    }
    const full = db.prepare('SELECT * FROM object_instance WHERE object_id = ?').get(node.objectId) as any;
    if (!full) continue;
    const evidence = db.prepare(
      `SELECT e.*, svr.observed_at AS src_observed, sr.source_key, svr.confidence AS src_conf,
              svr.security_labels AS source_labels, sr.status AS source_status,
              svr.expires_at AS source_expires, svr.purpose AS source_purpose
       FROM evidence e JOIN source_record sr ON sr.id = e.source_id
       JOIN source_record_revision svr ON svr.source_id = e.source_id AND svr.revision = e.source_revision
       WHERE e.object_id = ? AND e.status = 'active'`
    ).all(node.objectId).filter((e: any) =>
      clearanceAllows(input.actor, JSON.parse(e.source_labels || '["PUBLIC"]')) &&
      e.source_status === 'active' &&
      (!e.source_expires || Date.parse(e.source_expires) > Date.now()) &&
      (!requiredPurpose || e.source_purpose === requiredPurpose)
    ) as any[];
    for (const e of evidence) {
      const f = checkFreshness(e.observed_at || e.src_observed, maxAgeDays);
      freshness.push(f);
    }
    objects.push({
      objectId: node.objectId,
      typeKey: node.typeKey,
      typeDisplay: (db.prepare('SELECT display_name FROM ontology_type WHERE type_key = ?')
        .get(node.typeKey) as { display_name?: string } | undefined)?.display_name ?? node.typeKey,
      title: full.title,
      revision: full.revision,
      payload: JSON.parse(full.payload_json),
      securityLabels: JSON.parse(full.security_labels || '["PUBLIC"]'),
      isRoot: !!node.isRoot,
      evidenceCount: evidence.length,
      evidence: evidence.map((e) => ({
        evidenceId: e.id, sourceId: e.source_id, claim: e.claim,
        observedAt: e.observed_at, confidence: e.confidence,
        sourceRevision: e.source_revision,
        sourceKey: e.source_key, stance: e.stance,
        securityLabels: JSON.parse(e.source_labels || '["PUBLIC"]'),
      })),
      updatedAt: full.updated_at,
    });
  }

  // 计算派生指标
  const metricsCtx = buildMetricContext(objects, nb.edges);
  const { metrics, errors } = computeDerivedMetrics(metricsCtx);

  // 规则版本
  const ruleVersions: Record<string, number> = {};
  for (const r of listRules()) ruleVersions[r.ruleKey] = r.version;
  const ruleChecks: NonNullable<SituationSnapshot['ruleChecks']> = [];
  const capturedAt = nowIso();
  for (const rule of listRules('trigger').filter((item) => item.state === 'published' && item.scopeType)) {
    for (const object of objects.filter((item) => item.typeKey === rule.scopeType && !item.redacted)) {
      const check = {
        objectId: object.objectId,
        ruleKey: rule.ruleKey,
        name: rule.name,
        description: rule.description,
        version: rule.version,
        expression: rule.expression,
        inputDeps: rule.inputDeps,
        matched: null as boolean | null,
        error: undefined as string | undefined,
      };
      try {
        check.matched = evaluateBoolean(rule.expression,
          { object: object.payload, metrics, now: capturedAt });
      } catch (error) {
        check.error = error instanceof Error ? error.message : '规则求值失败';
      }
      ruleChecks.push(check);
    }
  }

  // 冲突检测：同类关键指标差异、证据矛盾标记、过期事实
  const conflicts = detectConflicts(objects, metrics, freshness, maxAgeDays);
  if (Object.keys(errors).length) {
    conflicts.push({ kind: 'rule_error', message: '部分规则计算失败', refs: Object.keys(errors) });
  }

  // 假设
  const assumptions: any[] = [];
  for (const a of input.assumptions ?? []) {
    const id = newId('asm');
    const now = nowIso();
    db.prepare(`INSERT INTO assumption (id, case_id, statement, confidence, status, owner, evidence_ref, created_at, updated_at)
      VALUES (?,?,?,?, 'open', ?, '', ?, ?)`).run(
      id, input.caseId, a.statement, a.confidence ?? 0.5, a.owner ?? input.actor.username, now, now
    );
    assumptions.push({ id, statement: a.statement, confidence: a.confidence ?? 0.5, status: 'open' });
  }

  // 保存快照
  const snapshotId = newId('snap');
  const modelVersionRef: Record<string, number> = {};
  for (const o of objects) {
    try {
      const tv = db.prepare(
        'SELECT schema_version FROM type_version WHERE type_key = ? AND state = ? ORDER BY schema_version DESC LIMIT 1'
      ).get(o.typeKey, 'published') as any;
      if (tv) modelVersionRef[o.typeKey] = tv.schema_version;
    } catch { /* 忽略 */ }
  }

  const snapshot: SituationSnapshot = {
    id: snapshotId,
    caseId: input.caseId,
    kind: 'orient',
    objects,
    links: nb.edges.map((edge) => ({ ...edge,
      linkDisplay: (db.prepare('SELECT display_name FROM link_def WHERE link_key = ?')
        .get(edge.linkKey) as { display_name?: string } | undefined)?.display_name ?? edge.linkKey,
    })),
    metrics,
    ruleVersions,
    ruleChecks,
    conflicts,
    assumptions,
    freshness,
    createdAt: capturedAt,
  };

  const snapshotLabels = mergeLabels(
    JSON.parse(caseRow.security_labels || '["PUBLIC"]'),
    ...objects.map((o) => o.securityLabels ?? []),
    ...objects.flatMap((o) => (o.evidence ?? []).map((e: any) => e.securityLabels ?? []))
  );
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO case_snapshot
      (id, case_id, kind, objects_json, links_json, metrics_json, rule_versions_json, conflicts_json, assumptions_json, created_by, created_at, freshness_json, rule_checks_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      snapshotId, input.caseId, 'orient', JSON.stringify(objects), JSON.stringify(snapshot.links),
      JSON.stringify(metrics), JSON.stringify(ruleVersions), JSON.stringify(conflicts),
      JSON.stringify(assumptions), input.actor.username, capturedAt, JSON.stringify(freshness), JSON.stringify(ruleChecks)
    );
    // 更新案例快照指针与冻结对象
    db.prepare('UPDATE decision_case SET snapshot_id = ?, model_version_ref = ?, security_labels = ?, updated_at = ? WHERE id = ?')
      .run(snapshotId, JSON.stringify({ ...JSON.parse(caseRow.model_version_ref || '{}'),
        types: modelVersionRef, rules: ruleVersions }),
        JSON.stringify(snapshotLabels), nowIso(), input.caseId);
    for (const o of objects) {
      if (o.redacted) continue;
      db.prepare(`INSERT OR REPLACE INTO case_object
        (id, case_id, object_id, role, frozen_revision, frozen_payload_json, created_at, domain_id)
        VALUES (?,?,?,?,?,?,?,?)`).run(
        newId('cobj'), input.caseId, o.objectId,
        o.objectId === input.rootObjectId ? 'trigger' : 'related',
        o.revision, JSON.stringify(o.payload ?? {}), nowIso(), currentDomainId()
      );
    }
    writeAudit({
      actor: input.actor.username, eventType: 'case.oriented', resourceType: 'decision_case',
      resourceId: input.caseId, after: { snapshotId, objectCount: objects.length, conflictCount: conflicts.length },
    });
  });
  tx();

  return getSnapshot(snapshotId, input.actor);
}

export function getSnapshot(snapshotId: string, actor?: AuthUser): SituationSnapshot {
  const row = getDb().prepare('SELECT * FROM case_snapshot WHERE id = ?').get(snapshotId) as any;
  if (!row) throw new AppError('NOT_FOUND', `快照不存在: ${snapshotId}`);
  if (actor) requireCaseAccess(actor, row.case_id);
  const objects = JSON.parse(row.objects_json || '[]');
  const visibleObjects = actor ? objects.filter((o: any) => !o.securityLabels || clearanceAllows(actor, o.securityLabels))
    .map((o: any) => ({
      ...o,
      payload: o.payload ? redactFields(actor, o.payload, o.typeKey) : o.payload,
      evidence: (o.evidence ?? []).filter((e: any) => clearanceAllows(actor, e.securityLabels ?? ['PUBLIC'])),
    })) : objects;
  const visibleById = new Map<string, any>(visibleObjects.map((object: any) => [object.objectId, object]));
  const storedChecks: SituationSnapshot['ruleChecks'] = row.rule_checks_json === null
    ? null : JSON.parse(row.rule_checks_json || '[]');
  return {
    id: row.id,
    caseId: row.case_id,
    kind: row.kind,
    objects: visibleObjects.map((object: any) => ({ ...object,
      typeDisplay: object.typeDisplay ?? (getDb().prepare('SELECT display_name FROM ontology_type WHERE type_key = ?')
        .get(object.typeKey) as { display_name?: string } | undefined)?.display_name ?? object.typeKey,
    })),
    links: (JSON.parse(row.links_json || '[]') as any[])
      .filter((edge) => visibleById.has(edge.from) && visibleById.has(edge.to))
      .map((edge) => ({ ...edge,
        linkDisplay: edge.linkDisplay ?? (getDb().prepare('SELECT display_name FROM link_def WHERE link_key = ?')
          .get(edge.linkKey) as { display_name?: string } | undefined)?.display_name ?? edge.linkKey,
      })),
    metrics: JSON.parse(row.metrics_json || '{}'),
    ruleVersions: JSON.parse(row.rule_versions_json || '{}'),
    ruleChecks: storedChecks?.filter((check) => {
      const object = visibleById.get(check.objectId);
      if (!object) return false;
      return !actor || check.inputDeps.every((dependency) => {
        if (!dependency.startsWith('object.')) return true;
        const field = dependency.slice('object.'.length).split('.')[0];
        return Object.hasOwn(object.payload ?? {}, field);
      });
    }) ?? null,
    conflicts: JSON.parse(row.conflicts_json || '[]'),
    assumptions: JSON.parse(row.assumptions_json || '[]'),
    freshness: JSON.parse(row.freshness_json || '[]'),
    createdAt: row.created_at,
  };
}

export function listSnapshots(caseId: string) {
  const rows = getDb().prepare(
    'SELECT id, kind, created_by, created_at FROM case_snapshot WHERE case_id = ? ORDER BY created_at DESC'
  ).all(caseId) as any[];
  return rows;
}

function buildMetricContext(objects: any[], edges: any[]) {
  // 上下文结构：object[.字段] 直接访问 + metrics + links + counts
  const byId: Record<string, any> = {};
  for (const o of objects) byId[o.objectId] = o;
  const linkSummary: Record<string, number> = {};
  for (const e of edges) {
    linkSummary[e.linkKey] = (linkSummary[e.linkKey] || 0) + 1;
  }
  // 把根对象（isRoot）字段提升到顶层，便于规则简写
  const root = objects.find((o) => o.isRoot) || objects[0] || {};
  return {
    object: root.payload ?? {},
    root: root,
    objects: byId,
    links: linkSummary,
    objectCount: objects.length,
    metrics: {},
    now: nowIso(),
  };
}

function detectConflicts(
  objects: any[],
  metrics: Record<string, unknown>,
  freshness: { fresh: boolean; ageDays: number }[],
  maxAgeDays: number
) {
  const conflicts: SituationSnapshot['conflicts'] = [];
  const staleCount = freshness.filter((f) => !f.fresh).length;
  if (staleCount > 0) {
    conflicts.push({
      kind: 'stale_evidence',
      message: `${staleCount} 条证据超过新鲜度阈值 ${maxAgeDays} 天`,
      refs: [],
    });
  }
  // 同名指标在不同对象上取值差异过大（简单启发式）
  const numericFields = new Map<string, number[]>();
  for (const o of objects) {
    if (!o.payload) continue;
    for (const [k, v] of Object.entries(o.payload)) {
      if (typeof v === 'number') {
        const arr = numericFields.get(k) ?? [];
        arr.push(v);
        numericFields.set(k, arr);
      }
    }
  }
  for (const [k, arr] of numericFields) {
    if (arr.length >= 2) {
      const min = Math.min(...arr);
      const max = Math.max(...arr);
      if (max - min > 0 && min !== 0 && (max - min) / Math.abs(min) > 3) {
        conflicts.push({
          kind: 'value_divergence',
          message: `字段 ${k} 在关联对象间取值差异显著 (${min} ~ ${max})`,
          refs: [k],
        });
      }
    }
  }
  // 反证与支持证据并存，形成可回放的冲突提示。
  for (const o of objects) {
    const supporting = (o.evidence ?? []).filter((e: any) => e.stance !== 'refute');
    const refuting = (o.evidence ?? []).filter((e: any) => e.stance === 'refute');
    if (refuting.length) {
      conflicts.push({
        kind: 'counter_evidence',
        message: supporting.length ? '支持证据与反证并存，需人工复核' : '存在反证，需人工复核',
        refs: [...supporting, ...refuting].map((e: any) => e.evidenceId),
      });
    }
  }
  void metrics;
  return conflicts;
}

// 重新定向：刷新事实后返回“待重新定向”的案例到选项阶段前
export function reorientCase(caseId: string, actor: AuthUser, rootObjectId: string) {
  const db = getDb();
  const c = db.prepare('SELECT state FROM decision_case WHERE id = ?').get(caseId) as any;
  if (!c) throw new AppError('NOT_FOUND', `案例不存在: ${caseId}`);
  const snapshot = buildSituationSnapshot({ caseId, rootObjectId, actor });
  // 状态回到 Oriented
  db.prepare('UPDATE decision_case SET state = ?, updated_at = ? WHERE id = ?')
    .run('Oriented', nowIso(), caseId);
  writeAudit({
    actor: actor.username, eventType: 'case.reoriented', resourceType: 'decision_case',
    resourceId: caseId, after: { snapshotId: snapshot.id },
  });
  return snapshot;
}
