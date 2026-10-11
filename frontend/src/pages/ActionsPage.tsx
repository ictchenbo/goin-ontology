/**
 * 动作执行页：Action 运行记录、Outbox 消息、重试与补偿
 */
import React, { useEffect, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { formatTime } from '@/lib/utils';

interface ActionRun {
  id: string;
  actionTypeKey: string;
  status: string;
  caseId?: string;
  idempotencyKey?: string;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  writeSet?: unknown;
}

interface OutboxMessage {
  id: string;
  topic: string;
  status: string;
  attempts: number;
  payload?: unknown;
  createdAt?: string;
  lastError?: string;
}

export function ActionsPage() {
  const { hasRole } = useAuth();
  const [runs, setRuns] = useState<ActionRun[]>([]);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [runsRes, outboxRes] = await Promise.allSettled([
        api.get<{ items?: ActionRun[] } | ActionRun[]>('/actions/runs'),
        api.get<{ items?: OutboxMessage[] } | OutboxMessage[]>('/outbox'),
      ]);
      if (runsRes.status === 'fulfilled') {
        const r = runsRes.value;
        setRuns(Array.isArray(r) ? r : r.items || []);
      }
      if (outboxRes.status === 'fulfilled') {
        const r = outboxRes.value;
        setOutbox(Array.isArray(r) ? r : r.items || []);
      }
    } catch (e) {
      setError((e as ApiError)?.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function retryOutbox(id: string) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await api.post(`/outbox/${id}/retry`, {});
      setInfo('已触发重试');
      await load();
    } catch (e) {
      setError((e as ApiError)?.message || '重试失败');
    } finally {
      setBusy(false);
    }
  }

  async function deliverPending() {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await api.post('/outbox/deliver', {});
      setInfo('已触发 Outbox 投递');
      await load();
    } catch (e) {
      setError((e as ApiError)?.message || '投递失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">动作执行</h1>
          <p className="text-muted-foreground">
            Action Engine：校验 → 前置条件 → 审批策略 → 原子写集 → 审计与 Outbox（至少一次投递）。
          </p>
        </div>
        {hasRole('operator', 'admin', 'commander') && (
          <Button onClick={deliverPending} disabled={busy}>
            投递 Outbox 待发消息
          </Button>
        )}
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {info && <Alert variant="success">{info}</Alert>}

      <Card>
        <CardHeader>
          <CardTitle>执行记录</CardTitle>
          <CardDescription>幂等键重放会返回首次结果，不会重复执行。</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">加载中…</p>
          ) : runs.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">暂无执行记录</p>
          ) : (
            <Table>
              <THeader>
                <TR>
                  <TH>动作</TH>
                  <TH>状态</TH>
                  <TH>案例</TH>
                  <TH>幂等键</TH>
                  <TH>开始</TH>
                  <TH>错误</TH>
                </TR>
              </THeader>
              <TBody>
                {runs.map((r) => (
                  <TR key={r.id}>
                    <TD className="font-mono text-xs">{r.actionTypeKey}</TD>
                    <TD>
                      <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                    </TD>
                    <TD className="text-xs">{r.caseId || '—'}</TD>
                    <TD className="text-xs text-muted-foreground">{r.idempotencyKey || '—'}</TD>
                    <TD className="text-xs text-muted-foreground">{formatTime(r.startedAt)}</TD>
                    <TD className="max-w-[180px] truncate text-xs text-destructive">{r.error || '—'}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Outbox 消息</CardTitle>
          <CardDescription>外部副作用通过 Outbox 异步投递，失败可重试。</CardDescription>
        </CardHeader>
        <CardContent>
          {outbox.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">暂无 Outbox 消息</p>
          ) : (
            <Table>
              <THeader>
                <TR>
                  <TH>主题</TH>
                  <TH>状态</TH>
                  <TH>尝试次数</TH>
                  <TH>创建时间</TH>
                  <TH>错误</TH>
                  <TH>操作</TH>
                </TR>
              </THeader>
              <TBody>
                {outbox.map((m) => (
                  <TR key={m.id}>
                    <TD className="font-mono text-xs">{m.topic}</TD>
                    <TD>
                      <Badge variant={statusVariant(m.status)}>{m.status}</Badge>
                    </TD>
                    <TD>{m.attempts}</TD>
                    <TD className="text-xs text-muted-foreground">{formatTime(m.createdAt)}</TD>
                    <TD className="max-w-[160px] truncate text-xs text-destructive">{m.lastError || '—'}</TD>
                    <TD>
                      {m.status !== 'delivered' && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => retryOutbox(m.id)}
                        >
                          重试
                        </Button>
                      )}
                    </TD>
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
