/** 对象实例列表：搜索、分页、创建与简单标题修改。 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { Input, Label, Select } from '@/components/ui/Input';
import { formatTime } from '@/lib/utils';
import { ObjectEditorDialog, ObjectInstance, ObjectType } from './ObjectEditorDialog';

type ObjectRow = ObjectInstance & { preview?: Record<string, unknown> };

function RenameObjectDialog({ item, onClose, onSaved }: {
  item: ObjectRow | null; onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (item) {
      setTitle(item.title); setError('');
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (dialog.current?.open) dialog.current.close();
  }, [item]);
  async function save() {
    if (!item) return;
    if (!title.trim()) { setError('标题不能为空'); return; }
    setBusy(true); setError('');
    try {
      await api.patch(`/objects/${encodeURIComponent(item.objectId)}`, {
        payload: {}, title: title.trim(), expectedRevision: item.revision, reason: '在列表修改标题',
      });
      onSaved(); onClose();
    } catch (failure) { setError((failure as ApiError).message || '修改标题失败'); }
    finally { setBusy(false); }
  }
  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }}
    aria-labelledby="rename-object-title"
    className="w-[min(94vw,480px)] rounded-xl border border-border bg-card p-5 text-card-foreground shadow-xl backdrop:bg-black/50">
    <h2 id="rename-object-title" className="text-lg font-semibold">修改对象标题</h2>
    <div className="mt-4 space-y-2"><Label htmlFor="rename-object-input">标题</Label>
      <Input id="rename-object-input" value={title} onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Enter') void save(); }} /></div>
    {error && <div className="mt-3"><Alert variant="error">{error}</Alert></div>}
    <div className="mt-5 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
      <Button disabled={busy} onClick={() => void save()}>保存</Button></div>
  </dialog>;
}

export function ObjectsPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') || '';
  const typeFilter = searchParams.get('type') || '';
  const page = Math.max(1, Number(searchParams.get('page')) || 1);
  const requestedSize = Number(searchParams.get('size'));
  const pageSize = [10, 20, 50].includes(requestedSize) ? requestedSize : 10;
  const [draft, setDraft] = useState(query);
  const [items, setItems] = useState<ObjectRow[]>([]);
  const [total, setTotal] = useState(0);
  const [types, setTypes] = useState<ObjectType[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [renaming, setRenaming] = useState<ObjectRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { setDraft(query); }, [query]);
  const loadTypes = useCallback(async () => {
    const result = await api.get<{ items: ObjectType[] }>('/ontology/types');
    setTypes([...result.items].sort((a, b) =>
      (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '') ||
      (b.createdAt || '').localeCompare(a.createdAt || '')));
  }, []);
  useEffect(() => {
    void loadTypes().catch((failure: ApiError) => setError(failure.message || '加载对象类型失败'));
  }, [loadTypes]);
  async function openEditor() {
    try { await loadTypes(); setEditorOpen(true); }
    catch (failure) { setError((failure as ApiError).message || '加载对象类型失败'); }
  }
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) });
      if (query) params.set('text', query);
      if (typeFilter) params.set('typeKey', typeFilter);
      const result = await api.get<{ items: ObjectRow[]; total: number }>(`/objects?${params}`);
      setItems(result.items); setTotal(result.total);
    } catch (failure) { setError((failure as ApiError).message || '检索对象失败'); }
    finally { setLoading(false); }
  }, [query, typeFilter, page, pageSize]);
  useEffect(() => { void load(); }, [load]);

  function updateFilters(changes: Record<string, string>) {
    const next = new URLSearchParams(searchParams);
    for (const [name, value] of Object.entries(changes)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    setSearchParams(next);
  }
  function submitSearch() {
    const next = draft.trim();
    if (next === query && page === 1) void load();
    else updateFilters({ q: next, page: '' });
  }
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const detailState = { listSearch: location.search };
  const canEdit = hasRole('admin', 'analyst', 'operator');

  return <div className="space-y-5">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-bold">对象列表</h1>
        <p className="text-muted-foreground">在列表中查找实例，进入详情查看属性、关联、证据和历史。</p></div>
      {canEdit && <Button onClick={() => void openEditor()}>新建对象</Button>}
    </div>
    {error && <Alert variant="error">{error}</Alert>}
    <Card><CardContent className="space-y-4 pt-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex w-full max-w-2xl flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1 space-y-1"><Label htmlFor="object-search">搜索对象</Label>
            <Input id="object-search" value={draft} onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') submitSearch(); }} placeholder="标题、编号或属性" /></div>
          <div className="min-w-[180px] space-y-1"><Label htmlFor="object-type-filter">对象类型</Label>
            <Select id="object-type-filter" value={typeFilter} onChange={(event) => updateFilters({ type: event.target.value, page: '' })}>
              <option value="">全部类型</option>
              {types.filter((type) => type.state === 'published').map((type) =>
                <option key={type.typeKey} value={type.typeKey}>{type.displayName} ({type.typeKey})</option>)}
            </Select></div>
          <Button disabled={loading} onClick={submitSearch}>搜索</Button>
        </div>
        <div className="space-y-1"><Label htmlFor="object-page-size">每页</Label>
          <Select id="object-page-size" value={pageSize} onChange={(event) => updateFilters({ size: event.target.value, page: '' })}>
            {[10, 20, 50].map((size) => <option key={size} value={size}>{size} 条</option>)}
          </Select></div>
      </div>
      <div className="rounded-md border border-border"><Table><THeader><TR>
        <TH>对象</TH><TH>类型</TH><TH>状态</TH><TH>更新</TH><TH>操作</TH>
      </TR></THeader><TBody>{items.length ? items.map((object) => {
        const status = object.status || object.preview?.status || object.payload?.status;
        return <TR key={object.objectId}>
          <TD><Link to={`/objects/${encodeURIComponent(object.objectId)}`} state={detailState}
            className="font-medium text-primary hover:underline">{object.title || object.objectId}</Link>
            <div className="font-mono text-xs text-muted-foreground">{object.objectId}</div></TD>
          <TD className="text-sm">{types.find((type) => type.typeKey === object.typeKey)?.displayName || object.typeKey}</TD>
          <TD>{status ? <Badge variant={statusVariant(String(status))}>{String(status)}</Badge> : '—'}</TD>
          <TD className="text-sm text-muted-foreground">{formatTime(object.updatedAt)}</TD>
          <TD><div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => navigate(`/objects/${encodeURIComponent(object.objectId)}`, { state: detailState })}>详情</Button>
            {canEdit && <Button size="sm" variant="ghost" onClick={() => setRenaming(object)}>改标题</Button>}
          </div></TD>
        </TR>;
      }) : <TR><TD colSpan={5} className="py-8 text-center text-muted-foreground">{loading ? '加载中…' : '没有匹配的对象'}</TD></TR>}</TBody></Table></div>
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>共 {total} 条 · 第 {Math.min(page, pages)} / {pages} 页</span>
        <div className="flex gap-2"><Button size="sm" variant="outline" disabled={loading || page <= 1}
          onClick={() => updateFilters({ page: String(page - 1) })}>上一页</Button>
          <Button size="sm" variant="outline" disabled={loading || page >= pages}
            onClick={() => updateFilters({ page: String(page + 1) })}>下一页</Button></div>
      </div>
    </CardContent></Card>
    <ObjectEditorDialog open={editorOpen} types={types} item={null} initialTypeKey={typeFilter || undefined}
      onClose={() => setEditorOpen(false)}
      onSaved={(object) => navigate(`/objects/${encodeURIComponent(object.objectId)}`, { state: detailState })} />
    <RenameObjectDialog item={renaming} onClose={() => setRenaming(null)} onSaved={() => { void load(); }} />
  </div>;
}
