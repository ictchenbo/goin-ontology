// 导入：CSV/JSON 进入来源区，字段映射与实体匹配生成对象或事件
// 业务写入只经过 Action Engine；导入通过受控 Ingestion Action 提交
import { getDb, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import { recordSource, attachEvidence } from '../sources/source-service';
import { createObject, updateObject, createLink, queryObjects } from '../objects/object-service';
import { validatePayload } from '../ontology/ontology-service';
import { writeAudit } from '../audit/audit-service';
import { processObjectChange } from '../automation/automation-service';
import { sha256 } from '../../shared/hash';
import { currentDomainId } from '../domains/domain-service';

export interface MappingConfig {
  typeKey: string;
  /** 外部字段 -> 本地属性 */
  fieldMap: Record<string, string>;
  /** 去重/匹配键（优先用外部 id，否则用这些字段组合） */
  matchKeys?: string[];
  /** 时间字段 */
  observedAtField?: string;
  businessAtField?: string;
  /** 自动建立的链接 */
  links?: Array<{ linkKey: string; fromField?: string; toField?: string; toTypeKey?: string }>;
  sourceKey?: string;
  purpose?: string;
  expiresAtField?: string;
  maxAgeDays?: number;
}

export function parseCsv(text: string): Array<Record<string, string>> {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === '"') {
      if (quoted && input[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (c === ',' && !quoted) {
      record.push(cell); cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && input[i + 1] === '\n') i++;
      record.push(cell); cell = '';
      if (record.some((v) => v.trim())) records.push(record);
      record = [];
    } else {
      cell += c;
    }
  }
  if (quoted) throw new AppError('VALIDATION_ERROR', 'CSV 引号未闭合');
  record.push(cell);
  if (record.some((v) => v.trim())) records.push(record);
  if (!records.length) return [];
  const headers = records[0].map((h) => h.trim());
  if (new Set(headers).size !== headers.length || headers.some((h) => !h)) {
    throw new AppError('VALIDATION_ERROR', 'CSV 表头为空或重复');
  }
  return records.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h.trim()] = (cells[i] ?? '').trim(); });
    return row;
  });
}

export function createIngestJob(input: {
  sourceType: 'csv' | 'json' | 'webhook';
  filename: string;
  rows: Array<Record<string, unknown>>;
  mapping?: MappingConfig;
  createdBy: string;
}) {
  const db = getDb();
  const jobId = newId('ing');
  const now = nowIso();
  db.prepare(`INSERT INTO ingest_job
    (id, source_type, filename, status, total_rows, accepted_rows, rejected_rows, mapping_json, errors_json, created_by, created_at, finished_at, domain_id)
    VALUES (?,?,?,?,?,0,0,?, '[]', ?,?,NULL,?)`).run(
    jobId, input.sourceType, input.filename, input.mapping ? 'ready' : 'mapping',
    input.rows.length, JSON.stringify(input.mapping ?? {}), input.createdBy, now, currentDomainId()
  );
  const insertRow = db.prepare(`INSERT INTO ingest_row (id, job_id, row_index, raw_json, status, error, mapped_object_id)
    VALUES (?,?,?,?, 'pending', '', NULL)`);
  input.rows.forEach((r, i) => {
    insertRow.run(newId('irow'), jobId, i, JSON.stringify(r));
  });
  writeAudit({
    actor: input.createdBy, eventType: 'ingest.created', resourceType: 'ingest_job',
    resourceId: jobId, after: { filename: input.filename, rows: input.rows.length },
  });
  return getIngestJob(jobId);
}

export function getIngestJob(jobId: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ingest_job WHERE id = ? AND domain_id = ?').get(jobId, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', `导入任务不存在: ${jobId}`);
  return {
    id: row.id,
    sourceType: row.source_type,
    filename: row.filename,
    status: row.status,
    totalRows: row.total_rows,
    acceptedRows: row.accepted_rows,
    rejectedRows: row.rejected_rows,
    mapping: JSON.parse(row.mapping_json || '{}'),
    errors: JSON.parse(row.errors_json || '[]'),
    createdBy: row.created_by,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

export function listIngestJobs() {
  return (getDb().prepare('SELECT id FROM ingest_job WHERE domain_id = ? ORDER BY created_at DESC LIMIT 50').all(currentDomainId()) as any[])
    .map((r) => getIngestJob(r.id));
}

export function setMapping(jobId: string, mapping: MappingConfig, actor: string) {
  const db = getDb();
  db.prepare('UPDATE ingest_job SET mapping_json = ?, status = ? WHERE id = ?')
    .run(JSON.stringify(mapping), 'ready', jobId);
  writeAudit({
    actor, eventType: 'ingest.mapping', resourceType: 'ingest_job', resourceId: jobId,
    after: mapping,
  });
  return getIngestJob(jobId);
}

export interface IngestResult {
  accepted: number;
  rejected: number;
  applied: number;
  objects: Array<{ objectId: string; externalKey: string; created: boolean; revision: number }>;
  errors: Array<{ rowIndex: number; message: string }>;
}

// 执行导入：质量检查覆盖必填、类型、重复、外键；异常进入待处理队列
export function applyIngestJob(jobId: string, actor: string): IngestResult {
  const db = getDb();
  const job = getIngestJob(jobId);
  if (job.status === 'done') {
    throw new AppError('CONFLICT', '导入任务已应用，不能重复提交');
  }
  if (!job.mapping || !(job.mapping as MappingConfig).typeKey) {
    throw new AppError('PRECONDITION_FAILED', '尚未配置字段映射');
  }
  const mapping = job.mapping as MappingConfig;
  const rows = db.prepare('SELECT * FROM ingest_row WHERE job_id = ? ORDER BY row_index').all(jobId) as any[];
  const result: IngestResult = { accepted: 0, rejected: 0, applied: 0, objects: [], errors: [] };

  for (const row of rows) {
    const raw = JSON.parse(row.raw_json);
    try {
      const payload: Record<string, unknown> = {};
      for (const [src, dest] of Object.entries(mapping.fieldMap)) {
        if (raw[src] !== undefined && raw[src] !== '') {
          // 由目标类型定义负责转换，避免把纯数字的业务编号误转成数值。
          payload[dest] = raw[src];
        }
      }
      const normalized = validatePayload(mapping.typeKey, payload);

      const sourceKey = mapping.sourceKey ?? job.sourceType;
      const keys = (mapping.matchKeys ?? []).map((k) => String(raw[k] ?? '').trim());
      const externalKey = String(raw.id || raw.external_key ||
        (keys.length && keys.every(Boolean) ? keys.join('|') : sha256(JSON.stringify(raw))));
      const observedAt = String(raw[mapping.observedAtField ?? 'observed_at'] ?? raw.observedAt ?? new Date().toISOString());
      if (mapping.maxAgeDays !== undefined &&
        (Date.now() - Date.parse(observedAt)) / 86400000 > mapping.maxAgeDays) {
        throw new AppError('VALIDATION_ERROR', '来源记录已超过新鲜度阈值');
      }
      const srcRec = recordSource({
        sourceKey,
        externalKey,
        sourceType: job.sourceType,
        observedAt,
        businessAt: mapping.businessAtField ? String(raw[mapping.businessAtField] ?? '') : undefined,
        confidence: raw.confidence ? Number(raw.confidence) : 1,
        raw,
        actor,
        purpose: mapping.purpose,
        expiresAt: mapping.expiresAtField ? String(raw[mapping.expiresAtField] ?? '') : undefined,
      });

      // 实体匹配：按 matchKeys 查找已有对象
      let objectId: string | undefined;
      let created = false;
      const filters = (mapping.matchKeys ?? []).map((k) => ({
        field: mapping.fieldMap[k] ?? k,
        op: 'eq',
        value: normalized[mapping.fieldMap[k] ?? k],
      })).filter((f) => f.value !== undefined);
      if (filters.length) {
        const found = queryObjects({ typeKey: mapping.typeKey, filters, limit: 1 });
        if (found.items.length) objectId = found.items[0].objectId;
      }
      if (!objectId) {
        const previous = db.prepare('SELECT object_id FROM evidence WHERE source_id = ? ORDER BY created_at DESC LIMIT 1')
          .get(srcRec.id) as any;
        objectId = previous?.object_id;
      }

      let revision = 1;
      if (objectId) {
        const updated = updateObject({
          objectId, payload: normalized, actor, reason: `导入更新 ${job.filename}`, skipAutomation: true,
        });
        revision = updated.revision;
      } else {
        const obj = createObject({
          typeKey: mapping.typeKey,
          payload: normalized,
          actor,
          reason: `导入创建 ${job.filename}`,
          skipAutomation: true,
        });
        objectId = obj.objectId;
        created = true;
      }
      const linkedEvidence = db.prepare(`SELECT e.id FROM evidence e
        WHERE e.object_id = ? AND e.source_id = ? AND e.status = 'active'
        AND e.source_revision = (SELECT MAX(revision) FROM source_record_revision WHERE source_id = ?)
        LIMIT 1`).get(objectId, srcRec.id, srcRec.id);
      if (!linkedEvidence) {
        attachEvidence({
          objectId: objectId!,
          sourceId: srcRec.id,
          claim: `来自 ${job.filename} 的导入记录`,
          observedAt,
          actor,
        });
      }

      // 自动建链
      for (const link of mapping.links ?? []) {
        const toRef = link.toField ? String(raw[link.toField] ?? '') : '';
        if (!toRef || !objectId) continue;
        // 查找目标对象
        const target = queryObjects({
          typeKey: link.toTypeKey,
          filters: [{ field: 'code', op: 'eq', value: toRef }],
          limit: 1,
        });
        if (!target.items.length) continue;
        try {
          if (link.fromField === '__self__') {
            createLink({
              linkKey: link.linkKey,
              fromObjectId: objectId,
              toObjectId: target.items[0].objectId,
              actor,
            });
          } else {
            createLink({
              linkKey: link.linkKey,
              fromObjectId: target.items[0].objectId,
              toObjectId: objectId,
              actor,
            });
          }
        } catch { /* 链接失败不阻断导入 */ }
      }

      processObjectChange(objectId!);

      db.prepare('UPDATE ingest_row SET status = ?, mapped_object_id = ? WHERE id = ?')
        .run('applied', objectId, row.id);
      result.accepted++;
      result.applied++;
      result.objects.push({ objectId: objectId!, externalKey, created, revision });
    } catch (e: any) {
      db.prepare('UPDATE ingest_row SET status = ?, error = ? WHERE id = ?')
        .run('rejected', e.message, row.id);
      result.rejected++;
      result.errors.push({ rowIndex: row.row_index, message: e.message });
    }
  }

  db.prepare(`UPDATE ingest_job SET status = ?, accepted_rows = ?, rejected_rows = ?, errors_json = ?, finished_at = ?
    WHERE id = ?`).run(
    result.rejected ? 'done' : 'done', result.accepted, result.rejected,
    JSON.stringify(result.errors.slice(0, 50)), nowIso(), jobId
  );
  writeAudit({
    actor, eventType: 'ingest.applied', resourceType: 'ingest_job', resourceId: jobId,
    after: { accepted: result.accepted, rejected: result.rejected },
  });
  return result;
}

// 质量检查队列：列出被拒绝的行
export function listRejectedRows(jobId: string) {
  return (getDb().prepare(
    `SELECT * FROM ingest_row WHERE job_id = ? AND status = 'rejected' ORDER BY row_index`
  ).all(jobId) as any[]).map((r) => ({
    rowIndex: r.row_index,
    raw: JSON.parse(r.raw_json),
    error: r.error,
  }));
}
