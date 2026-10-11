/**
 * 审计日志页：按时间/用户/动作检索操作痕迹
 */
import React, { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { Input, Label, Select } from '@/components/ui/Input';
import { formatTime } from '@/lib/utils';

interface AuditEvent {
  id: string;
  actor?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  correlationId?: string;
  createdAt?: string;
  details?: unknown;
}

export function AuditPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [actorFilter, setActorFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [selectedDetail, setSelectedDetail] = useState<AuditEvent | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: '100' });
      if (actorFilter) params.set('actor', actorFilter);
      if (actionFilter) params.set('action', actionFilter);
      const r = await api.get<{ items?: AuditEvent[] } | AuditEvent[]>(`/audit?${params}`);
      setEvents(Array.isArray(r) ? r : r.items || []);
    } catch (e) {
      setError((e as ApiError)?.message || '加载审计日志失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">审计日志</h1>
        <p className="text-muted-foreground">
          所有写操作、决策、审批与执行均写入 audit_event，可按 correlationId 追踪全链路。
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="w-40">
            <Label htmlFor="actor">用户</Label>
            <Input id="actor" value={actorFilter} onChange={(e) => setActorFilter(e.target.value)} />
          </div>
          <div className="w-40">
            <Label htmlFor="action">动作</Label>
            <Input id="action" value={actionFilter} onChange={(e) => setActionFilter(e.target.value)} />
          </div>
          <Button onClick={load} disabled={loading}>
            {loading ? '查询中…' : '查询'}
          </Button>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>事件列表（{events.length}）</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <THeader>
                <TR>
                  <TH>时间</TH>
                  <TH>用户</TH>
                  <TH>动作</TH>
                  <TH>资源</TH>
                  <TH />
                </TR>
              </THeader>
              <TBody>
                {events.map((e) => (
                  <TR key={e.id}>
                    <TD className="text-xs text-muted-foreground">{formatTime(e.createdAt)}</TD>
                    <TD>{e.actor || '—'}</TD>
                    <TD>
                      <Badge variant="outline">{e.action}</Badge>
                    </TD>
                    <TD className="text-xs">
                      {e.resourceType}/{e.resourceId}
                    </TD>
                    <TD>
                      <Button size="sm" variant="ghost" onClick={() => setSelectedDetail(e)}>
                        详情
                      </Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {events.length === 0 && !loading && (
              <p className="py-4 text-center text-muted-foreground">无匹配事件</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>事件详情</CardTitle>
            <CardDescription>{selectedDetail ? selectedDetail.action : '选择左侧事件'}</CardDescription>
          </CardHeader>
          <CardContent>
            {selectedDetail ? (
              <pre className="max-h-96 overflow-auto rounded-md bg-muted p-3 text-xs">
                {JSON.stringify(selectedDetail, null, 2)}
              </pre>
            ) : (
              <p className="text-muted-foreground">未选择事件。</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
