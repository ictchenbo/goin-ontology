// 受控 Webhook：服务端配置来源密钥和字段映射，投递键保证重试幂等。
import crypto from 'crypto';
import { getDb, nowIso } from '../../db/database';
import { AppError } from '../../shared/errors';
import { stableHash } from '../../shared/hash';
import { createIngestJob, applyIngestJob, MappingConfig } from './ingest-service';

interface WebhookConfig { secret: string; mapping: MappingConfig }

function configuration(sourceKey: string): WebhookConfig {
  let all: Record<string, WebhookConfig>;
  try { all = JSON.parse(process.env.WEBHOOK_SOURCES_JSON || '{}'); }
  catch { throw new AppError('INTERNAL_ERROR', 'Webhook 配置不是有效 JSON'); }
  const found = all[sourceKey];
  if (!found?.secret || !found.mapping?.typeKey || !found.mapping.fieldMap) {
    throw new AppError('NOT_FOUND', 'Webhook 来源未配置');
  }
  return found;
}

export function ingestWebhook(input: {
  sourceKey: string; secret: string; deliveryKey: string;
  rows: Array<Record<string, unknown>>;
}) {
  const config = configuration(input.sourceKey);
  const supplied = Buffer.from(input.secret || '');
  const expected = Buffer.from(config.secret);
  if (!supplied.length || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new AppError('UNAUTHORIZED', 'Webhook 密钥无效');
  }
  if (!input.deliveryKey || input.deliveryKey.length > 200) {
    throw new AppError('VALIDATION_ERROR', '需要有效的 X-Delivery-Key');
  }
  if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length > 1000 ||
      input.rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new AppError('VALIDATION_ERROR', 'rows 必须是 1 到 1000 条 JSON 对象');
  }
  const db = getDb();
  const hash = stableHash(input.rows);
  const previous = db.prepare('SELECT * FROM webhook_delivery WHERE source_key = ? AND delivery_key = ?')
    .get(input.sourceKey, input.deliveryKey) as any;
  if (previous) {
    if (previous.request_hash !== hash) throw new AppError('IDEMPOTENCY_CONFLICT', '投递键已用于不同内容');
    return { ...JSON.parse(previous.result_json), replayed: true };
  }
  const job = createIngestJob({ sourceType: 'webhook', filename: `webhook:${input.sourceKey}`,
    rows: input.rows, mapping: { ...config.mapping, sourceKey: input.sourceKey }, createdBy: `webhook:${input.sourceKey}` });
  const result = applyIngestJob(job.id, `webhook:${input.sourceKey}`);
  const response = { jobId: job.id, result, replayed: false };
  db.prepare(`INSERT INTO webhook_delivery
    (source_key,delivery_key,request_hash,job_id,result_json,created_at) VALUES (?,?,?,?,?,?)`)
    .run(input.sourceKey, input.deliveryKey, hash, job.id, JSON.stringify(response), nowIso());
  return response;
}
