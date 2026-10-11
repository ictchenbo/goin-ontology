/**
 * 对象浏览页：检索、详情（属性/关联/证据/历史）
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, apiFetch, downloadAttachment, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { formatTime } from '@/lib/utils';

interface ObjectInstance {
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
type ObjectType = { typeKey: string; displayName: string; state: string;
  publishedDefinition: { properties: PropertyDef[] } };

function ObjectEditorDialog({ open, types, item, onClose, onSaved }: {
  open: boolean; types: ObjectType[]; item: ObjectInstance | null;
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
      setTypeKey(item?.typeKey ?? types[0]?.typeKey ?? '');
      setValues(item?.payload ?? {}); setTitle(item?.title ?? ''); setReason(''); setError('');
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (dialog.current?.open) dialog.current.close();
  }, [open, item, types]);
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

export function ObjectsPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const { objectId } = useParams<{ objectId: string }>();
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [items, setItems] = useState<ObjectInstance[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const [types, setTypes] = useState<ObjectType[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<ObjectInstance | null>(null);
  const [selected, setSelected] = useState<ObjectInstance | null>(null);
  const [detail, setDetail] = useState<ObjectInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ id: string; filename: string; byteSize: number }>>([]);

  // 加载类型列表用于过滤
  useEffect(() => {
    (async () => {
      try {
        const result = await api.get<{ items?: ObjectType[] }>(
          '/ontology/types'
        );
        setTypes((result.items || []).filter((type) => type.state === 'published'));
      } catch {
        /* 类型列表加载失败不阻塞对象检索 */
      }
    })();
  }, []);

  const search = useCallback(async (pageNumber = page) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('text', query.trim());
      if (typeFilter) params.set('typeKey', typeFilter);
      params.set('limit', String(pageSize));
      params.set('offset', String((pageNumber - 1) * pageSize));
      const result = await api.get<{ items?: ObjectInstance[]; total?: number } | ObjectInstance[]>(
        `/objects?${params.toString()}`
      );
      setItems(Array.isArray(result) ? result : result.items || []);
      setTotal(Array.isArray(result) ? result.length : result.total ?? 0);
    } catch (e) {
      setError((e as ApiError)?.message || '检索失败');
    } finally {
      setLoading(false);
    }
  }, [query, typeFilter, page]);

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, page]);
  function submitSearch() {
    if (page === 1) void search(1);
    else setPage(1);
  }

  async function loadDetail(id: string) {
    setDetail(null);
    try {
      const full = await api.get<ObjectInstance>(`/objects/${encodeURIComponent(id)}?includeHistory=true`);
      setSelected(full); setDetail(full);
      const files = await api.get<{ items: Array<{ id: string; filename: string; byteSize: number }> }>(`/objects/${encodeURIComponent(id)}/attachments`);
      setAttachments(files.items);
    } catch (e) {
      setError((e as ApiError)?.message || '加载详情失败');
    }
  }
  useEffect(() => {
    if (objectId) void loadDetail(objectId);
    else { setSelected(null); setDetail(null); }
  }, [objectId]);
  function openDetail(obj: ObjectInstance) { setSelected(obj); navigate(`/objects/${encodeURIComponent(obj.objectId)}`); }

  async function uploadAttachment(file: File) {
    if (!detail) return;
    try {
      const form = new FormData();
      form.append('file', file);
      await apiFetch(`/objects/${detail.objectId}/attachments`, { method: 'POST', body: form });
      const files = await api.get<{ items: Array<{ id: string; filename: string; byteSize: number }> }>(`/objects/${detail.objectId}/attachments`);
      setAttachments(files.items);
    } catch (e) {
      setError((e as ApiError)?.message || '附件上传失败');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3"><div>
        <h1 className="text-2xl font-bold">对象浏览</h1>
        <p className="text-muted-foreground">按类型与关键词检索对象实例，查看关联图谱、证据与版本历史。</p>
      </div>{hasRole('admin', 'analyst', 'operator') && <Button onClick={() => { setEditing(null); setEditorOpen(true); }}>
        新建对象</Button>}</div>

      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[200px] flex-1">
            <Label htmlFor="q">关键词</Label>
            <Input
              id="q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submitSearch(); }}
              placeholder="名称 / 编号"
            />
          </div>
          <div className="w-48">
            <Label htmlFor="typeFilter">类型</Label>
            <Select id="typeFilter" value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
              <option value="">全部类型</option>
              {types.map((t) => (
                <option key={t.typeKey} value={t.typeKey}>
                  {t.displayName || t.typeKey}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={submitSearch} disabled={loading}>
            {loading ? '检索中…' : '检索'}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>结果（{total}）</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THeader>
                <TR>
                  <TH>名称</TH>
                  <TH>类型</TH>
                  <TH>状态</TH>
                  <TH>更新</TH>
                  <TH />
                </TR>
              </THeader>
              <TBody>
                {items.map((o) => (
                  <TR key={o.objectId}>
                    <TD className="font-medium">{o.title || o.objectId}</TD>
                    <TD className="text-xs">{o.typeKey}</TD>
                    <TD>
                      {o.status ? <Badge variant={statusVariant(o.status)}>{o.status}</Badge> : '—'}
                    </TD>
                    <TD className="text-xs text-muted-foreground">{formatTime(o.updatedAt)}</TD>
                    <TD>
                      <Button size="sm" variant="outline" onClick={() => openDetail(o)}>
                        查看
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {items.length === 0 && !loading && (
              <p className="py-4 text-center text-muted-foreground">无匹配对象</p>
            )}
            {total > pageSize && <div className="mt-4 flex items-center justify-end gap-2 text-sm">
              <span>第 {page} / {Math.ceil(total / pageSize)} 页</span>
              <Button size="sm" variant="outline" disabled={loading || page <= 1}
                onClick={() => setPage(page - 1)}>上一页</Button>
              <Button size="sm" variant="outline" disabled={loading || page >= Math.ceil(total / pageSize)}
                onClick={() => setPage(page + 1)}>下一页</Button>
            </div>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2"><CardTitle>对象详情</CardTitle>
              {detail && hasRole('admin', 'analyst', 'operator') && <Button size="sm" variant="outline"
                onClick={() => { setEditing(detail); setEditorOpen(true); }}>编辑</Button>}</div>
            <CardDescription>{selected ? selected.title || selected.objectId : '选择左侧对象'}</CardDescription>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <p className="text-muted-foreground">未选择对象。</p>
            ) : !detail ? (
              <p className="text-muted-foreground">加载中…</p>
            ) : (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-mono text-muted-foreground">对象 ID：{detail.objectId}</span>
                  <Button size="sm" variant="outline" onClick={() =>
                    navigate(`/actions?objectId=${encodeURIComponent(detail.objectId)}`)}>执行 Action</Button>
                </div>
                <div>
                  <h4 className="mb-2 text-sm font-semibold">属性</h4>
                  <pre className="max-h-48 overflow-auto rounded-md bg-muted p-3 text-xs">
                    {JSON.stringify(detail.payload || detail.properties || {}, null, 2)}
                  </pre>
                </div>

                {detail.links && detail.links.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-sm font-semibold">关联（{detail.links.length}）</h4>
                    <ul className="space-y-1 text-sm">
                      {detail.links.map((l) => (
                        <li key={l.linkId} className="flex items-center gap-2">
                          <Badge variant="outline">{l.linkKey}</Badge>
                          <span>{l.otherObject?.title || l.otherObject?.objectId}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {detail.evidence && detail.evidence.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-sm font-semibold">证据（{detail.evidence.length}）</h4>
                    <ul className="space-y-1 text-sm">
                      {detail.evidence.map((ev) => (
                        <li key={ev.id} className="flex items-center gap-2">
                          <Badge variant="secondary">{ev.sourceKey || 'source'}</Badge>
                          <span className="text-muted-foreground">
                            {ev.stance || '支持'} · {ev.status || 'active'} · 置信度 {ev.confidence ?? '—'} · {formatTime(ev.observedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {detail.history && detail.history.length > 0 && (
                  <div>
                    <h4 className="mb-2 text-sm font-semibold">版本历史</h4>
                    <ul className="space-y-1 text-xs text-muted-foreground">
                      {detail.history.map((h) => (
                        <li key={h.revision}>
                          r{h.revision} · {formatTime(h.createdAt)} · {h.changedBy || '—'} · {h.changeReason || ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div>
                  <h4 className="mb-2 text-sm font-semibold">附件</h4>
                  <Input aria-label="上传附件" type="file" onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void uploadAttachment(file);
                  }} />
                  <ul className="mt-2 space-y-1 text-sm">
                    {attachments.map((file) => (
                      <li key={file.id}>
                        <button className="text-primary underline" onClick={() => {
                          void downloadAttachment(file.id, file.filename).catch((e) => setError(e.message));
                        }}>{file.filename}</button>
                        <span className="ml-2 text-muted-foreground">{file.byteSize} B</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      <ObjectEditorDialog open={editorOpen} types={types} item={editing} onClose={() => setEditorOpen(false)}
        onSaved={(object) => { void search(); navigate(`/objects/${encodeURIComponent(object.objectId)}`);
          if (object.objectId === objectId) void loadDetail(object.objectId); }} />
    </div>
  );
}
