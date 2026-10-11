/**
 * 仪表盘：系统概况、待办、案例状态分布
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { formatTime } from '@/lib/utils';
import { Boxes, ClipboardList, CheckSquare, Rocket, Activity } from 'lucide-react';

interface DashboardData {
  counts?: Record<string, number>;
  pendingApprovals?: number;
  recentCases?: Array<{
    id: string;
    title: string;
    status: string;
    scenarioKey?: string;
    updatedAt?: string;
  }>;
  [key: string]: unknown;
}

export function DashboardPage() {
  const { user, hasRole } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await api.get<DashboardData>('/dashboard');
        if (!cancelled) setData(result);
      } catch (e) {
        if (!cancelled) setError((e as ApiError)?.message || '加载仪表盘失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) return <div className="text-muted-foreground">加载中…</div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">仪表盘</h1>
        <p className="text-muted-foreground">
          欢迎，{user?.displayName}。系统以本体模型为中心，覆盖 OODA 决策闭环。
        </p>
      </div>

      {error && <Alert variant="warning">{error}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={<Boxes className="h-5 w-5" />}
          label="对象实例"
          value={Number(data?.counts?.objects ?? data?.objectCount ?? 0) || '—'}
          to="/objects"
        />
        <StatCard
          icon={<ClipboardList className="h-5 w-5" />}
          label="决策案例"
          value={Number(data?.counts?.cases ?? data?.caseCount ?? 0) || '—'}
          to="/cases"
        />
        <StatCard
          icon={<CheckSquare className="h-5 w-5" />}
          label="待审批"
          value={Number(data?.pendingApprovals ?? 0) || '—'}
          to="/approvals"
        />
        <StatCard
          icon={<Rocket className="h-5 w-5" />}
          label="动作执行"
          value={Number(data?.counts?.actionRuns ?? data?.actionRunCount ?? 0) || '—'}
          to="/actions"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" aria-hidden />
            最近案例
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.recentCases?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">暂无案例，请前往决策工作台创建。</p>
          ) : (
            <Table>
              <THeader>
                <TR>
                  <TH>标题</TH>
                  <TH>场景</TH>
                  <TH>状态</TH>
                  <TH>更新时间</TH>
                  <TH>操作</TH>
                </TR>
              </THeader>
              <TBody>
                {data?.recentCases?.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium">{c.title}</TD>
                    <TD>{c.scenarioKey || '—'}</TD>
                    <TD>
                      <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                    </TD>
                    <TD className="text-muted-foreground">{formatTime(c.updatedAt)}</TD>
                    <TD>
                      <Link to={`/cases/${c.id}`}>
                        <Button variant="outline" size="sm">
                          打开
                        </Button>
                      </Link>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {hasRole('admin') && (
        <Alert variant="info">
          管理员提示：可在「本体模型」中管理类型/版本，在「审计日志」中检索操作记录。备份方法见项目 README。
        </Alert>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  to,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  to: string;
}) {
  return (
    <Link to={to} className="block">
      <Card className="transition-colors hover:border-primary/50">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10 text-primary">
            {icon}
          </div>
          <div>
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="text-2xl font-bold">{value}</div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
