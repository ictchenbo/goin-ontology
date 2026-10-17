// 认证与权限：用户/角色授权、对象及字段读取策略、Action 执行策略、数据标签
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { getDb, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import { currentDomainId } from '../domains/domain-service';

const JWT_SECRET = process.env.JWT_SECRET || 'ontology-ooda-dev-secret-change-me';
const TOKEN_TTL = '12h';

export type Role =
  | 'admin' | 'analyst' | 'approver' | 'operator' | 'observer'
  | 'intelligence' | 'commander' | 'safety_officer' | 'legal';

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  roles: Role[];
  securityClearance: string;
}

export interface JwtPayload {
  sub: string;
  username: string;
  roles: Role[];
  clearance: string;
}

export function hashPassword(password: string): string {
  return bcrypt.hashSync(password, 10);
}

export function verifyPassword(password: string, hash: string): boolean {
  return bcrypt.compareSync(password, hash);
}

export function login(username: string, password: string): { token: string; user: AuthUser } {
  const db = getDb();
  const row = db.prepare('SELECT * FROM users WHERE username = ? AND disabled = 0').get(username) as any;
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new AppError('UNAUTHORIZED', '用户名或密码错误');
  }
  const user = mapUser(row);
  const payload: JwtPayload = {
    sub: user.id,
    username: user.username,
    roles: user.roles,
    clearance: user.securityClearance,
  };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
  return { token, user };
}

export function verifyToken(token: string): AuthUser {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as JwtPayload;
    if (!payload.sub || !payload.username) throw new Error('令牌缺少用户身份');
    const row = getDb().prepare('SELECT * FROM users WHERE id = ? AND username = ? AND disabled = 0')
      .get(payload.sub, payload.username);
    if (!row) throw new Error('用户已停用或不存在');
    return mapUser(row);
  } catch {
    throw new AppError('UNAUTHORIZED', '登录凭证无效或已过期');
  }
}

export function mapUser(r: any): AuthUser {
  return {
    id: r.id,
    username: r.username,
    displayName: r.display_name,
    roles: JSON.parse(r.roles || '[]'),
    securityClearance: r.security_clearance || 'PUBLIC',
  };
}

export function createUser(input: {
  username: string;
  displayName: string;
  password: string;
  roles: Role[];
  securityClearance?: string;
}): AuthUser {
  const db = getDb();
  const id = newId('usr');
  try {
    db.prepare(`INSERT INTO users (id, username, display_name, password_hash, roles, security_clearance, disabled, created_at, updated_at)
      VALUES (?,?,?,?,?,?,0,?,?)`).run(
      id, input.username, input.displayName, hashPassword(input.password),
      JSON.stringify(input.roles), input.securityClearance ?? 'PUBLIC', nowIso(), nowIso()
    );
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) {
      throw new AppError('CONFLICT', `用户名已存在: ${input.username}`);
    }
    throw e;
  }
  return {
    id, username: input.username, displayName: input.displayName,
    roles: input.roles, securityClearance: input.securityClearance ?? 'PUBLIC',
  };
}

export function listUsers(): AuthUser[] {
  const rows = getDb().prepare('SELECT * FROM users ORDER BY username').all() as any[];
  return rows.map(mapUser);
}

// ===== 授权检查 =====

export function hasRole(user: AuthUser, roles: string | string[]): boolean {
  const list = Array.isArray(roles) ? roles : [roles];
  if (user.roles.includes('admin')) return true;
  return list.some((r) => user.roles.includes(r as Role));
}

export function requireRole(user: AuthUser, roles: string | string[]): void {
  if (!hasRole(user, roles)) {
    throw new AppError('FORBIDDEN', `需要角色: ${Array.isArray(roles) ? roles.join('/') : roles}`);
  }
}

// 密级层级：PUBLIC < CONFIDENTIAL < SECRET < TOP_SECRET
const CLEARANCE_ORDER = ['PUBLIC', 'CONFIDENTIAL', 'SECRET', 'TOP_SECRET'];

export function clearanceAllows(user: AuthUser, labels: string[]): boolean {
  if (!labels || labels.length === 0) return true;
  const userLevel = CLEARANCE_ORDER.indexOf(user.securityClearance);
  // 任一标签要求的密级不超过用户密级即可读
  return labels.every((lab) => {
    const idx = CLEARANCE_ORDER.indexOf(lab);
    if (idx < 0) return true; // 非密级标签（如 PII）由字段策略处理
    return userLevel >= idx;
  });
}

export function requireClearance(user: AuthUser, labels: string[]): void {
  if (!clearanceAllows(user, labels)) {
    throw new AppError('FORBIDDEN', `密级不足，需要: ${labels.join(',')}`);
  }
}

// 行级字段裁剪：按角色隐藏敏感字段
const FIELD_POLICIES: Record<string, { roles: Role[]; label: string }> = {
  ssn: { roles: ['admin', 'legal'], label: 'PII' },
  id_number: { roles: ['admin', 'legal'], label: 'PII' },
  home_address: { roles: ['admin', 'legal', 'safety_officer'], label: 'PII' },
  phone: { roles: ['admin', 'legal', 'safety_officer'], label: 'PII' },
  informant: { roles: ['admin', 'intelligence'], label: 'SOURCE' },
  source_identity: { roles: ['admin', 'intelligence'], label: 'SOURCE' },
  legal_basis: { roles: ['admin', 'legal', 'safety_officer'], label: 'LEGAL' },
};

export function redactFields(user: AuthUser, payload: Record<string, unknown>, typeKey?: string): Record<string, unknown> {
  const definitions = typeKey
    ? getDb().prepare('SELECT definition_json FROM type_version WHERE type_key = ? AND state = ? ORDER BY schema_version DESC LIMIT 1').get(typeKey, 'published') as any
    : null;
  const properties = definitions ? JSON.parse(definitions.definition_json).properties ?? [] : [];
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    const sensitive = properties.find((p: any) => p.name === k)?.sensitive;
    const policy = FIELD_POLICIES[k] ?? (sensitive ? {
      roles: sensitive === 'SOURCE' ? ['admin', 'intelligence'] :
        sensitive === 'LEGAL' ? ['admin', 'legal', 'safety_officer'] : ['admin', 'legal'],
      label: sensitive,
    } : undefined);
    if (policy && !hasRole(user, policy.roles)) {
      continue;
    } else {
      out[k] = Array.isArray(v)
        ? v.map((item) => item && typeof item === 'object' ? redactFields(user, item as Record<string, unknown>) : item)
        : v && typeof v === 'object' ? redactFields(user, v as Record<string, unknown>) : v;
    }
  }
  return out;
}

export function requireObjectAccess(user: AuthUser, objectId: string): void {
  const row = getDb().prepare('SELECT security_labels FROM object_instance WHERE object_id = ? AND deleted = 0 AND domain_id = ?')
    .get(objectId, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', `对象不存在: ${objectId}`);
  requireClearance(user, JSON.parse(row.security_labels || '["PUBLIC"]'));
}

export function requireCaseAccess(user: AuthUser, caseId: string): void {
  const row = getDb().prepare('SELECT security_labels FROM decision_case WHERE id = ? AND domain_id = ?')
    .get(caseId, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', `案例不存在: ${caseId}`);
  requireClearance(user, JSON.parse(row.security_labels || '["PUBLIC"]'));
}

// 衍生值标签并集：降级须经显式授权（此处默认拒绝降级）
export function mergeLabels(...labelSets: string[][]): string[] {
  const set = new Set<string>();
  for (const ls of labelSets) for (const l of ls ?? []) set.add(l);
  return [...set].sort();
}

export function labelsSubset(derived: string[], allowed: string[]): boolean {
  return derived.every((d) => allowed.includes(d));
}
