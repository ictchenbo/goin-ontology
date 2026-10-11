/** 对象实例详情：属性、关联、证据、历史与附件。 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, apiFetch, downloadAttachment, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { Input } from '@/components/ui/Input';
import { formatTime } from '@/lib/utils';
import { ObjectEditorDialog, ObjectInstance, ObjectType } from './ObjectEditorDialog';

type Attachment = { id: string; filename: string; byteSize: number };
const noTypes: ObjectType[] = [];

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
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!objectId) return;
    setLoading(true); setError(null);
    try {
      const full = await api.get<ObjectInstance>(`/objects/${encodeURIComponent(objectId)}?includeHistory=true`);
      setDetail(full);
      const [typeResult, filesResult] = await Promise.all([
        api.get<ObjectType>(`/ontology/types/${encodeURIComponent(full.typeKey)}`),
        api.get<{ items: Attachment[] }>(`/objects/${encodeURIComponent(objectId)}/attachments`),
      ]);
      setType(typeResult); setAttachments(filesResult.items);
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

  const payload = detail?.payload || detail?.properties || {};
  const properties = type?.publishedDefinition?.properties || [];
  const editorTypes = useMemo(() => type ? [type] : noTypes, [type]);
  const labelOf = (name: string) => properties.find((property) => property.name === name)?.label || name;

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
        </TR>)}</TBody></Table></div> : <p className="text-sm text-muted-foreground">暂无属性</p>}
        {detail.computedErrors && Object.keys(detail.computedErrors).length > 0 &&
          <div className="mt-3"><Alert variant="error">计算属性失败：{Object.entries(detail.computedErrors)
            .map(([name, reason]) => `${labelOf(name)}：${reason}`).join('；')}</Alert></div>}
      </CardContent></Card>

      <Card><CardHeader><CardTitle>关联（{detail.links?.length || 0}）</CardTitle></CardHeader><CardContent>
        {detail.links?.length ? <ul className="space-y-2 text-sm">{detail.links.map((link) => <li key={link.linkId} className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{link.linkKey}</Badge>
          {link.otherObject?.objectId ? <Link to={`/objects/${encodeURIComponent(link.otherObject.objectId)}`}
            className="text-primary hover:underline">{link.otherObject.title || link.otherObject.objectId}</Link> : '关联对象'}
        </li>)}</ul> : <p className="text-sm text-muted-foreground">暂无关联</p>}
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
  </div>;
}
