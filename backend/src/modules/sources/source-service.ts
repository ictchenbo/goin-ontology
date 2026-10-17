// 来源与证据：来源记录去重、证据挂接、冲突事实标记
import { getDb, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { sha256, stableStringify } from '../../shared/hash';
import { AppError } from '../../shared/errors';
import { writeAudit } from '../audit/audit-service';
import { AuthUser, clearanceAllows, redactFields, mergeLabels } from '../auth/auth-service';
import { invalidateCasesForObject } from '../decision/staleness-service';
import { currentDomainId } from '../domains/domain-service';

export interface SourceInput {
  sourceKey: string;
  externalKey: string;
  sourceType?: string;
  observedAt: string;
  businessAt?: string;
  confidence?: number;
  securityLabels?: string[];
  purpose?: string;
  expiresAt?: string;
  raw: unknown;
  actor: string;
}

// 同一来源记录使用稳定键去重
export function recordSource(input: SourceInput) {
  const db = getDb();
  if (!input.sourceKey || !input.externalKey || !Number.isFinite(Date.parse(input.observedAt))) {
    throw new AppError('VALIDATION_ERROR', '来源标识、外部键及有效采集时间为必填项');
  }
  if (input.expiresAt && (!Number.isFinite(Date.parse(input.expiresAt)) ||
    Date.parse(input.expiresAt) <= Date.parse(input.observedAt))) {
    throw new AppError('VALIDATION_ERROR', '来源有效期必须晚于采集时间');
  }
  if (input.confidence !== undefined && (input.confidence < 0 || input.confidence > 1)) {
    throw new AppError('VALIDATION_ERROR', '可信度须在 0 到 1 之间');
  }
  const hash = sha256(stableStringify(input.raw));
  const existing = db.prepare(
    'SELECT * FROM source_record WHERE source_key = ? AND external_key = ? AND domain_id = ?'
  ).get(input.sourceKey, input.externalKey, currentDomainId()) as any;
  if (!existing && db.prepare('SELECT 1 FROM source_record WHERE source_key = ? AND external_key = ?')
    .get(input.sourceKey, input.externalKey)) {
    throw new AppError('CONFLICT', '来源技术键已被其他领域使用');
  }
  if (existing) {
    if (existing.hash === hash) {
      return { id: existing.id, deduplicated: true };
    }
    // 同键不同内容：追加不可变版本，再更新当前投影。
    db.transaction(() => {
      const latest = db.prepare('SELECT MAX(revision) AS n FROM source_record_revision WHERE source_id = ?').get(existing.id) as any;
      if (!latest.n) {
        db.prepare(`INSERT INTO source_record_revision
          (id, source_id, revision, hash, raw_json, observed_at, business_at, confidence, security_labels, recorded_at)
          VALUES (?,?,?,?,?,?,?,?,?,?)`).run(newId('srev'), existing.id, 1, existing.hash, existing.raw_json,
          existing.observed_at, existing.business_at, existing.confidence, existing.security_labels, existing.recorded_at);
      }
      db.prepare(`INSERT INTO source_record_revision
        (id, source_id, revision, hash, raw_json, observed_at, business_at, confidence, security_labels, recorded_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(newId('srev'), existing.id, Number(latest.n || 1) + 1, hash,
        JSON.stringify(input.raw), input.observedAt, input.businessAt ?? null, input.confidence ?? 1,
        JSON.stringify(input.securityLabels ?? ['PUBLIC']), nowIso());
      db.prepare('UPDATE source_record_revision SET purpose = ?, expires_at = ? WHERE source_id = ? AND revision = ?')
        .run(input.purpose ?? '', input.expiresAt ?? null, existing.id, Number(latest.n || 1) + 1);
      db.prepare(`UPDATE source_record SET hash = ?, raw_json = ?, observed_at = ?, business_at = ?,
        confidence = ?, security_labels = ?, purpose = ?, expires_at = ?, status = 'active', recorded_at = ? WHERE id = ?`).run(hash, JSON.stringify(input.raw),
        input.observedAt, input.businessAt ?? null, input.confidence ?? 1,
        JSON.stringify(input.securityLabels ?? ['PUBLIC']), input.purpose ?? '', input.expiresAt ?? null,
        nowIso(), existing.id);
    })();
    writeAudit({
      actor: input.actor, eventType: 'source.updated', resourceType: 'source_record',
      resourceId: existing.id, before: JSON.parse(existing.raw_json), after: input.raw,
    });
    const affected = db.prepare('SELECT DISTINCT object_id FROM evidence WHERE source_id = ? AND status = ?')
      .all(existing.id, 'active') as Array<{ object_id: string }>;
    for (const item of affected) invalidateCasesForObject(item.object_id, `来源 ${existing.id} 已修订`, input.actor);
    return { id: existing.id, deduplicated: false, updated: true };
  }
  const id = newId('src');
  db.prepare(`INSERT INTO source_record
    (id, source_key, external_key, source_type, hash, observed_at, business_at, confidence, security_labels, raw_json, recorded_at, domain_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    id, input.sourceKey, input.externalKey, input.sourceType ?? 'manual', hash,
    input.observedAt, input.businessAt ?? null, input.confidence ?? 1.0,
    JSON.stringify(input.securityLabels ?? ['PUBLIC']), JSON.stringify(input.raw), nowIso(), currentDomainId()
  );
  db.prepare(`INSERT INTO source_record_revision
    (id, source_id, revision, hash, raw_json, observed_at, business_at, confidence, security_labels, recorded_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(newId('srev'), id, 1, hash, JSON.stringify(input.raw),
    input.observedAt, input.businessAt ?? null, input.confidence ?? 1,
    JSON.stringify(input.securityLabels ?? ['PUBLIC']), nowIso());
  db.prepare('UPDATE source_record SET purpose = ?, expires_at = ? WHERE id = ?')
    .run(input.purpose ?? '', input.expiresAt ?? null, id);
  db.prepare('UPDATE source_record_revision SET purpose = ?, expires_at = ? WHERE source_id = ? AND revision = 1')
    .run(input.purpose ?? '', input.expiresAt ?? null, id);
  writeAudit({
    actor: input.actor, eventType: 'source.recorded', resourceType: 'source_record',
    resourceId: id, after: { sourceKey: input.sourceKey, externalKey: input.externalKey },
  });
  return { id, deduplicated: false };
}

export function attachEvidence(input: {
  objectId: string;
  sourceId: string;
  fieldPath?: string;
  claim?: string;
  observedAt: string;
  businessAt?: string;
  confidence?: number;
  stance?: 'support' | 'refute';
  actor: string;
}) {
  const db = getDb();
  const obj = db.prepare('SELECT object_id, security_labels FROM object_instance WHERE object_id = ? AND domain_id = ?').get(input.objectId, currentDomainId()) as any;
  if (!obj) throw new AppError('NOT_FOUND', `对象不存在: ${input.objectId}`);
  const src = db.prepare('SELECT id, security_labels, status, expires_at FROM source_record WHERE id = ? AND domain_id = ?').get(input.sourceId, currentDomainId()) as any;
  if (!src) throw new AppError('NOT_FOUND', `来源记录不存在: ${input.sourceId}`);
  if (src.status !== 'active' || (src.expires_at && Date.parse(src.expires_at) <= Date.now())) {
    throw new AppError('PRECONDITION_FAILED', '来源记录已纠错或过期');
  }
  if (input.stance && !['support', 'refute'].includes(input.stance)) {
    throw new AppError('VALIDATION_ERROR', '证据立场只能为 support 或 refute');
  }
  const id = newId('evd');
  const sourceRevision = (db.prepare('SELECT MAX(revision) AS n FROM source_record_revision WHERE source_id = ?')
    .get(input.sourceId) as any)?.n ?? 1;
  db.prepare(`INSERT INTO evidence
    (id, object_id, source_id, field_path, claim, observed_at, business_at, confidence,
     status, created_at, stance, source_revision, domain_id)
    VALUES (?,?,?,?,?,?,?,?, 'active', ?, ?, ?, ?)`).run(
    id, input.objectId, input.sourceId, input.fieldPath ?? '', input.claim ?? '',
    input.observedAt, input.businessAt ?? null, input.confidence ?? 1.0,
    nowIso(), input.stance ?? 'support', sourceRevision, currentDomainId()
  );
  const labels = mergeLabels(JSON.parse(obj.security_labels || '["PUBLIC"]'), JSON.parse(src.security_labels || '["PUBLIC"]'));
  db.prepare('UPDATE object_instance SET security_labels = ? WHERE object_id = ?')
    .run(JSON.stringify(labels), input.objectId);
  invalidateCasesForObject(input.objectId, `对象 ${input.objectId} 新增证据`, input.actor);
  writeAudit({
    actor: input.actor, eventType: 'evidence.attached', resourceType: 'evidence',
    resourceId: id, after: { objectId: input.objectId, sourceId: input.sourceId },
  });
  return { evidenceId: id };
}

export function retractEvidence(evidenceId: string, actor: string, reason: string) {
  const db = getDb();
  const old = db.prepare('SELECT object_id FROM evidence WHERE id = ?').get(evidenceId) as any;
  const r = db.prepare(`UPDATE evidence SET status = 'retracted' WHERE id = ?`).run(evidenceId);
  if (r.changes === 0) throw new AppError('NOT_FOUND', `证据不存在: ${evidenceId}`);
  writeAudit({
    actor, eventType: 'evidence.retracted', resourceType: 'evidence',
    resourceId: evidenceId, detail: { reason },
  });
  if (old) invalidateCasesForObject(old.object_id, `证据 ${evidenceId} 已撤回`, actor);
  return { evidenceId, status: 'retracted' };
}

export function correctSource(sourceId: string, actor: string, reason: string) {
  if (!reason.trim()) throw new AppError('VALIDATION_ERROR', '纠错原因不能为空');
  const db = getDb();
  const row = db.prepare('SELECT id FROM source_record WHERE id = ?').get(sourceId);
  if (!row) throw new AppError('NOT_FOUND', `来源记录不存在: ${sourceId}`);
  db.prepare("UPDATE source_record SET status = 'corrected' WHERE id = ?").run(sourceId);
  const affected = db.prepare('SELECT DISTINCT object_id FROM evidence WHERE source_id = ?').all(sourceId) as Array<{ object_id: string }>;
  for (const item of affected) invalidateCasesForObject(item.object_id, `来源 ${sourceId} 已纠错`, actor);
  writeAudit({ actor, eventType: 'source.corrected', resourceType: 'source_record',
    resourceId: sourceId, detail: { reason } });
  return { sourceId, status: 'corrected' };
}

export function getSource(sourceId: string, user?: AuthUser) {
  const row = getDb().prepare('SELECT * FROM source_record WHERE id = ? AND domain_id = ?').get(sourceId, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', `来源记录不存在: ${sourceId}`);
  const labels = JSON.parse(row.security_labels || '["PUBLIC"]');
  if (user && !clearanceAllows(user, labels)) throw new AppError('FORBIDDEN', '密级不足');
  const revisions = getDb().prepare('SELECT * FROM source_record_revision WHERE source_id = ? ORDER BY revision').all(sourceId) as any[];
  return {
    id: row.id,
    sourceKey: row.source_key,
    externalKey: row.external_key,
    sourceType: row.source_type,
    hash: row.hash,
    observedAt: row.observed_at,
    businessAt: row.business_at,
    confidence: row.confidence,
    securityLabels: labels,
    raw: user ? redactFields(user, JSON.parse(row.raw_json || '{}')) : JSON.parse(row.raw_json || '{}'),
    recordedAt: row.recorded_at,
    purpose: row.purpose,
    expiresAt: row.expires_at,
    status: row.status,
    revisions: revisions.filter((r) => !user || clearanceAllows(user, JSON.parse(r.security_labels || '["PUBLIC"]')))
      .map((r) => ({ revision: r.revision, hash: r.hash, raw: user ? redactFields(user, JSON.parse(r.raw_json)) : JSON.parse(r.raw_json),
        observedAt: r.observed_at, businessAt: r.business_at, confidence: r.confidence,
        purpose: r.purpose, expiresAt: r.expires_at, recordedAt: r.recorded_at })),
  };
}

export function listSources(limit = 50, offset = 0, user?: AuthUser) {
  const db = getDb();
  const visible = (db.prepare('SELECT * FROM source_record WHERE domain_id = ? ORDER BY recorded_at DESC').all(currentDomainId()) as any[])
    .filter((r) => !user || clearanceAllows(user, JSON.parse(r.security_labels || '["PUBLIC"]')));
  return { items: visible.slice(offset, offset + limit).map((r) => getSource(r.id, user)), total: visible.length };
}

// 新鲜度检查：超过 maxAgeDays 视为过期
export function checkFreshness(observedAt: string, maxAgeDays: number): { fresh: boolean; ageDays: number } {
  const ageDays = (Date.now() - Date.parse(observedAt)) / 86400000;
  return { fresh: ageDays <= maxAgeDays, ageDays };
}
