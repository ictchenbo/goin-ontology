// Ontology Registry：类型、属性、关系、Interface、模型版本与迁移
import { getDb, nowIso } from '../../db/database';
import { newId } from '../../shared/ids';
import { AppError } from '../../shared/errors';
import { writeAudit } from '../audit/audit-service';
import { stableStringify } from '../../shared/hash';
import { getFunction } from '../functions/function-service';
import { currentDomainId } from '../domains/domain-service';

export type PropertyType =
  | 'string' | 'number' | 'boolean' | 'datetime' | 'enum' | 'reference' | 'json';

export interface PropertyDef {
  name: string;
  type: PropertyType;
  label: string;
  required?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  enumValues?: string[];
  refType?: string;
  sensitive?: string; // PII / SOURCE / LEGAL / ...
  description?: string;
  default?: unknown;
  /** 供列表/详情展示 */
  showInList?: boolean;
  /** 共享属性来源；定义快照仍属于当前类型版本。 */
  sharedKey?: string;
  sharedVersion?: number;
  /** 只读计算属性：参数名映射到当前对象类型的普通属性名。 */
  computed?: { functionKey: string; inputs: Record<string, string> };
}

export interface TypeDefinition {
  properties: PropertyDef[];
  displayProperty?: string;
  titleTemplate?: string;
  searchFields?: string[];
}

export interface CreateTypeInput {
  typeKey: string;
  displayName: string;
  description?: string;
  category?: string;
  interfaces?: string[];
  icon?: string;
  definition: TypeDefinition;
  createdBy: string;
}

// 创建草稿类型 + 首个版本
export function createType(input: CreateTypeInput) {
  const db = getDb();
  const existing = db.prepare('SELECT type_key FROM ontology_type WHERE type_key = ?').get(input.typeKey);
  if (existing) throw new AppError('CONFLICT', `类型已存在: ${input.typeKey}`);
  validateDefinition(input.definition);
  assertInterfaces(input.definition, input.interfaces ?? []);
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(`INSERT INTO ontology_type
      (type_key, display_name, description, category, interfaces, icon, state, current_version, created_at, updated_at, domain_id)
      VALUES (?,?,?,?,?,?,?,1,?,?,?)`).run(
      input.typeKey, input.displayName, input.description ?? '', input.category ?? 'entity',
      JSON.stringify(input.interfaces ?? []), input.icon ?? 'box', 'draft', now, now, currentDomainId()
    );
    db.prepare(`INSERT INTO type_version
      (id, type_key, schema_version, definition_json, state, change_note, created_by, created_at)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      newId('tv'), input.typeKey, 1, JSON.stringify(input.definition), 'draft', '初始定义', input.createdBy, now
    );
    writeAudit({
      actor: input.createdBy, eventType: 'ontology.type_created',
      resourceType: 'ontology_type', resourceId: input.typeKey, after: input.definition,
    });
  });
  tx();
  return getType(input.typeKey);
}

export function validateDefinition(def: TypeDefinition): void {
  if (!def || !Array.isArray(def.properties)) {
    throw new AppError('SCHEMA_ERROR', 'definition.properties 必须是数组');
  }
  const names = new Set<string>();
  for (const p of def.properties as PropertyDef[]) {
    if (!p.name) throw new AppError('SCHEMA_ERROR', '属性缺少 name');
    if (names.has(p.name)) throw new AppError('SCHEMA_ERROR', `属性重名: ${p.name}`);
    names.add(p.name);
    if (!['string', 'number', 'boolean', 'datetime', 'enum', 'reference', 'json'].includes(p.type)) {
      throw new AppError('SCHEMA_ERROR', `属性 ${p.name} 类型非法: ${p.type}`);
    }
    if (p.type === 'enum' && (!p.enumValues || !p.enumValues.length)) {
      throw new AppError('SCHEMA_ERROR', `枚举属性 ${p.name} 缺少 enumValues`);
    }
    if (p.type === 'reference' && !p.refType) {
      throw new AppError('SCHEMA_ERROR', `引用属性 ${p.name} 缺少 refType`);
    }
    if (p.computed) {
      if (p.sharedKey || p.sharedVersion) throw new AppError('SCHEMA_ERROR', `计算属性 ${p.name} 不能引用共享定义`);
      if (p.required || p.default !== undefined) throw new AppError('SCHEMA_ERROR', `计算属性 ${p.name} 不能设置必填或默认值`);
      if (!p.computed.functionKey || !p.computed.inputs || typeof p.computed.inputs !== 'object' ||
        Array.isArray(p.computed.inputs)) throw new AppError('SCHEMA_ERROR', `计算属性 ${p.name} 缺少函数或输入映射`);
      const fn = getFunction(p.computed.functionKey);
      if (fn.outputType !== p.type) throw new AppError('SCHEMA_ERROR', `计算属性 ${p.name} 的输出类型与函数不一致`);
      if (fn.parameters.length !== Object.keys(p.computed.inputs).length ||
        fn.parameters.some((parameter) => !Object.hasOwn(p.computed!.inputs, parameter))) {
        throw new AppError('SCHEMA_ERROR', `计算属性 ${p.name} 的输入映射与函数参数不一致`);
      }
      for (const source of Object.values(p.computed.inputs)) {
        if (typeof source !== 'string' || !def.properties.some((candidate) =>
          candidate.name === source && !candidate.computed)) {
          throw new AppError('SCHEMA_ERROR', `计算属性 ${p.name} 的输入属性不存在或不是普通属性: ${String(source)}`);
        }
      }
    }
    if (p.sharedKey !== undefined || p.sharedVersion !== undefined) {
      if (!p.sharedKey || !Number.isInteger(p.sharedVersion) || p.sharedVersion! < 1) {
        throw new AppError('SCHEMA_ERROR', `共享属性 ${p.name} 缺少有效来源版本`);
      }
      const source = getDb().prepare(`SELECT spv.definition_json FROM shared_property_version spv
        JOIN shared_property sp ON sp.property_key = spv.property_key
        WHERE spv.property_key = ? AND spv.version = ? AND sp.domain_id = ?`)
        .get(p.sharedKey, p.sharedVersion, currentDomainId()) as
        { definition_json: string } | undefined;
      if (!source) throw new AppError('SCHEMA_ERROR', `共享属性版本不存在: ${p.sharedKey} v${p.sharedVersion}`);
      const { sharedKey: _key, sharedVersion: _version, ...inline } = p;
      if (stableStringify(JSON.parse(JSON.stringify(inline))) !== stableStringify(JSON.parse(source.definition_json))) {
        throw new AppError('SCHEMA_ERROR', `共享属性 ${p.name} 与引用版本不一致，请同步或解除共享引用`);
      }
    }
  }
  if (def.displayProperty && def.properties.some((property) =>
    property.name === def.displayProperty && property.computed)) {
    throw new AppError('SCHEMA_ERROR', '标题字段不能使用只读计算属性');
  }
}

function assertSharedDefinition(propertyKey: string, definition: PropertyDef): PropertyDef {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(propertyKey) || definition?.name !== propertyKey) {
    throw new AppError('SCHEMA_ERROR', '共享属性标识必须与合法属性名一致');
  }
  if (!definition.label?.trim() || definition.sharedKey !== undefined || definition.sharedVersion !== undefined) {
    throw new AppError('SCHEMA_ERROR', '共享属性必须有显示名，且定义本身不能引用其他共享属性');
  }
  validateDefinition({ properties: [definition] });
  return JSON.parse(JSON.stringify(definition)) as PropertyDef;
}

export function listSharedProperties() {
  const db = getDb();
  const latestDefinitions = db.prepare(`SELECT tv.type_key, tv.definition_json FROM type_version tv
    JOIN ontology_type ot ON ot.type_key = tv.type_key
    WHERE tv.state IN ('draft', 'published') AND ot.domain_id = ?`)
    .all(currentDomainId()) as Array<{ type_key: string; definition_json: string }>;
  const usages = new Map<string, string[]>();
  for (const type of latestDefinitions) {
    const def = JSON.parse(type.definition_json) as TypeDefinition;
    for (const property of def.properties) {
      if (property.sharedKey) usages.set(property.sharedKey,
        [...new Set([...(usages.get(property.sharedKey) ?? []), type.type_key])]);
    }
  }
  return (db.prepare('SELECT * FROM shared_property WHERE domain_id = ? ORDER BY updated_at DESC, created_at DESC, property_key')
    .all(currentDomainId()) as any[])
    .map((row) => ({ propertyKey: row.property_key,
      definition: JSON.parse(row.definition_json) as PropertyDef,
      version: row.current_version, usedBy: usages.get(row.property_key) ?? [],
      createdAt: row.created_at, updatedAt: row.updated_at }));
}

export function createSharedProperty(propertyKey: string, definition: PropertyDef, actor: string) {
  const property = assertSharedDefinition(propertyKey, definition);
  const db = getDb();
  const now = nowIso();
  db.transaction(() => {
    if (db.prepare('SELECT 1 FROM shared_property WHERE property_key = ?').get(propertyKey)) {
      throw new AppError('CONFLICT', `共享属性已存在: ${propertyKey}`);
    }
    db.prepare(`INSERT INTO shared_property
      (property_key, definition_json, current_version, created_by, created_at, updated_at, domain_id)
      VALUES (?,?,1,?,?,?,?)`).run(propertyKey, JSON.stringify(property), actor, now, now, currentDomainId());
    db.prepare(`INSERT INTO shared_property_version
      (id, property_key, version, definition_json, created_by, created_at)
      VALUES (?,?,1,?,?,?)`).run(newId('spv'), propertyKey, JSON.stringify(property), actor, now);
    writeAudit({ actor, eventType: 'ontology.shared_property_created', resourceType: 'shared_property',
      resourceId: propertyKey, after: property });
  })();
  return { propertyKey, definition: property, version: 1, usedBy: [] as string[] };
}

export function updateSharedProperty(propertyKey: string, definition: PropertyDef,
  expectedVersion: number, actor: string) {
  const property = assertSharedDefinition(propertyKey, definition);
  const db = getDb();
  const now = nowIso();
  const version = db.transaction(() => {
    const row = db.prepare('SELECT * FROM shared_property WHERE property_key = ?').get(propertyKey) as any;
    if (!row) throw new AppError('NOT_FOUND', `共享属性不存在: ${propertyKey}`);
    if (row.current_version !== expectedVersion) {
      throw new AppError('CONFLICT', `共享属性版本冲突: 当前 v${row.current_version}`);
    }
    const next = row.current_version + 1;
    db.prepare('UPDATE shared_property SET definition_json = ?, current_version = ?, updated_at = ? WHERE property_key = ?')
      .run(JSON.stringify(property), next, now, propertyKey);
    db.prepare(`INSERT INTO shared_property_version
      (id, property_key, version, definition_json, created_by, created_at)
      VALUES (?,?,?,?,?,?)`).run(newId('spv'), propertyKey, next, JSON.stringify(property), actor, now);
    writeAudit({ actor, eventType: 'ontology.shared_property_updated', resourceType: 'shared_property',
      resourceId: propertyKey, before: JSON.parse(row.definition_json), after: property,
      detail: { fromVersion: row.current_version, toVersion: next } });
    return next;
  })();
  return { propertyKey, definition: property, version };
}

function assertInterfaceContract(def: TypeDefinition, key: string, requirements: Array<{ name: string; type: string; required?: boolean }>): void {
  for (const required of requirements) {
    const actual = def.properties.find((p) => p.name === required.name);
    if (!actual || actual.type !== required.type || (required.required && !actual.required)) {
      throw new AppError('SCHEMA_ERROR', `类型未满足 Interface ${key} 的属性契约: ${required.name}`);
    }
  }
}

function assertInterfaces(def: TypeDefinition, keys: string[]): void {
  if (!Array.isArray(keys) || new Set(keys).size !== keys.length) {
    throw new AppError('SCHEMA_ERROR', 'interfaces 必须是不重复的标识数组');
  }
  for (const key of keys) {
    const contract = getInterface(key);
    assertInterfaceContract(def, key, contract.properties);
  }
}

export function getType(typeKey: string) {
  const db = getDb();
  const row = db.prepare('SELECT * FROM ontology_type WHERE type_key = ? AND domain_id = ?')
    .get(typeKey, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', `类型不存在: ${typeKey}`);
  const versions = db.prepare(
    'SELECT * FROM type_version WHERE type_key = ? ORDER BY schema_version DESC'
  ).all(typeKey) as any[];
  return {
    typeKey: row.type_key,
    displayName: row.display_name,
    description: row.description,
    category: row.category,
    interfaces: JSON.parse(row.interfaces || '[]'),
    icon: row.icon,
    state: row.state,
    currentVersion: row.current_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    definition: JSON.parse(versions[0]?.definition_json || '{"properties":[]}'),
    publishedDefinition: JSON.parse((versions.find((v) => v.state === 'published') ?? versions[0])?.definition_json || '{"properties":[]}'),
    versions: versions.map((v) => ({
      id: v.id,
      schemaVersion: v.schema_version,
      state: v.state,
      changeNote: v.change_note,
      createdBy: v.created_by,
      createdAt: v.created_at,
      publishedAt: v.published_at,
      definition: JSON.parse(v.definition_json),
    })),
  };
}

export function listTypes(category?: string) {
  const db = getDb();
  const rows = category
    ? db.prepare('SELECT * FROM ontology_type WHERE domain_id = ? AND category = ? ORDER BY updated_at DESC, created_at DESC, type_key')
      .all(currentDomainId(), category)
    : db.prepare('SELECT * FROM ontology_type WHERE domain_id = ? ORDER BY updated_at DESC, created_at DESC, type_key')
      .all(currentDomainId()) as any[];
  return (rows as any[]).map((row) => {
    const v = db.prepare(
      'SELECT definition_json FROM type_version WHERE type_key = ? ORDER BY schema_version DESC LIMIT 1'
    ).get(row.type_key) as any;
    return {
      typeKey: row.type_key,
      displayName: row.display_name,
      description: row.description,
      category: row.category,
      interfaces: JSON.parse(row.interfaces || '[]'),
      icon: row.icon,
      state: row.state,
      currentVersion: row.current_version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      propertyCount: JSON.parse(v?.definition_json || '{"properties":[]}').properties?.length ?? 0,
    };
  });
}

// 发布类型：草稿 -> 发布；已发布类型不可原地破坏性修改
export function publishType(typeKey: string, actor: string, changeNote?: string) {
  const t = getType(typeKey);
  const current = t.versions[0];
  if (!current) throw new AppError('SCHEMA_ERROR', '没有可发布版本');
  if (current.state === 'published') {
    throw new AppError('CONFLICT', '当前版本已发布，需先创建新版本');
  }
  const published = t.versions.find((v) => v.state === 'published');
  if (published && analyzeBreakingChange(published.definition, current.definition).length) {
    throw new AppError('SCHEMA_ERROR', '存在破坏性变更，请使用带迁移规则的版本发布接口');
  }
  if (changeNote) {
    getDb().prepare('UPDATE type_version SET change_note = ? WHERE id = ?').run(changeNote, current.id);
  }
  return publishVersionWithMigration(typeKey, current.schemaVersion, actor);
}

// 创建新版本（可选择迁移策略）；破坏性变更必须提供迁移规则
export function createTypeVersion(
  typeKey: string,
  definition: TypeDefinition,
  actor: string,
  opts: { changeNote?: string; migration?: MigrationRule } = {}
) {
  const db = getDb();
  const t = getType(typeKey);
  validateDefinition(definition);
  assertInterfaces(definition, t.interfaces);
  // 影响分析：检测破坏性变更
  const breaking = analyzeBreakingChange(t.definition, definition);
  if (breaking.length && !opts.migration) {
    throw new AppError('SCHEMA_ERROR', `存在破坏性变更，必须提供迁移规则: ${breaking.join('; ')}`, { breaking });
  }
  const nextVersion = Math.max(0, ...t.versions.map((v) => v.schemaVersion)) + 1;
  const id = newId('tv');
  db.prepare(`INSERT INTO type_version
    (id, type_key, schema_version, definition_json, state, change_note, created_by, created_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    id, typeKey, nextVersion, JSON.stringify(definition), 'draft',
    opts.changeNote ?? '', actor, nowIso()
  );
  db.prepare('UPDATE ontology_type SET updated_at = ? WHERE type_key = ?').run(nowIso(), typeKey);
  writeAudit({
    actor, eventType: 'ontology.version_created', resourceType: 'ontology_type',
    resourceId: typeKey, after: { schemaVersion: nextVersion, breaking },
  });
  return { ...getType(typeKey), breakingChanges: breaking };
}

export interface MigrationRule {
  /** 旧字段 -> 新字段 映射 */
  renameMap?: Record<string, string>;
  /** 字段默认值（新增必填或类型变化时） */
  defaults?: Record<string, unknown>;
  /** 枚举缩减映射 */
  enumMap?: Record<string, string>;
  /** 允许删除的字段 */
  dropFields?: string[];
}

export function analyzeBreakingChange(oldDef: TypeDefinition, newDef: TypeDefinition): string[] {
  const issues: string[] = [];
  const oldProps = new Map(oldDef.properties.map((p) => [p.name, p]));
  const newProps = new Map(newDef.properties.map((p) => [p.name, p]));
  for (const [name, op] of oldProps) {
    const np = newProps.get(name);
    if (!np) {
      issues.push(`删除字段 ${name}`);
      continue;
    }
    if (np.type !== op.type) issues.push(`字段 ${name} 类型变化 ${op.type}->${np.type}`);
    if (!op.computed && np.computed) issues.push(`字段 ${name} 改为只读计算属性`);
    if (np.required && !op.required) issues.push(`字段 ${name} 变为必填`);
    if (op.type === 'enum' && np.type === 'enum') {
      const removed = (op.enumValues || []).filter((v) => !(np.enumValues || []).includes(v));
      if (removed.length) issues.push(`字段 ${name} 枚举缩减: ${removed.join(',')}`);
    }
    if (op.type === 'reference' && np.refType && op.refType !== np.refType) {
      issues.push(`字段 ${name} 引用类型变化 ${op.refType}->${np.refType}`);
    }
  }
  return issues;
}

// 试运行迁移
export function previewMigration(typeKey: string, migration: MigrationRule) {
  const db = getDb();
  const objs = db.prepare('SELECT object_id, payload_json FROM object_instance WHERE type_key = ?').all(typeKey) as any[];
  const sample = objs.slice(0, 20).map((o) => {
    const payload = JSON.parse(o.payload_json);
    return { objectId: o.object_id, before: payload, after: applyMigration(payload, migration) };
  });
  return { totalObjects: objs.length, sample };
}

export function applyMigration(payload: Record<string, unknown>, migration: MigrationRule): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (migration.dropFields?.includes(k)) continue;
    const nk = migration.renameMap?.[k] ?? k;
    if (migration.enumMap && typeof v === 'string' && migration.enumMap[v]) {
      out[nk] = migration.enumMap[v];
    } else {
      out[nk] = v;
    }
  }
  for (const [k, def] of Object.entries(migration.defaults ?? {})) {
    if (out[k] === undefined) out[k] = def;
  }
  return out;
}

// 发布新版本并迁移实例
export function publishVersionWithMigration(
  typeKey: string,
  schemaVersion: number,
  actor: string,
  migration?: MigrationRule
) {
  const db = getDb();
  const t = getType(typeKey);
  const target = t.versions.find((v) => v.schemaVersion === schemaVersion);
  if (!target) throw new AppError('NOT_FOUND', `版本不存在: ${schemaVersion}`);
  if (target.state === 'archived') throw new AppError('CONFLICT', '归档版本不可发布');
  if (target.schemaVersion !== t.versions[0]?.schemaVersion) {
    throw new AppError('CONFLICT', '只能发布最新版本');
  }
  assertInterfaces(target.definition, t.interfaces);

  const published = t.versions.find((v) => v.state === 'published' && v.schemaVersion !== schemaVersion);
  const breaking = published ? analyzeBreakingChange(published.definition, target.definition) : [];
  if (breaking.length && !migration) {
    throw new AppError('SCHEMA_ERROR', `破坏性变更需要迁移规则: ${breaking.join('; ')}`);
  }
  const removed = published?.definition.properties.filter((p: PropertyDef) =>
    !target.definition.properties.some((n: PropertyDef) => n.name === p.name)) ?? [];
  for (const p of removed) {
    if (!migration?.dropFields?.includes(p.name) && !migration?.renameMap?.[p.name]) {
      throw new AppError('SCHEMA_ERROR', `删除属性 ${p.name} 需要 dropFields 或 renameMap 迁移规则`);
    }
  }
  for (const previous of published?.definition.properties ?? []) {
    const next = target.definition.properties.find((property: PropertyDef) => property.name === previous.name);
    if (!previous.computed && next?.computed && !migration?.dropFields?.includes(previous.name)) {
      throw new AppError('SCHEMA_ERROR', `字段 ${previous.name} 改为计算属性需要 dropFields 迁移规则`);
    }
  }

  const tx = db.transaction(() => {
    const objs = db.prepare('SELECT object_id, payload_json, revision FROM object_instance WHERE type_key = ? AND deleted = 0').all(typeKey) as any[];
    for (const o of objs) {
        const before = JSON.parse(o.payload_json);
        const after = migration ? applyMigration(before, migration) : before;
        validatePayload(typeKey, after, target.definition);
        const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])]
          .filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
        if (changed.length) {
          const newRev = o.revision + 1;
          db.prepare('UPDATE object_instance SET payload_json = ?, revision = ?, updated_at = ? WHERE object_id = ?')
            .run(JSON.stringify(after), newRev, nowIso(), o.object_id);
          db.prepare(`INSERT INTO object_revision (id, object_id, revision, payload_json, changed_fields, changed_by, change_reason, created_at)
            VALUES (?,?,?,?,?,?,?,?)`).run(
            newId('rev'), o.object_id, newRev, JSON.stringify(after), JSON.stringify(changed),
            actor, `模型迁移到 v${schemaVersion}`, nowIso()
          );
        }
        db.prepare('UPDATE object_instance SET schema_version = ? WHERE object_id = ?')
          .run(schemaVersion, o.object_id);
    }
    // 归档旧发布版本
    db.prepare(`UPDATE type_version SET state = 'archived' WHERE type_key = ? AND state = 'published' AND schema_version != ?`)
      .run(typeKey, schemaVersion);
    db.prepare(`UPDATE type_version SET state = 'published', published_at = ? WHERE id = ?`)
      .run(nowIso(), target.id);
    db.prepare(`UPDATE ontology_type SET state = 'published', current_version = ?, updated_at = ? WHERE type_key = ?`)
      .run(schemaVersion, nowIso(), typeKey);
    writeAudit({
      actor, eventType: 'ontology.version_published', resourceType: 'ontology_type',
      resourceId: typeKey, after: { schemaVersion, migration: migration ?? null },
    });
  });
  tx();
  return getType(typeKey);
}

// 回滚通过发布一个新版本实现，保留原版本和历史案例的引用。
export function rollbackTypeVersion(typeKey: string, previousVersion: number, actor: string, migration?: MigrationRule) {
  const db = getDb();
  const source = getType(typeKey).versions.find((version) => version.schemaVersion === previousVersion);
  if (!source) throw new AppError('NOT_FOUND', `回滚目标版本不存在: ${previousVersion}`);
  if (source.state === 'published') throw new AppError('CONFLICT', '目标版本已经是当前发布版本');
  return db.transaction(() => {
    const created = createTypeVersion(typeKey, source.definition, actor, {
      changeNote: `回滚到 v${previousVersion} 的定义`, migration,
    });
    const nextVersion = Math.max(...created.versions.map((version) => version.schemaVersion));
    const result = publishVersionWithMigration(typeKey, nextVersion, actor, migration);
    writeAudit({ actor, eventType: 'ontology.version_rolled_back',
      resourceType: 'ontology_type', resourceId: typeKey,
      after: { fromVersion: previousVersion, publishedVersion: nextVersion } });
    return result;
  })();
}

// 更新类型元数据（不改动 schema，schema 变更走版本机制）
export function updateTypeMeta(typeKey: string, patch: {
  displayName?: string;
  description?: string;
  category?: string;
  interfaces?: string[];
  icon?: string;
}, actor: string) {
  const db = getDb();
  const before = getType(typeKey);
  if (patch.interfaces !== undefined) assertInterfaces(before.publishedDefinition, patch.interfaces);
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.displayName !== undefined) { fields.push('display_name = ?'); values.push(patch.displayName); }
  if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
  if (patch.category !== undefined) { fields.push('category = ?'); values.push(patch.category); }
  if (patch.interfaces !== undefined) { fields.push('interfaces = ?'); values.push(JSON.stringify(patch.interfaces)); }
  if (patch.icon !== undefined) { fields.push('icon = ?'); values.push(patch.icon); }
  if (!fields.length) return before;
  fields.push('updated_at = ?'); values.push(nowIso());
  values.push(typeKey);
  db.prepare(`UPDATE ontology_type SET ${fields.join(', ')} WHERE type_key = ?`).run(...values);
  writeAudit({
    actor, eventType: 'ontology.type_updated', resourceType: 'ontology_type',
    resourceId: typeKey, before, after: patch,
  });
  return getType(typeKey);
}

/**
 * 删除对象类型
 * 默认软删（state=archived）；force=true 且无实例时才物理删除
 * 存在对象实例时拒绝物理删除，避免悬空引用
 */
export function deleteType(typeKey: string, actor: string, opts: { force?: boolean } = {}) {
  const db = getDb();
  const before = getType(typeKey);
  const objCount = (db.prepare(
    'SELECT COUNT(*) AS c FROM object_instance WHERE type_key = ? AND deleted = 0'
  ).get(typeKey) as any).c as number;
  const linkCount = (db.prepare(
    'SELECT COUNT(*) AS c FROM link_def WHERE from_type = ? OR to_type = ?'
  ).get(typeKey, typeKey) as any).c as number;

  if (objCount > 0) {
    throw new AppError('CONFLICT', `类型 ${typeKey} 存在 ${objCount} 个对象实例，请先清理后再删除`, {
      objectCount: objCount,
    });
  }
  if (linkCount > 0) {
    throw new AppError('CONFLICT', `类型 ${typeKey} 被 ${linkCount} 个链接类型引用，请先删除相关链接类型`, {
      linkCount,
    });
  }

  const now = nowIso();
  if (opts.force) {
    db.prepare('DELETE FROM type_version WHERE type_key = ?').run(typeKey);
    db.prepare('DELETE FROM ontology_type WHERE type_key = ?').run(typeKey);
  } else {
    db.prepare("UPDATE ontology_type SET state = 'archived', updated_at = ? WHERE type_key = ?").run(now, typeKey);
    db.prepare("UPDATE type_version SET state = 'archived' WHERE type_key = ?").run(typeKey);
  }
  writeAudit({
    actor, eventType: 'ontology.type_deleted', resourceType: 'ontology_type',
    resourceId: typeKey, before, detail: { force: !!opts.force, objCount, linkCount },
  });
  return { typeKey, deleted: true, force: !!opts.force, objectCount: objCount };
}

// 新增/更新单个属性：自动生成新 schema 版本，保留旧版本可追溯
export function upsertProperty(typeKey: string, prop: PropertyDef, actor: string, opts: { changeNote?: string } = {}) {
  const t = getType(typeKey);
  if (!prop?.name) throw new AppError('SCHEMA_ERROR', '属性缺少 name');
  validateDefinition({ properties: [prop] });
  const props = [...(t.definition.properties ?? [])];
  const idx = props.findIndex((p) => p.name === prop.name);
  const isNew = idx < 0;
  if (isNew) props.push(prop);
  else props[idx] = { ...props[idx], ...prop };
  const next: TypeDefinition = { ...t.definition, properties: props };
  const result = createTypeVersion(typeKey, next, actor, {
    changeNote: opts.changeNote ?? (isNew ? `新增属性 ${prop.name}` : `更新属性 ${prop.name}`),
  });
  return { ...result, propertyOp: isNew ? 'added' : 'updated', property: prop };
}

/**
 * 删除属性
 * 破坏性变更：若存在实例且该属性有值，必须显式传 migration.dropFields 或 force=true
 */
export function removeProperty(
  typeKey: string,
  propName: string,
  actor: string,
  opts: { force?: boolean; migration?: MigrationRule; changeNote?: string } = {}
) {
  const db = getDb();
  const t = getType(typeKey);
  const exists = ((t.definition?.properties ?? []) as PropertyDef[]).some((p) => p.name === propName);
  if (!exists) throw new AppError('NOT_FOUND', `属性不存在: ${propName}`);

  // 影响面：有多少实例在使用该字段
  const objs = db.prepare('SELECT object_id, payload_json FROM object_instance WHERE type_key = ? AND deleted = 0').all(typeKey) as any[];
  const affected = objs.filter((o) => {
    const p = JSON.parse(o.payload_json || '{}');
    return p[propName] !== undefined && p[propName] !== null && p[propName] !== '';
  }).length;

  const migration: MigrationRule = {
    ...(opts.migration ?? {}),
    dropFields: Array.from(new Set([...(opts.migration?.dropFields ?? []), propName])),
  };
  if (affected > 0 && !opts.force && !(opts.migration?.dropFields ?? []).includes(propName)) {
    throw new AppError('CONFLICT', `属性 ${propName} 被 ${affected} 个实例使用，需 force=true 或提供 dropFields 迁移规则`, {
      affected,
    });
  }

  const props = ((t.definition?.properties ?? []) as PropertyDef[]).filter((p) => p.name !== propName);
  const next: TypeDefinition = { ...t.definition, properties: props };
  const result = createTypeVersion(typeKey, next, actor, {
    changeNote: opts.changeNote ?? `删除属性 ${propName}`,
    migration,
  });
  return { ...result, propertyOp: 'removed', propertyName: propName, affected };
}

// ===== Link 定义 =====
export function updateLinkDef(linkKey: string, patch: {
  displayName?: string;
  cardinality?: string;
  inverseName?: string;
  description?: string;
  required?: boolean;
  allowSelfLoop?: boolean;
  state?: string;
}, actor: string) {
  const db = getDb();
  const before = getLinkDef(linkKey);
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.displayName !== undefined) { fields.push('display_name = ?'); values.push(patch.displayName); }
  if (patch.cardinality !== undefined) {
    if (!['1:1', '1:N', 'N:1', 'N:M'].includes(patch.cardinality)) {
      throw new AppError('SCHEMA_ERROR', `基数非法: ${patch.cardinality}`);
    }
    fields.push('cardinality = ?'); values.push(patch.cardinality);
  }
  if (patch.inverseName !== undefined) { fields.push('inverse_name = ?'); values.push(patch.inverseName); }
  if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
  if (patch.required !== undefined) { fields.push('required = ?'); values.push(patch.required ? 1 : 0); }
  if (patch.allowSelfLoop !== undefined) {
    if (patch.allowSelfLoop && before.fromType !== before.toType) {
      throw new AppError('SCHEMA_ERROR', '只有起点与终点类型相同的关系才能允许自环');
    }
    if (!patch.allowSelfLoop) {
      const count = (db.prepare(`SELECT COUNT(*) AS count FROM link_instance
        WHERE link_key = ? AND is_valid = 1 AND from_object_id = to_object_id`).get(linkKey) as { count: number }).count;
      if (count > 0) throw new AppError('CONFLICT', '已有自环连接，请先移除后再禁止自环');
    }
    fields.push('allow_self_loop = ?'); values.push(patch.allowSelfLoop ? 1 : 0);
  }
  if (patch.state !== undefined) {
    if (!['draft', 'published', 'archived'].includes(patch.state)) {
      throw new AppError('SCHEMA_ERROR', `状态非法: ${patch.state}`);
    }
    fields.push('state = ?'); values.push(patch.state);
  }
  if (!fields.length) return before;
  fields.push('updated_at = ?'); values.push(nowIso());
  values.push(linkKey);
  db.prepare(`UPDATE link_def SET ${fields.join(', ')} WHERE link_key = ?`).run(...values);
  writeAudit({
    actor, eventType: 'ontology.link_updated', resourceType: 'link_def',
    resourceId: linkKey, before, after: patch,
  });
  return getLinkDef(linkKey);
}

export function deleteLinkDef(linkKey: string, actor: string, opts: { force?: boolean } = {}) {
  const db = getDb();
  const before = getLinkDef(linkKey);
  const instCount = (db.prepare(
    'SELECT COUNT(*) AS c FROM link_instance WHERE link_key = ?'
  ).get(linkKey) as any).c as number;
  if (instCount > 0 && !opts.force) {
    db.prepare("UPDATE link_def SET state = 'archived', updated_at = ? WHERE link_key = ?")
      .run(nowIso(), linkKey);
    db.prepare("UPDATE link_instance SET is_valid = 0, valid_to = ? WHERE link_key = ? AND is_valid = 1")
      .run(nowIso(), linkKey);
    writeAudit({ actor, eventType: 'ontology.link_archived', resourceType: 'link_def',
      resourceId: linkKey, before, detail: { instanceCount: instCount } });
    return { linkKey, deleted: false, archived: true, instanceCount: instCount };
  }
  if (instCount > 0) {
    throw new AppError('CONFLICT', '该关系存在历史连接，不能物理删除；请先归档');
  }
  db.prepare('DELETE FROM link_def WHERE link_key = ?').run(linkKey);
  writeAudit({
    actor, eventType: 'ontology.link_deleted', resourceType: 'link_def',
    resourceId: linkKey, before, detail: { instanceCount: instCount, force: !!opts.force },
  });
  return { linkKey, deleted: true, invalidatedInstances: instCount };
}

// ===== Interface =====
export function updateInterface(interfaceKey: string, patch: {
  displayName?: string;
  description?: string;
  properties?: unknown[];
  capabilities?: string[];
}, actor: string) {
  const db = getDb();
  const before = getInterface(interfaceKey);
  if (patch.properties !== undefined) {
    const refs = db.prepare('SELECT type_key, interfaces FROM ontology_type').all() as any[];
    for (const ref of refs) {
      if ((JSON.parse(ref.interfaces || '[]') as string[]).includes(interfaceKey)) {
        const type = getType(ref.type_key);
        assertInterfaceContract(type.publishedDefinition, interfaceKey, patch.properties as Array<{ name: string; type: string; required?: boolean }>);
      }
    }
  }
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.displayName !== undefined) { fields.push('display_name = ?'); values.push(patch.displayName); }
  if (patch.description !== undefined) { fields.push('description = ?'); values.push(patch.description); }
  if (patch.properties !== undefined) {
    validateInterfaceProperties(patch.properties);
    fields.push('properties = ?'); values.push(JSON.stringify(patch.properties));
  }
  if (patch.capabilities !== undefined) {
    fields.push('capabilities = ?'); values.push(JSON.stringify(patch.capabilities));
  }
  if (!fields.length) return before;
  fields.push('updated_at = ?'); values.push(nowIso());
  values.push(interfaceKey);
  db.prepare(`UPDATE interface_def SET ${fields.join(', ')} WHERE interface_key = ?`).run(...values);
  writeAudit({
    actor, eventType: 'ontology.interface_updated', resourceType: 'interface_def',
    resourceId: interfaceKey, before, after: patch,
  });
  return getInterface(interfaceKey);
}

export function deleteInterface(interfaceKey: string, actor: string) {
  const db = getDb();
  const before = getInterface(interfaceKey);
  // 被对象类型引用时拒绝删除
  const types = db.prepare("SELECT type_key, interfaces FROM ontology_type WHERE interfaces LIKE ?").all(
    `%${interfaceKey}%`
  ) as any[];
  const referrers = types
    .map((t) => ({ typeKey: t.type_key, interfaces: JSON.parse(t.interfaces || '[]') }))
    .filter((t) => Array.isArray(t.interfaces) && t.interfaces.includes(interfaceKey));
  if (referrers.length) {
    throw new AppError('CONFLICT', `Interface ${interfaceKey} 被 ${referrers.length} 个类型引用: ${referrers.map((r) => r.typeKey).join(',')}`, {
      referrers,
    });
  }
  db.prepare('DELETE FROM interface_def WHERE interface_key = ?').run(interfaceKey);
  writeAudit({
    actor, eventType: 'ontology.interface_deleted', resourceType: 'interface_def',
    resourceId: interfaceKey, before,
  });
  return { interfaceKey, deleted: true };
}

function validateInterfaceProperties(props: unknown[]): void {
  if (!Array.isArray(props)) throw new AppError('SCHEMA_ERROR', 'Interface.properties 必须是数组');
  const names = new Set<string>();
  for (const raw of props) {
    const p = raw as any;
    if (!p?.name) throw new AppError('SCHEMA_ERROR', 'Interface 属性缺少 name');
    if (names.has(p.name)) throw new AppError('SCHEMA_ERROR', `Interface 属性重名: ${p.name}`);
    names.add(p.name);
    if (!['string', 'number', 'boolean', 'datetime', 'enum', 'reference', 'json'].includes(p.type)) {
      throw new AppError('SCHEMA_ERROR', `Interface 属性 ${p.name} 类型非法: ${p.type}`);
    }
  }
}

// ===== Link 定义 =====
export function createLinkDef(input: {
  linkKey: string;
  displayName: string;
  fromType: string;
  toType: string;
  cardinality?: string;
  inverseName?: string;
  description?: string;
  required?: boolean;
  allowSelfLoop?: boolean;
  actor: string;
}) {
  const db = getDb();
  const now = nowIso();
  if (input.cardinality && !['1:1', '1:N', 'N:1', 'N:M'].includes(input.cardinality)) {
    throw new AppError('SCHEMA_ERROR', `基数非法: ${input.cardinality}`);
  }
  if (input.allowSelfLoop && input.fromType !== input.toType) {
    throw new AppError('SCHEMA_ERROR', '只有起点与终点类型相同的关系才能允许自环');
  }
  try {
    db.prepare(`INSERT INTO link_def
      (link_key, display_name, from_type, to_type, cardinality, inverse_name, description, required,
       allow_self_loop, state, created_at, updated_at, domain_id)
      VALUES (?,?,?,?,?,?,?,?,?, 'published', ?, ?, ?)`).run(
      input.linkKey, input.displayName, input.fromType, input.toType,
      input.cardinality ?? '1:N', input.inverseName ?? '', input.description ?? '',
      input.required ? 1 : 0, input.allowSelfLoop ? 1 : 0, now, now, currentDomainId()
    );
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) throw new AppError('CONFLICT', `关系已存在: ${input.linkKey}`);
    if (String(e.message).includes('FOREIGN KEY')) throw new AppError('SCHEMA_ERROR', '起点或终点类型不存在');
    throw e;
  }
  writeAudit({
    actor: input.actor, eventType: 'ontology.link_created', resourceType: 'link_def',
    resourceId: input.linkKey, after: input,
  });
  return getLinkDef(input.linkKey);
}

export function getLinkDef(linkKey: string) {
  const row = getDb().prepare('SELECT * FROM link_def WHERE link_key = ? AND domain_id = ?')
    .get(linkKey, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', `关系不存在: ${linkKey}`);
  return mapLinkDef(row);
}

export function listLinkDefs(fromType?: string, toType?: string) {
  const db = getDb();
  let sql = 'SELECT * FROM link_def WHERE domain_id = ?';
  const params: unknown[] = [currentDomainId()];
  if (fromType) { sql += ' AND from_type = ?'; params.push(fromType); }
  if (toType) { sql += ' AND to_type = ?'; params.push(toType); }
  sql += ' ORDER BY link_key';
  return (db.prepare(sql).all(...params) as any[]).map(mapLinkDef);
}

function mapLinkDef(r: any) {
  return {
    linkKey: r.link_key,
    displayName: r.display_name,
    fromType: r.from_type,
    toType: r.to_type,
    cardinality: r.cardinality,
    inverseName: r.inverse_name,
    description: r.description,
    required: !!r.required,
    allowSelfLoop: !!r.allow_self_loop,
    state: r.state,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ===== Interface =====
export function createInterface(input: {
  interfaceKey: string;
  displayName: string;
  description?: string;
  properties?: unknown[];
  capabilities?: string[];
  actor?: string;
}) {
  const db = getDb();
  validateInterfaceProperties(input.properties ?? []);
  try {
    const now = nowIso();
    db.prepare(`INSERT INTO interface_def (interface_key, display_name, description, properties, capabilities, created_at, updated_at, domain_id)
      VALUES (?,?,?,?,?,?,?,?)`).run(
      input.interfaceKey, input.displayName, input.description ?? '',
      JSON.stringify(input.properties ?? []), JSON.stringify(input.capabilities ?? []), now, now, currentDomainId()
    );
  } catch (e: any) {
    if (String(e.message).includes('UNIQUE')) throw new AppError('CONFLICT', `Interface 已存在: ${input.interfaceKey}`);
    throw e;
  }
  if (input.actor) {
    writeAudit({
      actor: input.actor, eventType: 'ontology.interface_created', resourceType: 'interface_def',
      resourceId: input.interfaceKey, after: input,
    });
  }
  return getInterface(input.interfaceKey);
}

export function getInterface(key: string) {
  const row = getDb().prepare('SELECT * FROM interface_def WHERE interface_key = ? AND domain_id = ?')
    .get(key, currentDomainId()) as any;
  if (!row) throw new AppError('NOT_FOUND', `Interface 不存在: ${key}`);
  return {
    interfaceKey: row.interface_key,
    displayName: row.display_name,
    description: row.description,
    properties: JSON.parse(row.properties || '[]'),
    capabilities: JSON.parse(row.capabilities || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listInterfaces() {
  return (getDb().prepare('SELECT * FROM interface_def WHERE domain_id = ? ORDER BY interface_key')
    .all(currentDomainId()) as any[])
    .map((r) => getInterface(r.interface_key));
}

// 校验对象 payload 是否符合类型定义
export function validatePayload(typeKey: string, payload: Record<string, unknown>, definition?: TypeDefinition): Record<string, unknown> {
  const t = getType(typeKey);
  const def = definition ?? t.publishedDefinition;
  const errors: string[] = [];
  const out: Record<string, unknown> = {};
  for (const p of def.properties) {
    if (p.computed) {
      if (Object.hasOwn(payload, p.name)) errors.push(`计算属性不可写入: ${p.name}`);
      continue;
    }
    const v = payload[p.name];
    if (v === undefined || v === null || v === '') {
      if (p.required) errors.push(`缺少必填属性: ${p.name}`);
      if (p.default !== undefined) out[p.name] = p.default;
      continue;
    }
    switch (p.type) {
      case 'string':
        if (typeof v !== 'string') errors.push(`${p.name} 应为字符串`);
        else out[p.name] = v;
        break;
      case 'number': {
        const n = Number(v);
        if (Number.isNaN(n)) errors.push(`${p.name} 应为数值`);
        else {
          if (p.min !== undefined && n < p.min) errors.push(`${p.name} 小于下界 ${p.min}`);
          if (p.max !== undefined && n > p.max) errors.push(`${p.name} 大于上界 ${p.max}`);
          out[p.name] = n;
        }
        break;
      }
      case 'boolean':
        if (typeof v === 'boolean') out[p.name] = v;
        else if (v === 'true' || v === 'false') out[p.name] = v === 'true';
        else errors.push(`${p.name} 应为布尔`);
        break;
      case 'datetime':
        if (typeof v === 'string' && !Number.isNaN(Date.parse(v))) out[p.name] = v;
        else errors.push(`${p.name} 应为日期时间字符串`);
        break;
      case 'enum':
        if (p.enumValues && p.enumValues.includes(String(v))) out[p.name] = String(v);
        else errors.push(`${p.name} 不在枚举范围: ${p.enumValues?.join(',')}`);
        break;
      case 'reference':
        out[p.name] = String(v);
        break;
      case 'json':
        out[p.name] = v;
        break;
    }
  }
  // 允许附带不在定义中的非敏感字段（保留灵活性），但记录
  for (const [k, v] of Object.entries(payload)) {
    if (out[k] === undefined && !(def.properties as PropertyDef[]).find((p) => p.name === k)) {
      out[k] = v;
    }
  }
  if (errors.length) throw new AppError('SCHEMA_ERROR', `属性校验失败: ${errors.join('; ')}`, { errors });
  return out;
}
