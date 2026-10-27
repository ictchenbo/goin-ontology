/**
 * 决策案例列表页：创建案例、按状态筛选
 */
import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { Input, Label, Select } from '@/components/ui/Input';
import { ObjectPicker } from '@/components/ObjectPicker';
import { formatTime } from '@/lib/utils';

interface DecisionCase {
  id: string;
  title: string;
  state: string;
  status?: string;
  summary?: string;
  description?: string;
  scenarioKey?: string;
  decisionTypeKey?: string;
  urgency?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** 场景包 → 默认决策类型（与种子配置保持一致） */
const SCENARIO_DECISION_TYPE: Record<string, string> = {
  'supply-chain': 'sc_disruption_response',
  military: 'mil_threat_response',
  'public-safety': 'ps_case_response',
};

const STATE_OPTIONS = [
  '', 'New', 'Observed', 'Oriented', 'OptionsReady', 'PendingApproval',
  'Approved', 'Executing', 'Completed', 'Failed', 'OutcomeReviewed', 'Closed', 'Cancelled'
];

export function CasesPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const [cases, setCases] = useState<DecisionCase[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [decisionTypeKey, setDecisionTypeKey] = useState('');
  const [scenarioKey, setScenarioKey] = useState('supply-chain');
  const [description, setDescription] = useState('');
  const [rootObjectId, setRootObjectId] = useState('');
  const [decisionTypes, setDecisionTypes] = useState<Array<{ typeKey: string; displayName?: string; label?: string; targetObjectType?: string }>>([]);
  const targetObjectType = decisionTypes.find((item) => item.typeKey === decisionTypeKey)?.targetObjectType;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('state', statusFilter);
      params.set('limit', '50');
      const result = await api.get<{ items?: DecisionCase[] } | DecisionCase[]>(`/cases?${params}`);
      setCases(Array.isArray(result) ? result : result.items || []);
    } catch (e) {
      setError((e as ApiError)?.message || '加载案例失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    (async () => {
      try {
        const r = await api.get<{ items?: Array<{ typeKey: string; displayName?: string; label?: string; targetObjectType?: string }> }>('/decision-types');
        const list = r.items || [];
        setDecisionTypes(list);
        if (list.length > 0 && !decisionTypeKey) {
          setDecisionTypeKey(SCENARIO_DECISION_TYPE[scenarioKey] || list[0].typeKey);
        }
      } catch {
        /* 决定类型加载失败不阻塞列表 */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function handleCreate() {
    setError(null);
    setInfo(null);
    if (!title.trim()) {
      setError('请填写案例标题');
      return;
    }
    const resolvedType = decisionTypeKey || SCENARIO_DECISION_TYPE[scenarioKey];
    if (!resolvedType) {
      setError('请选择决策类型（决定评分准则与硬约束）');
      return;
    }
    if (!rootObjectId) {
      setError('请选择触发对象，才能形成案例快照');
      return;
    }
    try {
      const created = await api.post<{ id: string }>('/cases', {
        title: title.trim(),
        summary: description,
        description,
        decisionTypeKey: resolvedType,
        rootObjectId,
      });
      setInfo('案例创建成功');
      setShowCreate(false);
      setTitle('');
      setDescription('');
      await load();
      if (created?.id) navigate(`/cases/${created.id}`);
    } catch (e) {
      setError((e as ApiError)?.message || '创建案例失败');
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">决策工作台</h1>
          <p className="text-muted-foreground">
            以案例为工作单元，完成 Observe → Orient → Decide → Act 闭环。
          </p>
        </div>
        {hasRole('analyst', 'admin', 'intelligence', 'commander') && (
          <Button onClick={() => setShowCreate(!showCreate)}>{showCreate ? '取消' : '新建案例'}</Button>
        )}
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {info && <Alert variant="success">{info}</Alert>}

      {showCreate && (
        <Card>
          <CardHeader>
            <CardTitle>新建决策案例</CardTitle>
            <CardDescription>案例创建后进入 New 状态，随后执行态势构建（Orient）。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label htmlFor="caseTitle">标题</Label>
              <Input id="caseTitle" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="scenarioKey">场景包</Label>
                <Select
                  id="scenarioKey"
                  value={scenarioKey}
                  onChange={(e) => {
                    const key = e.target.value;
                    setScenarioKey(key);
                    // 场景包联动默认决策类型
                    const mapped = SCENARIO_DECISION_TYPE[key];
                    if (mapped) { setDecisionTypeKey(mapped); setRootObjectId(''); }
                  }}
                >
                  <option value="supply-chain">供应链中断</option>
                  <option value="military">军事训练想定</option>
                  <option value="public-safety">公共安全事件</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="decisionTypeKey">决策类型</Label>
                <Select
                  id="decisionTypeKey"
                  value={decisionTypeKey}
                  onChange={(e) => { setDecisionTypeKey(e.target.value); setRootObjectId(''); }}
                >
                  <option value="">请选择</option>
                  {decisionTypes.map((t) => (
                    <option key={t.typeKey} value={t.typeKey}>
                      {t.displayName || t.label || t.typeKey}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="caseDesc">描述</Label>
              <Input id="caseDesc" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <ObjectPicker label="触发对象" value={rootObjectId} onChange={setRootObjectId}
              typeKey={targetObjectType} disabled={!targetObjectType} />
            <Button onClick={handleCreate}>创建</Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>案例列表</CardTitle>
            <div className="w-48">
              <Select
                aria-label="按状态筛选"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                {STATE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s || '全部状态'}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-muted-foreground">加载中…</p>
          ) : cases.length === 0 ? (
            <p className="py-4 text-center text-muted-foreground">暂无案例</p>
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
                {cases.map((c) => (
                  <TR key={c.id}>
                    <TD className="font-medium">{c.title}</TD>
                    <TD className="text-xs">{c.scenarioKey || c.decisionTypeKey || '—'}</TD>
                    <TD>
                      <Badge variant={statusVariant(c.state || c.status || '')}>{c.state || c.status}</Badge>
                    </TD>
                    <TD className="text-xs text-muted-foreground">{formatTime(c.updatedAt)}</TD>
                    <TD>
                      <Link to={`/cases/${c.id}`}>
                        <Button size="sm" variant="outline">
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
    </div>
  );
}
