/** 对象实例表单：按已发布模型生成属性编辑控件。 */
import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';

export interface ObjectInstance {
  objectId: string;
  revision: number;
  typeKey: string;
  title: string;
  status?: string;
  updatedAt?: string;
  payload?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  links?: Array<{ linkId: string; linkKey: string; otherObject?: { objectId: string; title: string }; direction?: string }>;
  evidence?: Array<{ id: string; sourceKey?: string; confidence?: number; observedAt?: string; stance?: string; status?: string }>;
  history?: Array<{ revision: number; changeReason?: string; createdAt?: string; changedBy?: string }>;
  [key: string]: unknown;
}

type PropertyDef = { name: string; label: string; type: string; required?: boolean;
  enumValues?: string[]; refType?: string; description?: string };
export type ObjectType = { typeKey: string; displayName: string; state: string;
  publishedDefinition: { properties: PropertyDef[] } };

export function ObjectEditorDialog({ open, types, item, initialTypeKey, onClose, onSaved }: {
  open: boolean; types: ObjectType[]; item: ObjectInstance | null; initialTypeKey?: string;
  onClose: () => void; onSaved: (object: ObjectInstance) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [typeKey, setTypeKey] = useState('');
  const [type, setType] = useState<ObjectType | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [title, setTitle] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setTypeKey(item?.typeKey ?? initialTypeKey ?? types[0]?.typeKey ?? '');
      setValues(item?.payload ?? {}); setTitle(item?.title ?? ''); setReason(''); setError('');
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (dialog.current?.open) dialog.current.close();
  }, [open, item, types, initialTypeKey]);
  useEffect(() => {
    if (!open || !typeKey) return;
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
      for (const property of type.publishedDefinition.properties) {
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
      <div><Label htmlFor="object-type">对象类型</Label><Select id="object-type" value={typeKey} disabled={!!item}
        onChange={(event) => { setTypeKey(event.target.value); setValues({}); }}>
        {types.map((candidate) => <option key={candidate.typeKey} value={candidate.typeKey}>
          {candidate.displayName} ({candidate.typeKey})</option>)}
      </Select></div>
      <div><Label htmlFor="object-title">标题{item ? '' : '（留空则按模型生成）'}</Label>
        <Input id="object-title" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
      {type?.typeKey === typeKey && <div className="grid gap-4 sm:grid-cols-2">
        {type.publishedDefinition.properties.map((property) => <div key={property.name} className="space-y-1">
          <Label htmlFor={`object-${property.name}`}>{property.label || property.name}{property.required ? ' *' : ''}</Label>
          {property.type === 'boolean' ? <Select id={`object-${property.name}`}
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
              placeholder={property.type === 'datetime' ? '2026-10-11T12:00:00Z' :
                property.type === 'reference' ? `${property.refType || '对象'} ID` : property.name} />}
          {property.description && <p className="text-xs text-muted-foreground">{property.description}</p>}
        </div>)}
      </div>}
      <div><Label htmlFor="object-reason">变更说明</Label><Input id="object-reason" value={reason}
        onChange={(event) => setReason(event.target.value)} /></div>
      <div className="flex justify-end gap-2"><Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
        <Button onClick={() => void save()} disabled={busy || !typeKey || type?.typeKey !== typeKey}>
          {busy ? '保存中…' : item ? '保存修改' : '创建对象'}</Button></div>
    </div>
  </dialog>;
}
