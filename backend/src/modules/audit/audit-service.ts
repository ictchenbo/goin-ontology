// 审计服务：所有写操作统一留痕
import { getDb, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { stableHash } from '../../shared/hash';
import { AuthUser, clearanceAllows, hasRole, redactFields } from '../auth/auth-service';

export interface AuditInput {
  actor: string;
  eventType: string;
  resourceType: string;
  resourceId: string;
  action?: string;
  before?: unknown;
  after?: unknown;
  correlationId?: string;
  detail?: unknown;
}

export function writeAudit(input: AuditInput): string {
  const db = getDb();
  const id = newId('aud');
  db.prepare(`INSERT INTO audit_event
    (id, actor, event_type, resource_type, resource_id, action, before_hash, after_hash, correlation_id, detail_json, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    id,
    input.actor,
    input.eventType,
    input.resourceType,
    input.resourceId,
    input.action ?? '',
    input.before === undefined ? '' : stableHash(input.before),
    input.after === undefined ? '' : stableHash(input.after),
    input.correlationId ?? '',
    JSON.stringify(input.detail ?? {}),
    nowIso()
  );
  return id;
}

export interface AuditQuery {
  actor?: string;
  resourceType?: string;
  resourceId?: string;
  eventType?: string;
  correlationId?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function canReadAuditResource(user: AuthUser, resourceType: string, resourceId: string): boolean {
  if (hasRole(user, 'admin')) return true;
  const db = getDb();
  let row: any;
  if (resourceType === 'object') row = db.prepare('SELECT security_labels FROM object_instance WHERE object_id = ?').get(resourceId);
  else if (resourceType === 'decision_case') row = db.prepare('SELECT security_labels FROM decision_case WHERE id = ?').get(resourceId);
  else if (resourceType === 'source_record') row = db.prepare('SELECT security_labels FROM source_record WHERE id = ?').get(resourceId);
  else if (resourceType === 'evidence') row = db.prepare(`SELECT o.security_labels FROM evidence e JOIN object_instance o ON o.object_id = e.object_id WHERE e.id = ?`).get(resourceId);
  else if (['approval', 'action_run', 'outcome'].includes(resourceType)) {
    row = db.prepare(`SELECT c.security_labels FROM ${resourceType} r JOIN decision_case c ON c.id = r.case_id WHERE r.id = ?`).get(resourceId);
  }
  return !!row && clearanceAllows(user, JSON.parse(row.security_labels || '["PUBLIC"]'));
}

export function listAudit(query: AuditQuery, user?: AuthUser) {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (query.actor) { where.push('actor = ?'); params.push(query.actor); }
  if (query.resourceType) { where.push('resource_type = ?'); params.push(query.resourceType); }
  if (query.resourceId) { where.push('resource_id = ?'); params.push(query.resourceId); }
  if (query.eventType) { where.push('event_type = ?'); params.push(query.eventType); }
  if (query.correlationId) { where.push('correlation_id = ?'); params.push(query.correlationId); }
  if (query.from) { where.push('created_at >= ?'); params.push(query.from); }
  if (query.to) { where.push('created_at <= ?'); params.push(query.to); }
  const limit = Math.min(query.limit ?? 50, 500);
  const offset = query.offset ?? 0;
  const sql = `SELECT * FROM audit_event ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY created_at DESC, rowid DESC`;
  const visible = (db.prepare(sql).all(...params) as any[]).filter((r) =>
    !user || canReadAuditResource(user, r.resource_type, r.resource_id));
  const rows = visible.slice(offset, offset + limit);
  const total = visible.length;
  return {
    items: rows.map((r) => {
      const item = mapAudit(r);
      return user ? { ...item, detail: redactFields(user, item.detail) } : item;
    }),
    total,
    limit,
    offset,
  };
}

function mapAudit(r: any) {
  return {
    id: r.id,
    actor: r.actor,
    eventType: r.event_type,
    resourceType: r.resource_type,
    resourceId: r.resource_id,
    action: r.action,
    beforeHash: r.before_hash,
    afterHash: r.after_hash,
    correlationId: r.correlation_id,
    detail: JSON.parse(r.detail_json || '{}'),
    createdAt: r.created_at,
  };
}

export function getAuditChain(resourceType: string, resourceId: string, user?: AuthUser) {
  if (user && !canReadAuditResource(user, resourceType, resourceId)) return [];
  const db = getDb();
  const rows = db.prepare(
    `SELECT * FROM audit_event WHERE resource_type = ? AND resource_id = ? ORDER BY created_at ASC, rowid ASC`
  ).all(resourceType, resourceId);
  return rows.map((r) => {
    const item = mapAudit(r);
    return user ? { ...item, detail: redactFields(user, item.detail) } : item;
  });
}
