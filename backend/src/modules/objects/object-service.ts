// Object Store：对象、关系、历史、查询、局部图和证据
import { getDb, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import { stableHash } from '../../shared/hash';
import { writeAudit } from '../audit/audit-service';
import { validatePayload, getType, type PropertyDef } from '../ontology/ontology-service';
import { evaluateFunction } from '../functions/function-service';
import { clearanceAllows, redactFields, requireObjectAccess, AuthUser } from '../auth/auth-service';
import { invalidateCasesForObject } from '../decision/staleness-service';
import { currentDomainId } from '../domains/domain-service';

export interface ObjectInput {
  typeKey: string;
  title?: string;
  payload: Record<string, unknown>;
  securityLabels?: string[];
  actor: string;
  reason?: string;
  skipAutomation?: boolean;
}

export function createObject(input: ObjectInput) {
  const db = getDb();
  const type = getType(input.typeKey);
  if (type.state !== 'published') throw new AppError('PRECONDITION_FAILED', `对象类型尚未发布: ${input.typeKey}`);
  const payload = validatePayload(input.typeKey, input.payload);
  const title = input.title || buildTitle(input.typeKey, payload);
  const id = newId('obj');
  const now = nowIso();
  const labels = input.securityLabels ?? ['PUBLIC'];
  const schemaVersion = type.versions.find((v) => v.state === 'published')?.schemaVersion ?? 1;
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO object_instance
      (object_id, type_key, title, payload_json, revision, security_labels, created_at, updated_at, deleted, schema_version, domain_id)
      VALUES (?,?,?,?,1,?,?,?,0,?,?)`).run(
      id, input.typeKey, title, JSON.stringify(payload), JSON.stringify(labels), now, now, schemaVersion, currentDomainId()
    );
    db.prepare(`INSERT INTO object_revision
      (id, object_id, revision, payload_json, changed_fields, changed_by, change_reason, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      newId('rev'), id, 1, JSON.stringify(payload),
      JSON.stringify(Object.keys(payload)), input.actor, input.reason ?? '创建对象', now
    );
    writeAudit({
      actor: input.actor, eventType: 'object.created', resourceType: 'object',
      resourceId: id, after: payload,
    });
  });
  tx();
  if (!input.skipAutomation) {
    const { processObjectChange } = require('../automation/automation-service') as typeof import('../automation/automation-service');
    processObjectChange(id);
  }
  return getObject(id);
}

export function buildTitle(typeKey: string, payload: Record<string, unknown>): string {
  try {
    const def = getType(typeKey).publishedDefinition as any;
    if (def.titleTemplate) {
      return String(def.titleTemplate).replace(/\{(\w+)\}/g, (_m, k) => String(payload[k] ?? k));
    }
    if (def.displayProperty && payload[def.displayProperty] !== undefined) {
      return String(payload[def.displayProperty]);
    }
    const nameish = ['name', 'title', 'code', 'id', 'event_id', 'report_id', 'case_number', 'order_no'];
    for (const k of nameish) if (payload[k] !== undefined) return String(payload[k]);
    const businessId = Object.keys(payload).find((key) => /(?:Id|Code|_id|_code)$/.test(key) &&
      payload[key] !== undefined && payload[key] !== null && payload[key] !== '');
    if (businessId) return String(payload[businessId]);
  } catch { /* 类型未注册时忽略 */ }
  return `${typeKey}-${stableHash(payload).slice(0, 8)}`;
}

export interface WriteObjectInput {
  objectId: string;
  payload: Record<string, unknown>;
  title?: string;
  expectedRevision?: number;
  actor: string;
  reason?: string;
  /** Action 引擎调用时跳过重复审计 */
  skipAudit?: boolean;
  skipAutomation?: boolean;
}

// 更新对象：比较 revision，历史修订只追加
export function updateObject(input: WriteObjectInput) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM object_instance WHERE object_id = ? AND deleted = 0 AND domain_id = ?')
    .get(input.objectId, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', `对象不存在: ${input.objectId}`);
  if (input.expectedRevision !== undefined && input.expectedRevision !== row.revision) {
    throw new AppError('CONFLICT', `对象修订冲突: 当前 ${row.revision}, 期望 ${input.expectedRevision}`, {
      currentRevision: row.revision,
      expectedRevision: input.expectedRevision,
    });
  }
  const before = JSON.parse(row.payload_json);
  const merged = { ...before, ...input.payload };
  const payload = validatePayload(row.type_key, merged);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(payload)])].filter(
    (k) => JSON.stringify(payload[k]) !== JSON.stringify(before[k])
  );
  const title = input.title !== undefined ? (input.title.trim() || buildTitle(row.type_key, payload)) :
    input.payload.title !== undefined ? String(input.payload.title) :
    row.title === buildTitle(row.type_key, before) ? buildTitle(row.type_key, payload) : row.title;
  if (title !== row.title) changed.push('__title');
  if (!changed.length) return getObject(input.objectId);
  const newRev = row.revision + 1;
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(`UPDATE object_instance SET payload_json = ?, revision = ?, title = ?, updated_at = ?
      WHERE object_id = ?`).run(JSON.stringify(payload), newRev, title, now, input.objectId);
    db.prepare(`INSERT INTO object_revision
      (id, object_id, revision, payload_json, changed_fields, changed_by, change_reason, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      newId('rev'), input.objectId, newRev, JSON.stringify(payload),
      JSON.stringify(changed), input.actor, input.reason ?? '', now
    );
    if (!input.skipAudit) {
      writeAudit({
        actor: input.actor, eventType: 'object.updated', resourceType: 'object',
        resourceId: input.objectId, before, after: payload,
        detail: { changedFields: changed, reason: input.reason ?? '' },
      });
      invalidateCasesForObject(input.objectId, `对象 ${input.objectId} 修订已更新`, input.actor);
    }
  });
  tx();
  if (!input.skipAutomation && !input.skipAudit) {
    const { processObjectChange } = require('../automation/automation-service') as typeof import('../automation/automation-service');
    processObjectChange(input.objectId);
  }
  return getObject(input.objectId);
}

// 删除默认采取失效标记以保留历史
export function softDeleteObject(objectId: string, actor: string, reason?: string, skipInvalidation = false) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM object_instance WHERE object_id = ? AND domain_id = ?')
    .get(objectId, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', `对象不存在: ${objectId}`);
  db.prepare('UPDATE object_instance SET deleted = 1, updated_at = ? WHERE object_id = ?').run(nowIso(), objectId);
  db.prepare('UPDATE link_instance SET is_valid = 0, valid_to = ? WHERE (from_object_id = ? OR to_object_id = ?) AND is_valid = 1')
    .run(nowIso(), objectId, objectId);
  writeAudit({
    actor, eventType: 'object.deleted', resourceType: 'object', resourceId: objectId,
    before: JSON.parse(row.payload_json), detail: { reason: reason ?? '' },
  });
  if (!skipInvalidation) invalidateCasesForObject(objectId, `对象 ${objectId} 已失效`, actor);
  return { objectId, deleted: true };
}

export function getObject(objectId: string, opts: { actor?: AuthUser; includeHistory?: boolean } = {}) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM object_instance WHERE object_id = ? AND deleted = 0 AND domain_id = ?')
    .get(objectId, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', `对象不存在: ${objectId}`);
  const labels = JSON.parse(row.security_labels || '["PUBLIC"]');
  if (opts.actor && !clearanceAllows(opts.actor, labels)) {
    throw new AppError('FORBIDDEN', '密级不足，无法读取该对象');
  }
  const computed = readPayload(row.type_key, JSON.parse(row.payload_json), opts.actor);
  return {
    objectId: row.object_id,
    typeKey: row.type_key,
    typeDisplay: safeTypeDisplay(row.type_key),
    title: row.title,
    payload: computed.payload,
    computedErrors: computed.errors,
    revision: row.revision,
    schemaVersion: row.schema_version,
    securityLabels: labels,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    history: opts.includeHistory ? getHistory(objectId, opts.actor) : undefined,
    links: getLinksOfObject(objectId, opts.actor),
    evidence: getEvidenceOfObject(objectId, opts.actor),
  };
}

// 先按读取者权限过滤输入，再计算只读属性；计算结果仍经过字段权限过滤。
function readPayload(typeKey: string, stored: Record<string, unknown>, actor?: AuthUser) {
  const visible = actor ? redactFields(actor, stored, typeKey) : { ...stored };
  const errors: Record<string, string> = {};
  for (const property of getType(typeKey).publishedDefinition.properties as PropertyDef[]) {
    if (!property.computed) continue;
    delete visible[property.name];
    const args: Record<string, unknown> = {};
    let available = true;
    for (const [parameter, source] of Object.entries(property.computed.inputs)) {
      if (!Object.hasOwn(visible, source) || visible[source] === null) { available = false; break; }
      args[parameter] = visible[source];
    }
    if (!available) continue;
    try {
      visible[property.name] = evaluateFunction(property.computed.functionKey, args).result;
    } catch (error) {
      errors[property.name] = error instanceof Error ? error.message : '计算失败';
    }
  }
  return { payload: actor ? redactFields(actor, visible, typeKey) : visible, errors };
}

function safeTypeDisplay(typeKey: string): string {
  try { return getType(typeKey).displayName; } catch { return typeKey; }
}

export function getHistory(objectId: string, actor?: AuthUser) {
  if (actor) requireObjectAccess(actor, objectId);
  const typeKey = (getDb().prepare('SELECT type_key FROM object_instance WHERE object_id = ?').get(objectId) as any)?.type_key;
  const rows = getDb().prepare(
    'SELECT * FROM object_revision WHERE object_id = ? ORDER BY revision DESC'
  ).all(objectId) as any[];
  return rows.map((r) => ({
    revision: r.revision,
    payload: actor ? redactFields(actor, JSON.parse(r.payload_json), typeKey) : JSON.parse(r.payload_json),
    changedFields: JSON.parse(r.changed_fields || '[]'),
    changedBy: r.changed_by,
    changeReason: r.change_reason,
    createdAt: r.created_at,
  }));
}

export function getLinksOfObject(objectId: string, actor?: AuthUser) {
  if (actor) requireObjectAccess(actor, objectId);
  const db = getDb();
  const rows = db.prepare(`
    SELECT li.*, ld.display_name AS link_display, ld.from_type, ld.to_type, ld.inverse_name
    FROM link_instance li
    JOIN link_def ld ON ld.link_key = li.link_key
    WHERE (li.from_object_id = ? OR li.to_object_id = ?) AND li.is_valid = 1
    ORDER BY li.created_at DESC
  `).all(objectId, objectId) as any[];
  return rows.filter((r) => {
    if (!actor) return true;
    const otherId = r.from_object_id === objectId ? r.to_object_id : r.from_object_id;
    const other = db.prepare('SELECT security_labels FROM object_instance WHERE object_id = ?').get(otherId) as any;
    return other && clearanceAllows(actor, JSON.parse(other.security_labels || '["PUBLIC"]'));
  }).map((r) => {
    const isOutgoing = r.from_object_id === objectId;
    const otherId = isOutgoing ? r.to_object_id : r.from_object_id;
    const other = db.prepare('SELECT object_id, type_key, title, security_labels FROM object_instance WHERE object_id = ?').get(otherId) as any;
    return {
      linkId: r.id,
      linkKey: r.link_key,
      linkDisplay: r.link_display,
      direction: isOutgoing ? 'outgoing' : 'incoming',
      otherObject: other ? {
        objectId: other.object_id,
        typeKey: other.type_key,
        title: other.title,
        securityLabels: JSON.parse(other.security_labels || '[]'),
      } : null,
      props: JSON.parse(r.props_json || '{}'),
      validFrom: r.valid_from,
      validTo: r.valid_to,
    };
  });
}

export function getEvidenceOfObject(objectId: string, actor?: AuthUser) {
  if (actor) requireObjectAccess(actor, objectId);
  const db = getDb();
  const rows = db.prepare(`
    SELECT e.*, sr.source_key, sr.source_type, sr.external_key,
           svr.confidence AS source_confidence, svr.security_labels AS source_labels
    FROM evidence e JOIN source_record sr ON sr.id = e.source_id
    JOIN source_record_revision svr ON svr.source_id = e.source_id AND svr.revision = e.source_revision
    WHERE e.object_id = ? ORDER BY e.observed_at DESC LIMIT 100
  `).all(objectId) as any[];
  return rows.filter((r) => !actor || clearanceAllows(actor, JSON.parse(r.source_labels || '["PUBLIC"]'))).map((r) => ({
    id: r.id,
    sourceId: r.source_id,
    sourceKey: r.source_key,
    sourceType: r.source_type,
    externalKey: r.external_key,
    fieldPath: r.field_path,
    claim: r.claim,
    observedAt: r.observed_at,
    businessAt: r.business_at,
    confidence: r.confidence,
    stance: r.stance,
    sourceRevision: r.source_revision,
    status: r.status,
  }));
}

export interface QueryInput {
  typeKey?: string;
  text?: string;
  filters?: Array<{ field: string; op: string; value: unknown }>;
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
}

export function queryObjects(query: QueryInput, user?: AuthUser) {
  const db = getDb();
  const where: string[] = ['domain_id = ?'];
  const params: unknown[] = [currentDomainId()];
  if (query.typeKey) { where.push('type_key = ?'); params.push(query.typeKey); }
  if (!query.includeDeleted) where.push('deleted = 0');
  if (query.text) {
    where.push('(title LIKE ? OR object_id LIKE ? OR payload_json LIKE ?)');
    params.push(`%${query.text}%`, `%${query.text}%`, `%${query.text}%`);
  }
  // 简单字段过滤（payload JSON 内字段用 json_extract）
  for (const f of query.filters ?? []) {
    const col = `json_extract(payload_json, '$.${f.field.replace(/[^a-zA-Z0-9_]/g, '')}')`;
    switch (f.op) {
      case 'eq': where.push(`${col} = ?`); params.push(f.value); break;
      case 'ne': where.push(`${col} != ?`); params.push(f.value); break;
      case 'gt': where.push(`${col} > ?`); params.push(f.value); break;
      case 'gte': where.push(`${col} >= ?`); params.push(f.value); break;
      case 'lt': where.push(`${col} < ?`); params.push(f.value); break;
      case 'lte': where.push(`${col} <= ?`); params.push(f.value); break;
      case 'contains': where.push(`${col} LIKE ?`); params.push(`%${String(f.value)}%`); break;
      case 'in': {
        const list = Array.isArray(f.value) ? f.value : [f.value];
        where.push(`${col} IN (${list.map(() => '?').join(',')})`);
        params.push(...list);
        break;
      }
      default: throw new AppError('VALIDATION_ERROR', `不支持的过滤操作: ${f.op}`);
    }
  }
  const limit = Math.min(query.limit ?? 50, 200);
  const offset = query.offset ?? 0;
  const sql = `SELECT * FROM object_instance ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY updated_at DESC`;
  const visible = (db.prepare(sql).all(...params) as any[]).filter((r) =>
    !user || clearanceAllows(user, JSON.parse(r.security_labels || '["PUBLIC"]'))
  );
  const total = visible.length;
  const rows = visible.slice(offset, offset + limit);
  return {
    items: rows.map((r) => ({
      objectId: r.object_id,
      typeKey: r.type_key,
      typeDisplay: safeTypeDisplay(r.type_key),
      title: r.title,
      revision: r.revision,
      securityLabels: JSON.parse(r.security_labels || '[]'),
      updatedAt: r.updated_at,
      preview: readPayload(r.type_key, JSON.parse(r.payload_json), user).payload,
    })),
    total,
    limit,
    offset,
  };
}

// 关系邻域：指定深度遍历，限制在当前案例邻域规模
export function getNeighborhood(objectId: string, depth = 2, maxNodes = 80, actor?: AuthUser) {
  if (actor) requireObjectAccess(actor, objectId);
  const db = getDb();
  const nodes = new Map<string, any>();
  const edges: any[] = [];
  const visited = new Set<string>();
  let frontier = [objectId];

  const rootNode = db.prepare('SELECT * FROM object_instance WHERE object_id = ? AND domain_id = ?')
    .get(objectId, currentDomainId()) as any;
  if (!rootNode) throw new AppError('NOT_FOUND', `对象不存在: ${objectId}`);
  nodes.set(objectId, {
    objectId, typeKey: rootNode.type_key, title: rootNode.title,
    securityLabels: JSON.parse(rootNode.security_labels || '[]'),
    isRoot: true,
  });

  for (let d = 0; d < depth && nodes.size < maxNodes; d++) {
    const next: string[] = [];
    for (const id of frontier) {
      if (visited.has(id)) continue;
      visited.add(id);
      const links = db.prepare(`
        SELECT * FROM link_instance WHERE (from_object_id = ? OR to_object_id = ?) AND is_valid = 1
      `).all(id, id) as any[];
      for (const li of links) {
        const otherId = li.from_object_id === id ? li.to_object_id : li.from_object_id;
        edges.push({
          id: li.id,
          linkKey: li.link_key,
          from: li.from_object_id,
          to: li.to_object_id,
          props: JSON.parse(li.props_json || '{}'),
        });
        if (!nodes.has(otherId) && nodes.size < maxNodes) {
          const o = db.prepare('SELECT * FROM object_instance WHERE object_id = ? AND deleted = 0').get(otherId) as any;
          if (o && (!actor || clearanceAllows(actor, JSON.parse(o.security_labels || '["PUBLIC"]')))) {
            nodes.set(otherId, {
              objectId: otherId, typeKey: o.type_key, title: o.title,
              securityLabels: JSON.parse(o.security_labels || '[]'),
            });
            next.push(otherId);
          }
        }
      }
    }
    frontier = next;
  }
  return {
    rootId: objectId,
    nodes: [...nodes.values()],
    edges: edges.filter((e) => nodes.has(e.from) && nodes.has(e.to)),
  };
}

// ===== 链接实例 =====
export function createLink(input: {
  linkKey: string;
  fromObjectId: string;
  toObjectId: string;
  props?: Record<string, unknown>;
  actor: string;
  sourceId?: string;
}) {
  const db = getDb();
  const linkDef = db.prepare('SELECT * FROM link_def WHERE link_key = ? AND domain_id = ?')
    .get(input.linkKey, currentDomainId()) as any;
  if (!linkDef) throw new AppError('NOT_FOUND', `关系定义不存在: ${input.linkKey}`);
  if (linkDef.state !== 'published') throw new AppError('PRECONDITION_FAILED', '关系定义尚未发布或已归档');
  const from = db.prepare('SELECT type_key FROM object_instance WHERE object_id = ? AND deleted = 0 AND domain_id = ?')
    .get(input.fromObjectId, currentDomainId()) as any;
  const to = db.prepare('SELECT type_key FROM object_instance WHERE object_id = ? AND deleted = 0 AND domain_id = ?')
    .get(input.toObjectId, currentDomainId()) as any;
  if (!from || !to) throw new AppError('NOT_FOUND', '起点或终点对象不存在');
  if (from.type_key !== linkDef.from_type) {
    throw new AppError('SCHEMA_ERROR', `起点类型应为 ${linkDef.from_type}，实际 ${from.type_key}`);
  }
  if (to.type_key !== linkDef.to_type) {
    throw new AppError('SCHEMA_ERROR', `终点类型应为 ${linkDef.to_type}，实际 ${to.type_key}`);
  }
  if (input.fromObjectId === input.toObjectId && !linkDef.allow_self_loop) {
    throw new AppError('SCHEMA_ERROR', `关系 ${input.linkKey} 不允许对象连接自身`);
  }
  // 基数约束：1:1 / 1:N / N:M
  enforceCardinality(db, linkDef, input.fromObjectId, input.toObjectId);
  const id = newId('lnk');
  const now = nowIso();
  db.prepare(`INSERT INTO link_instance
    (id, link_key, from_object_id, to_object_id, props_json, valid_from, valid_to, is_valid, source_id, created_at, created_by, domain_id)
    VALUES (?,?,?,?,?,?,NULL,1,?,?,?,?)`).run(
    id, input.linkKey, input.fromObjectId, input.toObjectId,
    JSON.stringify(input.props ?? {}), now, input.sourceId ?? null, now, input.actor, currentDomainId()
  );
  writeAudit({
    actor: input.actor, eventType: 'link.created', resourceType: 'link',
    resourceId: id, after: { linkKey: input.linkKey, from: input.fromObjectId, to: input.toObjectId },
  });
  return { linkId: id, linkKey: input.linkKey, from: input.fromObjectId, to: input.toObjectId };
}

export function invalidateLink(linkId: string, actor: string) {
  const db = getDb();
  const r = db.prepare('UPDATE link_instance SET is_valid = 0, valid_to = ? WHERE id = ?').run(nowIso(), linkId);
  if (r.changes === 0) throw new AppError('NOT_FOUND', `链接不存在: ${linkId}`);
  writeAudit({
    actor, eventType: 'link.invalidated', resourceType: 'link', resourceId: linkId,
  });
  return { linkId, valid: false };
}

// 替换关联时在同一事务中保留旧记录，并校验新关联的类型与基数。
export function replaceLink(linkId: string, input: {
  linkKey: string; fromObjectId: string; toObjectId: string;
  props?: Record<string, unknown>; actor: string;
}) {
  const db = getDb();
  const old = db.prepare('SELECT * FROM link_instance WHERE id = ? AND is_valid = 1').get(linkId) as any;
  if (!old) throw new AppError('NOT_FOUND', `有效关联不存在: ${linkId}`);
  return db.transaction(() => {
    invalidateLink(linkId, input.actor);
    const next = createLink({ ...input, sourceId: old.source_id ?? undefined });
    writeAudit({ actor: input.actor, eventType: 'link.replaced', resourceType: 'link',
      resourceId: next.linkId, before: { linkId, linkKey: old.link_key,
        fromObjectId: old.from_object_id, toObjectId: old.to_object_id }, after: next });
    return next;
  })();
}

/**
 * 基数约束
 * - 1:1  起点至多一条出边、终点至多一条入边
 * - 1:N  每个终点至多一条入边
 * - N:1  每个起点至多一条出边
 * - N:M  仅禁止重复边
 */
function enforceCardinality(db: any, linkDef: any, fromObjectId: string, toObjectId: string) {
  const cardinality = String(linkDef.cardinality ?? '1:N');
  const duplicate = db.prepare(
    'SELECT 1 FROM link_instance WHERE link_key = ? AND from_object_id = ? AND to_object_id = ? AND is_valid = 1'
  ).get(linkDef.link_key, fromObjectId, toObjectId);
  if (duplicate) throw new AppError('CONFLICT', '相同连接已存在');
  if (cardinality === '1:1' || cardinality === 'N:1') {
    const outCount = (db.prepare(
      'SELECT COUNT(*) AS c FROM link_instance WHERE link_key = ? AND from_object_id = ? AND is_valid = 1'
    ).get(linkDef.link_key, fromObjectId) as any).c as number;
    if (outCount >= 1) {
      throw new AppError('CONFLICT', `基数 ${cardinality} 不允许起点 ${fromObjectId} 有多条出边`);
    }
  }
  if (cardinality === '1:1' || cardinality === '1:N') {
    const inCount = (db.prepare(
      'SELECT COUNT(*) AS c FROM link_instance WHERE link_key = ? AND to_object_id = ? AND is_valid = 1'
    ).get(linkDef.link_key, toObjectId) as any).c as number;
    if (inCount >= 1) {
      throw new AppError('CONFLICT', `基数 ${cardinality} 不允许终点 ${toObjectId} 有多条入边`);
    }
  }
}

// 全局链接实例列表（支持按 linkKey / 端点过滤）
export function listLinks(filter: {
  linkKey?: string;
  fromObjectId?: string;
  toObjectId?: string;
  includeInvalid?: boolean;
  limit?: number;
} = {}) {
  const db = getDb();
  let sql = `SELECT li.*, ld.display_name AS link_display, ld.cardinality
             FROM link_instance li LEFT JOIN link_def ld ON ld.link_key = li.link_key WHERE li.domain_id = ?`;
  const params: unknown[] = [currentDomainId()];
  if (filter.linkKey) { sql += ' AND li.link_key = ?'; params.push(filter.linkKey); }
  if (filter.fromObjectId) { sql += ' AND li.from_object_id = ?'; params.push(filter.fromObjectId); }
  if (filter.toObjectId) { sql += ' AND li.to_object_id = ?'; params.push(filter.toObjectId); }
  if (!filter.includeInvalid) sql += ' AND li.is_valid = 1';
  sql += ' ORDER BY li.created_at DESC LIMIT ?';
  params.push(Math.min(filter.limit ?? 100, 500));
  return (db.prepare(sql).all(...params) as any[]).map((r) => ({
    linkId: r.id,
    linkKey: r.link_key,
    linkDisplay: r.link_display,
    cardinality: r.cardinality,
    fromObjectId: r.from_object_id,
    toObjectId: r.to_object_id,
    props: JSON.parse(r.props_json || '{}'),
    validFrom: r.valid_from,
    validTo: r.valid_to,
    isValid: !!r.is_valid,
    createdBy: r.created_by,
    createdAt: r.created_at,
  }));
}
