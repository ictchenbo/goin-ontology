/** 对象实例详情：属性、关联、证据、历史与附件。 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, apiFetch, downloadAttachment, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { formatTime } from '@/lib/utils';
import { ObjectEditorDialog, ObjectInstance, ObjectType } from './ObjectEditorDialog';

type Attachment = { id: string; filename: string; byteSize: number };
type LinkDef = { linkKey: string; displayName: string; fromType: string; toType: string;
  cardinality: string; state: string };
type ObjectLink = NonNullable<ObjectInstance['links']>[number];
type ObjectOption = { objectId: string; title: string; typeKey: string };
const noTypes: ObjectType[] = [];

function LinkEditorDialog({ open, object, link, definitions, onClose, onSaved }: {
  open: boolean; object: ObjectInstance | null; link: ObjectLink | null; definitions: LinkDef[];
  onClose: () => void; onSaved: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const compatible = definitions.filter((item) => item.state === 'published' &&
    (item.fromType === object?.typeKey || item.toType === object?.typeKey));
  const [linkKey, setLinkKey] = useState('');
  const [direction, setDirection] = useState<'outgoing' | 'incoming'>('outgoing');
  const [otherId, setOtherId] = useState('');
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ObjectOption[]>([]);
  const [propsText, setPropsText] = useState('{}');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const definition = compatible.find((item) => item.linkKey === linkKey);
  const canOutgoing = definition?.fromType === object?.typeKey;
  const canIncoming = definition?.toType === object?.typeKey;
  const targetType = direction === 'outgoing' ? definition?.toType : definition?.fromType;

  useEffect(() => {
    if (open) {
      const initialKey = link?.linkKey || compatible[0]?.linkKey || '';
      const initialDef = compatible.find((item) => item.linkKey === initialKey);
      setLinkKey(initialKey);
      setDirection(link?.direction === 'incoming' ? 'incoming' : initialDef?.fromType === object?.typeKey ? 'outgoing' : 'incoming');
      setOtherId(link?.otherObject?.objectId || '');
      setQuery(''); setOptions([]); setPropsText(JSON.stringify(link?.props || {}, null, 2)); setError('');
      if (!dialog.current?.open) dialog.current?.showModal();
    } else if (dialog.current?.open) dialog.current.close();
  }, [open, link, object, definitions]);

  const searchObjects = useCallback(async (typeKey: string, text: string) => {
    if (!typeKey) { setOptions([]); return; }
    try {
      const params = new URLSearchParams({ typeKey, limit: '30' });
      if (text.trim()) params.set('text', text.trim());
      const result = await api.get<{ items: ObjectOption[] }>(`/objects?${params}`);
      setOptions(result.items.filter((item) => item.objectId !== object?.objectId));
    } catch (failure) { setError((failure as ApiError).message || '搜索关联对象失败'); }
  }, [object?.objectId]);
  useEffect(() => {
    if (open && targetType) void searchObjects(targetType, '');
  }, [open, targetType, searchObjects]);

  async function save() {
    if (!object || !definition || !otherId) { setError('请选择关系定义和关联对象'); return; }
    setBusy(true); setError('');
    try {
      const props = JSON.parse(propsText);
      if (!props || typeof props !== 'object' || Array.isArray(props)) throw new Error('关系属性必须是 JSON 对象');
      const endpoints = direction === 'outgoing' ?
        { fromObjectId: object.objectId, toObjectId: otherId } :
        { fromObjectId: otherId, toObjectId: object.objectId };
      const body = { linkKey, ...endpoints, props };
      if (link) await api.patch(`/links/${encodeURIComponent(link.linkId)}`, body);
      else await api.post('/links', body);
      onSaved(); onClose();
    } catch (failure) { setError((failure as ApiError)?.message || (failure as Error).message || '保存关联失败'); }
    finally { setBusy(false); }
  }

  return <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); onClose(); }}
    aria-labelledby="link-editor-title"
    className="w-[min(94vw,680px)] max-h-[90vh] rounded-xl border border-border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50">
    <div className="max-h-[90vh] space-y-4 overflow-y-auto p-5 sm:p-6">
      <h2 id="link-editor-title" className="text-lg font-semibold">{link ? '编辑关联' : '添加关联'}</h2>
      {error && <Alert variant="error">{error}</Alert>}
      {compatible.length ? <>
        <div className="space-y-1"><Label htmlFor="link-definition">关系定义</Label>
          <Select id="link-definition" value={linkKey} onChange={(event) => {
            const next = compatible.find((item) => item.linkKey === event.target.value);
            setLinkKey(event.target.value); setDirection(next?.fromType === object?.typeKey ? 'outgoing' : 'incoming');
            setOtherId(''); setQuery('');
          }}>{compatible.map((item) => <option key={item.linkKey} value={item.linkKey}>
            {item.displayName} ({item.fromType} → {item.toType})
          </option>)}</Select></div>
        {canOutgoing && canIncoming && <div className="space-y-1"><Label htmlFor="link-direction">方向</Label>
          <Select id="link-direction" value={direction} onChange={(event) => {
            setDirection(event.target.value as 'outgoing' | 'incoming'); setOtherId('');
          }}><option value="outgoing">当前对象为起点</option><option value="incoming">当前对象为终点</option></Select></div>}
        <div className="space-y-1"><Label htmlFor="link-object-search">搜索{targetType}对象</Label>
          <div className="flex gap-2"><Input id="link-object-search" value={query} onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void searchObjects(targetType || '', query); } }}
            placeholder="输入标题或属性关键词" />
            <Button variant="outline" onClick={() => void searchObjects(targetType || '', query)}>搜索</Button></div></div>
        <div className="space-y-1"><Label htmlFor="link-target">关联对象</Label>
          <Select id="link-target" value={otherId} onChange={(event) => setOtherId(event.target.value)}>
            <option value="">请选择对象</option>
            {link?.otherObject?.objectId && !options.some((item) => item.objectId === link.otherObject?.objectId) &&
              <option value={link.otherObject.objectId}>{link.otherObject.title || link.otherObject.objectId}</option>}
            {options.map((item) => <option key={item.objectId} value={item.objectId}>{item.title} ({item.objectId})</option>)}
          </Select>
          {!options.length && <p className="text-xs text-muted-foreground">暂无匹配对象，请调整搜索词或先创建目标对象。</p>}</div>
        <div className="space-y-1"><Label htmlFor="link-props">关系属性（JSON）</Label>
          <Textarea id="link-props" value={propsText} onChange={(event) => setPropsText(event.target.value)} rows={3} /></div>
      </> : <p className="text-sm text-muted-foreground">当前对象类型尚无已发布的关系定义。
        <Link to="/ontology/links" onClick={onClose} className="ml-1 text-primary hover:underline">前往本体模型定义关系</Link></p>}
      <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={onClose}>取消</Button>
        <Button disabled={busy || !compatible.length || !otherId} onClick={() => void save()}>{busy ? '保存中…' : '保存关联'}</Button></div>
    </div>
  </dialog>;
}

function valueText(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

export function ObjectDetailPage() {
  const { objectId } = useParams<{ objectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { hasRole } = useAuth();
  const listSearch = (location.state as { listSearch?: string } | null)?.listSearch || '';
  const [detail, setDetail] = useState<ObjectInstance | null>(null);
  const [type, setType] = useState<ObjectType | null>(null);
  const [linkDefinitions, setLinkDefinitions] = useState<LinkDef[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editing, setEditing] = useState(false);
  const [linkEditorOpen, setLinkEditorOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<ObjectLink | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!objectId) return;
    setLoading(true); setError(null);
    try {
      const full = await api.get<ObjectInstance>(`/objects/${encodeURIComponent(objectId)}?includeHistory=true`);
      setDetail(full);
      const [typeResult, filesResult, linkResult] = await Promise.all([
        api.get<ObjectType>(`/ontology/types/${encodeURIComponent(full.typeKey)}`),
        api.get<{ items: Attachment[] }>(`/objects/${encodeURIComponent(objectId)}/attachments`),
        api.get<{ items: LinkDef[] }>('/ontology/links'),
      ]);
      setType(typeResult); setAttachments(filesResult.items); setLinkDefinitions(linkResult.items);
    } catch (failure) {
      setError((failure as ApiError).message || '加载对象详情失败');
    } finally { setLoading(false); }
  }, [objectId]);
  useEffect(() => { void load(); }, [load]);

  async function uploadAttachment(file: File) {
    if (!detail) return;
    setError(null);
    try {
      const form = new FormData();
      form.append('file', file);
      await apiFetch(`/objects/${encodeURIComponent(detail.objectId)}/attachments`, { method: 'POST', body: form });
      const files = await api.get<{ items: Attachment[] }>(`/objects/${encodeURIComponent(detail.objectId)}/attachments`);
      setAttachments(files.items);
    } catch (failure) { setError((failure as ApiError).message || '上传附件失败'); }
  }

  async function removeLink(link: ObjectLink) {
    if (!window.confirm(`移除与“${link.otherObject?.title || link.otherObject?.objectId || '关联对象'}”的关联？`)) return;
    setLinkBusy(true); setError(null);
    try {
      await api.delete(`/links/${encodeURIComponent(link.linkId)}`);
      await load();
    } catch (failure) { setError((failure as ApiError).message || '移除关联失败'); }
    finally { setLinkBusy(false); }
  }

  const payload = detail?.payload || detail?.properties || {};
  const properties = type?.publishedDefinition?.properties || [];
  const editorTypes = useMemo(() => type ? [type] : noTypes, [type]);
  const labelOf = (name: string) => properties.find((property) => property.name === name)?.label || name;
  const canAddLink = hasRole('admin', 'analyst', 'operator');
  const canChangeLink = hasRole('admin', 'analyst');

  return <div className="space-y-5">
    <div><Link to={`/objects${listSearch}`} className="text-sm text-primary hover:underline">← 返回对象列表</Link>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-2xl font-bold">{detail?.title || '对象详情'}</h1>
          {detail && <p className="font-mono text-sm text-muted-foreground">{detail.objectId}</p>}</div>
        {detail && <div className="flex flex-wrap gap-2">
          {hasRole('admin', 'analyst', 'operator') && <Button variant="outline" onClick={() => setEditing(true)}>编辑属性</Button>}
          <Button onClick={() => navigate(`/actions?objectId=${encodeURIComponent(detail.objectId)}`)}>执行 Action</Button>
        </div>}
      </div>
    </div>
    {error && <Alert variant="error">{error}</Alert>}
    {loading && <p className="text-muted-foreground">加载中…</p>}
    {!loading && detail && <>
      <Card><CardHeader><CardTitle>基本信息</CardTitle></CardHeader><CardContent>
        <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-muted-foreground">对象类型</dt><dd>{type?.displayName || detail.typeKey}<span className="ml-2 font-mono text-xs text-muted-foreground">{detail.typeKey}</span></dd></div>
          <div><dt className="text-muted-foreground">状态</dt><dd>{detail.status || payload.status ?
            <Badge variant={statusVariant(String(detail.status || payload.status))}>{String(detail.status || payload.status)}</Badge> : '—'}</dd></div>
          <div><dt className="text-muted-foreground">修订</dt><dd>r{detail.revision}</dd></div>
          <div><dt className="text-muted-foreground">更新时间</dt><dd>{formatTime(detail.updatedAt)}</dd></div>
        </dl>
      </CardContent></Card>

      <Card><CardHeader><CardTitle>属性</CardTitle></CardHeader><CardContent>
        {Object.keys(payload).length ? <div className="rounded-md border border-border"><Table><THeader><TR>
          <TH>属性</TH><TH>值</TH>
        </TR></THeader><TBody>{Object.entries(payload).map(([name, value]) => <TR key={name}>
          <TD className="w-52"><span className="font-medium">{labelOf(name)}</span>
            {properties.find((property) => property.name === name)?.computed &&
              <span className="ml-2 text-xs text-primary">计算 · 只读</span>}
            <div className="font-mono text-xs text-muted-foreground">{name}</div></TD>
          <TD><pre className="whitespace-pre-wrap break-all font-sans text-sm">{valueText(value)}</pre></TD>
        </TR>)}</TBody></Table></div> : <p className="text-sm text-muted-foreground">暂无属性值。</p>}
        {!properties.some((property) => !property.computed) &&
          <p className="mt-2 text-xs text-muted-foreground">对象类型尚无已发布的可编辑属性。
            <Link to={`/ontology/types/${encodeURIComponent(detail.typeKey)}`}
              className="ml-1 text-primary hover:underline">前往属性管理添加并发布</Link></p>}
        {detail.computedErrors && Object.keys(detail.computedErrors).length > 0 &&
          <div className="mt-3"><Alert variant="error">计算属性失败：{Object.entries(detail.computedErrors)
            .map(([name, reason]) => `${labelOf(name)}：${reason}`).join('；')}</Alert></div>}
      </CardContent></Card>

      <Card><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>关联（{detail.links?.length || 0}）</CardTitle>
        {canAddLink && <Button size="sm" onClick={() => { setEditingLink(null); setLinkEditorOpen(true); }}>添加关联</Button>}
      </CardHeader><CardContent>
        {detail.links?.length ? <ul className="space-y-2 text-sm">{detail.links.map((link) => <li key={link.linkId} className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{link.linkDisplay || link.linkKey}</Badge>
          <span className="text-xs text-muted-foreground">{link.direction === 'incoming' ? '←' : '→'}</span>
          {link.otherObject?.objectId ? <Link to={`/objects/${encodeURIComponent(link.otherObject.objectId)}`}
            className="text-primary hover:underline">{link.otherObject.title || link.otherObject.objectId}</Link> : '关联对象'}
          {link.props && Object.keys(link.props).length > 0 &&
            <span className="break-all text-xs text-muted-foreground">{JSON.stringify(link.props)}</span>}
          {canChangeLink && <span className="ml-auto flex gap-1">
            <Button size="sm" variant="ghost" disabled={linkBusy} onClick={() => {
              setEditingLink(link); setLinkEditorOpen(true);
            }}>编辑</Button>
            <Button size="sm" variant="destructive" disabled={linkBusy} onClick={() => void removeLink(link)}>移除</Button>
          </span>}
        </li>)}</ul> : <p className="text-sm text-muted-foreground">暂无关联</p>}
        {!linkDefinitions.some((item) => item.state === 'published' &&
          (item.fromType === detail.typeKey || item.toType === detail.typeKey)) &&
          <p className="mt-2 text-xs text-muted-foreground">当前类型尚无已发布的关系定义。
            <Link to="/ontology/links" className="ml-1 text-primary hover:underline">前往本体模型配置关系</Link></p>}
      </CardContent></Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card><CardHeader><CardTitle>证据（{detail.evidence?.length || 0}）</CardTitle></CardHeader><CardContent>
          {detail.evidence?.length ? <ul className="space-y-3 text-sm">{detail.evidence.map((evidence) => <li key={evidence.id}>
            <Badge variant="secondary">{evidence.sourceKey || 'source'}</Badge>
            <span className="ml-2 text-muted-foreground">{evidence.stance || '支持'} · {evidence.status || 'active'} · 置信度 {evidence.confidence ?? '—'} · {formatTime(evidence.observedAt)}</span>
          </li>)}</ul> : <p className="text-sm text-muted-foreground">暂无证据</p>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>版本历史</CardTitle></CardHeader><CardContent>
          {detail.history?.length ? <ul className="space-y-2 text-sm">{detail.history.map((history) => <li key={history.revision}>
            <span className="font-medium">r{history.revision}</span><span className="ml-2 text-muted-foreground">{formatTime(history.createdAt)} · {history.changedBy || '—'} · {history.changeReason || ''}</span>
          </li>)}</ul> : <p className="text-sm text-muted-foreground">暂无版本记录</p>}
        </CardContent></Card>
      </div>

      <Card><CardHeader><CardTitle>附件</CardTitle></CardHeader><CardContent className="space-y-3">
        <Input aria-label="上传附件" type="file" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void uploadAttachment(file);
        }} />
        {attachments.length ? <ul className="space-y-1 text-sm">{attachments.map((file) => <li key={file.id}>
          <button className="text-primary hover:underline" onClick={() => {
            void downloadAttachment(file.id, file.filename).catch((failure) => setError((failure as Error).message));
          }}>{file.filename}</button><span className="ml-2 text-muted-foreground">{file.byteSize} B</span>
        </li>)}</ul> : <p className="text-sm text-muted-foreground">暂无附件</p>}
      </CardContent></Card>
    </>}
    <ObjectEditorDialog open={editing} types={editorTypes} item={detail} onClose={() => setEditing(false)}
      onSaved={() => { void load(); }} />
    <LinkEditorDialog open={linkEditorOpen} object={detail} link={editingLink} definitions={linkDefinitions}
      onClose={() => setLinkEditorOpen(false)} onSaved={() => { void load(); }} />
  </div>;
}
