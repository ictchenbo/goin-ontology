/**
 * 案例详情页：OODA 全流程（态势构建、方案、推演、评分、决策、审批、执行、复盘）
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, statusVariant } from '@/components/ui/Badge';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Table, TBody, TD, TH, THeader, TR } from '@/components/ui/Table';
import { Input, Label, Select, Textarea } from '@/components/ui/Input';
import { ActionObjectParams } from '@/components/ActionObjectParams';
import { SnapshotRelationshipDag } from '@/components/SnapshotRelationshipDag';
import { formatNum, formatTime } from '@/lib/utils';
import { publicSafetyRelationshipFlow } from '@/lib/case-relationship-flow';

interface CriterionDef {
  key: string;
  name?: string;
  weight?: number;
  direction?: string;
  unit?: string;
}

interface ProposedAction {
  actionKey?: string;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

interface AlternativeView {
  id: string;
  name: string;
  description?: string;
  proposedActions?: ProposedAction[];
  params?: Record<string, unknown>;
  status?: string;
  feasible?: boolean;
  infeasibleReasons?: string[];
}

interface ScoreRow {
  alternativeId: string;
  name?: string;
  totalScore?: number;
  score?: number;
  feasible: boolean;
  rank?: number;
  infeasibleReasons?: string[];
  reasons?: string[];
  scores?: Array<{ criterionKey: string; raw?: number; rawValue?: number; normalized?: number; weighted?: number }>;
}

interface SnapshotObject {
  objectId: string;
  title?: string;
  typeKey?: string;
  typeDisplay?: string;
  isRoot?: boolean;
  redacted?: boolean;
  payload?: Record<string, unknown>;
  evidence?: Array<{
    evidenceId: string;
    claim?: string;
    sourceKey?: string;
    stance?: string;
    observedAt?: string;
  }>;
}

interface SnapshotView {
  objects?: SnapshotObject[];
  links?: Array<{ id?: string; from: string; to: string; linkKey: string; linkDisplay?: string }>;
  ruleChecks?: Array<{
    objectId: string;
    ruleKey: string;
    name: string;
    description?: string;
    version: number;
    expression: string;
    inputDeps: string[];
    matched: boolean | null;
    error?: string;
  }> | null;
  conflicts?: Array<{ kind: string; message: string }>;
  createdAt?: string;
}

function snapshotTitle(object: SnapshotObject): string {
  // 旧快照保留原编号；用冻结的描述和日期生成可读的展示名。
  if (object.typeKey === 'ObservedEvent' && /^EVT-\d{4}-\d{3}$/.test(object.title ?? '')) {
    const description = object.payload?.description;
    const eventTime = object.payload?.eventTime;
    if (typeof description === 'string' && typeof eventTime === 'string') {
      const eventDate = new Date(eventTime);
      const date = Number.isNaN(eventDate.getTime()) ? '' : `${eventDate.getFullYear()}${String(eventDate.getMonth() + 1).padStart(2, '0')}${String(eventDate.getDate()).padStart(2, '0')}`;
      if (/^\d{8}$/.test(date)) {
        if (description === '市民反映某人行为异常（虚构误报示例）') return `市民疑似异常行为反映-${date}-001`;
        if (description === '巡逻记录显示该时段一切正常（反证）') return `广场巡逻未见异常-${date}-002`;
        return `${description.replace(/（[^）]*）/g, '').trim()}-${date}-${object.title!.slice(-3)}`;
      }
    }
  }
  if (object.typeKey === 'RiskIndicator' && object.title === 'RI-行为异常'
    && object.payload?.basedOnEvent === 'EVT-2026-001') {
    return '单源行为线索指标-20261009-001';
  }
  if (object.typeKey === 'SafetyCase' && object.title === 'PS-2026-001'
    && object.payload?.purposeStatement === '依法核查可能影响公共安全的行为事件') {
    return '公共安全核查个案-20261009-001';
  }
  return object.title || object.objectId;
}

function snapshotValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '未提供';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function snapshotInput(dependency: string, object?: SnapshotObject): string {
  if (!dependency.startsWith('object.')) return dependency;
  const field = dependency.slice('object.'.length);
  const value = field.split('.').reduce<unknown>((current, key) =>
    current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined,
  object?.payload);
  return `${field} = ${snapshotValue(value)}`;
}

interface CaseDetail {
  id: string;
  title: string;
  state: string;
  status?: string;
  summary?: string;
  description?: string;
  decisionTypeKey?: string;
  createdAt?: string;
  updatedAt?: string;
  snapshotId?: string | null;
  facts?: { factsComplete?: boolean; missing?: string[]; stale?: boolean };
  decisionType?: {
    typeKey: string;
    displayName?: string;
    criteria?: CriterionDef[];
    constraints?: Array<{ key: string; name?: string; severity?: string }>;
    requiredFacts?: string[];
    roleMatrix?: Record<string, string[]>;
    targetObjectType?: string;
  };
  alternatives?: AlternativeView[];
  scores?: ScoreRow[];
  scoreRun?: {
    id: string;
    current?: boolean;
    winnerAlternativeId?: string | null;
    factsComplete?: boolean;
    missingFacts?: string[];
    weights?: Record<string, number>;
    createdAt?: string;
    evidenceRefs?: string[];
    units?: Record<string, string>;
  };
  decision?: {
    scoreRunId?: string;
    alternativeId?: string;
    selectedAlternativeId?: string;
    rationale?: string;
    overridden?: boolean;
    createdAt?: string;
  } | null;
  decisionRecord?: {
    scoreRunId?: string;
    selectedAlternativeId?: string;
    rationale?: string;
    overridden?: boolean;
    createdAt?: string;
  } | null;
  approvals?: Array<{
    id: string;
    status: string;
    requestedBy?: string;
    decidedBy?: string;
    comment?: string;
    createdAt?: string;
    requestedAt?: string;
    decidedAt?: string;
  }>;
  objects?: Array<{ objectId: string; role?: string; frozenPayload?: Record<string, unknown> }>;
  caseObjects?: Array<{ objectId: string; role?: string; frozenPayload?: Record<string, unknown> }>;
  outcomes?: Array<{
    id: string;
    expected: Record<string, unknown>;
    actual: Record<string, unknown>;
    deviation?: Record<string, { expected?: unknown; actual?: unknown; delta?: number; deltaPct?: number | null }>;
    reviewNotes?: string;
    attribution?: string;
    recordedBy?: string;
    createdAt?: string;
  }>;
  actionRuns?: Array<{
    id: string;
    actionKey: string;
    status: string;
    error?: string;
    executedAt?: string;
    idempotencyKey?: string;
  }>;
}

interface AiSuggestion {
  id: string;
  kind: string;
  status: string;
  modelVersion: string;
  content: { text: string; citations?: string[]; alternatives?: Array<Record<string, unknown>> };
  evaluations?: Array<{ passed: boolean; checks: Record<string, unknown> }>;
}

type PhaseId = 'facts' | 'options' | 'approval' | 'execution' | 'outcome';

const PHASES: Array<{ id: PhaseId; label: string; description: string }> = [
  { id: 'facts', label: '事实与快照', description: '观察、定向' },
  { id: 'options', label: '方案与评估', description: '备选、推演、评分' },
  { id: 'approval', label: '决策与审批', description: '选择、审核' },
  { id: 'execution', label: '执行动作', description: '批准后执行' },
  { id: 'outcome', label: '结果与关闭', description: '记录、复盘' },
];

function phaseForState(state?: string): PhaseId {
  if (state === 'New' || state === 'Observed') return 'facts';
  if (state === 'Oriented' || state === 'OptionsReady') return 'options';
  if (state === 'PendingApproval') return 'approval';
  if (state === 'Approved' || state === 'Executing') return 'execution';
  return 'outcome';
}

export function CaseDetailPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const { hasRole, user } = useAuth();
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // 方案表单
  const [newAltName, setNewAltName] = useState('');
  const [newAltDesc, setNewAltDesc] = useState('');
  const [newAltParams, setNewAltParams] = useState('{}');
  const [availableActions, setAvailableActions] = useState<Array<{ actionKey: string; name: string; state: string }>>([]);
  const proposalDraft = useMemo(() => {
    try {
      const parsed = JSON.parse(newAltParams) as Record<string, unknown>;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch { return null; }
  }, [newAltParams]);

  // 权重表单（按决策类型准则动态生成）
  const [weightForm, setWeightForm] = useState<Record<string, number>>({});

  // 决策表单
  const [selectedAlt, setSelectedAlt] = useState('');
  const [decisionNote, setDecisionNote] = useState('');

  // 推演
  const [scenarioOverlay, setScenarioOverlay] = useState('{}');

  const [actionSchema, setActionSchema] = useState<{ key: string; required: string[] } | null>(null);
  const [actionSchemaError, setActionSchemaError] = useState('');

  // 复盘表单
  const [expectedJson, setExpectedJson] = useState('{"service": 80}');
  const [actualJson, setActualJson] = useState('{"service": 75}');
  const [evidenceRefsText, setEvidenceRefsText] = useState('');
  const [availableEvidenceIds, setAvailableEvidenceIds] = useState<string[]>([]);
  const [snapshot, setSnapshot] = useState<SnapshotView | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [aiKind, setAiKind] = useState('explain');
  const [aiReviewNote, setAiReviewNote] = useState('');
  const [selectedPhase, setSelectedPhase] = useState<PhaseId>('facts');
  const decisionReady = !!detail?.scoreRun?.winnerAlternativeId && detail.scoreRun.current === true
    && detail.facts?.factsComplete !== false && detail.facts?.stale !== true;
  const currentPhase = detail?.state === 'OptionsReady' && decisionReady
    ? 'approval' : phaseForState(detail?.state);

  useEffect(() => {
    setSelectedPhase(currentPhase);
  }, [caseId, currentPhase]);

  const load = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const d = await api.get<CaseDetail>(`/cases/${caseId}`);
      setDetail(d);
      const suggestions = await api.get<{ items: AiSuggestion[] }>(`/cases/${caseId}/ai-suggestions`);
      setAiSuggestions(suggestions.items);
      if (d.snapshotId) {
        const snapshotResult = await api.get<SnapshotView>(
          `/snapshots/${d.snapshotId}`
        );
        const snapshotItems = snapshotResult.objects ?? [];
        setSnapshot(snapshotResult);
        const ids = [...new Set(snapshotItems.flatMap((o) =>
          (o.evidence ?? []).map((e) => e.evidenceId)))];
        setAvailableEvidenceIds(ids);
        setEvidenceRefsText((old) => old || ids[0] || '');
      } else {
        setSnapshot(null);
        setAvailableEvidenceIds([]);
      }
      const winner = d.scoreRun?.winnerAlternativeId;
      if (d.alternatives?.length) {
        const recorded = d.decision?.alternativeId || d.decision?.selectedAlternativeId
          || d.decisionRecord?.selectedAlternativeId;
        const scoredIds = new Set((d.scores ?? []).filter((score) => score.feasible)
          .map((score) => score.alternativeId));
        const feasibleIds = new Set(d.alternatives.filter((alternative) =>
          scoredIds.has(alternative.id) &&
          (alternative.status === 'feasible' || alternative.status === 'selected'))
          .map((alternative) => alternative.id));
        const currentDecision = (d.decision?.scoreRunId || d.decisionRecord?.scoreRunId)
          === d.scoreRun?.id && d.scoreRun?.current === true;
        setSelectedAlt((prev) => {
          if (d.state !== 'OptionsReady') return recorded || prev || winner || d.alternatives![0].id;
          return (feasibleIds.has(prev) ? prev : '')
            || (currentDecision && feasibleIds.has(recorded ?? '') ? recorded! : '')
            || (winner && feasibleIds.has(winner) ? winner : '')
            || d.alternatives!.find((alternative) => feasibleIds.has(alternative.id))?.id || '';
        });
      }
      // 初始化权重表单为决策类型默认权重
      const criteria = d.decisionType?.criteria ?? [];
      if (criteria.length) {
        setWeightForm((prev) => {
          if (Object.keys(prev).length) return prev;
          return Object.fromEntries(criteria.map((c) => [c.key, c.weight ?? 1]));
        });
      }
    } catch (e) {
      setError((e as ApiError)?.message || '加载案例失败');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  useEffect(() => {
    load();
    api.get<{ items: Array<{ actionKey: string; name: string; state: string }> }>('/action-types')
      .then((result) => setAvailableActions(result.items.filter((item) => item.state === 'published')))
      .catch(() => setAvailableActions([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  async function runAction(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
      setInfo(`${label}成功`);
      await load();
      return true;
    } catch (e) {
      setError((e as ApiError)?.message || `${label}失败`);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function exportReplay() {
    if (!caseId) return;
    setError(null);
    try {
      const replay = await api.get<unknown>(`/cases/${caseId}/replay`);
      const blob = new Blob([JSON.stringify(replay, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `case-replay-${caseId}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as ApiError)?.message || '导出回放失败');
    }
  }

  // 角色门控与后端 decisionType.roleMatrix 对齐，避免 UI 显示按钮但 API 403
  const roleMatrix = detail?.decisionType?.roleMatrix ?? {};
  const canDecide = hasRole(...(roleMatrix.propose ?? ['analyst', 'commander', 'intelligence', 'admin']));
  const canApprove = hasRole(...(roleMatrix.approve ?? ['approver', 'commander', 'safety_officer', 'legal', 'admin']));
  const canAct = hasRole(...(roleMatrix.execute ?? ['operator', 'commander', 'legal', 'admin']));

  /** 从选定方案解析待执行动作（场景感知，不再硬编码供应链动作） */
  const resolvedAction = useMemo(() => {
    if (!detail) return null;
    const altId = detail.decision?.alternativeId
      || detail.decision?.selectedAlternativeId
      || detail.decisionRecord?.selectedAlternativeId
      || selectedAlt;
    const alt = detail.alternatives?.find((a) => a.id === altId);
    if (!alt) return null;
    const actions = (alt.proposedActions ?? []).filter((p) => p && typeof p === 'object');
    const withKey = actions.find((p) => typeof p.actionKey === 'string' && p.actionKey);
    if (withKey) {
      return {
        alternativeId: alt.id,
        actionKey: String(withKey.actionKey),
        defaultParams: (withKey.params ?? {}) as Record<string, unknown>,
      };
    }
    // 兼容：params 对象中携带 actionKey
    const flat = (alt.params ?? {}) as Record<string, unknown>;
    if (typeof flat.actionKey === 'string' && flat.actionKey) {
      const { actionKey, params, ...rest } = flat as { actionKey: string; params?: Record<string, unknown> };
      return {
        alternativeId: alt.id,
        actionKey,
        defaultParams: (params ?? rest) as Record<string, unknown>,
      };
    }
    return { alternativeId: alt.id, actionKey: '', defaultParams: {} as Record<string, unknown> };
  }, [detail, selectedAlt]);

  // 执行参数必须来自已批准方案；读取 Action 定义以提示旧方案缺失的必填项。
  useEffect(() => {
    const actionKey = resolvedAction?.actionKey;
    setActionSchema(null);
    setActionSchemaError('');
    if (!actionKey) return;
    let active = true;
    api.get<{ paramsSchema?: { required?: string[] } }>(`/action-types/${encodeURIComponent(actionKey)}`)
      .then((definition) => {
        if (active) setActionSchema({ key: actionKey, required: definition.paramsSchema?.required ?? [] });
      })
      .catch((error: ApiError) => {
        if (active) setActionSchemaError(error.message || '无法读取 Action 参数定义');
      });
    return () => { active = false; };
  }, [resolvedAction?.actionKey]);

  if (loading) return <div className="text-muted-foreground">加载中…</div>;
  if (!detail) {
    return (
      <div className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        <p className="text-muted-foreground">案例不存在或加载失败。</p>
      </div>
    );
  }

  const state = detail.state || detail.status || 'New';
  const scores = detail.scores || [];
  const factsComplete = detail.facts?.factsComplete ?? detail.scoreRun?.factsComplete;
  const missingFacts = detail.facts?.missing ?? detail.scoreRun?.missingFacts ?? [];
  const snapshotObjects = snapshot?.objects ?? [];
  const snapshotById = new Map(snapshotObjects.map((object) => [object.objectId, object]));
  const snapshotLinks = [...new Map((snapshot?.links ?? []).map((link) =>
    [link.id ?? `${link.linkKey}:${link.from}:${link.to}`, link])).values()];
  const publicSafetyFlow = detail.decisionTypeKey === 'ps_case_response'
    ? publicSafetyRelationshipFlow(snapshotObjects, snapshotLinks) : null;
  const relationshipLinks = publicSafetyFlow?.links ?? snapshotLinks;
  const flowObjectIds = new Set(relationshipLinks.flatMap((link) => [link.from, link.to]));
  const rootSnapshotObject = snapshotObjects.find((object) => object.isRoot);
  const rootPayload = rootSnapshotObject?.payload ?? {};
  const observationTime = rootPayload.eventTime ?? rootPayload.detectedAt ?? rootPayload.observedAt;
  const observationDescription = rootPayload.description ?? rootPayload.content ?? rootPayload.statement;
  const indicatorObjects = snapshotObjects.filter((object) => object.typeKey === 'RiskIndicator');
  const decision = detail.decision
    || (detail.decisionRecord
      ? {
        alternativeId: detail.decisionRecord.selectedAlternativeId,
        scoreRunId: detail.decisionRecord.scoreRunId,
        rationale: detail.decisionRecord.rationale,
        overridden: detail.decisionRecord.overridden,
        createdAt: detail.decisionRecord.createdAt,
      }
      : null);
  const scoreByAlternative = new Map(scores.map((score) => [score.alternativeId, score]));
  const selectedScore = scoreByAlternative.get(selectedAlt);
  const selectableAlternatives = (detail.alternatives ?? []).filter((alternative) =>
    scoreByAlternative.get(alternative.id)?.feasible === true &&
    (alternative.status === 'feasible' || alternative.status === 'selected'));
  const currentDecision = !!decision && decision.scoreRunId === detail.scoreRun?.id && decisionReady;
  const missingActionParams = actionSchema && resolvedAction && actionSchema.key === resolvedAction.actionKey
    ? actionSchema.required.filter((key) => {
      const value = resolvedAction.defaultParams[key];
      return value === undefined || value === null || value === '';
    }) : [];
  const criteria = detail.decisionType?.criteria ?? [];
  const pendingApproval = state === 'PendingApproval'
    ? detail.approvals?.find((a) => a.status === 'pending') : undefined;
  const approvedApproval = detail.approvals?.find((a) => a.status === 'approved');
  const stalePendingCount = state === 'PendingApproval' ? 0
    : (detail.approvals ?? []).filter((a) => a.status === 'pending').length;
  const altName = (id?: string) => detail.alternatives?.find((a) => a.id === id)?.name || id || '—';
  const currentPhaseIndex = PHASES.findIndex((phase) => phase.id === currentPhase);
  const nextStep = (() => {
    switch (state) {
      case 'New': return '确认案例事实后，点击“完成 Observe”。';
      case 'Observed': return detail.snapshotId
        ? '确认快照后，点击“完成 Orient”。' : '先执行 Orient 快照，再确认定向。';
      case 'Oriented': return (detail.alternatives?.length ?? 0) >= 3
        ? '检查备选方案后，点击“至少三种备选就绪”。' : '建立至少三种备选方案。';
      case 'OptionsReady': return !decisionReady
        ? '核对事实缺口与方案，重新评分后再记录决策。'
        : currentDecision ? '确认决策方案与评分，再提交审批。' : '核对评分，选定方案并记录决策。';
      case 'PendingApproval': return canApprove
        ? '审核决策理由与方案，然后批准或驳回。' : '审批已提交，等待审批角色处理。';
      case 'Approved': return '审批通过，执行所选方案的动作。';
      case 'Executing': return '核对执行记录，完成后标记 Completed。';
      case 'Completed': return '记录实际结果与证据，完成复盘。';
      case 'OutcomeReviewed': return '复盘完成，可以关闭案例。';
      case 'Failed': return '检查失败原因，补充复盘或重新定向。';
      case 'Closed': return '案例已关闭，可切换阶段查看历史记录或导出回放。';
      case 'Cancelled': return '案例已取消，可切换阶段查看历史记录。';
      default: return '查看当前阶段的记录与操作。';
    }
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{detail.title}</h1>
            <Badge variant={statusVariant(state)}>{state}</Badge>
          </div>
          <p className="mt-1 text-muted-foreground">
            {detail.decisionType?.displayName || detail.decisionTypeKey || '通用场景'} · 创建于 {formatTime(detail.createdAt)}
          </p>
          {detail.summary && <p className="mt-1 text-sm text-muted-foreground">{detail.summary}</p>}
        </div>
        <div className="flex gap-2">
          {hasRole('admin', 'analyst', 'approver') && (
            <Button variant="outline" onClick={exportReplay}>导出回放</Button>
          )}
          <Button variant="outline" onClick={load}>刷新</Button>
        </div>
      </div>

      {error && <Alert variant="error">{error}</Alert>}
      {info && <Alert variant="success">{info}</Alert>}

      <Card className="overflow-hidden">
        <CardContent className="space-y-5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">当前阶段</p>
              <h2 className="mt-1 text-lg font-semibold">{PHASES[currentPhaseIndex].label}</h2>
              <p className="mt-1 text-sm text-muted-foreground">下一步：{nextStep}</p>
            </div>
            <Badge variant={statusVariant(state)}>{state}</Badge>
          </div>
          <nav aria-label="案例处理阶段">
            <ol className="flex gap-2 overflow-x-auto pb-1">
              {PHASES.map((phase, index) => (
                <li key={phase.id} className="min-w-[148px] flex-1">
                  <button
                    type="button"
                    aria-current={currentPhase === phase.id ? 'step' : undefined}
                    aria-pressed={selectedPhase === phase.id}
                    aria-controls={`phase-${phase.id}`}
                    onClick={() => setSelectedPhase(phase.id)}
                    className={`w-full rounded-lg border p-3 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
                      selectedPhase === phase.id ? 'border-primary bg-primary/10' : 'border-border hover:bg-accent'
                    }`}
                  >
                    <span className="text-xs text-muted-foreground">第 {index + 1} 步 · {
                      index < currentPhaseIndex ? '已完成' : index === currentPhaseIndex ? '当前' : '待进行'
                    }</span>
                    <span className="mt-1 block text-sm font-semibold">{phase.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{phase.description}</span>
                  </button>
                </li>
              ))}
            </ol>
          </nav>
        </CardContent>
      </Card>
      <section id="phase-facts" aria-label="事实与快照" hidden={selectedPhase !== 'facts'} className="space-y-6">
      {/* 态势构建 */}
      <Card>
        <CardHeader>
          <CardTitle>Observe / Orient · 态势构建</CardTitle>
          <CardDescription>
            快照关联对象与证据，校验事实完备性。
            {factsComplete !== undefined && (
              <Badge variant={factsComplete ? 'success' : 'warning'} className="ml-2">
                {factsComplete ? '事实完备' : '事实缺口'}
              </Badge>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {missingFacts.length > 0 && (
            <Alert variant="warning">
              缺失事实字段：{missingFacts.join(', ')}
            </Alert>
          )}
          {rootSnapshotObject && !rootSnapshotObject.redacted && (
            <div className="rounded-md border border-border bg-muted/30 p-4">
              <h3 className="font-semibold">观察到的事件 / 数据</h3>
              <p className="mt-1 text-sm text-muted-foreground">以下字段来自当前 Orient 快照；未核实的描述仍是待核查的反映。</p>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div><dt className="text-muted-foreground">触发对象</dt><dd className="font-medium">{snapshotTitle(rootSnapshotObject)}</dd></div>
                <div><dt className="text-muted-foreground">类型</dt><dd>{rootSnapshotObject.typeDisplay || rootSnapshotObject.typeKey || '—'}</dd></div>
                {typeof observationTime === 'string' && <div><dt className="text-muted-foreground">发生 / 观测时间</dt><dd>{formatTime(observationTime)}</dd></div>}
                {rootPayload.location != null && <div><dt className="text-muted-foreground">地点</dt><dd>{snapshotValue(rootPayload.location)}</dd></div>}
                {observationDescription != null && <div className="sm:col-span-2"><dt className="text-muted-foreground">记录内容</dt><dd>{snapshotValue(observationDescription)}</dd></div>}
                {rootPayload.verificationStatus != null && <div><dt className="text-muted-foreground">核实状态</dt><dd>{({
                  unverified: '未核实', partial: '部分核实', verified: '已核实', corrected: '已更正',
                } as Record<string, string>)[String(rootPayload.verificationStatus)] || snapshotValue(rootPayload.verificationStatus)}</dd></div>}
                {rootPayload.sourceCount != null && <div><dt className="text-muted-foreground">来源数字段</dt><dd>{snapshotValue(rootPayload.sourceCount)}</dd></div>}
              </dl>
            </div>
          )}
          {detail.snapshotId && (
            <div className="space-y-3">
              <h3 className="font-semibold">对象之间的关系</h3>
              <SnapshotRelationshipDag
                objects={snapshotObjects.filter((object) => !publicSafetyFlow || flowObjectIds.has(object.objectId))
                  .map((object) => ({
                  objectId: object.objectId,
                  title: object.redacted ? '无权查看' : snapshotTitle(object),
                  typeDisplay: object.redacted ? undefined : object.typeDisplay || object.typeKey,
                  isRoot: object.isRoot,
                  redacted: object.redacted,
                }))}
                links={relationshipLinks} direction={publicSafetyFlow ? 'vertical' : 'horizontal'} />
              {publicSafetyFlow && <p className="text-xs text-muted-foreground">
                箭头表示当前快照可追溯的业务顺序；规则提示与事实核实请分别查看下方规则判断和证据。
              </p>}
              {publicSafetyFlow?.notice && <Alert variant="warning">{publicSafetyFlow.notice}</Alert>}
            </div>
          )}
          {detail.snapshotId && (
            <div className="space-y-3">
              <h3 className="font-semibold">规则判断</h3>
              {snapshot?.ruleChecks == null ? (
                <Alert variant="warning">此快照未保存规则判断结果；重新执行 Orient 快照后可核对规则输入与命中情况。</Alert>
              ) : snapshot.ruleChecks.length ? (
                <div className="rounded-md border border-border"><Table>
                  <THeader><TR><TH>适用对象 / 规则</TH><TH>输入与条件</TH><TH>结果</TH></TR></THeader>
                  <TBody>{snapshot.ruleChecks.map((check) => <TR key={`${check.objectId}:${check.ruleKey}`}>
                    <TD className="min-w-56 align-top">
                      <div className="font-medium">{snapshotById.get(check.objectId) ? snapshotTitle(snapshotById.get(check.objectId)!) : '对象不可见'}</div>
                      <Link to={`/ontology/rules/${encodeURIComponent(check.ruleKey)}`}
                        className="text-primary hover:underline">{check.name} · v{check.version}</Link>
                      {check.description && <div className="text-xs text-muted-foreground">{check.description}</div>}
                    </TD>
                    <TD className="min-w-64 align-top">
                      <div>{check.inputDeps.length ? check.inputDeps.map((dependency) =>
                        snapshotInput(dependency, snapshotById.get(check.objectId))).join('；') : '无显式输入字段'}</div>
                      <code className="mt-1 block break-all text-xs text-muted-foreground">{check.expression}</code>
                    </TD>
                    <TD className="align-top">{check.error ? <Badge variant="destructive">计算失败</Badge>
                      : <Badge variant={check.matched ? 'warning' : 'secondary'}>{check.matched ? '提示命中' : '未命中'}</Badge>}
                      {check.error && <div className="mt-1 text-xs text-muted-foreground">{check.error}</div>}</TD>
                  </TR>)}</TBody>
                </Table></div>
              ) : <p className="text-sm text-muted-foreground">当前快照没有适用的触发规则判断。</p>}
              {indicatorObjects.length > 0 && <Alert variant="warning">
                快照包含{indicatorObjects.length}个风险指标对象，但没有保存这些指标的生成规则运行记录。指标数值不能作为异常已被规则证实的结论。
              </Alert>}
              {(snapshot?.conflicts ?? []).length > 0 && <div className="text-sm">
                <p className="font-medium">反证与其他冲突提示</p>
                <ul className="mt-1 list-inside list-disc text-muted-foreground">
                  {snapshot!.conflicts!.map((conflict, index) => <li key={`${conflict.kind}:${index}`}>{conflict.message}</li>)}
                </ul>
              </div>}
            </div>
          )}
          {detail.snapshotId ? (
            <div className="space-y-3">
              <h3 className="font-semibold">快照对象与证据</h3>
              <div className="rounded-md border border-border">
              <Table>
                <THeader><TR>
                  <TH>相关对象</TH><TH>类型 / 角色</TH><TH>记录内容 / 数据</TH><TH>证据</TH>
                </TR></THeader>
                <TBody>
                  {snapshotObjects.map((object) => (
                    <TR key={object.objectId}>
                      <TD className="min-w-48 align-top">
                        {object.redacted ? (
                          <span className="font-medium">无权查看</span>
                        ) : (
                          <>
                            <Link to={`/objects/${encodeURIComponent(object.objectId)}`}
                              className="font-medium text-primary hover:underline">
                              {snapshotTitle(object)}
                            </Link>
                            <div className="font-mono text-xs text-muted-foreground">{object.objectId}</div>
                          </>
                        )}
                      </TD>
                      <TD className="align-top">
                        <div>{object.typeDisplay || object.typeKey || '—'}</div>
                        <div className="text-xs text-muted-foreground">{object.isRoot ? '触发对象' : '关联对象'}</div>
                      </TD>
                      <TD className="min-w-56 align-top">{object.payload ? (
                        <div className="space-y-1">
                          {object.payload.description != null && <div>{snapshotValue(object.payload.description)}</div>}
                          {object.payload.content != null && <div>{snapshotValue(object.payload.content)}</div>}
                          {typeof object.payload.eventTime === 'string' && <div>事件时间：{formatTime(object.payload.eventTime)}</div>}
                          {object.payload.channel != null && <div>渠道：{({
                            report: '市民反映', patrol: '巡逻记录', sensor: '传感器', public: '公开来源',
                          } as Record<string, string>)[String(object.payload.channel)] || snapshotValue(object.payload.channel)}</div>}
                          {object.payload.reliability != null && <div>可靠性：{snapshotValue(object.payload.reliability)}</div>}
                          {object.payload.value != null && <div>指标值：{snapshotValue(object.payload.value)}</div>}
                          {object.payload.purposeStatement != null && <div>{snapshotValue(object.payload.purposeStatement)}</div>}
                          {!['description', 'content', 'eventTime', 'channel', 'reliability', 'value', 'purposeStatement']
                            .some((key) => object.payload?.[key] != null) && <span className="text-muted-foreground">—</span>}
                        </div>
                      ) : '—'}</TD>
                      <TD className="min-w-64 align-top">
                        {object.evidence?.length ? (
                          <ul className="space-y-2">
                            {object.evidence.map((evidence) => (
                              <li key={evidence.evidenceId}>
                                <div>{evidence.claim || '未填写证据主张'}</div>
                                <div className="text-xs text-muted-foreground">
                                  {[evidence.sourceKey || '未知来源', evidence.stance, evidence.observedAt && formatTime(evidence.observedAt)]
                                    .filter(Boolean).join(' · ')}
                                </div>
                              </li>
                            ))}
                          </ul>
                        ) : <span className="text-muted-foreground">暂无证据</span>}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {snapshotObjects.length === 0 && <p className="p-3 text-sm text-muted-foreground">快照中暂无可见对象。</p>}
              </div>
            </div>
          ) : <p className="text-sm text-muted-foreground">尚无 Orient 快照，执行快照后可查看相关对象和证据。</p>}
          <div className="flex flex-wrap gap-2">
            {canDecide && (
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  runAction('态势构建', () =>
                    api.post(`/cases/${caseId}/orient`, { depth: 5, maxAgeDays: 30 }).then(() => undefined)
                  )
                }
              >
                执行 Orient 快照
              </Button>
            )}
            {canDecide && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() =>
                  runAction('重新定向', () =>
                    api.post(`/cases/${caseId}/reorient`, { reason: '事实更新' }).then(() => undefined)
                  )
                }
              >
                事实变更后重新 Orient
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {canDecide && (state === 'New' || state === 'Observed') && (
        <div className="flex flex-wrap gap-2">
          {state === 'New' && <Button disabled={busy} onClick={() => runAction('完成观察', () =>
            api.post(`/cases/${caseId}/transition`, { toState: 'Observed', reason: '事实已进入案例' }).then(() => undefined))}>
            完成 Observe
          </Button>}
          {state === 'Observed' && <Button disabled={busy || !detail.snapshotId} onClick={() => runAction('完成定向', () =>
            api.post(`/cases/${caseId}/transition`, { toState: 'Oriented', reason: '情境快照已确认' }).then(() => undefined))}>
            完成 Orient
          </Button>}
        </div>
      )}
      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">AI 建议与人工复核 <span className="text-muted-foreground">（可选）</span></summary>
        <div className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle>AI 建议与人工复核</CardTitle>
          <CardDescription>可选适配器只生成建议；请核对证据、约束和方案。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {canDecide && <div className="flex flex-wrap items-end gap-2">
            <div><Label htmlFor="ai-kind">建议类型</Label>
              <Select id="ai-kind" value={aiKind} onChange={(e) => setAiKind(e.target.value)}>
                <option value="explain">解释</option><option value="missing_facts">缺失事实</option>
                <option value="alternative_draft">备选草案</option>
              </Select></div>
            <Button disabled={busy} onClick={() => runAction('请求建议', () =>
              api.post(`/cases/${caseId}/ai-suggestions`, { kind: aiKind }).then(() => undefined))}>请求建议</Button>
          </div>}
          {aiSuggestions.map((item) => <div key={item.id} className="space-y-2 rounded-md border border-border p-3 text-sm">
            <div className="flex flex-wrap gap-2"><Badge variant="secondary">建议 · {item.kind}</Badge>
              <Badge variant="outline">{item.status}</Badge><span>模型 {item.modelVersion}</span></div>
            <p className="whitespace-pre-wrap">{item.content.text}</p>
            <p className="text-muted-foreground">证据：{item.content.citations?.join(', ') || '未引用'} ·
              自动检查：{item.evaluations?.[0]?.passed ? '通过' : '待核实'}</p>
            {canDecide && item.status === 'suggestion' && <div className="flex flex-wrap gap-2">
              <Input aria-label="复核备注" placeholder="纠正或拒绝时填写理由" value={aiReviewNote}
                onChange={(e) => setAiReviewNote(e.target.value)} />
              {(['accepted', 'corrected', 'rejected'] as const).map((status) =>
                <Button key={status} size="sm" variant="outline" disabled={busy}
                  onClick={() => runAction('复核建议', () => api.post(`/ai-suggestions/${item.id}/review`, {
                    status, note: aiReviewNote,
                  }).then(() => undefined))}>{status}</Button>)}
            </div>}
          </div>)}
        </CardContent>
      </Card>

        </div>
      </details>

      </section>

      {/* 方案与评分 */}
      <section id="phase-options" aria-label="方案与评估" hidden={selectedPhase !== 'options'} className="space-y-6">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Decide · 方案备选</CardTitle>
            <CardDescription>硬约束不满足的方案将保留并标记不可行及原因。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {(detail.alternatives || []).length === 0 ? (
              <p className="text-muted-foreground">暂无备选方案，请添加。</p>
            ) : (
              <ul className="space-y-2">
                {detail.alternatives?.map((a) => {
                  const infeasible = a.status === 'infeasible' || a.feasible === false
                    || (a.infeasibleReasons && a.infeasibleReasons.length > 0);
                  return (
                    <li
                      key={a.id}
                      className="flex items-start justify-between gap-2 rounded-md border border-border p-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{a.name}</span>
                          {infeasible && <Badge variant="destructive">不可行</Badge>}
                          {detail.scoreRun?.winnerAlternativeId === a.id && (
                            <Badge variant="success">推荐</Badge>
                          )}
                        </div>
                        {a.description && (
                          <p className="text-xs text-muted-foreground">{a.description}</p>
                        )}
                        {(a.proposedActions?.length ?? 0) > 0 && (
                          <p className="mt-1 break-all text-xs text-muted-foreground">
                            拟议动作：{a.proposedActions?.[0]?.actionKey || '未配置'}
                          </p>
                        )}
                        {infeasible && (a.infeasibleReasons?.length ?? 0) > 0 && (
                          <p className="mt-1 text-xs text-destructive">
                            {a.infeasibleReasons!.join('；')}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {canDecide && (state === 'Oriented' || state === 'OptionsReady') && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <Label htmlFor="altName">新增方案</Label>
                <Input id="altName" value={newAltName} onChange={(e) => setNewAltName(e.target.value)} placeholder="方案名称" />
                <Input
                  value={newAltDesc}
                  onChange={(e) => setNewAltDesc(e.target.value)}
                  placeholder="方案说明"
                />
                <p className="text-xs text-muted-foreground">
                  预测指标 / 拟议动作 JSON（将写入 proposedActions[0]，供评分表达式与执行动作使用）
                </p>
                <div className="space-y-1">
                  <Label htmlFor="new-alt-action">拟议 Action</Label>
                  <Select id="new-alt-action" value={typeof proposalDraft?.actionKey === 'string' ? proposalDraft.actionKey : ''}
                    onChange={(event) => setNewAltParams((current) => {
                      try {
                        const draft = JSON.parse(current) as Record<string, unknown>;
                        return JSON.stringify({ ...draft, actionKey: event.target.value, params: {} }, null, 2);
                      } catch { return JSON.stringify({ actionKey: event.target.value, params: {} }, null, 2); }
                    })}>
                    <option value="">选择 Action</option>
                    {availableActions.map((action) => <option key={action.actionKey} value={action.actionKey}>
                      {action.name}（{action.actionKey}）
                    </option>)}
                  </Select>
                </div>
                <Textarea
                  rows={5}
                  value={newAltParams}
                  onChange={(e) => setNewAltParams(e.target.value)}
                  className="font-mono text-xs"
                  aria-label="方案预测指标 JSON"
                  placeholder='{"actionKey":"sc_transfer_inventory","serviceScore":82,"costScore":64,"riskScore":85,"params":{"quantity":400}}'
                />
                {proposalDraft && typeof proposalDraft.actionKey === 'string' && proposalDraft.actionKey &&
                  <ActionObjectParams actionKey={proposalDraft.actionKey}
                    params={proposalDraft.params && typeof proposalDraft.params === 'object' && !Array.isArray(proposalDraft.params)
                      ? proposalDraft.params as Record<string, unknown> : {}}
                    targetTypeKey={detail.decisionType?.targetObjectType}
                    onChange={(key, objectId) => setNewAltParams((current) => {
                      try {
                        const draft = JSON.parse(current) as Record<string, unknown>;
                        const params = draft.params && typeof draft.params === 'object' && !Array.isArray(draft.params)
                          ? draft.params as Record<string, unknown> : {};
                        return JSON.stringify({ ...draft, params: { ...params, [key]: objectId } }, null, 2);
                      } catch { return current; }
                    })} />}
                <Button
                  size="sm"
                  disabled={busy || !newAltName.trim()}
                  onClick={() => {
                    let params: Record<string, unknown>;
                    try {
                      params = JSON.parse(newAltParams || '{}');
                    } catch {
                      setError('方案预测指标 JSON 格式错误');
                      return;
                    }
                    if (typeof params.actionKey !== 'string' || !params.actionKey) {
                      setError('方案须包含已配置的 actionKey');
                      return;
                    }
                    const rootObjectId = detail.caseObjects?.find((item) => item.role === 'trigger')?.objectId
                      || detail.objects?.find((item) => item.role === 'trigger')?.objectId;
                    const actionParams = (params.params && typeof params.params === 'object')
                      ? params.params as Record<string, unknown> : {};
                    if (rootObjectId && !actionParams.objectId) {
                      params.params = { ...actionParams, objectId: rootObjectId };
                    }
                    runAction('添加方案', () =>
                      api
                        .post(`/cases/${caseId}/alternatives`, {
                          name: newAltName.trim(),
                          description: newAltDesc,
                          proposedActions: [params],
                          params,
                        })
                        .then(() => {
                          setNewAltName('');
                          setNewAltDesc('');
                        })
                    );
                  }}
                >
                  添加方案
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {canDecide && state === 'Oriented' && (
          <Button disabled={busy || (detail.alternatives?.length ?? 0) < 3}
            onClick={() => runAction('备选就绪', () =>
              api.post(`/cases/${caseId}/transition`, { toState: 'OptionsReady', reason: '备选方案已建立' }).then(() => undefined))}>
            至少三种备选就绪
          </Button>
        )}

        <details className="rounded-lg border border-border p-4">
          <summary className="cursor-pointer text-sm font-medium">情景推演 <span className="text-muted-foreground">（可选，评分前使用）</span></summary>
          <div className="mt-4">
      {/* 情景推演 */}
      <Card>
        <CardHeader>
          <CardTitle>情景推演（Overlay）</CardTitle>
          <CardDescription>
            推演仅在内存叠加，不修改正式对象（由 assertNoOverlayLeak 校验）。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Textarea
            rows={4}
            value={scenarioOverlay}
            onChange={(e) => setScenarioOverlay(e.target.value)}
            className="font-mono text-xs"
            aria-label="推演覆盖 JSON"
            placeholder='{"overrides": {"availableQty": 120}}'
          />
          {canDecide && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => {
                let overlay: unknown;
                try {
                  overlay = JSON.parse(scenarioOverlay || '{}');
                } catch {
                  setError('推演覆盖 JSON 格式错误');
                  return;
                }
                runAction('推演', () =>
                  api.post(`/cases/${caseId}/scenarios`, { overlay }).then(() => undefined)
                );
              }}
            >
              运行推演
            </Button>
          )}
        </CardContent>
      </Card>

          </div>
        </details>

        <Card>
          <CardHeader>
            <CardTitle>评分对比</CardTitle>
            <CardDescription>按硬约束 → 事实完备性 → 加权得分排序。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {scores.length === 0 ? (
              <p className="text-muted-foreground">尚未评分。</p>
            ) : (
              <Table>
                <THeader>
                  <TR>
                    <TH>方案</TH>
                    <TH>得分</TH>
                    <TH>可行性</TH>
                    <TH>原因</TH>
                  </TR>
                </THeader>
                <TBody>
                  {scores.map((s) => (
                    <TR key={s.alternativeId}>
                      <TD className="font-medium">
                        {s.name || altName(s.alternativeId)}
                        {detail.scoreRun?.winnerAlternativeId === s.alternativeId && (
                          <Badge variant="success" className="ml-2">推荐</Badge>
                        )}
                      </TD>
                      <TD>{formatNum(s.totalScore ?? s.score)}</TD>
                      <TD>
                        <Badge variant={s.feasible ? 'success' : 'destructive'}>
                          {s.feasible ? '可行' : '不可行'}
                        </Badge>
                      </TD>
                      <TD className="max-w-[200px] text-xs text-muted-foreground">
                        {(s.infeasibleReasons || s.reasons || []).join('；') || '—'}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}

            {canDecide && (
              <div className="space-y-2 rounded-md border border-border p-3">
                <Label>权重调整（准则权重）</Label>
                {criteria.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    当前决策类型未定义评分准则，将使用默认权重。
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {criteria.map((c) => (
                      <div key={c.key}>
                        <Label htmlFor={`w-${c.key}`} className="text-xs">
                          {c.name || c.key}（默认 {c.weight ?? 0}）
                        </Label>
                        <Input
                          id={`w-${c.key}`}
                          type="number"
                          value={weightForm[c.key] ?? c.weight ?? 0}
                          onChange={(e) => setWeightForm({ ...weightForm, [c.key]: Number(e.target.value) })}
                        />
                      </div>
                    ))}
                  </div>
                )}
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    runAction('评分', () =>
                      api
                        .post(`/cases/${caseId}/score`, {
                          weights: weightForm,
                        })
                        .then(() => undefined)
                    )
                  }
                >
                  运行评分
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
      </section>

      {/* 决策与审批 */}
      <section id="phase-approval" aria-label="决策与审批" hidden={selectedPhase !== 'approval'} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>决策与审批</CardTitle>
          <CardDescription>选定方案后申请审批；审批通过方可执行动作。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">操作顺序：① 记录选定方案与理由 → ② 提交审批 → ③ 审批人批准或驳回。</p>
          {stalePendingCount > 0 && (
            <Alert variant="warning">
              有 {stalePendingCount} 条旧待审记录与当前案例状态不一致，无法继续审批。请核对方案后重新记录决策并提交审批。
            </Alert>
          )}
          {detail.scoreRun && !detail.scoreRun.current && (
            <Alert variant="warning">
              当前快照或备选方案晚于上次评分。请到“方案与评估”重新评分，再记录决策。
              <Button size="sm" variant="outline" className="ml-3" onClick={() => setSelectedPhase('options')}>
                查看方案与评估
              </Button>
            </Alert>
          )}
          {decision && (
            <Alert variant={currentDecision && !decision.overridden ? 'info' : 'warning'}>
              {currentDecision ? '已记录决策' : '历史决策（需重新记录）'}：{altName(decision.alternativeId || decision.selectedAlternativeId)}
              {decision.overridden ? '（人工覆写，非最高分）' : ''}
              {decision.rationale ? ` — ${decision.rationale}` : ''}
            </Alert>
          )}
          {(detail.alternatives ?? []).filter((alternative) =>
            scoreByAlternative.get(alternative.id)?.feasible === false).map((alternative) => {
            const reasons = scoreByAlternative.get(alternative.id)?.infeasibleReasons
              ?? alternative.infeasibleReasons ?? [];
            return <Alert key={alternative.id} variant="warning">
              {alternative.name}不可选：{reasons.join('；') || '未通过硬约束'}
            </Alert>;
          })}

          <div className="flex flex-wrap items-end gap-2">
            <div className="w-64">
              <Label htmlFor="altSelect">选定方案</Label>
              <Select id="altSelect" value={selectedAlt} disabled={state !== 'OptionsReady' || selectableAlternatives.length === 0}
                onChange={(e) => setSelectedAlt(e.target.value)}>
                {!selectedAlt && <option value="">请先评分并选择可行方案</option>}
                {(detail.alternatives || []).map((a) => (
                  <option key={a.id} value={a.id} disabled={!selectableAlternatives.some((item) => item.id === a.id)}>
                    {a.name}{scoreByAlternative.get(a.id)?.feasible === false ? ' · 不可行' :
                      !scoreByAlternative.has(a.id) ? ' · 未评分' : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-[200px] flex-1">
              <Label htmlFor="decisionNote">决策理由</Label>
              <Input
                id="decisionNote"
                value={decisionNote}
                disabled={state !== 'OptionsReady'}
                onChange={(e) => setDecisionNote(e.target.value)}
                placeholder="选择依据、关键权衡"
              />
            </div>
            {canDecide && state === 'OptionsReady' && (
              <Button
                disabled={busy || !selectedAlt || !decisionReady || !selectedScore?.feasible
                  || !selectableAlternatives.some((alternative) => alternative.id === selectedAlt)}
                onClick={() =>
                  runAction('记录决策', () =>
                    api
                      .post(`/cases/${caseId}/decision`, {
                        selectedAlternativeId: selectedAlt,
                        rationale: decisionNote,
                      })
                      .then(() => undefined)
                  )
                }
              >
                记录决策
              </Button>
            )}
            {canDecide && state === 'OptionsReady' && (
              <Button
                variant="outline"
                disabled={busy || !decisionReady || !currentDecision || !selectedScore?.feasible
                  || (decision.alternativeId || decision.selectedAlternativeId) !== selectedAlt}
                onClick={() =>
                  runAction('提交审批', () =>
                    api.post(`/cases/${caseId}/approvals`, { alternativeId: selectedAlt }).then(() => undefined)
                  )
                }
              >
                提交审批
              </Button>
            )}
            {canApprove && pendingApproval && (
              <>
                <Button
                  disabled={busy}
                  onClick={() =>
                    runAction('批准', () =>
                      api
                        .post(`/approvals/${pendingApproval.id}/decide`, {
                          decision: 'approved',
                          comment: '同意执行',
                        })
                        .then(() => undefined)
                    )
                  }
                >
                  批准
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy}
                  onClick={() =>
                    runAction('驳回', () =>
                      api
                        .post(`/approvals/${pendingApproval.id}/decide`, {
                          decision: 'rejected',
                          comment: '需要补充材料',
                        })
                        .then(() => undefined)
                    )
                  }
                >
                  驳回
                </Button>
              </>
            )}
          </div>
          {detail.approvals && detail.approvals.length > 0 && (
            <details className="rounded-lg border border-border p-3" open={state === 'PendingApproval'}>
              <summary className="cursor-pointer text-sm font-medium">审批记录（{detail.approvals.length}）</summary>
              <ul className="mt-3 space-y-2 text-sm">
                {detail.approvals.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(a.status)}>
                      {a.status === 'pending' && state !== 'PendingApproval' ? 'pending · 不可处理' : a.status}
                    </Badge>
                    <span className="text-muted-foreground">
                      {a.decidedBy || a.requestedBy || '—'} · {formatTime(a.decidedAt || a.requestedAt || a.createdAt)}
                    </span>
                    {a.comment && <span className="text-xs">· {a.comment}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>
      </section>

      {/* Act · 执行动作（场景感知） */}
      <section id="phase-execution" aria-label="执行动作" hidden={selectedPhase !== 'execution'} className="space-y-6">
      {canAct && (
        <Card>
          <CardHeader>
            <CardTitle>Act · 执行决策动作</CardTitle>
            <CardDescription>
              动作来自所选方案的拟议动作（actionKey + params），按决策类型场景执行，支持幂等。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!resolvedAction?.actionKey ? (
              <Alert variant="warning">
                当前方案未定义可执行动作（proposedActions.actionKey）。请为方案补充拟议动作，或选择已配置动作的方案。
              </Alert>
            ) : (
              <div className="space-y-2 rounded-md border border-border p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">动作：</span>
                  <Badge variant="outline">{resolvedAction.actionKey}</Badge>
                  <span className="text-muted-foreground">方案：</span>
                  <span>{altName(resolvedAction.alternativeId)}</span>
                </div>
                <Label htmlFor="actionParams">方案中的动作参数 JSON（审批后不可修改）</Label>
                <Textarea
                  id="actionParams"
                  rows={5}
                  value={JSON.stringify(resolvedAction.defaultParams, null, 2)}
                  readOnly
                  className="font-mono text-xs"
                />
                {actionSchemaError && <Alert variant="error">{actionSchemaError}</Alert>}
                {missingActionParams.length > 0 && (
                  <Alert variant="warning">
                    当前方案缺少必填参数：{missingActionParams.join('、')}。已批准方案的参数不能在执行时修改；请退回方案阶段，补全后重新评分和审批。
                  </Alert>
                )}
                {state === 'Approved' && canDecide && missingActionParams.length > 0 && (
                  <Button variant="outline" disabled={busy} onClick={async () => {
                    const original = detail.alternatives?.find((item) => item.id === resolvedAction.alternativeId);
                    const proposed = original?.proposedActions?.find((item) => item.actionKey === resolvedAction.actionKey);
                    const rootObjectId = detail.caseObjects?.find((item) => item.role === 'trigger')?.objectId
                      || detail.objects?.find((item) => item.role === 'trigger')?.objectId;
                    setNewAltName(`${original?.name || '原方案'}（参数补全）`);
                    setNewAltDesc(original?.description || '');
                    setNewAltParams(JSON.stringify({ ...proposed, params: {
                      ...resolvedAction.defaultParams,
                      ...(rootObjectId && !resolvedAction.defaultParams.objectId ? { objectId: rootObjectId } : {}),
                    } }, null, 2));
                    const returned = await runAction('退回方案阶段', () =>
                      api.post(`/cases/${caseId}/transition`, {
                        toState: 'OptionsReady', reason: '补全已批准方案的动作参数，重新评分和审批',
                      }).then(() => undefined));
                    if (returned) setSelectedPhase('options');
                  }}>
                    退回并准备补全方案
                  </Button>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy || state !== 'Approved' || !actionSchema || missingActionParams.length > 0}
                    onClick={() => {
                      runAction('执行动作', () =>
                        api
                          .post('/actions/execute', {
                            actionKey: resolvedAction.actionKey,
                            caseId: detail.id,
                            alternativeId: resolvedAction.alternativeId,
                            approvalId: approvedApproval?.id,
                            params: resolvedAction.defaultParams,
                            idempotencyKey: `case-exec-${detail.id}-${resolvedAction.alternativeId}`,
                          })
                          .then(() => undefined)
                      );
                    }}
                  >
                    执行决策动作
                  </Button>
                  {state === 'Approved' && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        runAction('推进执行中', () =>
                          api.post(`/cases/${caseId}/transition`, { toState: 'Executing', reason: '开始执行' }).then(() => undefined)
                        )
                      }
                    >
                      标记 Executing
                    </Button>
                  )}
                  {state === 'Executing' && (
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        runAction('标记完成', () =>
                          api.post(`/cases/${caseId}/transition`, { toState: 'Completed', reason: '执行完成' }).then(() => undefined)
                        )
                      }
                    >
                      标记 Completed
                    </Button>
                  )}
                </div>
                {state !== 'Approved' && state !== 'Executing' && (
                  <p className="text-xs text-muted-foreground">
                    需案例处于 Approved / Executing 状态方可执行（当前 {state}）。
                  </p>
                )}
              </div>
            )}

            {detail.actionRuns && detail.actionRuns.length > 0 && (
              <div>
                <h4 className="mb-1 text-sm font-medium">执行记录</h4>
                <ul className="space-y-1 text-sm">
                  {detail.actionRuns.map((r) => (
                    <li key={r.id} className="flex items-center gap-2">
                      <Badge variant={statusVariant(r.status)}>{r.status}</Badge>
                      <span className="font-mono text-xs">{r.actionKey}</span>
                      <span className="text-xs text-muted-foreground">{formatTime(r.executedAt)}</span>
                      {r.error && <span className="text-xs text-destructive">{r.error}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {!canAct && (
        <Card>
          <CardHeader>
            <CardTitle>执行动作</CardTitle>
            <CardDescription>此阶段由具有执行权限的角色处理。</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(detail.actionRuns ?? []).length === 0 ? <p className="text-muted-foreground">暂无执行记录。</p>
              : detail.actionRuns?.map((run) => (
                <p key={run.id}>{run.actionKey} · {run.status} · {formatTime(run.executedAt)}</p>
              ))}
          </CardContent>
        </Card>
      )}
      </section>

      {/* 复盘：结果记录与关闭 */}
      <section id="phase-outcome" aria-label="结果与关闭" hidden={selectedPhase !== 'outcome'} className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Outcome · 结果复盘</CardTitle>
          <CardDescription>
            记录预期/实际指标，系统自动计算偏差；复盘后可关闭案例。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {detail.outcomes && detail.outcomes.length > 0 ? (
            <Table>
              <THeader>
                <TR>
                  <TH>预期</TH>
                  <TH>实际</TH>
                  <TH>偏差</TH>
                  <TH>记录人</TH>
                  <TH>时间</TH>
                </TR>
              </THeader>
              <TBody>
                {detail.outcomes.map((o) => (
                  <TR key={o.id}>
                    <TD className="font-mono text-xs">{JSON.stringify(o.expected)}</TD>
                    <TD className="font-mono text-xs">{JSON.stringify(o.actual)}</TD>
                    <TD className="max-w-[220px] text-xs">
                      {Object.entries(o.deviation || {}).map(([k, v]) => (
                        <div key={k}>
                          {k}: {String(v.delta ?? '—')}
                          {v.deltaPct != null ? ` (${v.deltaPct}%)` : ''}
                        </div>
                      ))}
                    </TD>
                    <TD className="text-xs">{o.recordedBy || '—'}</TD>
                    <TD className="text-xs text-muted-foreground">{formatTime(o.createdAt)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          ) : (
            <p className="text-muted-foreground">尚未记录结果。</p>
          )}

          {canAct && (state === 'Executing' || state === 'Completed' || state === 'Failed') && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <Label htmlFor="expectedJson">预期指标 JSON</Label>
                  <Textarea
                    id="expectedJson"
                    rows={3}
                    value={expectedJson}
                    onChange={(e) => setExpectedJson(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
                <div>
                  <Label htmlFor="actualJson">实际指标 JSON</Label>
                  <Textarea
                    id="actualJson"
                    rows={3}
                    value={actualJson}
                    onChange={(e) => setActualJson(e.target.value)}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="outcomeEvidence">结果证据 ID（逗号分隔）</Label>
                <Input id="outcomeEvidence" value={evidenceRefsText}
                  onChange={(e) => setEvidenceRefsText(e.target.value)}
                  aria-describedby="outcomeEvidenceHelp" />
                <p id="outcomeEvidenceHelp" className="text-xs text-muted-foreground">
                  案例已有证据：{availableEvidenceIds.join('、') || '暂无，请先为关联对象添加来源证据'}
                </p>
              </div>
              <div>
                <Label htmlFor="reviewNotes">复盘备注</Label>
                <Input
                  id="reviewNotes"
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  placeholder="接近预期 / 偏差原因 / 改进点"
                />
              </div>
              <Button
                size="sm"
                disabled={busy}
                onClick={() => {
                  let expected: Record<string, unknown>;
                  let actual: Record<string, unknown>;
                  try {
                    expected = JSON.parse(expectedJson || '{}');
                    actual = JSON.parse(actualJson || '{}');
                  } catch {
                    setError('预期/实际指标 JSON 格式错误');
                    return;
                  }
                  const evidenceRefs = evidenceRefsText.split(',').map((x) => x.trim()).filter(Boolean);
                  if (!evidenceRefs.length) {
                    setError('请选择至少一条结果证据');
                    return;
                  }
                  const units = Object.fromEntries((detail.decisionType?.criteria ?? [])
                    .filter((c) => c.unit).map((c) => [c.key, c.unit!]));
                  runAction('记录结果', () =>
                    api
                      .post(`/cases/${caseId}/outcomes`, {
                        expected,
                        actual,
                        units,
                        evidenceRefs,
                        reviewNotes,
                      })
                      .then(() => undefined)
                  );
                }}
              >
                记录结果
              </Button>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {canApprove && state === 'Completed' && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  runAction('复盘完成', () =>
                    api.post(`/cases/${caseId}/transition`, { toState: 'OutcomeReviewed', reason: '复盘完成' }).then(() => undefined)
                  )
                }
              >
                标记 OutcomeReviewed
              </Button>
            )}
            {canApprove && (state === 'OutcomeReviewed' || state === 'Failed') && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  runAction('关闭案例', () =>
                    api.post(`/cases/${caseId}/close`, {}).then(() => undefined)
                  )
                }
              >
                关闭案例
              </Button>
            )}
            {(canDecide || canApprove) && state !== 'Closed' && state !== 'Cancelled' && (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  runAction('取消案例', () =>
                    api.post(`/cases/${caseId}/transition`, { toState: 'Cancelled', reason: '业务取消' }).then(() => undefined)
                  )
                }
              >
                取消案例
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
      </section>
    </div>
  );
}
