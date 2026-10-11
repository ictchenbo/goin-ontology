/**
 * 本体模型页：对象类型 / 链接类型 / 接口声明
 * - 属性级增删改（自动生成新 schema 版本）
 * - 类型删除（含实例占用保护）
 * - 链接类型与 Interface 的完整 CRUD
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { formatTime } from '@/lib/utils';

// ===== 类型定义（与后端 PropertyDef / TypeDefinition 对齐） =====
type PropType = 'string' | 'number' | 'boolean' | 'datetime' | 'enum' | 'reference' | 'json';

interface PropertyDef {
  name: string;
  type: PropType;
  label?: string;
  required?: boolean;
  unit?: string;
  min?: number;
  max?: number;
  enumValues?: string[];
  refType?: string;
  sensitive?: string;
  description?: string;
  default?: unknown;
}

interface TypeDefinition {
  properties: PropertyDef[];
  displayProperty?: string;
  titleTemplate?: string;
  searchFields?: string[];
}

interface TypeVersionRow {
  id: string;
  schemaVersion: number;
  state: string;
  changeNote?: string;
  createdBy?: string;
  createdAt?: string;
  publishedAt?: string;
  definition: TypeDefinition;
}

interface OntologyType {
  typeKey: string;
  displayName: string;
  description?: string;
  category?: string;
  interfaces?: string[];
  icon?: string;
  state?: string;
  currentVersion?: number;
  propertyCount?: number;
  definition?: TypeDefinition;
  versions?: TypeVersionRow[];
  createdAt?: string;
  updatedAt?: string;
}

interface LinkDef {
  linkKey: string;
  displayName: string;
  fromType: string;
  toType: string;
  cardinality: string;
  inverseName?: string;
  description?: string;
  required?: boolean;
  state?: string;
}

interface InterfaceDef {
  interfaceKey: string;
  displayName: string;
  description?: string;
  properties?: Array<{ name: string; type: string; required?: boolean }>;
  capabilities?: string[];
}

type Tab = 'types' | 'links' | 'interfaces';

const EMPTY_PROP: PropertyDef = { name: '', type: 'string', label: '', required: false };
const PROP_TYPES: PropType[] = ['string', 'number', 'boolean', 'datetime', 'enum', 'reference', 'json'];

export function OntologyPage() {
  const { hasRole } = useAuth();
  const [tab, setTab] = useState<Tab>('types');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const canEdit = hasRole('admin', 'analyst');
  const canDelete = hasRole('admin');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">本体模型</h1>
        <p className="text-muted-foreground">
          对象类型、属性、链接类型与 Interface 的注册中心。配置驱动，领域场景无需修改内核代码。
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {info && <Alert variant="success">{info}</Alert>}

      {/* 页签切换 */}
      <div role="tablist" aria-label="本体模型分区" className="flex flex-wrap gap-1 border-b border-border">
        {(
          [
            ['types', '对象类型'],
            ['links', '链接类型'],
            ['interfaces', '接口声明'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={
              tab === key
                ? 'border-b-2 border-primary px-4 py-2 text-sm font-medium text-primary'
                : 'px-4 py-2 text-sm text-muted-foreground hover:text-foreground'
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'types' && (
        <TypesPanel
          canEdit={canEdit}
          canDelete={canDelete}
          setError={setError}
          setInfo={setInfo}
        />
      )}
      {tab === 'links' && (
        <LinksPanel canEdit={canEdit} canDelete={canDelete} setError={setError} setInfo={setInfo} />
      )}
      {tab === 'interfaces' && (
        <InterfacesPanel
          canEdit={canEdit}
          canDelete={canDelete}
          setError={setError}
          setInfo={setInfo}
        />
      )}
    </div>
  );
}

// ===================== 对象类型面板 =====================
function TypesPanel(props: {
  canEdit: boolean;
  canDelete: boolean;
  setError: (s: string | null) => void;
  setInfo: (s: string | null) => void;
}) {
  const { canEdit, canDelete, setError, setInfo } = props;
  const [types, setTypes] = useState<OntologyType[]>([]);
  const [selected, setSelected] = useState<OntologyType | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showPropForm, setShowPropForm] = useState(false);
  const [propForm, setPropForm] = useState<PropertyDef>({ ...EMPTY_PROP });
  const [enumText, setEnumText] = useState('');
  const [migrationPreview, setMigrationPreview] = useState<string | null>(null);
  const [metaForm, setMetaForm] = useState({ displayName: '', description: '', category: '', icon: '', interfaces: '' });

  const loadTypes = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get<{ items?: OntologyType[] } | OntologyType[]>('/ontology/types');
      const list = Array.isArray(r) ? r : r.items || [];
      setTypes(list);
    } catch (e) {
      setError((e as ApiError)?.message || '加载本体类型失败');
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    loadTypes();
  }, [loadTypes]);

  async function loadDetail(typeKey: string) {
    try {
      const d = await api.get<OntologyType>(`/ontology/types/${encodeURIComponent(typeKey)}`);
      setSelected(d);
      setMetaForm({
        displayName: d.displayName || '',
        description: d.description || '',
        category: d.category || '',
        icon: d.icon || '',
        interfaces: (d.interfaces || []).join(','),
      });
      setMigrationPreview(null);
    } catch (e) {
      setError((e as ApiError)?.message || '加载类型详情失败');
    }
  }

  // 创建类型：字段与后端 createType 对齐（displayName + definition.properties）
  async function handleCreateType(form: {
    typeKey: string;
    displayName: string;
    category: string;
    description: string;
    properties: PropertyDef[];
  }) {
    try {
      await api.post('/ontology/types', {
        typeKey: form.typeKey.trim(),
        displayName: form.displayName.trim(),
        category: form.category,
        description: form.description,
        interfaces: [],
        definition: { properties: form.properties },
      });
      setInfo(`类型 ${form.typeKey} 创建成功`);
      setShowCreate(false);
      await loadTypes();
    } catch (e) {
      setError((e as ApiError)?.message || '创建类型失败');
    }
  }

  async function handleSaveMeta() {
    if (!selected) return;
    try {
      const updated = await api.patch<OntologyType>(`/ontology/types/${encodeURIComponent(selected.typeKey)}`, {
        displayName: metaForm.displayName,
        description: metaForm.description,
        category: metaForm.category,
        icon: metaForm.icon,
        interfaces: metaForm.interfaces
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      });
      setSelected(updated);
      setInfo('类型元数据已更新');
      await loadTypes();
    } catch (e) {
      setError((e as ApiError)?.message || '更新失败');
    }
  }

  // 属性：新增/更新（后端自动生成新版本）
  async function handleUpsertProperty() {
    if (!selected) return;
    const name = propForm.name.trim();
    if (!name) {
      setError('属性名不能为空');
      return;
    }
    const body: PropertyDef = {
      name,
      type: propForm.type,
      label: propForm.label || name,
      required: !!propForm.required,
    };
    if (propForm.type === 'number') {
      if (propForm.min !== undefined) body.min = propForm.min;
      if (propForm.max !== undefined) body.max = propForm.max;
      if (propForm.unit) body.unit = propForm.unit;
    }
    if (propForm.type === 'enum') {
      const vals = enumText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!vals.length) {
        setError('枚举属性必须提供取值（逗号分隔）');
        return;
      }
      body.enumValues = vals;
    }
    if (propForm.type === 'reference') {
      if (!propForm.refType?.trim()) {
        setError('引用属性必须指定 refType');
        return;
      }
      body.refType = propForm.refType.trim();
    }
    if (propForm.sensitive) body.sensitive = propForm.sensitive;
    if (propForm.description) body.description = propForm.description;
    try {
      const updated = await api.post<OntologyType>(
        `/ontology/types/${encodeURIComponent(selected.typeKey)}/properties`,
        body
      );
      setSelected(updated);
      setInfo(`属性 ${name} 已保存（新版本已生成）`);
      setShowPropForm(false);
      setPropForm({ ...EMPTY_PROP });
      setEnumText('');
      await loadTypes();
    } catch (e) {
      setError((e as ApiError)?.message || '保存属性失败');
    }
  }

  // 属性删除：破坏性变更，需二次确认
  async function handleDeleteProperty(propName: string) {
    if (!selected) return;
    const ok = window.confirm(
      `确认删除属性 "${propName}"？\n这是破坏性变更，会生成新的 schema 版本并从实例中移除该字段。`
    );
    if (!ok) return;
    try {
      const updated = await api.delete<OntologyType>(
        `/ontology/types/${encodeURIComponent(selected.typeKey)}/properties/${encodeURIComponent(propName)}`,
        { force: true }
      );
      setSelected(updated);
      setInfo(`属性 ${propName} 已删除`);
      await loadTypes();
    } catch (e) {
      setError((e as ApiError)?.message || '删除属性失败');
    }
  }

  // 类型删除
  async function handleDeleteType(typeKey: string) {
    const ok = window.confirm(
      `确认删除类型 "${typeKey}"？\n若该类型仍有关联的链接类型或对象实例，删除会被拒绝。`
    );
    if (!ok) return;
    try {
      await api.delete(`/ontology/types/${encodeURIComponent(typeKey)}`, { force: true });
      setInfo(`类型 ${typeKey} 已删除`);
      if (selected?.typeKey === typeKey) setSelected(null);
      await loadTypes();
    } catch (e) {
      setError((e as ApiError)?.message || '删除类型失败（可能存在对象实例或被链接类型引用）');
    }
  }

  async function handlePublish(typeKey: string) {
    try {
      await api.post(`/ontology/types/${encodeURIComponent(typeKey)}/publish`, {});
      setInfo('版本发布成功');
      await loadDetail(typeKey);
      await loadTypes();
    } catch (e) {
      setError((e as ApiError)?.message || '发布失败');
    }
  }

  async function handlePreviewMigration(typeKey: string) {
    try {
      const r = await api.post<unknown>(`/ontology/types/${encodeURIComponent(typeKey)}/migration-preview`, {
        migration: {},
      });
      setMigrationPreview(JSON.stringify(r, null, 2));
    } catch (e) {
      setMigrationPreview((e as ApiError)?.message || '迁移预览不可用');
    }
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate(!showCreate)}>{showCreate ? '取消' : '新建类型'}</Button>
        </div>
      )}

      {showCreate && canEdit && (
        <CreateTypeForm onSubmit={handleCreateType} onCancel={() => setShowCreate(false)} />
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>类型列表（{types.length}）</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-muted-foreground">加载中…</p>
            ) : types.length === 0 ? (
              <p className="text-muted-foreground">暂无类型，请先创建或运行种子数据。</p>
            ) : (
              <Table>
                <THeader>
                  <TR>
                    <TH>标识</TH>
                    <TH>名称</TH>
                    <TH>分类</TH>
                    <TH>属性数</TH>
                    <TH>状态</TH>
                    <TH>操作</TH>
                  </TR>
                </THeader>
                <TBody>
                  {types.map((t) => (
                    <TR key={t.typeKey}>
                      <TD className="font-mono text-xs">{t.typeKey}</TD>
                      <TD>{t.displayName}</TD>
                      <TD className="text-xs">{t.category || '—'}</TD>
                      <TD>{t.propertyCount ?? '—'}</TD>
                      <TD>
                        <Badge variant={statusVariant(t.state || '')}>{t.state || '—'}</Badge>
                      </TD>
                      <TD>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => loadDetail(t.typeKey)}>
                            详情
                          </Button>
                          {canDelete && (
                            <Button size="sm" variant="destructive" onClick={() => handleDeleteType(t.typeKey)}>
                              删除
                            </Button>
                          )}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>类型详情</CardTitle>
            <CardDescription>
              {selected ? `${selected.typeKey} · ${selected.displayName}` : '选择左侧类型查看属性定义'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <p className="text-muted-foreground">未选择类型。</p>
            ) : (
              <div className="space-y-5">
                {/* 元数据编辑 */}
                {canEdit && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <h4 className="text-sm font-semibold">基本信息</h4>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="meta-name">显示名称</Label>
                        <Input
                          id="meta-name"
                          value={metaForm.displayName}
                          onChange={(e) => setMetaForm({ ...metaForm, displayName: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="meta-cat">分类</Label>
                        <Input
                          id="meta-cat"
                          value={metaForm.category}
                          onChange={(e) => setMetaForm({ ...metaForm, category: e.target.value })}
                        />
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="meta-desc">描述</Label>
                      <Input
                        id="meta-desc"
                        value={metaForm.description}
                        onChange={(e) => setMetaForm({ ...metaForm, description: e.target.value })}
                      />
                    </div>
                    <div>
                      <Label htmlFor="meta-iface">所属接口（逗号分隔）</Label>
                      <Input
                        id="meta-iface"
                        value={metaForm.interfaces}
                        onChange={(e) => setMetaForm({ ...metaForm, interfaces: e.target.value })}
                        placeholder="如 Asset, Trackable"
                      />
                    </div>
                    <Button size="sm" onClick={handleSaveMeta}>
                      保存基本信息
                    </Button>
                  </div>
                )}

                {/* 属性表 */}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <h4 className="text-sm font-semibold">
                      属性定义（{(selected.definition?.properties || []).length}）
                    </h4>
                    {canEdit && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setShowPropForm(true);
                          setPropForm({ ...EMPTY_PROP });
                          setEnumText('');
                        }}
                      >
                        + 添加属性
                      </Button>
                    )}
                  </div>
                  <Table>
                    <THeader>
                      <TR>
                        <TH>字段</TH>
                        <TH>名称</TH>
                        <TH>类型</TH>
                        <TH>必填</TH>
                        <TH>约束</TH>
                        {canEdit && <TH>操作</TH>}
                      </TR>
                    </THeader>
                    <TBody>
                      {(selected.definition?.properties || []).map((p) => (
                        <TR key={p.name}>
                          <TD className="font-mono text-xs">{p.name}</TD>
                          <TD>{p.label || p.name}</TD>
                          <TD>{p.type}</TD>
                          <TD>{p.required ? '是' : '否'}</TD>
                          <TD className="text-xs text-muted-foreground">
                            {p.enumValues?.length ? `enum: ${p.enumValues.join('|')}` : ''}
                            {p.min !== undefined ? ` min=${p.min}` : ''}
                            {p.max !== undefined ? ` max=${p.max}` : ''}
                            {p.refType ? ` ref=${p.refType}` : ''}
                            {p.sensitive ? ` [${p.sensitive}]` : ''}
                          </TD>
                          {canEdit && (
                            <TD>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => handleDeleteProperty(p.name)}
                              >
                                删除
                              </Button>
                            </TD>
                          )}
                        </TR>
                      ))}
                      {(selected.definition?.properties || []).length === 0 && (
                        <TR>
                          <TD colSpan={canEdit ? 6 : 5} className="text-center text-muted-foreground">
                            暂无属性，点击「添加属性」开始定义。
                          </TD>
                        </TR>
                      )}
                    </TBody>
                  </Table>
                </div>

                {/* 属性新增表单 */}
                {showPropForm && canEdit && (
                  <div className="space-y-2 rounded-md border border-border p-3">
                    <h4 className="text-sm font-semibold">新增 / 更新属性</h4>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div>
                        <Label htmlFor="p-name">字段名 (name)</Label>
                        <Input
                          id="p-name"
                          value={propForm.name}
                          onChange={(e) => setPropForm({ ...propForm, name: e.target.value })}
                          placeholder="如 delayDays"
                        />
                      </div>
                      <div>
                        <Label htmlFor="p-label">显示名称</Label>
                        <Input
                          id="p-label"
                          value={propForm.label || ''}
                          onChange={(e) => setPropForm({ ...propForm, label: e.target.value })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="p-type">类型</Label>
                        <Select
                          id="p-type"
                          value={propForm.type}
                          onChange={(e) => setPropForm({ ...propForm, type: e.target.value as PropType })}
                        >
                          {PROP_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="flex items-center gap-2 pt-4">
                        <input
                          id="p-req"
                          type="checkbox"
                          checked={!!propForm.required}
                          onChange={(e) => setPropForm({ ...propForm, required: e.target.checked })}
                          aria-label="必填"
                        />
                        <Label htmlFor="p-req">必填</Label>
                      </div>
                      <div>
                        <Label htmlFor="p-sens">敏感级别</Label>
                        <Select
                          id="p-sens"
                          value={propForm.sensitive || ''}
                          onChange={(e) => setPropForm({ ...propForm, sensitive: e.target.value })}
                        >
                          <option value="">无</option>
                          <option value="PII">PII</option>
                          <option value="SOURCE">SOURCE</option>
                          <option value="LEGAL">LEGAL</option>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="p-desc">说明</Label>
                        <Input
                          id="p-desc"
                          value={propForm.description || ''}
                          onChange={(e) => setPropForm({ ...propForm, description: e.target.value })}
                        />
                      </div>
                    </div>
                    {propForm.type === 'number' && (
                      <div className="grid gap-2 sm:grid-cols-3">
                        <div>
                          <Label htmlFor="p-min">最小值</Label>
                          <Input
                            id="p-min"
                            type="number"
                            value={propForm.min ?? ''}
                            onChange={(e) =>
                              setPropForm({ ...propForm, min: e.target.value === '' ? undefined : Number(e.target.value) })
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor="p-max">最大值</Label>
                          <Input
                            id="p-max"
                            type="number"
                            value={propForm.max ?? ''}
                            onChange={(e) =>
                              setPropForm({ ...propForm, max: e.target.value === '' ? undefined : Number(e.target.value) })
                            }
                          />
                        </div>
                        <div>
                          <Label htmlFor="p-unit">单位</Label>
                          <Input
                            id="p-unit"
                            value={propForm.unit || ''}
                            onChange={(e) => setPropForm({ ...propForm, unit: e.target.value })}
                          />
                        </div>
                      </div>
                    )}
                    {propForm.type === 'enum' && (
                      <div>
                        <Label htmlFor="p-enum">枚举取值（逗号分隔）</Label>
                        <Input
                          id="p-enum"
                          value={enumText}
                          onChange={(e) => setEnumText(e.target.value)}
                          placeholder="如 qualified,pending,blocked"
                        />
                      </div>
                    )}
                    {propForm.type === 'reference' && (
                      <div>
                        <Label htmlFor="p-ref">引用类型 (refType)</Label>
                        <Input
                          id="p-ref"
                          value={propForm.refType || ''}
                          onChange={(e) => setPropForm({ ...propForm, refType: e.target.value })}
                          placeholder="如 Facility"
                        />
                      </div>
                    )}
                    <div className="flex gap-2">
                      <Button size="sm" onClick={handleUpsertProperty}>
                        保存属性
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setShowPropForm(false)}>
                        取消
                      </Button>
                    </div>
                  </div>
                )}

                {/* 版本 + 操作 */}
                <div>
                  <h4 className="mb-2 text-sm font-semibold">版本历史</h4>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {(selected.versions || []).map((v) => (
                      <li key={v.id}>
                        v{v.schemaVersion} · <Badge variant={statusVariant(v.state)}>{v.state}</Badge>
                        {v.changeNote ? ` · ${v.changeNote}` : ''} · {formatTime(v.createdAt)}
                      </li>
                    ))}
                  </ul>
                </div>

                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => handlePublish(selected.typeKey)}>
                      发布当前版本
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => handlePreviewMigration(selected.typeKey)}>
                      迁移预览
                    </Button>
                  </div>
                )}
                {migrationPreview && (
                  <pre className="max-h-60 overflow-auto rounded-md bg-muted p-3 text-xs">{migrationPreview}</pre>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// 新建类型表单：属性以结构化方式添加，避免手写 JSON 出错
function CreateTypeForm(props: {
  onSubmit: (f: { typeKey: string; displayName: string; category: string; description: string; properties: PropertyDef[] }) => void;
  onCancel: () => void;
}) {
  const [typeKey, setTypeKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [category, setCategory] = useState('entity');
  const [description, setDescription] = useState('');
  const [props_, setProps] = useState<PropertyDef[]>([
    { name: 'name', type: 'string', label: '名称', required: true },
    { name: 'status', type: 'string', label: '状态', required: true },
  ]);
  const [draft, setDraft] = useState<PropertyDef>({ ...EMPTY_PROP });
  const [enumText, setEnumText] = useState('');

  function addProp() {
    const name = draft.name.trim();
    if (!name) return;
    const body: PropertyDef = { name, type: draft.type, label: draft.label || name, required: !!draft.required };
    if (draft.type === 'number') {
      if (draft.min !== undefined) body.min = draft.min;
      if (draft.max !== undefined) body.max = draft.max;
    }
    if (draft.type === 'enum') {
      body.enumValues = enumText.split(',').map((s) => s.trim()).filter(Boolean);
      if (!body.enumValues.length) return;
    }
    if (draft.type === 'reference') {
      if (!draft.refType?.trim()) return;
      body.refType = draft.refType.trim();
    }
    setProps([...props_.filter((p) => p.name !== name), body]);
    setDraft({ ...EMPTY_PROP });
    setEnumText('');
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>新建本体类型</CardTitle>
        <CardDescription>属性以结构化方式定义，支持 string/number/boolean/datetime/enum/reference/json。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="ct-key">类型标识 (typeKey)</Label>
            <Input id="ct-key" value={typeKey} onChange={(e) => setTypeKey(e.target.value)} placeholder="如 Supplier" />
          </div>
          <div>
            <Label htmlFor="ct-name">显示名称</Label>
            <Input id="ct-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="如 供应商" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="ct-cat">分类</Label>
            <Select id="ct-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="entity">entity</option>
              <option value="event">event</option>
              <option value="decision">decision</option>
              <option value="core">core</option>
              <option value="supply-chain">supply-chain</option>
              <option value="military">military</option>
              <option value="public-safety">public-safety</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="ct-desc">描述</Label>
            <Input id="ct-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
        </div>

        <div>
          <Label>已添加属性（{props_.length}）</Label>
          <ul className="mt-1 space-y-1 text-xs">
            {props_.map((p) => (
              <li key={p.name} className="flex items-center justify-between rounded bg-muted px-2 py-1">
                <span className="font-mono">
                  {p.name} : {p.type}
                  {p.required ? ' *' : ''}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setProps(props_.filter((x) => x.name !== p.name))}>
                  移除
                </Button>
              </li>
            ))}
          </ul>
        </div>

        <div className="space-y-2 rounded-md border border-border p-3">
          <Label>添加属性</Label>
          <div className="grid gap-2 sm:grid-cols-4">
            <Input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="字段名"
              aria-label="字段名"
            />
            <Input
              value={draft.label || ''}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="显示名"
              aria-label="显示名"
            />
            <Select
              value={draft.type}
              onChange={(e) => setDraft({ ...draft, type: e.target.value as PropType })}
              aria-label="类型"
            >
              {PROP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={!!draft.required}
                onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
                aria-label="必填"
              />
              <span className="text-xs">必填</span>
            </div>
          </div>
          {draft.type === 'enum' && (
            <Input
              value={enumText}
              onChange={(e) => setEnumText(e.target.value)}
              placeholder="枚举取值，逗号分隔"
              aria-label="枚举取值"
            />
          )}
          {draft.type === 'reference' && (
            <Input
              value={draft.refType || ''}
              onChange={(e) => setDraft({ ...draft, refType: e.target.value })}
              placeholder="引用类型 refType"
              aria-label="引用类型"
            />
          )}
          <Button size="sm" variant="outline" onClick={addProp}>
            添加到列表
          </Button>
        </div>

        <div className="flex gap-2">
          <Button
            disabled={!typeKey.trim() || !displayName.trim()}
            onClick={() =>
              props.onSubmit({
                typeKey: typeKey.trim(),
                displayName: displayName.trim(),
                category,
                description,
                properties: props_,
              })
            }
          >
            创建
          </Button>
          <Button variant="outline" onClick={props.onCancel}>
            取消
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ===================== 链接类型面板 =====================
function LinksPanel(props: {
  canEdit: boolean;
  canDelete: boolean;
  setError: (s: string | null) => void;
  setInfo: (s: string | null) => void;
}) {
  const { canEdit, canDelete, setError, setInfo } = props;
  const [links, setLinks] = useState<LinkDef[]>([]);
  const [types, setTypes] = useState<OntologyType[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<LinkDef | null>(null);
  const [form, setForm] = useState({
    linkKey: '',
    displayName: '',
    fromType: '',
    toType: '',
    cardinality: '1:N',
    inverseName: '',
    description: '',
    required: false,
  });

  const load = useCallback(async () => {
    try {
      const [lr, tr] = await Promise.all([
        api.get<{ items?: LinkDef[] } | LinkDef[]>('/ontology/links'),
        api.get<{ items?: OntologyType[] } | OntologyType[]>('/ontology/types'),
      ]);
      setLinks(Array.isArray(lr) ? lr : lr.items || []);
      setTypes(Array.isArray(tr) ? tr : tr.items || []);
    } catch (e) {
      setError((e as ApiError)?.message || '加载链接类型失败');
    }
  }, [setError]);

  useEffect(() => {
    load();
  }, [load]);

  function startCreate() {
    setEditing(null);
    setForm({
      linkKey: '',
      displayName: '',
      fromType: types[0]?.typeKey || '',
      toType: types[1]?.typeKey || types[0]?.typeKey || '',
      cardinality: '1:N',
      inverseName: '',
      description: '',
      required: false,
    });
    setShowForm(true);
  }

  function startEdit(l: LinkDef) {
    setEditing(l);
    setForm({
      linkKey: l.linkKey,
      displayName: l.displayName,
      fromType: l.fromType,
      toType: l.toType,
      cardinality: l.cardinality || '1:N',
      inverseName: l.inverseName || '',
      description: l.description || '',
      required: !!l.required,
    });
    setShowForm(true);
  }

  async function handleSubmit() {
    try {
      if (editing) {
        await api.patch(`/ontology/links/${encodeURIComponent(editing.linkKey)}`, {
          displayName: form.displayName,
          cardinality: form.cardinality,
          inverseName: form.inverseName,
          description: form.description,
          required: form.required,
        });
        setInfo(`链接类型 ${editing.linkKey} 已更新`);
      } else {
        await api.post('/ontology/links', {
          linkKey: form.linkKey.trim(),
          displayName: form.displayName.trim(),
          fromType: form.fromType,
          toType: form.toType,
          cardinality: form.cardinality,
          inverseName: form.inverseName,
          description: form.description,
          required: form.required,
        });
        setInfo(`链接类型 ${form.linkKey} 已创建`);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError((e as ApiError)?.message || '保存链接类型失败');
    }
  }

  async function handleDelete(linkKey: string) {
    const ok = window.confirm(`确认删除链接类型 "${linkKey}"？\n若仍有关联实例，需强制删除。`);
    if (!ok) return;
    try {
      await api.delete(`/ontology/links/${encodeURIComponent(linkKey)}`, { force: true });
      setInfo(`链接类型 ${linkKey} 已删除`);
      await load();
    } catch (e) {
      setError((e as ApiError)?.message || '删除链接类型失败');
    }
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={startCreate}>新建链接类型</Button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? `编辑 ${editing.linkKey}` : '新建链接类型'}</CardTitle>
            <CardDescription>声明起点类型、终点类型、方向与基数约束（1:1 / 1:N / N:M）。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="lk-key">标识 (linkKey)</Label>
                <Input
                  id="lk-key"
                  value={form.linkKey}
                  disabled={!!editing}
                  onChange={(e) => setForm({ ...form, linkKey: e.target.value })}
                  placeholder="如 supplies"
                />
              </div>
              <div>
                <Label htmlFor="lk-name">显示名称</Label>
                <Input
                  id="lk-name"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                  placeholder="如 供货"
                />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="lk-from">起点类型</Label>
                <Select
                  id="lk-from"
                  value={form.fromType}
                  disabled={!!editing}
                  onChange={(e) => setForm({ ...form, fromType: e.target.value })}
                >
                  <option value="">— 选择 —</option>
                  {types.map((t) => (
                    <option key={t.typeKey} value={t.typeKey}>
                      {t.displayName} ({t.typeKey})
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="lk-to">终点类型</Label>
                <Select
                  id="lk-to"
                  value={form.toType}
                  disabled={!!editing}
                  onChange={(e) => setForm({ ...form, toType: e.target.value })}
                >
                  <option value="">— 选择 —</option>
                  {types.map((t) => (
                    <option key={t.typeKey} value={t.typeKey}>
                      {t.displayName} ({t.typeKey})
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="lk-card">基数</Label>
                <Select
                  id="lk-card"
                  value={form.cardinality}
                  onChange={(e) => setForm({ ...form, cardinality: e.target.value })}
                >
                  <option value="1:1">1:1</option>
                  <option value="1:N">1:N</option>
                  <option value="N:M">N:M</option>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="lk-inv">反向名称 (inverseName)</Label>
                <Input
                  id="lk-inv"
                  value={form.inverseName}
                  onChange={(e) => setForm({ ...form, inverseName: e.target.value })}
                  placeholder="如 由…供货"
                />
              </div>
              <div>
                <Label htmlFor="lk-desc">描述</Label>
                <Input
                  id="lk-desc"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="lk-req"
                type="checkbox"
                checked={form.required}
                onChange={(e) => setForm({ ...form, required: e.target.checked })}
              />
              <Label htmlFor="lk-req">必填关联</Label>
            </div>
            <div className="flex gap-2">
              <Button
                disabled={!form.displayName.trim() || (!editing && (!form.linkKey.trim() || !form.fromType || !form.toType))}
                onClick={handleSubmit}
              >
                {editing ? '保存修改' : '创建'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>链接类型（{links.length}）</CardTitle>
        </CardHeader>
        <CardContent>
          {links.length === 0 ? (
            <p className="text-muted-foreground">暂无链接类型。</p>
          ) : (
            <Table>
              <THeader>
                <TR>
                  <TH>标识</TH>
                  <TH>名称</TH>
                  <TH>起点 → 终点</TH>
                  <TH>基数</TH>
                  <TH>反向</TH>
                  {canEdit && <TH>操作</TH>}
                </TR>
              </THeader>
              <TBody>
                {links.map((l) => (
                  <TR key={l.linkKey}>
                    <TD className="font-mono text-xs">{l.linkKey}</TD>
                    <TD>{l.displayName}</TD>
                    <TD className="text-xs">
                      {l.fromType} → {l.toType}
                    </TD>
                    <TD>
                      <Badge variant="outline">{l.cardinality}</Badge>
                    </TD>
                    <TD className="text-xs">{l.inverseName || '—'}</TD>
                    {canEdit && (
                      <TD>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => startEdit(l)}>
                            编辑
                          </Button>
                          {canDelete && (
                            <Button size="sm" variant="destructive" onClick={() => handleDelete(l.linkKey)}>
                              删除
                            </Button>
                          )}
                        </div>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ===================== 接口声明面板 =====================
function InterfacesPanel(props: {
  canEdit: boolean;
  canDelete: boolean;
  setError: (s: string | null) => void;
  setInfo: (s: string | null) => void;
}) {
  const { canEdit, canDelete, setError, setInfo } = props;
  const [items, setItems] = useState<InterfaceDef[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<InterfaceDef | null>(null);
  const [form, setForm] = useState({
    interfaceKey: '',
    displayName: '',
    description: '',
    propertiesText: '[]',
    capabilitiesText: '',
  });

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ items?: InterfaceDef[] } | InterfaceDef[]>('/ontology/interfaces');
      setItems(Array.isArray(r) ? r : r.items || []);
    } catch (e) {
      setError((e as ApiError)?.message || '加载接口失败');
    }
  }, [setError]);

  useEffect(() => {
    load();
  }, [load]);

  function startCreate() {
    setEditing(null);
    setForm({
      interfaceKey: '',
      displayName: '',
      description: '',
      propertiesText: '[\n  { "name": "code", "type": "string", "required": true }\n]',
      capabilitiesText: '',
    });
    setShowForm(true);
  }

  function startEdit(i: InterfaceDef) {
    setEditing(i);
    setForm({
      interfaceKey: i.interfaceKey,
      displayName: i.displayName,
      description: i.description || '',
      propertiesText: JSON.stringify(i.properties || [], null, 2),
      capabilitiesText: (i.capabilities || []).join(','),
    });
    setShowForm(true);
  }

  async function handleSubmit() {
    let properties: unknown;
    try {
      properties = JSON.parse(form.propertiesText || '[]');
      if (!Array.isArray(properties)) throw new Error('必须是数组');
    } catch (e) {
      setError(`属性 JSON 解析失败：${e instanceof Error ? e.message : '格式错误'}`);
      return;
    }
    const capabilities = form.capabilitiesText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      if (editing) {
        await api.patch(`/ontology/interfaces/${encodeURIComponent(editing.interfaceKey)}`, {
          displayName: form.displayName,
          description: form.description,
          properties,
          capabilities,
        });
        setInfo(`接口 ${editing.interfaceKey} 已更新`);
      } else {
        await api.post('/ontology/interfaces', {
          interfaceKey: form.interfaceKey.trim(),
          displayName: form.displayName.trim(),
          description: form.description,
          properties,
          capabilities,
        });
        setInfo(`接口 ${form.interfaceKey} 已创建`);
      }
      setShowForm(false);
      await load();
    } catch (e) {
      setError((e as ApiError)?.message || '保存接口失败');
    }
  }

  async function handleDelete(key: string) {
    const ok = window.confirm(`确认删除接口 "${key}"？\n若仍有对象类型引用它，删除会被拒绝。`);
    if (!ok) return;
    try {
      await api.delete(`/ontology/interfaces/${encodeURIComponent(key)}`);
      setInfo(`接口 ${key} 已删除`);
      await load();
    } catch (e) {
      setError((e as ApiError)?.message || '删除接口失败（可能仍被对象类型引用）');
    }
  }

  return (
    <div className="space-y-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={startCreate}>新建接口</Button>
        </div>
      )}

      {showForm && (
        <Card>
          <CardHeader>
            <CardTitle>{editing ? `编辑 ${editing.interfaceKey}` : '新建接口'}</CardTitle>
            <CardDescription>
              Interface 定义跨类型的共同属性与可执行能力，供统一查询和工作台模板使用。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="if-key">标识 (interfaceKey)</Label>
                <Input
                  id="if-key"
                  value={form.interfaceKey}
                  disabled={!!editing}
                  onChange={(e) => setForm({ ...form, interfaceKey: e.target.value })}
                  placeholder="如 Trackable"
                />
              </div>
              <div>
                <Label htmlFor="if-name">显示名称</Label>
                <Input
                  id="if-name"
                  value={form.displayName}
                  onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="if-desc">描述</Label>
              <Input
                id="if-desc"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="if-props">共同属性 (JSON 数组)</Label>
              <Textarea
                id="if-props"
                rows={5}
                value={form.propertiesText}
                onChange={(e) => setForm({ ...form, propertiesText: e.target.value })}
                className="font-mono text-xs"
              />
            </div>
            <div>
              <Label htmlFor="if-caps">可执行能力（逗号分隔）</Label>
              <Input
                id="if-caps"
                value={form.capabilitiesText}
                onChange={(e) => setForm({ ...form, capabilitiesText: e.target.value })}
                placeholder="如 transfer, inspect, retire"
              />
            </div>
            <div className="flex gap-2">
              <Button
                disabled={!form.displayName.trim() || (!editing && !form.interfaceKey.trim())}
                onClick={handleSubmit}
              >
                {editing ? '保存修改' : '创建'}
              </Button>
              <Button variant="outline" onClick={() => setShowForm(false)}>
                取消
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>接口声明（{items.length}）</CardTitle>
        </CardHeader>
        <CardContent>
          {items.length === 0 ? (
            <p className="text-muted-foreground">暂无接口声明。</p>
          ) : (
            <Table>
              <THeader>
                <TR>
                  <TH>标识</TH>
                  <TH>名称</TH>
                  <TH>属性数</TH>
                  <TH>可执行能力</TH>
                  <TH>描述</TH>
                  {canEdit && <TH>操作</TH>}
                </TR>
              </THeader>
              <TBody>
                {items.map((i) => (
                  <TR key={i.interfaceKey}>
                    <TD className="font-mono text-xs">{i.interfaceKey}</TD>
                    <TD>{i.displayName}</TD>
                    <TD>{i.properties?.length ?? 0}</TD>
                    <TD className="text-xs">
                      {(i.capabilities || []).map((c) => (
                        <Badge key={c} variant="secondary" className="mr-1">
                          {c}
                        </Badge>
                      ))}
                      {(i.capabilities || []).length === 0 && '—'}
                    </TD>
                    <TD className="text-xs text-muted-foreground">{i.description || '—'}</TD>
                    {canEdit && (
                      <TD>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline" onClick={() => startEdit(i)}>
                            编辑
                          </Button>
                          {canDelete && (
                            <Button size="sm" variant="destructive" onClick={() => handleDelete(i.interfaceKey)}>
                              删除
                            </Button>
                          )}
                        </div>
                      </TD>
                    )}
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
