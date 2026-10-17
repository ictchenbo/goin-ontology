// 附件保存在受控目录；数据库只保存路径、摘要及访问标签。
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getDb, getDbPath, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import { AuthUser, requireObjectAccess } from '../auth/auth-service';
import { writeAudit } from '../audit/audit-service';
import { currentDomainId } from '../domains/domain-service';

function attachmentDir() {
  return process.env.ATTACHMENT_DIR || path.join(path.dirname(getDbPath()), 'attachments');
}

function toMeta(row: any) {
  return {
    id: row.id, objectId: row.object_id, filename: row.filename,
    mediaType: row.media_type, byteSize: row.byte_size, sha256: row.sha256,
    securityLabels: JSON.parse(row.security_labels), uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
  };
}

export function saveAttachment(objectId: string, file: Express.Multer.File, actor: AuthUser) {
  requireObjectAccess(actor, objectId);
  if (!file?.buffer?.length) throw new AppError('VALIDATION_ERROR', '附件不能为空');
  const db = getDb();
  const object = db.prepare('SELECT security_labels FROM object_instance WHERE object_id = ?').get(objectId) as any;
  const id = newId('att');
  const dir = attachmentDir();
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, id);
  const filename = path.basename(file.originalname).slice(0, 255);
  const digest = crypto.createHash('sha256').update(file.buffer).digest('hex');
  try {
    fs.writeFileSync(target, file.buffer, { flag: 'wx', mode: 0o600 });
    db.prepare(`INSERT INTO attachment
      (id,object_id,filename,media_type,byte_size,sha256,storage_path,security_labels,uploaded_by,created_at,domain_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, objectId, filename, file.mimetype || 'application/octet-stream',
      file.size, digest, target, object.security_labels, actor.username, nowIso(), currentDomainId()
    );
    writeAudit({ actor: actor.username, eventType: 'attachment.uploaded',
      resourceType: 'object', resourceId: objectId,
      after: { attachmentId: id, filename, sha256: digest } });
  } catch (error) {
    if (fs.existsSync(target)) fs.unlinkSync(target);
    throw error;
  }
  return getAttachment(id, actor).meta;
}

export function listAttachments(objectId: string, actor: AuthUser) {
  requireObjectAccess(actor, objectId);
  return (getDb().prepare('SELECT * FROM attachment WHERE object_id = ? ORDER BY created_at DESC')
    .all(objectId) as any[]).map(toMeta);
}

export function getAttachment(id: string, actor: AuthUser) {
  const row = getDb().prepare('SELECT * FROM attachment WHERE id = ? AND domain_id = ?').get(id, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', '附件不存在');
  requireObjectAccess(actor, row.object_id);
  if (!fs.existsSync(row.storage_path)) throw new AppError('NOT_FOUND', '附件文件已丢失');
  return { meta: toMeta(row), path: row.storage_path };
}
