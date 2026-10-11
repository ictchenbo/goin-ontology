/** 本体配置工作台：类型、关系、动作、规则、函数与接口的可视化管理。 */
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert } from '@/components/ui/Alert';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';

type Tab = 'types' | 'shared' | 'links' | 'actions' | 'rules' | 'functions' | 'interfaces' | 'automations';
const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'types', label: '对象类型与属性' },
  { key: 'shared', label: '共享属性' },
  { key: 'links', label: '关系 Link' },
  { key: 'actions', label: 'Action' },
  { key: 'rules', label: '规则' },
  { key: 'functions', label: '函数' },
  { key: 'interfaces', label: 'Interface' },
  { key: 'automations', label: '自动化' },
];
const TYPE_CATEGORIES = [
  { value: 'entity', label: '实体（entity）' },
  { value: 'event', label: '事件（event）' },
  { value: 'decision', label: '决策（decision）' },
];

function message(error: unknown): string {
  return (error as ApiError)?.message || (error instanceof Error ? error.message : '操作失败');
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`${label}不是有效 JSON`);
  }
}

function json(value: unknown): string {
  return JSON.stringify(value ?? {}, null, 2);
}

function recentFirst<T extends { createdAt?: unknown; updatedAt?: unknown }>(items: T[]): T[] {
  return [...items].sort((a, b) =>
    String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')) ||
    String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function Notice({ error, info }: { error: string | null; info: string | null }) {
  return <>
    {error && <Alert variant="error">{error}</Alert>}
    {info && <Alert variant="success">{info}</Alert>}
  </>;
}

function Field({ label, value, onChange, disabled = false, required = false, placeholder }: {
  label: string; value: string; onChange: (value: string) => void;
  disabled?: boolean; required?: boolean; placeholder?: string;
}) {
  const id = useId();
  return <div className="space-y-1">
    <Label htmlFor={id}>{label}</Label>
    <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} required={required} placeholder={placeholder} />
  </div>;
}

function TypeCategorySelect({ value, onChange, disabled = false }: {
  value: string; onChange: (value: string) => void; disabled?: boolean;
}) {
  const id = useId();
  return <div className="space-y-1">
    <Label htmlFor={id}>分类</Label>
    <Select id={id} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)}>
      {value && !TYPE_CATEGORIES.some((item) => item.value === value) &&
        <option value={value}>原有分类（{value}）</option>}
      {TYPE_CATEGORIES.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
    </Select>
  </div>;
}

function JsonField({ label, value, onChange, rows = 5 }: {
  label: string; value: string; onChange: (value: string) => void; rows?: number;
}) {
  const id = useId();
  return <div className="space-y-1">
    <Label htmlFor={id}>{label}</Label>
    <Textarea id={id} className="font-mono text-xs" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
  </div>;
}

export function ModelStudioPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { module } = useParams();
  const requestedTab = new URLSearchParams(location.search).get('tab');
  const selectedTab = module ?? requestedTab;
  const tab: Tab = TABS.some((item) => item.key === selectedTab) ? selectedTab as Tab : 'types';
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'analyst');
  const canDelete = hasRole('admin');
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold">本体模型管理</h1>
        <p className="mt-1 text-sm text-muted-foreground">管理类型属性、关系、动作、规则、函数和接口定义。</p></div>
      <a href="/ontology-concepts.svg" target="_blank" rel="noopener noreferrer"
        className="rounded-md border border-border px-3 py-2 text-sm font-medium text-primary hover:bg-muted">
        查看概念关系图 <span className="sr-only">（新窗口打开）</span>
      </a>
    </div>
    <div role="tablist" aria-label="模型配置类别" className="flex flex-wrap gap-2 border-b border-border pb-3">
      {TABS.map((item) => <Button key={item.key} role="tab" aria-selected={tab === item.key}
        variant={tab === item.key ? 'primary' : 'outline'} size="sm"
        onClick={() => navigate(`/ontology/${item.key}`)}>
        {item.label}
      </Button>)}
    </div>
    {tab === 'types' && <ObjectTypeList canEdit={canEdit} canDelete={canDelete} />}
    {tab === 'shared' && <SharedPropertyList canEdit={canEdit} />}
    {tab !== 'types' && tab !== 'shared' && <ModelModuleList key={tab} tab={tab} canEdit={canEdit} canDelete={canDelete} />}
  </div>;
}

type Automation = {
  id: string; name: string; enabled: boolean;
  condition: { typeKey: string; expression: string; ruleKey?: string };
  effect: Record<string, unknown>;
};

function AutomationManager({ initialKey, canEdit }: { initialKey: string; canEdit: boolean }) {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<Array<{ id: string; ruleId: string; status: string; objectId: string }>>([]);
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [typeKey, setTypeKey] = useState('ObservedEvent');
  const [expression, setExpression] = useState('object.verificationStatus == "unverified"');
  const [ruleKey, setRuleKey] = useState('');
  const [triggerRules, setTriggerRules] = useState<Array<{ ruleKey: string; name: string; scopeType: string;
    expression: string }>>([]);
  const [effect, setEffect] = useState('{"type":"create_review_request","taskTypeKey":"ReviewRequest","title":"待人工核查"}');
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    const [ruleResponse, runResponse, triggerResponse] = await Promise.all([
      api.get<{ items: Automation[] }>('/automations'),
      api.get<{ items: Array<{ id: string; ruleId: string; status: string; objectId: string }> }>('/automations/runs'),
      api.get<{ items: Array<{ ruleKey: string; name: string; scopeType: string; expression: string }> }>('/rules?kind=trigger'),
    ]);
    setTriggerRules(triggerResponse.items);
    if (initialKey !== 'new') {
      const selected = ruleResponse.items.find((rule) => rule.id === initialKey);
      if (!selected) throw new Error(`自动化规则不存在: ${initialKey}`);
      edit(selected);
    }
    setRuns(runResponse.items.filter((run) => run.ruleId === initialKey));
  }, [initialKey]);
  useEffect(() => { void refresh().catch((e) => setError(message(e))); }, [refresh]);
  function edit(rule: Automation) {
    setId(rule.id); setName(rule.name); setTypeKey(rule.condition.typeKey);
    setExpression(rule.condition.expression); setRuleKey(rule.condition.ruleKey ?? '');
    setEffect(json(rule.effect)); setEnabled(rule.enabled);
  }
  async function save() {
    setError(null); setInfo(null);
    try {
      const saved = await api.post<Automation>('/automations', { ...(id ? { id } : {}), name, typeKey,
        expression: ruleKey ? undefined : expression, ruleKey: ruleKey || undefined,
        effect: parseJson(effect, '效果配置'), enabled });
      await refresh();
      setInfo('自动化规则已保存');
      if (initialKey === 'new') navigate(`/ontology/automations/${encodeURIComponent(saved.id)}`);
    } catch (e) { setError(message(e)); }
  }
  return <div className="space-y-4">
    <Notice error={error} info={info} />
    <Card><CardHeader><CardTitle>{initialKey === 'new' ? '新建自动化规则' : `编辑 ${initialKey}`}</CardTitle></CardHeader><CardContent className="space-y-3">
      <p className="text-sm text-muted-foreground">可引用已发布的触发规则；效果可创建案例、人工核查请求，或执行显式允许自动化的低影响 Action。</p>
      <div className="grid gap-3 md:grid-cols-2"><Field label="规则名称" value={name} onChange={setName} disabled={!canEdit} required />
        <Field label="对象类型" value={typeKey} onChange={setTypeKey} disabled={!canEdit} required /></div>
      <div className="space-y-1"><Label htmlFor="automation-rule">触发规则</Label>
        <Select id="automation-rule" value={ruleKey} disabled={!canEdit} onChange={(event) => setRuleKey(event.target.value)}>
          <option value="">自定义表达式</option>
          {triggerRules.filter((rule) => !rule.scopeType || rule.scopeType === typeKey).map((rule) =>
            <option key={rule.ruleKey} value={rule.ruleKey}>{rule.name} ({rule.ruleKey})</option>)}
        </Select></div>
      <Field label="条件表达式" value={ruleKey ? triggerRules.find((rule) => rule.ruleKey === ruleKey)?.expression ?? '' : expression}
        onChange={setExpression} disabled={!canEdit || !!ruleKey} required={!ruleKey} />
      <JsonField label="效果配置 JSON" value={effect} onChange={setEffect} rows={4} />
      <p className="text-xs text-muted-foreground">Action 效果示例：{`{"type":"execute_action","actionKey":"mark_review","params":{"reason":"${'${object.reason}'}"}}`}；系统自动传入触发对象 ID。</p>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={enabled}
        disabled={!canEdit} onChange={(event) => setEnabled(event.target.checked)} />启用</label>
      {canEdit && <Button onClick={() => void save()}>保存规则</Button>}
    </CardContent></Card>
    <Card><CardHeader><CardTitle>最近运行</CardTitle></CardHeader><CardContent className="space-y-3">
      {runs.slice(0, 20).map((run) => <div key={run.id} className="text-xs text-muted-foreground">
        {run.status} · {run.ruleId} · {run.objectId}</div>)}
      {!runs.length && <p className="text-sm text-muted-foreground">暂无运行记录</p>}
    </CardContent></Card>
  </div>;
}

type Property = {
  name: string; label: string; type: string; required?: boolean; unit?: string;
  min?: number; max?: number; enumValues?: string[]; refType?: string;
  sensitive?: string; description?: string; default?: unknown; showInList?: boolean;
  sharedKey?: string; sharedVersion?: number;
  computed?: { functionKey: string; inputs: Record<string, string> };
};
type SharedProperty = { propertyKey: string; definition: Property; version: number; usedBy: string[];
  createdAt?: string; updatedAt?: string };
type ObjectType = {
  typeKey: string; displayName: string; description: string; category: string;
  interfaces: string[]; state: string; currentVersion: number; propertyCount?: number;
  createdAt?: string; updatedAt?: string;
  definition: { properties: Property[]; displayProperty?: string; titleTemplate?: string; searchFields?: string[] };
  publishedDefinition: { properties: Property[] };
  versions: Array<{ schemaVersion: number; state: string; changeNote: string }>;
};
type InterfaceDef = { interfaceKey: string; displayName: string; description: string; properties: Array<{ name: string; type: string; required?: boolean }>; capabilities: string[] };

const blankProperty = (): Property => ({ name: '', label: '', type: 'string', required: false });

type PropertyEditState = {
  kind: 'local-add' | 'local-edit' | 'shared-new' | 'shared-edit';
  initial: Property;
  index?: number;
  shared?: SharedProperty;
};

function PropertyEditorDialog({ editor, onClose, onSave, functions = [], availableProperties = [] }: {
  editor: PropertyEditState | null; onClose: () => void;
  onSave: (property: Property) => Promise<void> | void;
  functions?: FunctionDef[]; availableProperties?: Property[];
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<Property>(blankProperty());
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (editor) {
      setDraft({ ...editor.initial }); setError(null);
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (dialog.current?.open) dialog.current.close();
  }, [editor]);
  const set = (patch: Partial<Property>) => setDraft((old) => ({ ...old, ...patch }));
  const local = editor?.kind === 'local-add' || editor?.kind === 'local-edit';
  const selectedFunction = functions.find((fn) => fn.functionKey === draft.computed?.functionKey);
  async function save() {
    setError(null);
    const name = draft.name.trim();
    if (!name || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      setError('属性名须以字母或下划线开头，仅含字母、数字和下划线'); return;
    }
    if (!draft.label.trim()) { setError('请填写显示名'); return; }
    if (draft.type === 'enum' && !draft.enumValues?.length) { setError('请填写枚举值'); return; }
    if (draft.type === 'reference' && !draft.refType?.trim()) { setError('请填写引用对象类型'); return; }
    if (draft.min !== undefined && draft.max !== undefined && draft.min > draft.max) {
      setError('最小值不能大于最大值'); return;
    }
    if (draft.computed) {
      if (!selectedFunction) { setError('请选择计算函数'); return; }
      if (selectedFunction.parameters.some((parameter) => !draft.computed?.inputs[parameter])) {
        setError('请为每个函数参数选择输入属性'); return;
      }
    }
    setSaving(true);
    try {
      const property: Property = { ...draft, name, label: draft.label.trim() };
      if (property.type !== 'enum') delete property.enumValues;
      if (property.type !== 'reference') delete property.refType;
      if (property.type !== 'number') { delete property.min; delete property.max; }
      if (property.computed) { property.required = false; delete property.default; }
      await onSave(property);
      onClose();
    } catch (failure) { setError(message(failure)); }
    finally { setSaving(false); }
  }
  const shared = editor?.kind.startsWith('shared');
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    aria-labelledby="property-dialog-title"
    className="w-[min(92vw,700px)] max-h-[90vh] rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50">
    <div className="max-h-[90vh] overflow-y-auto p-5 sm:p-6">
      <h3 id="property-dialog-title" className="text-lg font-semibold">
        {editor?.kind === 'local-edit' ? '修改属性' : editor?.kind === 'shared-edit' ? '修改共享属性' : shared ? '新建共享属性' : '添加属性'}
      </h3>
      {editor?.kind === 'local-edit' && editor.initial.sharedKey &&
        <p className="mt-2 text-sm text-muted-foreground">修改此属性会解除共享引用；如需更新共享定义，请在“共享属性”模块编辑后同步。</p>}
      {shared && <p className="mt-2 text-sm text-muted-foreground">共享定义更新后，已引用的类型需手动同步并发布新版本。</p>}
      {error && <div className="mt-3"><Alert variant="error">{error}</Alert></div>}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <Field label="属性名" value={draft.name} onChange={(v) => set({ name: v })}
          disabled={editor?.kind === 'shared-edit'} required />
        <Field label="显示名" value={draft.label} onChange={(v) => set({ label: v })} required />
        <div className="space-y-1"><Label htmlFor="property-dialog-type">{draft.computed ? '输出类型' : '类型'}</Label>
          <Select id="property-dialog-type" value={draft.type} disabled={!!draft.computed} onChange={(event) => set({ type: event.target.value })}>
            {['string', 'number', 'boolean', 'datetime', 'enum', 'reference', 'json'].map((item) =>
              <option key={item} value={item}>{item}</option>)}
          </Select></div>
        <div className="flex items-end gap-5 pb-2">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!draft.required} disabled={!!draft.computed}
            onChange={(event) => set({ required: event.target.checked })} />必填</label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!draft.showInList}
            onChange={(event) => set({ showInList: event.target.checked })} />列表显示</label>
        </div>
        {local && <div className="sm:col-span-2 space-y-3 rounded-md border border-border p-3">
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={!!draft.computed}
            onChange={(event) => set({ computed: event.target.checked ? { functionKey: '', inputs: {} } : undefined,
              required: event.target.checked ? false : draft.required })} />只读计算属性</label>
          {draft.computed && <>
            <div className="space-y-1"><Label htmlFor="property-computed-function">计算函数</Label>
              <Select id="property-computed-function" value={draft.computed.functionKey}
                onChange={(event) => {
                  const fn = functions.find((item) => item.functionKey === event.target.value);
                  set({ type: fn?.outputType ?? draft.type,
                    computed: { functionKey: event.target.value, inputs: {} } });
                }}>
                <option value="">选择函数</option>
                {functions.map((fn) => <option key={fn.functionKey} value={fn.functionKey}>
                  {fn.name} ({fn.functionKey}) → {fn.outputType}</option>)}
              </Select></div>
            {selectedFunction?.parameters.map((parameter) => <div key={parameter} className="space-y-1">
              <Label htmlFor={`property-input-${parameter}`}>参数 {parameter} 的输入属性</Label>
              <Select id={`property-input-${parameter}`} value={draft.computed?.inputs[parameter] ?? ''}
                onChange={(event) => set({ computed: { functionKey: draft.computed!.functionKey,
                  inputs: { ...draft.computed!.inputs, [parameter]: event.target.value } } })}>
                <option value="">选择普通属性</option>
                {availableProperties.filter((property) => !property.computed && property.name !== draft.name)
                  .map((property) => <option key={property.name} value={property.name}>
                    {property.label} ({property.name}) · {property.type}</option>)}
              </Select></div>)}
            <p className="text-xs text-muted-foreground">读取对象时按当前函数版本计算；结果不会写入实例。普通属性改为计算属性时，发布版本需迁移旧字段。</p>
          </>}
        </div>}
        {draft.type === 'enum' && <Field label="枚举值（逗号分隔）" value={(draft.enumValues ?? []).join(', ')}
          onChange={(v) => set({ enumValues: v.split(',').map((part) => part.trim()).filter(Boolean) })} />}
        {draft.type === 'reference' && <Field label="引用对象类型" value={draft.refType ?? ''}
          onChange={(v) => set({ refType: v })} />}
        {draft.type === 'number' && <><Field label="最小值" value={draft.min === undefined ? '' : String(draft.min)}
          onChange={(v) => set({ min: v === '' ? undefined : Number(v) })} />
          <Field label="最大值" value={draft.max === undefined ? '' : String(draft.max)}
            onChange={(v) => set({ max: v === '' ? undefined : Number(v) })} /></>}
        <Field label="单位" value={draft.unit ?? ''} onChange={(v) => set({ unit: v })} />
        <Field label="敏感标签" value={draft.sensitive ?? ''} onChange={(v) => set({ sensitive: v })} />
        <div className="sm:col-span-2"><Field label="说明" value={draft.description ?? ''}
          onChange={(v) => set({ description: v })} /></div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={saving}>取消</Button>
        <Button onClick={() => void save()} disabled={saving}>{saving ? '保存中…' : '保存属性'}</Button>
      </div>
    </div>
  </dialog>;
}

function SharedPickerDialog({ open, items, usedNames, onClose, onAttach }: {
  open: boolean; items: SharedProperty[]; usedNames: string[];
  onClose: () => void; onAttach: (item: SharedProperty) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }}
    onClick={(event) => { if (event.target === dialog.current) onClose(); }}
    aria-labelledby="shared-picker-title"
    className="w-[min(92vw,580px)] max-h-[85vh] rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-black/50">
    <div className="flex items-center justify-between gap-3"><h3 id="shared-picker-title" className="text-lg font-semibold">引用共享属性</h3>
      <Button variant="outline" size="sm" onClick={onClose}>关闭</Button></div>
    <div className="mt-4 max-h-[65vh] space-y-2 overflow-y-auto">
      {!items.length && <p className="text-sm text-muted-foreground">共享属性库为空，请先在“共享属性”模块创建。</p>}
      {items.map((item) => <div key={item.propertyKey} className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
        <div><div className="font-medium">{item.definition.label} <span className="font-mono text-sm text-muted-foreground">{item.propertyKey}</span></div>
          <div className="text-xs text-muted-foreground">{item.definition.type} · v{item.version} · {item.usedBy.length} 个类型引用</div></div>
        <Button size="sm" disabled={usedNames.includes(item.definition.name)} onClick={() => { onAttach(item); onClose(); }}>
          {usedNames.includes(item.definition.name) ? '已添加' : '引用'}</Button>
      </div>)}
    </div>
  </dialog>;
}

type TypeMeta = { typeKey: string; displayName: string; category: string; description: string };

function TypeMetaDialog({ item, onClose, onSave }: {
  item: TypeMeta | null; onClose: () => void; onSave: (value: TypeMeta) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState<TypeMeta>({ typeKey: '', displayName: '', category: 'entity', description: '' });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (item) { setDraft(item); setError(null); if (!dialog.current?.open) dialog.current?.showModal(); }
    else if (dialog.current?.open) dialog.current.close();
  }, [item]);
  async function save() {
    const value = { ...draft, typeKey: draft.typeKey.trim(), displayName: draft.displayName.trim(),
      category: draft.category.trim(), description: draft.description.trim() };
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value.typeKey)) {
      setError('类型标识须以字母或下划线开头，仅含字母、数字和下划线'); return;
    }
    if (!value.displayName) { setError('请填写显示名称'); return; }
    setSaving(true); setError(null);
    try { await onSave(value); onClose(); }
    catch (failure) { setError(message(failure)); }
    finally { setSaving(false); }
  }
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }}
    aria-labelledby="type-meta-dialog-title"
    className="w-[min(92vw,560px)] rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-black/50">
    <h3 id="type-meta-dialog-title" className="text-lg font-semibold">{item?.typeKey ? '编辑对象类型' : '新建对象类型'}</h3>
    {error && <div className="mt-3"><Alert variant="error">{error}</Alert></div>}
    <div className="mt-5 space-y-4">
      <Field label="类型标识" value={draft.typeKey} onChange={(typeKey) => setDraft({ ...draft, typeKey })}
        disabled={!!item?.typeKey} required />
      <Field label="显示名称" value={draft.displayName} onChange={(displayName) => setDraft({ ...draft, displayName })} required />
      <TypeCategorySelect value={draft.category} onChange={(category) => setDraft({ ...draft, category })} />
      <Field label="说明" value={draft.description} onChange={(description) => setDraft({ ...draft, description })} />
    </div>
    <div className="mt-6 flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={onClose}>取消</Button>
      <Button disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</Button></div>
  </dialog>;
}

function ObjectTypeList({ canEdit, canDelete }: { canEdit: boolean; canDelete: boolean }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<ObjectType[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editor, setEditor] = useState<TypeMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const load = useCallback(async () => {
    setItems(recentFirst((await api.get<{ items: ObjectType[] }>('/ontology/types')).items));
  }, []);
  useEffect(() => { void load().catch((failure) => setError(message(failure))); }, [load]);
  const filtered = items.filter((item) => `${item.displayName} ${item.typeKey} ${item.category}`
    .toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  async function save(value: TypeMeta) {
    if (editor?.typeKey) {
      await api.patch(`/ontology/types/${encodeURIComponent(editor.typeKey)}`, {
        displayName: value.displayName, category: value.category, description: value.description,
      });
      setInfo('对象类型基本信息已更新');
    } else {
      const created = await api.post<ObjectType>('/ontology/types', {
        ...value, interfaces: [], definition: { properties: [] },
      });
      navigate(`/ontology/types/${encodeURIComponent(created.typeKey)}`);
      return;
    }
    await load();
  }
  async function act(item: ObjectType, action: 'publish' | 'delete') {
    const prompt = action === 'delete' ? `删除对象类型 ${item.typeKey}？存在实例或关系时服务器会拒绝。` :
      `发布对象类型 ${item.typeKey} 的草稿版本？`;
    if (!window.confirm(prompt)) return;
    setBusyKey(item.typeKey); setError(null); setInfo(null);
    try {
      if (action === 'delete') await api.delete(`/ontology/types/${encodeURIComponent(item.typeKey)}`);
      else await api.post(`/ontology/types/${encodeURIComponent(item.typeKey)}/publish`, {});
      await load();
      setInfo(action === 'delete' ? '对象类型已删除' : '对象类型已发布');
    } catch (failure) { setError(message(failure)); }
    finally { setBusyKey(''); }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-lg font-semibold">对象类型列表</h2>
        <p className="text-sm text-muted-foreground">在列表中管理基本信息，进入详情编辑属性与版本。</p></div>
      {canEdit && <Button onClick={() => setEditor({ typeKey: '', displayName: '', category: 'entity', description: '' })}>新建类型</Button>}
    </div>
    <Notice error={error} info={info} />
    <Card><CardContent className="space-y-4 pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-full max-w-sm"><Field label="搜索类型" value={search} onChange={(value) => { setSearch(value); setPage(1); }}
          placeholder="名称、标识或分类" /></div>
        <div className="space-y-1"><Label htmlFor="type-page-size">每页</Label>
          <Select id="type-page-size" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
            {[10, 20, 50].map((size) => <option key={size} value={size}>{size} 条</option>)}
          </Select></div>
      </div>
      <div className="rounded-md border border-border"><Table><THeader><TR>
        <TH>对象类型</TH><TH>分类</TH><TH>属性数</TH><TH>状态</TH><TH>当前版本</TH><TH>操作</TH>
      </TR></THeader><TBody>{visible.length ? visible.map((item) => <TR key={item.typeKey}>
        <TD><Link className="font-medium text-primary hover:underline" to={`/ontology/types/${encodeURIComponent(item.typeKey)}`}>
          {item.displayName}</Link><div className="font-mono text-xs text-muted-foreground">{item.typeKey}</div></TD>
        <TD>{item.category}</TD><TD>{item.propertyCount ?? '—'}</TD>
        <TD><Badge variant={item.state === 'published' ? 'success' : 'warning'}>{item.state}</Badge></TD>
        <TD>v{item.currentVersion}</TD><TD><div className="flex flex-wrap gap-1">
          <Button size="sm" variant="outline" onClick={() => navigate(`/ontology/types/${encodeURIComponent(item.typeKey)}`)}>详情</Button>
          {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditor({ typeKey: item.typeKey,
            displayName: item.displayName, category: item.category, description: item.description })}>编辑</Button>}
          {canEdit && item.state === 'draft' && <Button size="sm" variant="secondary" disabled={!!busyKey}
            onClick={() => void act(item, 'publish')}>发布</Button>}
          {canDelete && <Button size="sm" variant="destructive" disabled={!!busyKey}
            onClick={() => void act(item, 'delete')}>删除</Button>}
        </div></TD>
      </TR>) : <TR><TD colSpan={6} className="py-8 text-center text-muted-foreground">没有匹配的对象类型</TD></TR>}</TBody></Table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>共 {filtered.length} 条 · 第 {currentPage} / {pages} 页</span>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={currentPage <= 1}
          onClick={() => setPage(currentPage - 1)}>上一页</Button>
          <Button size="sm" variant="outline" disabled={currentPage >= pages}
            onClick={() => setPage(currentPage + 1)}>下一页</Button></div>
      </div>
    </CardContent></Card>
    <TypeMetaDialog item={editor} onClose={() => setEditor(null)} onSave={save} />
  </div>;
}

type SecondaryTab = Exclude<Tab, 'types' | 'shared'>;
type ModuleRecord = Record<string, unknown>;
const MODULE_CONFIG: Record<SecondaryTab, { title: string; endpoint: string; key: string }> = {
  links: { title: '关系 Link', endpoint: '/ontology/links', key: 'linkKey' },
  actions: { title: 'Action', endpoint: '/action-types', key: 'actionKey' },
  rules: { title: '规则', endpoint: '/rules', key: 'ruleKey' },
  functions: { title: '函数', endpoint: '/functions', key: 'functionKey' },
  interfaces: { title: 'Interface', endpoint: '/ontology/interfaces', key: 'interfaceKey' },
  automations: { title: '自动化', endpoint: '/automations', key: 'id' },
};

function moduleName(tab: SecondaryTab, item: ModuleRecord): string {
  return String(item[tab === 'links' || tab === 'interfaces' ? 'displayName' : 'name'] ?? '');
}

function moduleSummary(tab: SecondaryTab, item: ModuleRecord): string {
  if (tab === 'links') return `${item.fromType} → ${item.toType} · ${item.cardinality}`;
  if (tab === 'interfaces') return `${(item.properties as unknown[] | undefined)?.length ?? 0} 个契约属性`;
  if (tab === 'automations') return String((item.condition as { typeKey?: string } | undefined)?.typeKey ?? '');
  return `${tab === 'rules' ? `${item.kind} · ` : ''}v${item.version ?? 1}`;
}

function ModuleQuickDialog({ tab, item, onClose, onSave }: {
  tab: SecondaryTab; item: ModuleRecord | null; onClose: () => void;
  onSave: (name: string, description: string) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (item) {
      setName(moduleName(tab, item)); setDescription(String(item.description ?? '')); setError(null);
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (dialog.current?.open) dialog.current.close();
  }, [item, tab]);
  async function save() {
    if (!name.trim()) { setError('请填写名称'); return; }
    setSaving(true); setError(null);
    try { await onSave(name.trim(), description.trim()); onClose(); }
    catch (failure) { setError(message(failure)); }
    finally { setSaving(false); }
  }
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }}
    aria-labelledby="module-quick-title"
    className="w-[min(92vw,560px)] rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-black/50">
    <h3 id="module-quick-title" className="text-lg font-semibold">编辑{MODULE_CONFIG[tab].title}基本信息</h3>
    {['actions', 'rules', 'functions'].includes(tab) &&
      <p className="mt-2 text-sm text-muted-foreground">保存基本信息会生成新的定义版本。</p>}
    {error && <div className="mt-3"><Alert variant="error">{error}</Alert></div>}
    <div className="mt-5 space-y-4"><Field label="名称" value={name} onChange={setName} required />
      {tab !== 'automations' && <Field label="说明" value={description} onChange={setDescription} />}</div>
    <div className="mt-6 flex justify-end gap-2"><Button variant="outline" disabled={saving} onClick={onClose}>取消</Button>
      <Button disabled={saving} onClick={() => void save()}>{saving ? '保存中…' : '保存'}</Button></div>
  </dialog>;
}

function ModelModuleList({ tab, canEdit, canDelete }: {
  tab: SecondaryTab; canEdit: boolean; canDelete: boolean;
}) {
  const navigate = useNavigate();
  const config = MODULE_CONFIG[tab];
  const editable = tab === 'automations' ? canDelete : canEdit;
  const [items, setItems] = useState<ModuleRecord[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editing, setEditing] = useState<ModuleRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState('');
  const load = useCallback(async () => {
    setItems(recentFirst((await api.get<{ items: ModuleRecord[] }>(config.endpoint)).items));
  }, [config.endpoint]);
  useEffect(() => { void load().catch((failure) => setError(message(failure))); }, [load]);
  const filtered = items.filter((item) => `${moduleName(tab, item)} ${item[config.key]} ${moduleSummary(tab, item)}`
    .toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  async function saveQuick(name: string, description: string) {
    if (!editing) return;
    const key = encodeURIComponent(String(editing[config.key]));
    if (tab === 'links' || tab === 'interfaces') {
      await api.patch(`${config.endpoint}/${key}`, { displayName: name, description });
    } else if (tab === 'automations') {
      const condition = editing.condition as { typeKey: string; expression: string; ruleKey?: string };
      await api.post(config.endpoint, { id: editing.id, name, typeKey: condition.typeKey,
        expression: condition.expression, ruleKey: condition.ruleKey || undefined,
        effect: editing.effect, enabled: editing.enabled });
    } else {
      await api.post(config.endpoint, { ...editing, name, description });
    }
    await load(); setInfo('基本信息已保存');
  }
  async function act(item: ModuleRecord, action: 'delete' | 'toggle') {
    const key = String(item[config.key]);
    if (action === 'delete' && !window.confirm(`删除 ${config.title} ${key}？服务器会检查关联数据。`)) return;
    setBusyKey(key); setError(null); setInfo(null);
    try {
      if (action === 'delete') await api.delete(`${config.endpoint}/${encodeURIComponent(key)}`);
      else {
        const condition = item.condition as { typeKey: string; expression: string };
        await api.post(config.endpoint, { id: item.id, name: item.name, typeKey: condition.typeKey,
          expression: condition.expression, effect: item.effect, enabled: !item.enabled });
      }
      await load(); setInfo(action === 'delete' ? '操作已完成；有关联记录的定义可能已归档' : '启用状态已更新');
    } catch (failure) { setError(message(failure)); }
    finally { setBusyKey(''); }
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div>
      <h2 className="text-lg font-semibold">{config.title}列表</h2>
      <p className="text-sm text-muted-foreground">在列表中管理基本信息，进入详情编辑完整定义。</p></div>
      {editable && <Button onClick={() => navigate(`/ontology/${tab}/new`)}>新建{config.title}</Button>}
    </div>
    <Notice error={error} info={info} />
    <Card><CardContent className="space-y-4 pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div className="w-full max-w-sm">
        <Field label={`搜索${config.title}`} value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="名称或标识" />
      </div><div className="space-y-1"><Label htmlFor={`${tab}-page-size`}>每页</Label>
        <Select id={`${tab}-page-size`} value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
          {[10, 20, 50].map((size) => <option key={size} value={size}>{size} 条</option>)}
        </Select></div></div>
      <div className="rounded-md border border-border"><Table><THeader><TR>
        <TH>{config.title}</TH><TH>概要</TH><TH>状态</TH><TH>操作</TH>
      </TR></THeader><TBody>{visible.length ? visible.map((item) => {
        const key = String(item[config.key]);
        const status = tab === 'automations' ? (item.enabled ? '启用' : '停用') : String(item.state ?? '—');
        return <TR key={key}><TD><Link className="font-medium text-primary hover:underline"
          to={`/ontology/${tab}/${encodeURIComponent(key)}`}>{moduleName(tab, item)}</Link>
          <div className="font-mono text-xs text-muted-foreground">{key}</div></TD>
          <TD className="text-sm text-muted-foreground">{moduleSummary(tab, item)}</TD>
          <TD><Badge variant={status === 'published' || status === '启用' ? 'success' : 'secondary'}>{status}</Badge></TD>
          <TD><div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => navigate(`/ontology/${tab}/${encodeURIComponent(key)}`)}>详情</Button>
            {editable && <Button size="sm" variant="ghost" onClick={() => setEditing(item)}>编辑</Button>}
            {tab === 'automations' && canDelete && <Button size="sm" variant="secondary" disabled={!!busyKey}
              onClick={() => void act(item, 'toggle')}>{item.enabled ? '停用' : '启用'}</Button>}
            {tab !== 'automations' && canDelete && <Button size="sm" variant="destructive" disabled={!!busyKey}
              onClick={() => void act(item, 'delete')}>删除</Button>}
          </div></TD></TR>;
      }) : <TR><TD colSpan={4} className="py-8 text-center text-muted-foreground">没有匹配的定义</TD></TR>}</TBody></Table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>共 {filtered.length} 条 · 第 {currentPage} / {pages} 页</span>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={currentPage <= 1}
          onClick={() => setPage(currentPage - 1)}>上一页</Button>
          <Button size="sm" variant="outline" disabled={currentPage >= pages}
            onClick={() => setPage(currentPage + 1)}>下一页</Button></div>
      </div>
    </CardContent></Card>
    <ModuleQuickDialog tab={tab} item={editing} onClose={() => setEditing(null)} onSave={saveQuick} />
  </div>;
}

function SharedPropertyList({ canEdit }: { canEdit: boolean }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<SharedProperty[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editor, setEditor] = useState<PropertyEditState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const load = useCallback(async () => {
    setItems(recentFirst((await api.get<{ items: SharedProperty[] }>('/ontology/shared-properties')).items));
  }, []);
  useEffect(() => { void load().catch((failure) => setError(message(failure))); }, [load]);
  const filtered = items.filter((item) => `${item.definition.label} ${item.propertyKey} ${item.definition.type}`
    .toLowerCase().includes(search.trim().toLowerCase()));
  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  async function save(property: Property) {
    if (editor?.kind === 'shared-edit' && editor.shared) {
      await api.put(`/ontology/shared-properties/${encodeURIComponent(editor.shared.propertyKey)}`, {
        definition: property, expectedVersion: editor.shared.version,
      });
      setInfo('共享定义已更新；引用类型需分别同步并发布');
    } else {
      const created = await api.post<SharedProperty>('/ontology/shared-properties', {
        propertyKey: property.name, definition: property,
      });
      navigate(`/ontology/shared/${encodeURIComponent(created.propertyKey)}`);
      return;
    }
    await load();
  }
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div>
      <h2 className="text-lg font-semibold">共享属性列表</h2>
      <p className="text-sm text-muted-foreground">统一属性定义可被多个对象类型引用；更新后由各类型手动同步。</p></div>
      {canEdit && <Button onClick={() => setEditor({ kind: 'shared-new', initial: blankProperty() })}>新建共享属性</Button>}
    </div>
    <Notice error={error} info={info} />
    <Card><CardContent className="space-y-4 pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3"><div className="w-full max-w-sm">
        <Field label="搜索共享属性" value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder="名称、标识或类型" />
      </div><div className="space-y-1"><Label htmlFor="shared-page-size">每页</Label>
        <Select id="shared-page-size" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}>
          {[10, 20, 50].map((size) => <option key={size} value={size}>{size} 条</option>)}
        </Select></div></div>
      <div className="rounded-md border border-border"><Table><THeader><TR>
        <TH>共享属性</TH><TH>类型</TH><TH>版本</TH><TH>引用类型数</TH><TH>操作</TH>
      </TR></THeader><TBody>{visible.length ? visible.map((item) => <TR key={item.propertyKey}>
        <TD><Link className="font-medium text-primary hover:underline" to={`/ontology/shared/${encodeURIComponent(item.propertyKey)}`}>
          {item.definition.label}</Link><div className="font-mono text-xs text-muted-foreground">{item.propertyKey}</div></TD>
        <TD>{item.definition.type}</TD><TD>v{item.version}</TD><TD>{item.usedBy.length}</TD>
        <TD><div className="flex flex-wrap gap-1"><Link to={`/ontology/shared/${encodeURIComponent(item.propertyKey)}`}
          className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs hover:bg-accent">详情</Link>
          {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditor({ kind: 'shared-edit', initial: item.definition, shared: item })}>编辑</Button>}
        </div></TD></TR>) : <TR><TD colSpan={5} className="py-8 text-center text-muted-foreground">暂无匹配的共享属性</TD></TR>}</TBody></Table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>共 {filtered.length} 条 · 第 {currentPage} / {pages} 页</span>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={currentPage <= 1}
          onClick={() => setPage(currentPage - 1)}>上一页</Button>
          <Button size="sm" variant="outline" disabled={currentPage >= pages}
            onClick={() => setPage(currentPage + 1)}>下一页</Button></div>
      </div>
    </CardContent></Card>
    <PropertyEditorDialog editor={editor} onClose={() => setEditor(null)} onSave={save} />
  </div>;
}

function SharedPropertyDetail({ propertyKey, canEdit }: { propertyKey: string; canEdit: boolean }) {
  const [item, setItem] = useState<SharedProperty | null>(null);
  const [editor, setEditor] = useState<PropertyEditState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const load = useCallback(async () => {
    const result = await api.get<{ items: SharedProperty[] }>('/ontology/shared-properties');
    const found = result.items.find((entry) => entry.propertyKey === propertyKey);
    if (!found) throw new Error(`共享属性不存在: ${propertyKey}`);
    setItem(found);
  }, [propertyKey]);
  useEffect(() => { void load().catch((failure) => setError(message(failure))); }, [load]);
  async function save(property: Property) {
    if (!item) return;
    await api.put(`/ontology/shared-properties/${encodeURIComponent(item.propertyKey)}`, {
      definition: property, expectedVersion: item.version,
    });
    await load(); setInfo('共享定义已更新；引用类型需分别同步并发布');
  }
  return <div className="space-y-4"><Notice error={error} info={info} />
    {item && <><Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-3">
      <div><CardTitle>{item.definition.label}</CardTitle><p className="font-mono text-sm text-muted-foreground">{item.propertyKey} · v{item.version}</p></div>
      {canEdit && <Button onClick={() => setEditor({ kind: 'shared-edit', initial: item.definition, shared: item })}>编辑共享属性</Button>}
    </div></CardHeader><CardContent className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2"><div>类型：{item.definition.type}</div>
        <div>必填：{item.definition.required ? '是' : '否'}</div>
        <div>列表显示：{item.definition.showInList ? '是' : '否'}</div>
        <div>单位：{item.definition.unit || '—'}</div>
        <div>敏感标签：{item.definition.sensitive || '—'}</div>
        <div>引用对象类型：{item.definition.refType || '—'}</div></div>
      <p>说明：{item.definition.description || '—'}</p>
    </CardContent></Card><Card><CardHeader><CardTitle>引用此属性的对象类型</CardTitle></CardHeader>
      <CardContent>{item.usedBy.length ? <div className="flex flex-wrap gap-2">
        {item.usedBy.map((typeKey) => <Link key={typeKey} className="rounded-md border border-border px-3 py-2 text-sm text-primary hover:bg-accent"
          to={`/ontology/types/${encodeURIComponent(typeKey)}`}>{typeKey}</Link>)}
      </div> : <p className="text-sm text-muted-foreground">暂无已保存的类型引用</p>}</CardContent></Card></>}
    <PropertyEditorDialog editor={editor} onClose={() => setEditor(null)} onSave={save} />
  </div>;
}

export function ObjectTypeDetailPage() {
  const { typeKey } = useParams();
  const { hasRole } = useAuth();
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><Link to="/ontology/types" className="text-sm text-primary hover:underline">← 返回对象类型列表</Link>
        <h1 className="mt-2 text-2xl font-bold">对象类型及属性</h1></div>
      <a href="/ontology-concepts.svg" target="_blank" rel="noopener noreferrer"
        className="text-sm font-medium text-primary hover:underline">查看概念关系图</a>
    </div>
    {typeKey && <TypeManager typeKey={typeKey} canEdit={hasRole('admin', 'analyst')} canDelete={hasRole('admin')} />}
  </div>;
}

export function ModelModuleDetailPage() {
  const { module, itemKey } = useParams();
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'analyst');
  const canDelete = hasRole('admin');
  const tab = TABS.find((entry) => entry.key === module);
  if (!tab || !itemKey || tab.key === 'types') return <Alert variant="error">模型模块或定义不存在</Alert>;
  return <div className="space-y-5">
    <div><Link to={`/ontology/${tab.key}`} className="text-sm text-primary hover:underline">← 返回{tab.label}列表</Link>
      <h1 className="mt-2 text-2xl font-bold">{tab.label}{itemKey === 'new' ? ' · 新建' : ' · 详情'}</h1></div>
    {tab.key === 'shared' ? <SharedPropertyDetail propertyKey={itemKey} canEdit={canEdit} /> : <>
      {tab.key === 'links' && <LinkManager key={itemKey} initialKey={itemKey} canEdit={canEdit} canDelete={canDelete} />}
      {tab.key === 'actions' && <ActionManager key={itemKey} initialKey={itemKey} canEdit={canEdit} canDelete={canDelete} />}
      {tab.key === 'rules' && <RuleManager key={itemKey} initialKey={itemKey} canEdit={canEdit} canDelete={canDelete} />}
      {tab.key === 'functions' && <FunctionManager key={itemKey} initialKey={itemKey} canEdit={canEdit} canDelete={canDelete} />}
      {tab.key === 'interfaces' && <InterfaceManager key={itemKey} initialKey={itemKey} canEdit={canEdit} canDelete={canDelete} />}
      {tab.key === 'automations' && <AutomationManager key={itemKey} initialKey={itemKey} canEdit={canDelete} />}
    </>}
  </div>;
}

function TypeManager({ typeKey, canEdit, canDelete }: { typeKey: string; canEdit: boolean; canDelete: boolean }) {
  const [interfaces, setInterfaces] = useState<InterfaceDef[]>([]);
  const [functions, setFunctions] = useState<FunctionDef[]>([]);
  const [sharedProperties, setSharedProperties] = useState<SharedProperty[]>([]);
  const [selected, setSelected] = useState<ObjectType | null>(null);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [category, setCategory] = useState('entity');
  const [description, setDescription] = useState('');
  const [implemented, setImplemented] = useState<string[]>([]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyEditor, setPropertyEditor] = useState<PropertyEditState | null>(null);
  const [sharedPickerOpen, setSharedPickerOpen] = useState(false);
  const [displayProperty, setDisplayProperty] = useState('');
  const [titleTemplate, setTitleTemplate] = useState('');
  const [migration, setMigration] = useState('{}');
  const [rollbackVersion, setRollbackVersion] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadShared = useCallback(async () => {
    const result = await api.get<{ items: SharedProperty[] }>('/ontology/shared-properties');
    setSharedProperties(result.items);
  }, []);

  const load = useCallback(async () => {
    const [detail, f, s, functionResult] = await Promise.all([api.get<ObjectType>(`/ontology/types/${encodeURIComponent(typeKey)}`),
      api.get<{ items: InterfaceDef[] }>('/ontology/interfaces'),
      api.get<{ items: SharedProperty[] }>('/ontology/shared-properties'),
      api.get<{ items: FunctionDef[] }>('/functions')]);
    setInterfaces(f.items); setSharedProperties(s.items); setFunctions(functionResult.items);
    setSelected(detail); setKey(detail.typeKey); setName(detail.displayName);
    setCategory(detail.category); setDescription(detail.description); setImplemented(detail.interfaces || []);
    setProperties(detail.definition.properties.map((p) => ({ ...p })));
    setDisplayProperty(detail.definition.displayProperty || ''); setTitleTemplate(detail.definition.titleTemplate || '');
  }, [typeKey]);
  useEffect(() => { void load().catch((e) => setError(message(e))); }, [load]);

  async function run(label: string, task: () => Promise<unknown>, keepInterfaceDraft = false) {
    setBusy(true); setError(null); setInfo(null);
    try {
      const pendingInterfaces = implemented;
      await task(); await load();
      if (keepInterfaceDraft) setImplemented(pendingInterfaces);
      setInfo(`${label}成功`);
    }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  function definition() {
    if (!properties.every((p) => p.name.trim())) throw new Error('每个属性必须填写属性名');
    if (new Set(properties.map((p) => p.name)).size !== properties.length) throw new Error('属性名不能重复');
    return { properties, displayProperty: displayProperty || undefined, titleTemplate: titleTemplate || undefined,
      searchFields: selected?.definition.searchFields || [] };
  }
  async function saveProperty(property: Property) {
    if (!propertyEditor) return;
    if (propertyEditor.kind === 'shared-new') {
      await api.post('/ontology/shared-properties', { propertyKey: property.name, definition: property });
      await loadShared();
      setInfo(`共享属性 ${property.name} 已创建`);
      return;
    }
    if (propertyEditor.kind === 'shared-edit') {
      await api.put(`/ontology/shared-properties/${encodeURIComponent(propertyEditor.shared!.propertyKey)}`, {
        definition: property, expectedVersion: propertyEditor.shared!.version,
      });
      await loadShared();
      setInfo(`共享属性 ${property.name} 已更新；已引用类型需手动同步`);
      return;
    }
    const { sharedKey: _key, sharedVersion: _version, ...local } = property;
    const index = propertyEditor.kind === 'local-edit' ? propertyEditor.index : undefined;
    if (properties.some((item, position) => position !== index && item.name === local.name)) {
      throw new Error(`属性名已存在: ${local.name}`);
    }
    setProperties(index === undefined ? [...properties, local] :
      properties.map((item, position) => position === index ? local : item));
    setInfo('属性列表已更新，请保存并发布类型版本');
  }
  function attachShared(item: SharedProperty) {
    if (properties.some((property) => property.name === item.definition.name)) return;
    setProperties([...properties, { ...item.definition, sharedKey: item.propertyKey, sharedVersion: item.version }]);
    setInfo('共享属性已加入列表，请保存并发布类型版本');
  }
  function changeInterface(item: InterfaceDef, checked: boolean) {
    setError(null);
    if (!checked) {
      setImplemented(implemented.filter((key) => key !== item.interfaceKey));
      setInfo('已取消接口选择；已有属性会保留，保存基本信息后生效');
      return;
    }
    const additions: Property[] = [];
    for (const requirement of item.properties) {
      const existing = properties.find((property) => property.name === requirement.name);
      if (existing) {
        if (existing.type !== requirement.type || (requirement.required && !existing.required && existing.sharedKey)) {
          setError(`属性 ${requirement.name} 与接口契约不兼容，请先调整属性或共享定义`);
          return;
        }
        if (requirement.required && !existing.required) {
          additions.push({ ...existing, required: true });
        }
        continue;
      }
      const shared = sharedProperties.find((candidate) => candidate.definition.name === requirement.name &&
        candidate.definition.type === requirement.type && (!requirement.required || candidate.definition.required));
      if (shared) {
        additions.push({ ...shared.definition, sharedKey: shared.propertyKey, sharedVersion: shared.version });
      } else if (requirement.type === 'enum' || requirement.type === 'reference') {
        setError(`接口属性 ${requirement.name} 需要枚举值或引用类型，请先建立兼容的共享属性`);
        return;
      } else {
        additions.push({ name: requirement.name, label: requirement.name, type: requirement.type,
          required: !!requirement.required });
      }
    }
    setProperties(properties.map((property) => additions.find((candidate) => candidate.name === property.name) ?? property)
      .concat(additions.filter((candidate) => !properties.some((property) => property.name === candidate.name))));
    setImplemented([...implemented, item.interfaceKey]);
    setInfo(additions.length ? `已补齐 ${additions.length} 个接口属性；请保存属性版本、发布，再保存基本信息` :
      '属性已满足接口契约，请保存基本信息');
  }
  const unpublishedInterfaces = implemented.filter((interfaceKey) => {
    const contract = interfaces.find((item) => item.interfaceKey === interfaceKey);
    return contract?.properties.some((requirement) => {
      const actual = selected?.publishedDefinition.properties.find((property) => property.name === requirement.name);
      return !actual || actual.type !== requirement.type || (requirement.required && !actual.required);
    });
  });
  async function promoteProperty(index: number, property: Property) {
    setBusy(true); setError(null); setInfo(null);
    try {
      const { sharedKey: _key, sharedVersion: _version, ...definition } = property;
      const created = await api.post<SharedProperty>('/ontology/shared-properties', {
        propertyKey: definition.name, definition,
      });
      setProperties((current) => current.map((item, position) => position === index ?
        { ...created.definition, sharedKey: created.propertyKey, sharedVersion: created.version } : item));
      await loadShared();
      setInfo('属性已加入共享属性库；当前类型还需保存并发布新版本');
    } catch (failure) { setError(message(failure)); }
    finally { setBusy(false); }
  }
  const latest = selected?.versions?.[0];
  return <div className="space-y-4">
    <div className="space-y-4"><Notice error={error} info={info} />
      {selected ? <Card><CardHeader><CardTitle>编辑 {selected.typeKey}</CardTitle></CardHeader>
        <CardContent className="space-y-5">
          <section className="space-y-3" aria-labelledby="type-properties-title">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h3 id="type-properties-title" className="font-semibold">属性列表 <span className="text-muted-foreground">({properties.length})</span></h3>
                <p className="text-xs text-muted-foreground">添加、修改或移除后，保存并发布类型版本才会生效。</p></div>
              {canEdit && <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setPropertyEditor({ kind: 'shared-new', initial: blankProperty() })}>新建共享属性</Button>
                <Button size="sm" variant="outline" onClick={() => setSharedPickerOpen(true)}>引用共享属性</Button>
                <Button size="sm" onClick={() => setPropertyEditor({ kind: 'local-add', initial: blankProperty() })}>添加属性</Button>
              </div>}
            </div>
            <div className="rounded-md border border-border">
              <Table><THeader><TR><TH>属性名</TH><TH>显示名</TH><TH>类型</TH><TH>来源</TH><TH>设置</TH><TH>操作</TH></TR></THeader>
                <TBody>{properties.length ? properties.map((property, index) => {
                  const source = sharedProperties.find((item) => item.propertyKey === property.sharedKey);
                  const sameNameSource = sharedProperties.find((item) => item.propertyKey === property.name);
                  const outdated = source && source.version !== property.sharedVersion;
                  return <TR key={`${property.name}-${index}`}>
                    <TD className="font-mono text-xs">{property.name}</TD>
                    <TD>{property.label}</TD><TD>{property.type}</TD>
                    <TD className="text-xs">{property.computed ? <span className="text-primary">计算 · {property.computed.functionKey}</span> : property.sharedKey ? <>
                      <span className="text-primary">共享 v{property.sharedVersion}</span>
                      {outdated && <span className="ml-1 text-amber-600 dark:text-amber-400">有 v{source.version} 更新</span>}
                    </> : '本地'}</TD>
                    <TD className="text-xs text-muted-foreground">{property.computed ? '只读 ' : ''}{property.required ? '必填 ' : ''}{property.showInList ? '列表显示' : ''}</TD>
                    <TD><div className="flex flex-wrap gap-1">
                      {canEdit && <Button size="sm" variant="ghost" onClick={() => setPropertyEditor({ kind: 'local-edit', initial: property, index })}>修改</Button>}
                      {canEdit && !property.sharedKey && !property.computed && (sameNameSource ?
                        <Button size="sm" variant="outline" onClick={() => {
                          setProperties(properties.map((item, position) => position === index ?
                            { ...sameNameSource.definition, sharedKey: sameNameSource.propertyKey, sharedVersion: sameNameSource.version } : item));
                          setInfo('已改用共享定义，请保存并发布类型版本');
                        }}>改用共享</Button> :
                        <Button size="sm" variant="outline" disabled={busy}
                          onClick={() => void promoteProperty(index, property)}>设为共享</Button>)}
                      {canEdit && outdated && <Button size="sm" variant="outline" onClick={() => {
                        setProperties(properties.map((item, position) => position === index ?
                          { ...source.definition, sharedKey: source.propertyKey, sharedVersion: source.version } : item));
                        setInfo('共享属性已同步到列表，请保存并发布类型版本');
                      }}>同步</Button>}
                      {canEdit && <Button size="sm" variant="destructive" onClick={() => {
                        setProperties(properties.filter((_, position) => position !== index));
                        setInfo('属性已从列表移除，请保存并发布类型版本；删除已有字段需填写迁移规则');
                      }}>移除</Button>}
                    </div></TD>
                  </TR>;
                }) : <TR><TD colSpan={6} className="py-8 text-center text-muted-foreground">暂无属性，点击“添加属性”或“引用共享属性”</TD></TR>}</TBody>
              </Table>
            </div>
          </section>
          <div className="border-t border-border pt-4"><h3 className="mb-3 font-semibold">类型基本信息</h3>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="类型标识" value={key} onChange={setKey} disabled required />
            <Field label="显示名称" value={name} onChange={setName} disabled={!canEdit} required />
            <TypeCategorySelect value={category} onChange={setCategory} disabled={!canEdit} />
            <Field label="说明" value={description} onChange={setDescription} disabled={!canEdit} />
            <Field label="标题字段" value={displayProperty} onChange={setDisplayProperty} disabled={!canEdit} />
            <Field label="标题模板" value={titleTemplate} onChange={setTitleTemplate} disabled={!canEdit} placeholder="例如 {name}" />
          </div>
          <div><Label>实现的 Interface</Label><div className="mt-2 flex flex-wrap gap-3">
            {interfaces.map((item) => <label key={item.interfaceKey} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={!canEdit} checked={implemented.includes(item.interfaceKey)} onChange={(e) => changeInterface(item, e.target.checked)} />
              {item.displayName}</label>)}
            {!interfaces.length && <span className="text-sm text-muted-foreground">暂无 Interface 定义</span>}
          </div><p className="mt-2 text-xs text-muted-foreground">勾选后自动补齐契约属性；同名属性保留现有定义，取消勾选不删除属性。</p>
          {unpublishedInterfaces.length > 0 && <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
            {unpublishedInterfaces.join('、')} 的属性尚未发布，请先保存属性版本并发布，然后保存基本信息。
          </p>}</div></div>
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="版本说明" value={note} onChange={setNote} disabled={!canEdit} />
            <JsonField label="迁移规则（删除或更改属性时填写）" value={migration} onChange={setMigration} rows={3} />
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && <><Button variant="outline" disabled={busy || unpublishedInterfaces.length > 0} onClick={() => run('保存基本信息',
              () => api.patch(`/ontology/types/${encodeURIComponent(key)}`, { displayName: name, category, description, interfaces: implemented }))}>保存基本信息</Button>
              <Button disabled={busy} onClick={() => run('创建属性版本', () => api.post(`/ontology/types/${encodeURIComponent(key)}/versions`, {
                definition: definition(), changeNote: note, migration: parseJson(migration, '迁移规则'),
              }), true)}>保存属性为新版本</Button>
              {canDelete && <Button variant="secondary" disabled={busy || !latest || latest.state === 'published'} onClick={() => run('发布版本',
                () => api.post(`/ontology/types/${encodeURIComponent(key)}/publish-version`, {
                  schemaVersion: latest?.schemaVersion, migration: parseJson(migration, '迁移规则'),
                }), true)}>发布 v{latest?.schemaVersion || selected?.currentVersion}</Button>}</>}
          </div>
          <div className="text-xs text-muted-foreground">版本：{selected?.versions.map((v) => `v${v.schemaVersion} ${v.state}`).join(' · ')}</div>
          {canDelete && selected && <div className="flex flex-wrap items-end gap-2">
            <div><Label htmlFor="rollback-version">回滚到历史定义</Label>
              <Select id="rollback-version" value={rollbackVersion} onChange={(event) => setRollbackVersion(event.target.value)}>
                <option value="">选择历史版本</option>
                {selected.versions.filter((version) => version.state === 'archived').map((version) =>
                  <option key={version.schemaVersion} value={version.schemaVersion}>v{version.schemaVersion}</option>)}
              </Select></div>
            <Button variant="outline" disabled={busy || !rollbackVersion} onClick={() => run('回滚模型', () =>
              api.post(`/ontology/types/${encodeURIComponent(key)}/rollback`, {
                schemaVersion: Number(rollbackVersion), migration: parseJson(migration, '迁移规则'),
              }))}>发布回滚版本</Button>
          </div>}
        </CardContent></Card> : !error && <Card><CardContent className="pt-5 text-sm text-muted-foreground">正在加载对象类型…</CardContent></Card>}
      <PropertyEditorDialog editor={propertyEditor} onClose={() => setPropertyEditor(null)} onSave={saveProperty}
        functions={functions} availableProperties={properties} />
      <SharedPickerDialog open={sharedPickerOpen} items={sharedProperties} usedNames={properties.map((item) => item.name)}
        onClose={() => setSharedPickerOpen(false)} onAttach={attachShared} />
    </div>
  </div>;
}

type LinkDef = { linkKey: string; displayName: string; fromType: string; toType: string;
  cardinality: string; inverseName: string; description: string; required: boolean; state: string };
type LinkInstance = { linkId: string; linkKey: string; fromObjectId: string; toObjectId: string; isValid: boolean };
type ObjectOption = { objectId: string; title: string; typeKey: string };

function LinkManager({ initialKey, canEdit }: { initialKey: string; canEdit: boolean; canDelete: boolean }) {
  const navigate = useNavigate();
  const [types, setTypes] = useState<ObjectType[]>([]);
  const [instances, setInstances] = useState<LinkInstance[]>([]);
  const [objects, setObjects] = useState<ObjectOption[]>([]);
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState<LinkDef>({ linkKey: '', displayName: '', fromType: '', toType: '', cardinality: '1:N', inverseName: '', description: '', required: false, state: 'published' });
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [a, b, c, d] = await Promise.all([
      initialKey === 'new' ? Promise.resolve(null) : api.get<LinkDef>(`/ontology/links/${encodeURIComponent(initialKey)}`),
      api.get<{ items: ObjectType[] }>('/ontology/types'),
      api.get<{ items: LinkInstance[] }>('/links?limit=100'), api.get<{ items: ObjectOption[] }>('/objects?limit=200'),
    ]);
    if (a) { setSelected(a.linkKey); setForm(a); }
    setTypes(b.items); setInstances(c.items); setObjects(d.items);
  }, [initialKey]);
  useEffect(() => { load().catch((e) => setError(message(e))); }, [load]);
  async function run(label: string, task: () => Promise<unknown>) {
    setBusy(true); setError(null); setInfo(null);
    try { await task(); await load(); setInfo(`${label}成功`); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  const set = (patch: Partial<LinkDef>) => setForm({ ...form, ...patch });
  const visibleInstances = selected ? instances.filter((x) => x.linkKey === selected) : [];
  const fromOptions = objects.filter((o) => !form.fromType || o.typeKey === form.fromType);
  const toOptions = objects.filter((o) => !form.toType || o.typeKey === form.toType);
  return <div className="space-y-4"><Notice error={error} info={info} />
      <Card><CardHeader><CardTitle>{selected ? `编辑 ${selected}` : '新建 Link 定义'}</CardTitle></CardHeader><CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Link 标识" value={form.linkKey} onChange={(v) => set({ linkKey: v })} disabled={!!selected || !canEdit} />
          <Field label="显示名称" value={form.displayName} onChange={(v) => set({ displayName: v })} disabled={!canEdit} />
          <div className="space-y-1"><Label htmlFor="link-from-type">起点类型</Label><Select id="link-from-type" value={form.fromType} disabled={!!selected || !canEdit} onChange={(e) => set({ fromType: e.target.value })}>
            <option value="">选择类型</option>{types.map((t) => <option key={t.typeKey} value={t.typeKey}>{t.displayName} ({t.typeKey})</option>)}
          </Select></div>
          <div className="space-y-1"><Label htmlFor="link-to-type">终点类型</Label><Select id="link-to-type" value={form.toType} disabled={!!selected || !canEdit} onChange={(e) => set({ toType: e.target.value })}>
            <option value="">选择类型</option>{types.map((t) => <option key={t.typeKey} value={t.typeKey}>{t.displayName} ({t.typeKey})</option>)}
          </Select></div>
          <div className="space-y-1"><Label htmlFor="link-cardinality">基数</Label><Select id="link-cardinality" value={form.cardinality} disabled={!canEdit} onChange={(e) => set({ cardinality: e.target.value })}>
            {['1:1', '1:N', 'N:1', 'N:M'].map((v) => <option key={v}>{v}</option>)}
          </Select></div>
          <Field label="反向名称" value={form.inverseName || ''} onChange={(v) => set({ inverseName: v })} disabled={!canEdit} />
          <Field label="说明" value={form.description || ''} onChange={(v) => set({ description: v })} disabled={!canEdit} />
          <div className="flex items-end gap-4 pb-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.required} disabled={!canEdit} onChange={(e) => set({ required: e.target.checked })} />必需关系</label>
            {selected && <Select aria-label="关系状态" value={form.state} disabled={!canEdit} onChange={(e) => set({ state: e.target.value })}>
              {['draft', 'published', 'archived'].map((v) => <option key={v}>{v}</option>)}
            </Select>}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button disabled={busy} onClick={() => run(selected ? '更新关系定义' : '创建关系定义', async () => {
            if (!form.linkKey || !form.displayName || !form.fromType || !form.toType) throw new Error('标识、名称与两端类型均必填');
            if (selected) await api.patch(`/ontology/links/${encodeURIComponent(selected)}`, form);
            else { await api.post('/ontology/links', form); navigate(`/ontology/links/${encodeURIComponent(form.linkKey)}`); }
          })}>{selected ? '保存定义' : '创建定义'}</Button>}
        </div>
      </CardContent></Card>
    <Card><CardHeader><CardTitle>对象连接实例</CardTitle></CardHeader><CardContent className="space-y-4">
      {canEdit && <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1"><Label htmlFor="link-from-object">起点对象</Label><Select id="link-from-object" value={fromId} onChange={(e) => setFromId(e.target.value)}><option value="">选择对象</option>
          {fromOptions.map((o) => <option key={o.objectId} value={o.objectId}>{o.title} ({o.objectId})</option>)}
        </Select></div>
        <div className="space-y-1"><Label htmlFor="link-to-object">终点对象</Label><Select id="link-to-object" value={toId} onChange={(e) => setToId(e.target.value)}><option value="">选择对象</option>
          {toOptions.map((o) => <option key={o.objectId} value={o.objectId}>{o.title} ({o.objectId})</option>)}
        </Select></div>
        <Button className="self-end" disabled={busy || !selected || !fromId || !toId} onClick={() => run('建立连接', () => api.post('/links', { linkKey: selected, fromObjectId: fromId, toObjectId: toId }))}>建立连接</Button>
      </div>}
      <div className="space-y-2">{visibleInstances.map((x) => <div key={x.linkId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-3 text-sm">
        <span><span className="font-mono">{x.linkKey}</span> · {x.fromObjectId} → {x.toObjectId}</span>
        {canEdit && <Button size="sm" variant="outline" disabled={busy} onClick={() => {
          if (window.confirm('使这条连接失效？')) void run('失效连接', () => api.delete(`/links/${encodeURIComponent(x.linkId)}`));
        }}>失效</Button>}
      </div>)}{visibleInstances.length === 0 && <p className="text-sm text-muted-foreground">暂无连接实例。</p>}</div>
    </CardContent></Card>
  </div>;
}

type ActionDef = { actionKey: string; name: string; description: string; paramsSchema: Record<string, unknown>;
  preconditions: string[]; writeSet: Array<Record<string, unknown>>; approvalPolicy: Record<string, unknown>;
  requiredRoles: string[]; externalEffects: Array<Record<string, unknown>>; compensation: Record<string, unknown>;
  version?: number; state?: string };
const blankAction = (): ActionDef => ({ actionKey: '', name: '', description: '', paramsSchema: { type: 'object', properties: {}, required: [] },
  preconditions: [], writeSet: [], approvalPolicy: {}, requiredRoles: ['operator'], externalEffects: [], compensation: {} });

function ActionManager({ initialKey, canEdit }: { initialKey: string; canEdit: boolean; canDelete: boolean }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState<ActionDef>(blankAction());
  const [paramsText, setParamsText] = useState(json(blankAction().paramsSchema));
  const [writesText, setWritesText] = useState('[]');
  const [policyText, setPolicyText] = useState('{}');
  const [effectsText, setEffectsText] = useState('[]');
  const [compensationText, setCompensationText] = useState('{}');
  const [previewParams, setPreviewParams] = useState('{}');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (initialKey !== 'new') choose(await api.get<ActionDef>(`/action-types/${encodeURIComponent(initialKey)}`));
  }, [initialKey]);
  useEffect(() => { load().catch((e) => setError(message(e))); }, [load]);
  function choose(a: ActionDef) {
    setSelected(a.actionKey); setForm(a); setParamsText(json(a.paramsSchema)); setWritesText(json(a.writeSet));
    setPolicyText(json(a.approvalPolicy)); setEffectsText(json(a.externalEffects)); setCompensationText(json(a.compensation)); setPreview(null);
  }
  async function run(label: string, task: () => Promise<unknown>) {
    setBusy(true); setError(null); setInfo(null);
    try { await task(); await load(); setInfo(`${label}成功`); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  function payload(): ActionDef {
    if (!form.actionKey.trim() || !form.name.trim()) throw new Error('Action 标识和名称必填');
    const paramsSchema = parseJson<Record<string, unknown>>(paramsText, '参数 Schema');
    const writeSet = parseJson<Array<Record<string, unknown>>>(writesText, '写入集合');
    const approvalPolicy = parseJson<Record<string, unknown>>(policyText, '审批策略');
    const externalEffects = parseJson<Array<Record<string, unknown>>>(effectsText, '外部效果');
    const compensation = parseJson<Record<string, unknown>>(compensationText, '补偿定义');
    if (!Array.isArray(writeSet) || !Array.isArray(externalEffects)) throw new Error('写入集合与外部效果必须是数组');
    return { ...form, paramsSchema, writeSet, approvalPolicy, externalEffects, compensation };
  }
  return <div className="space-y-4"><Notice error={error} info={info} /><Card><CardHeader><CardTitle>{selected ? `编辑 ${selected}` : '新建 Action'}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Action 标识" value={form.actionKey} onChange={(v) => setForm({ ...form, actionKey: v })} disabled={!!selected || !canEdit} />
          <Field label="名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} disabled={!canEdit} />
          <Field label="说明" value={form.description || ''} onChange={(v) => setForm({ ...form, description: v })} disabled={!canEdit} />
          <Field label="可执行角色（逗号分隔）" value={form.requiredRoles.join(', ')} onChange={(v) => setForm({ ...form, requiredRoles: v.split(',').map((x) => x.trim()).filter(Boolean) })} disabled={!canEdit} />
        </div>
        <JsonField label="参数 Schema" value={paramsText} onChange={setParamsText} />
        <div className="space-y-2"><Label>前置条件（DSL，每行一条）</Label><Textarea aria-label="前置条件" rows={4} className="font-mono text-xs" value={form.preconditions.join('\n')}
          disabled={!canEdit} onChange={(e) => setForm({ ...form, preconditions: e.target.value.split('\n').map((x) => x.trim()).filter(Boolean) })} /></div>
        <JsonField label="写入集合（数组）" value={writesText} onChange={setWritesText} />
        <div className="grid gap-3 md:grid-cols-2">
          <JsonField label="审批策略" value={policyText} onChange={setPolicyText} rows={4} />
          <JsonField label="外部效果（数组）" value={effectsText} onChange={setEffectsText} rows={4} />
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit}
          checked={(() => { try { return JSON.parse(policyText).allowAutomation === true; } catch { return false; } })()}
          onChange={(event) => { try {
            setPolicyText(json({ ...JSON.parse(policyText), allowAutomation: event.target.checked }));
            setError(null);
          } catch { setError('请先修正审批策略 JSON'); } }} />允许自动化执行</label>
        <p className="text-xs text-muted-foreground">仅当无需审批、无外部效果且只更新触发对象时可用于自动化。</p>
        <JsonField label="补偿定义" value={compensationText} onChange={setCompensationText} rows={3} />
        <div className="flex flex-wrap gap-2">
          {canEdit && <Button disabled={busy} onClick={() => run(selected ? '更新 Action' : '创建 Action', async () => {
            const result = await api.post<ActionDef>('/action-types', payload()); choose(result);
            if (initialKey === 'new') navigate(`/ontology/actions/${encodeURIComponent(result.actionKey)}`);
          })}>{selected ? '保存新版本' : '创建 Action'}</Button>}
        </div>
        {selected && <div className="space-y-2 border-t border-border pt-4">
          <Label htmlFor="action-preview">验证参数（JSON）</Label><Textarea id="action-preview" rows={3} className="font-mono text-xs" value={previewParams} onChange={(e) => setPreviewParams(e.target.value)} />
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run('验证', async () => {
            const result = await api.post('/actions/validate', { actionKey: selected, params: parseJson(previewParams, '验证参数') }); setPreview(json(result));
          })}>验证 Action</Button>
          {preview && <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{preview}</pre>}
        </div>}
      </CardContent></Card>
  </div>;
}

type RuleDef = { ruleKey: string; name: string; kind: string; description: string; expression: string;
  outputType: string; scopeType: string; testCases: Array<{ input: Record<string, unknown>; expected: unknown }>;
  version?: number };
const blankRule = (): RuleDef => ({ ruleKey: '', name: '', kind: 'derived_metric', description: '', expression: '', outputType: 'number', scopeType: '', testCases: [] });

function RuleManager({ initialKey, canEdit }: { initialKey: string; canEdit: boolean; canDelete: boolean }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState<RuleDef>(blankRule());
  const [testsText, setTestsText] = useState('[]');
  const [contextText, setContextText] = useState('{}');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (initialKey !== 'new') choose(await api.get<RuleDef>(`/rules/${encodeURIComponent(initialKey)}`));
  }, [initialKey]);
  useEffect(() => { load().catch((e) => setError(message(e))); }, [load]);
  function choose(r: RuleDef) { setSelected(r.ruleKey); setForm(r); setTestsText(json(r.testCases)); setPreview(null); }
  async function run(label: string, task: () => Promise<unknown>) {
    setBusy(true); setError(null); setInfo(null);
    try { await task(); await load(); setInfo(`${label}成功`); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4"><Notice error={error} info={info} /><Card><CardHeader><CardTitle>{selected ? `编辑 ${selected}` : '新建规则'}</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="规则标识" value={form.ruleKey} onChange={(v) => setForm({ ...form, ruleKey: v })} disabled={!!selected || !canEdit} />
        <Field label="名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} disabled={!canEdit} />
        <div className="space-y-1"><Label htmlFor="rule-kind">规则类型</Label><Select id="rule-kind" value={form.kind} disabled={!canEdit} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          {['derived_metric', 'constraint', 'trigger', 'score_normalizer'].map((v) => <option key={v}>{v}</option>)}
        </Select></div>
        <Field label="适用对象类型" value={form.scopeType || ''} onChange={(v) => setForm({ ...form, scopeType: v })} disabled={!canEdit} />
        <Field label="输出类型" value={form.outputType || ''} onChange={(v) => setForm({ ...form, outputType: v })} disabled={!canEdit} />
        <Field label="说明" value={form.description || ''} onChange={(v) => setForm({ ...form, description: v })} disabled={!canEdit} />
      </div>
      <div className="space-y-1"><Label htmlFor="rule-expression">DSL 表达式</Label><Textarea id="rule-expression" className="font-mono text-xs" rows={4} value={form.expression} disabled={!canEdit}
        onChange={(e) => setForm({ ...form, expression: e.target.value })} /></div>
      <JsonField label="测试样例（数组）" value={testsText} onChange={setTestsText} />
      <div className="flex flex-wrap gap-2">
        {canEdit && <Button disabled={busy} onClick={() => run(selected ? '更新规则' : '创建规则', async () => {
          if (!form.ruleKey || !form.name || !form.expression) throw new Error('标识、名称和表达式必填');
          const testCases = parseJson<RuleDef['testCases']>(testsText, '测试样例');
          if (!Array.isArray(testCases)) throw new Error('测试样例必须是数组');
          const result = await api.post<RuleDef>('/rules', { ...form, testCases }); choose(result);
          if (initialKey === 'new') navigate(`/ontology/rules/${encodeURIComponent(result.ruleKey)}`);
        })}>{selected ? '保存新版本' : '创建规则'}</Button>}
      </div>
      <div className="space-y-2 border-t border-border pt-4"><JsonField label="试算上下文" value={contextText} onChange={setContextText} rows={3} />
        <Button size="sm" variant="outline" disabled={busy || !form.expression} onClick={() => run('试算', async () => {
          const result = await api.post('/rules/preview', { expression: form.expression, context: parseJson(contextText, '试算上下文') }); setPreview(json(result));
        })}>试算表达式</Button>
        {preview && <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{preview}</pre>}
      </div>
    </CardContent></Card>
  </div>;
}

type FunctionDef = { functionKey: string; name: string; description: string; parameters: string[];
  expression: string; outputType: string; version?: number; state?: string };
const blankFunction = (): FunctionDef => ({ functionKey: '', name: '', description: '', parameters: [], expression: '', outputType: 'number' });

function FunctionManager({ initialKey, canEdit }: { initialKey: string; canEdit: boolean; canDelete: boolean }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState<FunctionDef>(blankFunction());
  const [argsText, setArgsText] = useState('{}');
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (initialKey !== 'new') choose(await api.get<FunctionDef>(`/functions/${encodeURIComponent(initialKey)}`));
  }, [initialKey]);
  useEffect(() => { load().catch((e) => setError(message(e))); }, [load]);
  function choose(f: FunctionDef) { setSelected(f.functionKey); setForm(f); setPreview(null); }
  async function run(label: string, task: () => Promise<unknown>) {
    setBusy(true); setError(null); setInfo(null);
    try { await task(); await load(); setInfo(`${label}成功`); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4"><Notice error={error} info={info} /><Card><CardHeader><CardTitle>{selected ? `编辑 ${selected}` : '新建函数'}</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="函数标识" value={form.functionKey} onChange={(v) => setForm({ ...form, functionKey: v })} disabled={!!selected || !canEdit} placeholder="例如 risk_score" />
        <Field label="名称" value={form.name} onChange={(v) => setForm({ ...form, name: v })} disabled={!canEdit} />
        <Field label="参数名（逗号分隔）" value={form.parameters.join(', ')} onChange={(v) => setForm({ ...form, parameters: v.split(',').map((x) => x.trim()).filter(Boolean) })} disabled={!canEdit} placeholder="例如 severity, exposure" />
        <Field label="输出类型" value={form.outputType} onChange={(v) => setForm({ ...form, outputType: v })} disabled={!canEdit} />
      </div>
      <Field label="说明" value={form.description || ''} onChange={(v) => setForm({ ...form, description: v })} disabled={!canEdit} />
      <div className="space-y-1"><Label htmlFor="function-expression">DSL 表达式</Label><Textarea id="function-expression" className="font-mono text-xs" rows={4} value={form.expression} disabled={!canEdit}
        onChange={(e) => setForm({ ...form, expression: e.target.value })} placeholder="severity * exposure" /></div>
      <p className="text-xs text-muted-foreground">参数可以直接在表达式中使用；函数可用于规则、Action 前置条件和对象类型的只读计算属性。周岁示例：参数 birth_date，数值输出，表达式 age_years(birth_date, today(&quot;Asia/Shanghai&quot;))。</p>
      <div className="flex flex-wrap gap-2">
        {canEdit && <Button disabled={busy} onClick={() => run(selected ? '更新函数' : '创建函数', async () => {
          if (!form.functionKey || !form.name || !form.expression) throw new Error('标识、名称和表达式必填');
          const result = await api.post<FunctionDef>('/functions', form); choose(result);
          if (initialKey === 'new') navigate(`/ontology/functions/${encodeURIComponent(result.functionKey)}`);
        })}>{selected ? '保存新版本' : '创建函数'}</Button>}
      </div>
      {selected && <div className="space-y-2 border-t border-border pt-4">
        <JsonField label="试算参数（对象）" value={argsText} onChange={setArgsText} rows={3} />
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run('函数试算', async () => {
          const result = await api.post(`/functions/${encodeURIComponent(selected)}/evaluate`, { args: parseJson(argsText, '试算参数') }); setPreview(json(result));
        })}>运行试算</Button>
        {preview && <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">{preview}</pre>}
      </div>}
    </CardContent></Card>
  </div>;
}

function InterfaceManager({ initialKey, canEdit }: { initialKey: string; canEdit: boolean; canDelete: boolean }) {
  const navigate = useNavigate();
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState<InterfaceDef>({ interfaceKey: '', displayName: '', description: '', properties: [], capabilities: [] });
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    if (initialKey !== 'new') {
      const selected = await api.get<InterfaceDef>(`/ontology/interfaces/${encodeURIComponent(initialKey)}`);
      setSelected(selected.interfaceKey); setForm(selected);
    }
  }, [initialKey]);
  useEffect(() => { load().catch((e) => setError(message(e))); }, [load]);
  async function run(label: string, task: () => Promise<unknown>) {
    setBusy(true); setError(null); setInfo(null);
    try { await task(); await load(); setInfo(`${label}成功`); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  const set = (patch: Partial<InterfaceDef>) => setForm({ ...form, ...patch });
  const updateProp = (index: number, patch: Partial<InterfaceDef['properties'][number]>) =>
    set({ properties: form.properties.map((p, i) => i === index ? { ...p, ...patch } : p) });
  return <div className="space-y-4"><Notice error={error} info={info} /><Card><CardHeader><CardTitle>{selected ? `编辑 ${selected}` : '新建 Interface'}</CardTitle></CardHeader><CardContent className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="Interface 标识" value={form.interfaceKey} onChange={(v) => set({ interfaceKey: v })} disabled={!!selected || !canEdit} />
        <Field label="显示名称" value={form.displayName} onChange={(v) => set({ displayName: v })} disabled={!canEdit} />
      </div>
      <Field label="说明" value={form.description || ''} onChange={(v) => set({ description: v })} disabled={!canEdit} />
      <Field label="能力标识（逗号分隔）" value={form.capabilities.join(', ')} onChange={(v) => set({ capabilities: v.split(',').map((x) => x.trim()).filter(Boolean) })} disabled={!canEdit} />
      <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="font-semibold">接口属性契约</h3>
        {canEdit && <Button size="sm" variant="outline" onClick={() => set({ properties: [...form.properties, { name: '', type: 'string', required: false }] })}>添加属性</Button>}
      </div>
        {form.properties.map((p, i) => <div key={i} className="grid gap-2 rounded-md border border-border p-3 md:grid-cols-[1fr_1fr_auto_auto]">
          <Field label={`属性名 ${i + 1}`} value={p.name} onChange={(v) => updateProp(i, { name: v })} disabled={!canEdit} />
          <div className="space-y-1"><Label htmlFor={`iface-type-${i}`}>类型</Label><Select id={`iface-type-${i}`} value={p.type} disabled={!canEdit} onChange={(e) => updateProp(i, { type: e.target.value })}>
            {['string', 'number', 'boolean', 'datetime', 'enum', 'reference', 'json'].map((v) => <option key={v}>{v}</option>)}
          </Select></div>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={!!p.required} disabled={!canEdit} onChange={(e) => updateProp(i, { required: e.target.checked })} />必填</label>
          {canEdit && <Button className="self-end" size="sm" variant="destructive" onClick={() => set({ properties: form.properties.filter((_, n) => n !== i) })}>移除</Button>}
        </div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        {canEdit && <Button disabled={busy} onClick={() => run(selected ? '更新 Interface' : '创建 Interface', async () => {
          if (!form.interfaceKey || !form.displayName) throw new Error('标识和显示名称必填');
          if (form.properties.some((p) => !p.name)) throw new Error('属性名必填');
          if (selected) await api.patch(`/ontology/interfaces/${encodeURIComponent(selected)}`, form);
          else { await api.post('/ontology/interfaces', form); navigate(`/ontology/interfaces/${encodeURIComponent(form.interfaceKey)}`); }
        })}>{selected ? '保存 Interface' : '创建 Interface'}</Button>}
      </div>
    </CardContent></Card>
  </div>;
}
