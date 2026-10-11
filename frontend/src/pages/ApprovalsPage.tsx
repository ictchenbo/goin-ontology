/**
 * 审批中心：待办审批、批准/驳回、失效处理
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { Input } from '@/components/ui/Input';
import { formatTime } from '@/lib/utils';

interface ApprovalItem {
  id: string;
  caseId?: string;
  caseTitle?: string;
  status: string;
  proposer?: string;
  requestedBy?: string;
  requestedAt?: string;
  createdAt?: string;
  decidedAt?: string;
  decidedBy?: string;
  comment?: string;
  alternativeName?: string;
  canApprove?: boolean;
}

export function ApprovalsPage() {
  const { hasRole, user } = useAuth();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState('pending');

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const qs = statusFilter ? `?status=${statusFilter}` : '';
      const r = await api.get<{ items?: ApprovalItem[] } | ApprovalItem[]>(`/approvals${qs}`);
      setItems(Array.isArray(r) ? r : r.items || []);
    } catch (e) {
      setError((e as ApiError)?.message || '加载审批列表失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function decide(approvalId: string, decision: 'approved' | 'rejected') {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await api.post(`/approvals/${approvalId}/decide`, {
        decision,
        comment: comments[approvalId] || (decision === 'approved' ? '同意' : '不同意'),
      });
      setInfo(decision === 'approved' ? '已批准' : '已驳回');
      await load();
    } catch (e) {
      setError((e as ApiError)?.message || '审批操作失败');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">审批中心</h1>
        <p className="text-muted-foreground">
          职责分离：决策提议人不能批准自己的请求（管理员除外）。
        </p>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {info && <Alert variant="success">{info}</Alert>}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle>审批事项（{items.length}）</CardTitle>
              <CardDescription>当前用户：{user?.displayName}（{user?.roles?.join(', ')}）</CardDescription>
            </div>
            <select
              aria-label="按状态筛选审批"
              className="h-9 rounded-md border border-border bg-background px-2 text-sm"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="pending">待审批</option>
              <option value="approved">已批准</option>
              <option value="rejected">已驳回</option>
              <option value="">全部</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">加载中…</p>
          ) : items.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">暂无审批事项</p>
          ) : (
            <Table>
              <THeader>
                <TR>
                  <TH>案例</TH>
                  <TH>方案</TH>
                  <TH>状态</TH>
                  <TH>提交人/时间</TH>
                  <TH>意见</TH>
                  <TH>操作</TH>
                </TR>
              </THeader>
              <TBody>
                {items.map((a) => (
                  <TR key={a.id}>
                    <TD>
                      {a.caseId ? (
                        <Link to={`/cases/${a.caseId}`} className="text-primary underline">
                          {a.caseTitle || a.caseId}
                        </Link>
                      ) : (
                        a.caseTitle || '—'
                      )}
                    </TD>
                    <TD>{a.alternativeName || '—'}</TD>
                    <TD>
                      <Badge variant={statusVariant(a.status)}>{a.status}</Badge>
                    </TD>
                    <TD className="text-xs text-muted-foreground">
                      {a.requestedBy || a.proposer || '—'} · {formatTime(a.requestedAt || a.createdAt)}
                    </TD>
                    <TD>
                      {a.status === 'pending' ? (
                        <Input
                          value={comments[a.id] || ''}
                          onChange={(e) => setComments({ ...comments, [a.id]: e.target.value })}
                          placeholder="审批意见"
                          className="h-8 w-32 text-xs"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">{a.comment || '—'}</span>
                      )}
                    </TD>
                    <TD>
                      {(a.canApprove ?? hasRole('approver', 'commander', 'safety_officer', 'legal', 'admin'))
                        && a.status === 'pending' && (
                        <div className="flex gap-1">
                          <Button size="sm" disabled={busy} onClick={() => decide(a.id, 'approved')}>
                            批准
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            disabled={busy}
                            onClick={() => decide(a.id, 'rejected')}
                          >
                            驳回
                          </Button>
                        </div>
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
