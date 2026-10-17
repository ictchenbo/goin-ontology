// 应用领域注册、成员授权与请求上下文。
import { AsyncLocalStorage } from 'node:async_hooks';
import { getDb, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import type { AuthUser } from '../auth/auth-service';

export const EXISTING_DOMAIN_ID = 'dom_existing';
const domainStorage = new AsyncLocalStorage<string>();

export function runInDomain<T>(domainId: string, operation: () => T): T {
  return domainStorage.run(domainId, operation);
}

// CLI 和现有单领域测试没有请求上下文，使用迁移创建的初始领域。
export function currentDomainId(): string {
  return domainStorage.getStore() ?? EXISTING_DOMAIN_ID;
}

export function getDomain(id: string) {
  const row = getDb().prepare('SELECT * FROM application_domain WHERE id = ?').get(id) as any;
  if (!row) throw new AppError('NOT_FOUND', '应用领域不存在');
  return { id: row.id, domainKey: row.domain_key, displayName: row.display_name,
    description: row.description, status: row.status, createdBy: row.created_by,
    createdAt: row.created_at, updatedAt: row.updated_at };
}

export function listDomains(user: AuthUser, includeArchived = false) {
  const db = getDb();
  const isAdmin = user.roles.includes('admin');
  const rows = isAdmin
    ? db.prepare(`SELECT id FROM application_domain WHERE (? = 1 OR status = 'active') ORDER BY created_at, domain_key`)
      .all(includeArchived ? 1 : 0) as Array<{ id: string }>
    : db.prepare(`SELECT d.id FROM application_domain d JOIN application_domain_member m ON m.domain_id = d.id
      WHERE m.user_id = ? AND d.status = 'active' ORDER BY d.created_at, d.domain_key`)
      .all(user.id) as Array<{ id: string }>;
  return rows.map((row) => getDomain(row.id));
}

export function assertDomainAccess(user: AuthUser, domainId: string): void {
  const domain = getDomain(domainId);
  if (domain.status !== 'active') throw new AppError('FORBIDDEN', '应用领域已归档');
  if (user.roles.includes('admin')) return;
  const member = getDb().prepare(`SELECT 1 FROM application_domain_member WHERE domain_id = ? AND user_id = ?`)
    .get(domainId, user.id);
  if (!member) throw new AppError('FORBIDDEN', '无权访问该应用领域');
}

export function createDomain(input: { domainKey: string; displayName: string; description?: string }, actor: AuthUser) {
  const domainKey = input.domainKey.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (!/^[a-z][a-z0-9-]{1,63}$/.test(domainKey) || !displayName) {
    throw new AppError('VALIDATION_ERROR', '领域标识须为 2-64 位小写字母、数字或连字符，且名称不能为空');
  }
  const id = newId('dom');
  const now = nowIso();
  try {
    getDb().transaction(() => {
      getDb().prepare(`INSERT INTO application_domain
        (id, domain_key, display_name, description, status, created_by, created_at, updated_at)
        VALUES (?,?,?,?, 'active', ?,?,?)`).run(id, domainKey, displayName, input.description?.trim() ?? '', actor.username, now, now);
      getDb().prepare(`INSERT INTO application_domain_member (domain_id, user_id, created_at) VALUES (?,?,?)`)
        .run(id, actor.id, now);
    })();
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE')) throw new AppError('CONFLICT', '领域标识已存在');
    throw error;
  }
  return getDomain(id);
}

export function updateDomain(id: string, input: { displayName?: string; description?: string; status?: string }) {
  const old = getDomain(id);
  const name = input.displayName === undefined ? old.displayName : input.displayName.trim();
  if (!name || (input.status && !['active', 'archived'].includes(input.status))) {
    throw new AppError('VALIDATION_ERROR', '领域名称或状态无效');
  }
  getDb().prepare(`UPDATE application_domain SET display_name = ?, description = ?, status = ?, updated_at = ? WHERE id = ?`)
    .run(name, input.description === undefined ? old.description : input.description.trim(),
      input.status ?? old.status, nowIso(), id);
  return getDomain(id);
}

export function listDomainMembers(domainId: string) {
  getDomain(domainId);
  return getDb().prepare(`SELECT u.id, u.username, u.display_name AS displayName, u.roles
    FROM application_domain_member m JOIN users u ON u.id = m.user_id
    WHERE m.domain_id = ? ORDER BY u.username`).all(domainId) as
    Array<{ id: string; username: string; displayName: string; roles: string }>;
}

export function setDomainMember(domainId: string, userId: string, enabled: boolean) {
  getDomain(domainId);
  if (!getDb().prepare('SELECT 1 FROM users WHERE id = ? AND disabled = 0').get(userId)) {
    throw new AppError('NOT_FOUND', '用户不存在或已停用');
  }
  if (enabled) getDb().prepare(`INSERT OR IGNORE INTO application_domain_member (domain_id, user_id, created_at)
    VALUES (?,?,?)`).run(domainId, userId, nowIso());
  else getDb().prepare('DELETE FROM application_domain_member WHERE domain_id = ? AND user_id = ?').run(domainId, userId);
  return { domainId, userId, enabled };
}

export function assertResourceDomain(table: string, keyColumn: string, key: string): void {
  const allowed: Record<string, string> = {
    ontology_type: 'type_key', link_def: 'link_key', interface_def: 'interface_key',
    shared_property: 'property_key', function_def: 'function_key', rule_def: 'rule_key',
    action_type: 'action_key', automation_rule: 'id', decision_type: 'type_key',
    object_instance: 'object_id', link_instance: 'id', source_record: 'id',
    evidence: 'id', ingest_job: 'id', decision_case: 'id', case_object: 'id',
    action_run: 'id', attachment: 'id', ai_suggestion: 'id', outbox_message: 'id',
  };
  if (allowed[table] !== keyColumn) throw new Error('无效的领域资源映射');
  const row = getDb().prepare(`SELECT 1 FROM ${table} WHERE ${keyColumn} = ? AND domain_id = ?`)
    .get(key, currentDomainId());
  if (!row) throw new AppError('NOT_FOUND', '资源不存在');
}

export function assertCaseChildDomain(table: string, id: string): void {
  if (!['alternative', 'scenario_run', 'approval', 'outcome', 'case_snapshot'].includes(table)) {
    throw new Error('无效的案例资源映射');
  }
  const row = getDb().prepare(`SELECT 1 FROM ${table} child
    JOIN decision_case parent ON parent.id = child.case_id
    WHERE child.id = ? AND parent.domain_id = ?`).get(id, currentDomainId());
  if (!row) throw new AppError('NOT_FOUND', '资源不存在');
}
