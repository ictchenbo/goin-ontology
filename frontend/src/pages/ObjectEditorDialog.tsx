/** 对象实例表单：按已发布模型生成属性编辑控件。 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { ObjectPicker } from '@/components/ObjectPicker';

export interface ObjectInstance {
  objectId: string;
  revision: number;
  typeKey: string;
  title: string;
  status?: string;
  updatedAt?: string;
  payload?: Record<string, unknown>;
  computedErrors?: Record<string, string>;
  properties?: Record<string, unknown>;
  links?: Array<{ linkId: string; linkKey: string; linkDisplay?: string;
    otherObject?: { objectId: string; title: string }; direction?: string; props?: Record<string, unknown> }>;
  evidence?: Array<{ id: string; sourceKey?: string; confidence?: number; observedAt?: string; stance?: string; status?: string }>;
  history?: Array<{ revision: number; changeReason?: string; createdAt?: string; changedBy?: string }>;
  [key: string]: unknown;
}

type PropertyDef = { name: string; label: string; type: string; required?: boolean;
  enumValues?: string[]; refType?: string; description?: string;
  computed?: { functionKey: string; inputs: Record<string, string> } };
export type ObjectType = { typeKey: string; displayName: string; state: string;
  createdAt?: string; updatedAt?: string;
  publishedDefinition: { properties: PropertyDef[] } };

export function ObjectTypePicker({ types, value, disabled, onChange, label = '对象类型', allowEmpty = false }: {
  types: Array<Pick<ObjectType, 'typeKey' | 'displayName' | 'state'>>;
  value: string; disabled: boolean; onChange: (typeKey: string) => void;
  label?: string; allowEmpty?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const selected = types.find((type) => type.typeKey === value);
  const normalizedQuery = query.trim().toLowerCase();
  const matches = [
    ...(allowEmpty && '全部对象类型'.includes(normalizedQuery) ?
      [{ typeKey: '', displayName: '全部对象类型', state: 'published' }] : []),
    ...types.filter((type) => `${type.displayName} ${type.typeKey}`
      .toLowerCase().includes(normalizedQuery)),
  ];
  return <div className="space-y-1" onBlurCapture={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <Label htmlFor={id}>{label}</Label>
    <div className="relative">
      <Input id={id} role="combobox" aria-autocomplete="list"
        aria-expanded={open} aria-controls={`${id}-options`}
        aria-activedescendant={open && matches[active] ? `${id}-option-${active}` : undefined}
        disabled={disabled} value={open ? query : selected ? `${selected.displayName} (${selected.typeKey})` : allowEmpty && !value ? '全部对象类型' : value}
        placeholder="搜索对象类型名称或标识"
        onFocus={() => { setQuery(''); setActive(0); setOpen(true); }}
        onClick={() => { if (!open) { setQuery(''); setActive(0); setOpen(true); } }}
        onChange={(event) => { setQuery(event.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { setOpen(false); return; }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault(); setOpen(true);
            setActive((index) => Math.max(0, Math.min(matches.length - 1,
              index + (event.key === 'ArrowDown' ? 1 : -1))));
          }
          if (event.key === 'Enter' && open) {
            event.preventDefault();
            if (matches[active]?.state === 'published') {
              onChange(matches[active].typeKey); setOpen(false);
            }
          }
        }} />
      {open && <div id={`${id}-options`} role="listbox" aria-label="对象类型搜索结果"
        className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-border bg-card p-1 shadow-lg"
        onMouseDown={(event) => event.preventDefault()}>
        {matches.length ? matches.map((candidate, index) => candidate.state === 'published' ?
          <button key={candidate.typeKey} id={`${id}-option-${index}`} type="button" role="option"
            aria-selected={candidate.typeKey === value} onClick={() => { onChange(candidate.typeKey); setOpen(false); }}
            className={`block w-full rounded px-3 py-2 text-left text-sm hover:bg-accent ${index === active ? 'bg-accent' : ''}`}>
            {candidate.displayName} {candidate.typeKey && <span className="font-mono text-xs text-muted-foreground">({candidate.typeKey})</span>}
          </button> : <div key={candidate.typeKey} id={`${id}-option-${index}`} role="option"
            aria-selected={false} aria-disabled="true" className={`flex items-center justify-between gap-2 rounded px-3 py-2 text-sm ${index === active ? 'bg-accent' : ''}`}>
            <span>{candidate.displayName} <span className="font-mono text-xs text-muted-foreground">({candidate.typeKey})</span>
              <span className="ml-2 text-xs text-muted-foreground">{candidate.state === 'draft' ? '草稿，发布后可选' : '当前不可选择'}</span></span>
            {candidate.state === 'draft' && <Link className="shrink-0 text-xs text-primary hover:underline"
              to={`/ontology/types/${encodeURIComponent(candidate.typeKey)}`}>前往发布</Link>}
          </div>) : <p className="px-3 py-2 text-sm text-muted-foreground">没有匹配的对象类型</p>}
      </div>}
    </div>
    {!disabled && <p className="text-xs text-muted-foreground">按名称或标识搜索；草稿类型需发布后才能选择。</p>}
  </div>;
}

export function ObjectEditorDialog({ open, types, item, initialTypeKey, onClose, onSaved }: {
  open: boolean; types: ObjectType[]; item: ObjectInstance | null; initialTypeKey?: string;
  onClose: () => void; onSaved: (object: ObjectInstance) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [typeKey, setTypeKey] = useState('');
  const [type, setType] = useState<ObjectType | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      const published = types.filter((candidate) => candidate.state === 'published');
      setTypeKey(item?.typeKey ?? published.find((candidate) => candidate.typeKey === initialTypeKey)?.typeKey ??
        published[0]?.typeKey ?? '');
      setValues(item?.payload ?? {});
      setExtraValues(Object.fromEntries(Object.entries(item?.payload ?? {}).map(([name, value]) =>
        [name, JSON.stringify(value, null, 2)])));
      setTitle(item?.title ?? ''); setReason(''); setError('');
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (dialog.current?.open) dialog.current.close();
  }, [open, item, types, initialTypeKey]);
  useEffect(() => {
    if (!open || !typeKey) { setType(null); return; }
    void api.get<ObjectType>(`/ontology/types/${encodeURIComponent(typeKey)}`)
      .then(setType).catch((failure: ApiError) => setError(failure.message));
  }, [open, typeKey]);
  function setValue(name: string, value: unknown) {
    setValues((old) => ({ ...old, [name]: value }));
  }
  async function save() {
    setBusy(true); setError('');
    try {
      if (!type) throw new Error('请选择已发布的对象类型');
      const payload = { ...values };
      const definedNames = new Set(type.publishedDefinition.properties.map((property) => property.name));
      for (const [name, raw] of Object.entries(extraValues)) {
        if (definedNames.has(name)) continue;
        try { payload[name] = JSON.parse(raw); }
        catch { throw new Error(`${name} 需要有效 JSON 值`); }
      }
      for (const property of type.publishedDefinition.properties) {
        if (property.computed) { delete payload[property.name]; continue; }
        const value = payload[property.name];
        if (value === '' || value === undefined) {
          if (property.required) throw new Error(`请填写 ${property.label || property.name}`);
          if (item) payload[property.name] = null;
          else delete payload[property.name];
        } else if (property.type === 'number') {
          const number = Number(value);
          if (!Number.isFinite(number)) throw new Error(`${property.label || property.name} 必须是数字`);
          payload[property.name] = number;
        } else if (property.type === 'json' && typeof value === 'string') {
          try { payload[property.name] = JSON.parse(value); }
          catch { throw new Error(`${property.label || property.name} 需要有效 JSON`); }
        }
      }
      const saved = item ? await api.patch<ObjectInstance>(`/objects/${encodeURIComponent(item.objectId)}`, {
        payload, title: title.trim(), expectedRevision: item.revision, reason: reason || '界面编辑对象',
      }) : await api.post<ObjectInstance>('/objects', { typeKey, payload,
        ...(title.trim() ? { title: title.trim() } : {}), reason: reason || '界面创建对象' });
      onSaved(saved); onClose();
    } catch (failure) { setError((failure as ApiError)?.message || '保存失败'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }}
    aria-labelledby="object-editor-title"
    className="w-[min(94vw,760px)] max-h-[90vh] rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50">
    <div className="max-h-[90vh] space-y-4 overflow-y-auto p-5 sm:p-6">
      <h2 id="object-editor-title" className="text-lg font-semibold">{item ? '编辑对象实例' : '新建对象实例'}</h2>
      {error && <Alert variant="error">{error}</Alert>}
      <ObjectTypePicker types={types} value={typeKey} disabled={!!item}
        onChange={(selected) => {
          if (selected !== typeKey) { setTypeKey(selected); setType(null); setValues({}); setExtraValues({}); }
        }} />
      <div><Label htmlFor="object-title">标题{item ? '' : '（留空则按模型生成）'}</Label>
        <Input id="object-title" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
      {type?.typeKey === typeKey && <div className="grid gap-4 sm:grid-cols-2">
        {type.publishedDefinition.properties.filter((property) => !property.computed).map((property) => <div key={property.name} className="space-y-1">
          {property.type !== 'reference' && <Label htmlFor={`object-${property.name}`}>
            {property.label || property.name}{property.required ? ' *' : ''}</Label>}
          {property.type === 'reference' ? <ObjectPicker
            label={`${property.label || property.name}${property.required ? ' *' : ''}`}
            value={String(values[property.name] ?? '')} onChange={(selected) => setValue(property.name, selected)}
            typeKey={property.refType} disabled={!open} /> : property.type === 'boolean' ? <Select id={`object-${property.name}`}
            value={values[property.name] === undefined ? '' : String(values[property.name])}
            onChange={(event) => setValue(property.name, event.target.value === '' ? undefined : event.target.value === 'true')}>
            <option value="">未设置</option><option value="true">是</option><option value="false">否</option>
          </Select> : property.type === 'enum' ? <Select id={`object-${property.name}`}
            value={String(values[property.name] ?? '')} onChange={(event) => setValue(property.name, event.target.value)}>
            <option value="">请选择</option>{(property.enumValues ?? []).map((option) =>
              <option key={option} value={option}>{option}</option>)}
          </Select> : property.type === 'json' ? <Textarea id={`object-${property.name}`}
            value={typeof values[property.name] === 'string' ? String(values[property.name]) :
              values[property.name] === undefined ? '' : JSON.stringify(values[property.name], null, 2)}
            onChange={(event) => setValue(property.name, event.target.value)} rows={3} /> :
            <Input id={`object-${property.name}`} type={property.type === 'number' ? 'number' : 'text'}
              value={String(values[property.name] ?? '')} onChange={(event) => setValue(property.name, event.target.value)}
              placeholder={property.type === 'datetime' ? '2026-10-11T12:00:00Z' : property.name} />}
          {property.description && <p className="text-xs text-muted-foreground">{property.description}</p>}
        </div>)}
      </div>}
      {type?.typeKey === typeKey && !type.publishedDefinition.properties.some((property) => !property.computed) &&
        <p className="rounded-md border border-border p-3 text-sm text-muted-foreground">
          此对象类型没有已发布的可编辑属性。
          <Link to={`/ontology/types/${encodeURIComponent(typeKey)}`} onClick={onClose}
            className="ml-1 text-primary hover:underline">前往本体模型添加并发布属性</Link>
        </p>}
      {item && type?.typeKey === typeKey && Object.entries(extraValues).filter(([name]) =>
        !type.publishedDefinition.properties.some((property) => property.name === name)).map(([name, raw]) =>
        <div key={name} className="space-y-1"><Label htmlFor={`object-extra-${name}`}>{name}（未建模，JSON 值）</Label>
          <Textarea id={`object-extra-${name}`} value={raw} rows={2}
            onChange={(event) => setExtraValues((old) => ({ ...old, [name]: event.target.value }))} /></div>)}
      <div><Label htmlFor="object-reason">变更说明</Label><Input id="object-reason" value={reason}
        onChange={(event) => setReason(event.target.value)} /></div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
        <Button onClick={() => void save()} disabled={busy || !typeKey || type?.typeKey !== typeKey}>
          {busy ? '保存中…' : item ? '保存修改' : '创建对象'}</Button></div>
    </div>
  </dialog>;
}
