/**
 * 对象浏览页：检索、详情（属性/关联/证据/历史）
 */
import React, { useCallback, useEffect, useState } from 'react';
import { api, apiFetch, downloadAttachment, ApiError } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { Input, Label, Select } from '@/components/ui/Input';
import { formatTime } from '@/lib/utils';

interface ObjectInstance {
  objectId: string;
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

export function ObjectsPage() {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [items, setItems] = useState<ObjectInstance[]>([]);
  const [types, setTypes] = useState<Array<{ typeKey: string; label?: string }>>([]);
  const [selected, setSelected] = useState<ObjectInstance | null>(null);
  const [detail, setDetail] = useState<ObjectInstance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<Array<{ id: string; filename: string; byteSize: number }>>([]);

  // 加载类型列表用于过滤
  useEffect(() => {
    (async () => {
      try {
        const result = await api.get<{ items?: Array<{ typeKey: string; label?: string }> }>(
          '/ontology/types'
        );
        setTypes(result.items || []);
      } catch {
        /* 类型列表加载失败不阻塞对象检索 */
      }
    })();
  }, []);

  const search = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('text', query.trim());
      if (typeFilter) params.set('typeKey', typeFilter);
      params.set('limit', '50');
      const result = await api.get<{ items?: ObjectInstance[] } | ObjectInstance[]>(
        `/objects?${params.toString()}`
      );
      setItems(Array.isArray(result) ? result : result.items || []);
    } catch (e) {
      setError((e as ApiError)?.message || '检索失败');
    } finally {
      setLoading(false);
    }
  }, [query, typeFilter]);

  useEffect(() => {
    search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter]);

  async function openDetail(obj: ObjectInstance) {
    setSelected(obj);
    setDetail(null);
    try {
      const full = await api.get<ObjectInstance>(`/objects/${obj.objectId}?includeHistory=true`);
      setDetail(full);
      const files = await api.get<{ items: Array<{ id: string; filename: string; byteSize: number }> }>(`/objects/${obj.objectId}/attachments`);
      setAttachments(files.items);
    } catch (e) {
      setError((e as ApiError)?.message || '加载详情失败');
    }
  }

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
      <div>
        <h1 className="text-2xl font-bold">对象浏览</h1>
        <p className="text-muted-foreground">按类型与关键词检索对象实例，查看关联图谱、证据与版本历史。</p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[200px] flex-1">
            <Label htmlFor="q">关键词</Label>
            <Input
              id="q"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && search()}
              placeholder="名称 / 编号"
            />
          </div>
          <div className="w-48">
            <Label htmlFor="typeFilter">类型</Label>
            <Select id="typeFilter" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              <option value="">全部类型</option>
              {types.map((t) => (
                <option key={t.typeKey} value={t.typeKey}>
                  {t.label || t.typeKey}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={search} disabled={loading}>
            {loading ? '检索中…' : '检索'}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>结果（{items.length}）</CardTitle>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>对象详情</CardTitle>
            <CardDescription>{selected ? selected.title || selected.objectId : '选择左侧对象'}</CardDescription>
          </CardHeader>
          <CardContent>
            {!selected ? (
              <p className="text-muted-foreground">未选择对象。</p>
            ) : !detail ? (
              <p className="text-muted-foreground">加载中…</p>
            ) : (
              <div className="space-y-4">
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
    </div>
  );
}
