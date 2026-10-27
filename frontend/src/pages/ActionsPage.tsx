/**
 * 动作执行页：Action 运行记录、Outbox 消息、重试与补偿
 */
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { ActionObjectParams } from '@/components/ActionObjectParams';
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

interface ActionType {
  actionKey: string;
  name: string;
  state: string;
  paramsSchema?: { properties?: Record<string, { type?: string }>; required?: string[] };
}

interface ActionValidation {
  valid: boolean;
  errors: string[];
  preconditionResults: Array<{ expression: string; passed: boolean; message?: string }>;
  writePlan: Array<{ op: string; target: string; detail: string }>;
}

export function ActionsPage() {
  const [searchParams] = useSearchParams();
  const { hasRole } = useAuth();
  const [actionTypes, setActionTypes] = useState<ActionType[]>([]);
  const [actionKey, setActionKey] = useState('');
  const [paramsText, setParamsText] = useState(() => JSON.stringify({ objectId: searchParams.get('objectId') || '' }, null, 2));
  const [caseId, setCaseId] = useState('');
  const [alternativeId, setAlternativeId] = useState('');
  const [approvalId, setApprovalId] = useState('');
  const [preview, setPreview] = useState<ActionValidation | null>(null);
  const [runs, setRuns] = useState<ActionRun[]>([]);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const editableParams = (() => {
    try {
      const parsed = JSON.parse(paramsText) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed as Record<string, unknown> : {};
    } catch { return {}; }
  })();

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
    api.get<{ items?: ActionType[] } | ActionType[]>('/action-types')
      .then((result) => setActionTypes((Array.isArray(result) ? result : result.items || []).filter((a) => a.state === 'published')))
      .catch((e: ApiError) => setError(e.message || '加载 Action 类型失败'));
  }, []);

  useEffect(() => {
    const objectId = searchParams.get('objectId');
    if (objectId) setParamsText((current) => {
      try { return JSON.stringify({ ...JSON.parse(current), objectId }, null, 2); }
      catch { return JSON.stringify({ objectId }, null, 2); }
    });
  }, [searchParams]);

  function requestBody() {
    if (!actionKey) throw new Error('请选择 Action');
    let params: unknown;
    try { params = JSON.parse(paramsText); }
    catch { throw new Error('参数不是有效的 JSON'); }
    if (!params || Array.isArray(params) || typeof params !== 'object') throw new Error('参数必须是 JSON 对象');
    return { actionKey, params, caseId: caseId.trim() || undefined,
      alternativeId: alternativeId.trim() || undefined, approvalId: approvalId.trim() || undefined };
  }

  async function validate() {
    setBusy(true); setError(null); setInfo(null); setPreview(null);
    try {
      const result = await api.post<ActionValidation>('/actions/validate', requestBody());
      setPreview(result);
      if (result.valid) setInfo('验证通过，可以执行');
    } catch (e) { setError((e as Error).message || '验证失败'); }
    finally { setBusy(false); }
  }

  async function execute() {
    setBusy(true); setError(null); setInfo(null);
    try {
      const body = requestBody();
      const checked = await api.post<ActionValidation>('/actions/validate', body);
      setPreview(checked);
      if (!checked.valid) { setError(checked.errors.join('；') || '验证未通过'); return; }
      await api.post('/actions/execute', { ...body, idempotencyKey: crypto.randomUUID() });
      setInfo('Action 已执行');
      await load();
    } catch (e) { setError((e as Error).message || '执行失败'); }
    finally { setBusy(false); }
  }

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
        <CardHeader><CardTitle>执行 Action</CardTitle>
          <CardDescription>选择已发布 Action，通过对象选择器填写引用参数，再查看验证和写入计划。</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="execute-action">Action</Label>
              <Select id="execute-action" value={actionKey} onChange={(e) => {
                const next = e.target.value; setActionKey(next); setPreview(null);
                const def = actionTypes.find((a) => a.actionKey === next);
                const objectId = searchParams.get('objectId') || '';
                setParamsText(JSON.stringify(Object.fromEntries(Object.entries(def?.paramsSchema?.properties || {})
                  .map(([key, spec]) => [key, key === 'objectId' ? objectId : spec.type === 'number' ? 0
                    : spec.type === 'boolean' ? false : spec.type === 'array' ? [] : spec.type === 'object' ? {} : ''])), null, 2));
              }}><option value="">选择 Action</option>{actionTypes.map((a) =>
                <option key={a.actionKey} value={a.actionKey}>{a.name} ({a.actionKey})</option>)}</Select></div>
            <div className="space-y-2"><Label htmlFor="execute-case">案例 ID（可选）</Label>
              <Input id="execute-case" value={caseId} onChange={(e) => setCaseId(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="execute-alternative">方案 ID（可选）</Label>
              <Input id="execute-alternative" value={alternativeId} onChange={(e) => setAlternativeId(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="execute-approval">审批 ID（可选）</Label>
              <Input id="execute-approval" value={approvalId} onChange={(e) => setApprovalId(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor="execute-params">参数（JSON）</Label>
            <Textarea id="execute-params" rows={6} className="font-mono text-xs" value={paramsText}
              onChange={(e) => { setParamsText(e.target.value); setPreview(null); }} /></div>
          <ActionObjectParams actionKey={actionKey} params={editableParams}
            onChange={(key, objectId) => {
              setParamsText((current) => {
                try {
                  const parsed = JSON.parse(current) as Record<string, unknown>;
                  return JSON.stringify({ ...parsed, [key]: objectId }, null, 2);
                } catch { return current; }
              });
              setPreview(null);
            }} />
          <div className="flex gap-2"><Button variant="outline" disabled={busy || !actionKey} onClick={validate}>验证</Button>
            <Button disabled={busy || !actionKey} onClick={execute}>执行</Button></div>
          {preview && <div className="space-y-2 rounded-md border p-3 text-sm">
            <Badge variant={preview.valid ? 'success' : 'destructive'}>{preview.valid ? '验证通过' : '验证失败'}</Badge>
            {preview.errors.length > 0 && <ul className="list-inside list-disc text-destructive">{preview.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
            {preview.writePlan.length > 0 && <pre className="overflow-auto bg-muted p-2 text-xs">{JSON.stringify(preview.writePlan, null, 2)}</pre>}
          </div>}
        </CardContent>
      </Card>

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
