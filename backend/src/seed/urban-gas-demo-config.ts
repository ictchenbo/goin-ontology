// “城市燃气安全”演示领域配置：对象模型、规则、函数、Action、决策类型与两条演示案例
// 与 seed.ts 的场景包使用同一套引擎；所有数据均为合成演示数据。
import type { TypeDefinition, PropertyDef } from '../modules/ontology/ontology-service';

export const gasDomain = {
  domainKey: 'urban-gas-safety',
  displayName: '城市燃气安全',
  description: '城市燃气管网泄漏应急处置演示领域，串联本体模型、对象浏览、决策工作台、审批中心与动作执行',
};

/** 领域内创建的资源统一由该种子主体记录，便于重复执行时识别 */
export const GAS_SEED_ACTOR = 'urban-gas-demo-seed';

function props(list: PropertyDef[]): TypeDefinition {
  return {
    properties: list,
    displayProperty: list.find((p) => p.name === 'name')?.name ?? list[0]?.name,
  };
}

export interface DemoSampleType {
  typeKey: string;
  displayName: string;
  description?: string;
  category?: string;
  definition: TypeDefinition;
}

export const gasTypes: DemoSampleType[] = [
  {
    typeKey: 'GasPipeline', displayName: '燃气管段', category: 'entity',
    description: '城市中压/低压燃气管段，是隔离与抢修的作用对象',
    definition: props([
      { name: 'name', type: 'string', label: '管段名称', required: true },
      { name: 'code', type: 'string', label: '管段编码', required: true },
      { name: 'diameterMm', type: 'number', label: '管径(mm)', min: 0 },
      { name: 'pressureLevel', type: 'enum', label: '压力等级', enumValues: ['low', 'medium', 'high'] },
      { name: 'lengthM', type: 'number', label: '长度(m)', min: 0 },
      { name: 'households', type: 'number', label: '影响户数', min: 0 },
      { name: 'status', type: 'enum', label: '运行状态', enumValues: ['normal', 'suspected_leak', 'isolated', 'repairing'] },
    ]),
  },
  {
    typeKey: 'GasSensor', displayName: '燃气监测终端', category: 'entity',
    description: 'SCADA 压力/浓度监测点，为报警提供实时读数',
    definition: props([
      { name: 'name', type: 'string', label: '终端名称', required: true },
      { name: 'code', type: 'string', label: '终端编码', required: true },
      { name: 'location', type: 'string', label: '安装位置' },
      { name: 'methanePct', type: 'number', label: '甲烷浓度(%LEL)', min: 0, max: 100 },
      { name: 'pressureKpa', type: 'number', label: '压力(kPa)', min: 0 },
      { name: 'batteryPct', type: 'number', label: '电量(%)', min: 0, max: 100 },
      { name: 'status', type: 'enum', label: '终端状态', enumValues: ['online', 'offline', 'fault'] },
    ]),
  },
  {
    typeKey: 'GasValveStation', displayName: '燃气阀门站', category: 'entity',
    description: '可远程或现场操作的管段上游控制阀门',
    definition: props([
      { name: 'name', type: 'string', label: '阀门站名称', required: true },
      { name: 'valveId', type: 'string', label: '阀门编号', required: true },
      { name: 'upstreamPressureKpa', type: 'number', label: '上游压力(kPa)', min: 0 },
      { name: 'controllable', type: 'boolean', label: '可远程控制' },
      { name: 'status', type: 'enum', label: '阀门状态', enumValues: ['open', 'closed', 'maintenance'] },
    ]),
  },
  {
    typeKey: 'GasSensitiveSite', displayName: '燃气敏感场所', category: 'entity',
    description: '泄漏半径内需要优先通知的学校、医院、市场或居民区',
    definition: props([
      { name: 'name', type: 'string', label: '场所名称', required: true },
      { name: 'kind', type: 'enum', label: '场所类型', enumValues: ['school', 'hospital', 'residential', 'market'] },
      { name: 'distanceM', type: 'number', label: '距管段距离(m)', min: 0 },
      { name: 'occupantCount', type: 'number', label: '在场人数', min: 0 },
      { name: 'contact', type: 'string', label: '联系人/电话' },
    ]),
  },
  {
    typeKey: 'GasRepairTeam', displayName: '抢修班组', category: 'entity',
    description: '承担现场核实、关阀与抢修的班组',
    definition: props([
      { name: 'name', type: 'string', label: '班组名称', required: true },
      { name: 'code', type: 'string', label: '班组编码', required: true },
      { name: 'onDuty', type: 'boolean', label: '是否值班' },
      { name: 'etaMinutes', type: 'number', label: '预计到场(分钟)', min: 0 },
      { name: 'skills', type: 'string', label: '能力说明' },
    ]),
  },
  {
    typeKey: 'GasLeakAlarm', displayName: '燃气泄漏报警', category: 'event',
    description: 'SCADA、巡检或热线产生的泄漏报警事件，是决策案例的触发对象',
    definition: props([
      { name: 'name', type: 'string', label: '报警编号', required: true },
      { name: 'alarmTime', type: 'datetime', label: '报警时间', required: true },
      { name: 'location', type: 'string', label: '报警位置' },
      { name: 'methanePct', type: 'number', label: '甲烷浓度(%LEL)', min: 0, max: 100 },
      { name: 'pressureDropKpa', type: 'number', label: '压力下降(kPa)', min: 0 },
      { name: 'verificationStatus', type: 'enum', label: '核实状态', required: true,
        enumValues: ['unverified', 'partial', 'verified'] },
      { name: 'sourceCount', type: 'number', label: '来源数量', min: 1 },
      { name: 'description', type: 'string', label: '报警描述' },
      { name: 'status', type: 'enum', label: '报警状态', enumValues: ['open', 'confirmed', 'closed'] },
    ]),
  },
  {
    typeKey: 'GasWorkOrder', displayName: '燃气处置工单', category: 'event',
    description: 'Action 执行后生成的现场处置工单',
    definition: props([
      { name: 'name', type: 'string', label: '工单名称', required: true },
      { name: 'orderNo', type: 'string', label: '工单编号' },
      { name: 'status', type: 'enum', label: '工单状态', enumValues: ['open', 'in_progress', 'done'] },
      { name: 'assignee', type: 'string', label: '执行班组' },
      { name: 'dueAt', type: 'datetime', label: '要求完成时间' },
      { name: 'note', type: 'string', label: '处置说明' },
    ]),
  },
];

export interface DemoLink {
  linkKey: string;
  displayName: string;
  fromType: string;
  toType: string;
  cardinality?: string;
  description?: string;
}

export const gasLinks: DemoLink[] = [
  { linkKey: 'gas_alarm_monitored_by', displayName: '报警来自监测终端', fromType: 'GasLeakAlarm', toType: 'GasSensor', cardinality: 'N:1' },
  { linkKey: 'gas_sensor_on_pipeline', displayName: '终端安装于管段', fromType: 'GasSensor', toType: 'GasPipeline', cardinality: 'N:1' },
  { linkKey: 'gas_pipeline_has_valve', displayName: '管段受阀门控制', fromType: 'GasPipeline', toType: 'GasValveStation', cardinality: 'N:1' },
  { linkKey: 'gas_pipeline_near_site', displayName: '管段邻近敏感场所', fromType: 'GasPipeline', toType: 'GasSensitiveSite', cardinality: 'N:M' },
  { linkKey: 'gas_team_responsible_for', displayName: '班组负责管段', fromType: 'GasRepairTeam', toType: 'GasPipeline', cardinality: 'N:M' },
  { linkKey: 'gas_workorder_for_alarm', displayName: '工单对应报警', fromType: 'GasWorkOrder', toType: 'GasLeakAlarm', cardinality: 'N:1' },
];

export interface DemoRule {
  ruleKey: string;
  name: string;
  kind: 'trigger' | 'derived_metric';
  description?: string;
  expression: string;
  scopeType?: string;
  outputType?: string;
  testCases?: Array<{ input: Record<string, unknown>; expected: unknown }>;
}

export const gasRules: DemoRule[] = [
  {
    ruleKey: 'gas_methane_threshold', name: '甲烷浓度达到报警阈值', kind: 'trigger', scopeType: 'GasLeakAlarm',
    description: '浓度达到 10% LEL 时提示需要现场核查；命中规则不等于泄漏已确认。',
    expression: 'coalesce(object.methanePct, 0) >= 10',
    testCases: [
      { input: { object: { methanePct: 18 } }, expected: true },
      { input: { object: { methanePct: 9 } }, expected: false },
    ],
  },
  {
    ruleKey: 'gas_pressure_drop_alert', name: '管段压力异常下降', kind: 'trigger', scopeType: 'GasLeakAlarm',
    description: '压力下降达到 30 kPa 时提示管段可能存在泄漏或阀门异常。',
    expression: 'coalesce(object.pressureDropKpa, 0) >= 30',
    testCases: [
      { input: { object: { pressureDropKpa: 42 } }, expected: true },
      { input: { object: { pressureDropKpa: 8 } }, expected: false },
    ],
  },
  {
    ruleKey: 'gas_single_source_alert', name: '单源报警需补充核实', kind: 'trigger', scopeType: 'GasLeakAlarm',
    description: '只有一个来源时仅提示补充核实，不证明泄漏成立。',
    expression: 'coalesce(object.sourceCount, 1) == 1',
    testCases: [
      { input: { object: { sourceCount: 1 } }, expected: true },
      { input: { object: { sourceCount: 3 } }, expected: false },
    ],
  },
  {
    ruleKey: 'gas_urgency_index', name: '泄漏紧急度指数', kind: 'derived_metric',
    description: '按甲烷浓度与压力降幅计算的 0-100 紧急度，用于排序提示。',
    expression: 'clamp(coalesce(object.methanePct, 0) * 4 + coalesce(object.pressureDropKpa, 0), 0, 100)',
    testCases: [
      { input: { object: { methanePct: 18, pressureDropKpa: 42 } }, expected: 100 },
      { input: { object: { methanePct: 0, pressureDropKpa: 8 } }, expected: 8 },
    ],
  },
];

export interface DemoFunction {
  functionKey: string;
  name: string;
  description?: string;
  parameters: string[];
  expression: string;
  outputType?: string;
}

export const gasFunctions: DemoFunction[] = [
  {
    functionKey: 'gas_response_priority',
    name: '燃气响应优先级',
    description: '按甲烷浓度与压力降幅计算响应优先级（0-100），供模型工作台试算。',
    parameters: ['methane_pct', 'pressure_drop'],
    expression: 'clamp(methane_pct * 4 + pressure_drop, 0, 100)',
    outputType: 'number',
  },
];

export interface DemoObject {
  key: string;
  typeKey: string;
  title: string;
  payload: Record<string, unknown>;
}

// 主链 A：梧桐路中压管段泄漏（已核实，供决策主线使用）
// 辅链 B：建设路低压管段异味（未核实，供审批中心待办使用）
export const gasObjects: DemoObject[] = [
  // --- 主链 A ---
  {
    key: 'alarmMain', typeKey: 'GasLeakAlarm', title: '梧桐路与建设路交口燃气泄漏报警',
    payload: {
      name: 'ALM-GAS-001', alarmTime: '@now-2h', location: '梧桐路与建设路交口 DN300 中压管段',
      methanePct: 18, pressureDropKpa: 42, verificationStatus: 'verified', sourceCount: 3,
      description: 'SCADA 压力骤降，巡检员便携检测仪读数 18% LEL，两处井盖可闻到异味，现场已核实。',
      status: 'confirmed',
    },
  },
  {
    key: 'sensorMain', typeKey: 'GasSensor', title: '梧桐路调压站下游监测终端 PT-031',
    payload: { name: 'PT-031', code: 'PT-031', location: '梧桐路调压站下游', methanePct: 18, pressureKpa: 96, batteryPct: 87, status: 'online' },
  },
  {
    key: 'pipelineMain', typeKey: 'GasPipeline', title: 'DN300 梧桐路中压管段',
    payload: { name: 'DN300 梧桐路中压管段', code: 'PL-WT-300', diameterMm: 300, pressureLevel: 'medium', lengthM: 820, households: 320, status: 'suspected_leak' },
  },
  {
    key: 'valveMain', typeKey: 'GasValveStation', title: '梧桐路调压站上游阀门',
    payload: { name: '梧桐路调压站上游阀门', valveId: 'VALVE-WT-01', upstreamPressureKpa: 210, controllable: true, status: 'open' },
  },
  {
    key: 'siteMainSchool', typeKey: 'GasSensitiveSite', title: '梧桐路小学',
    payload: { name: '梧桐路小学', kind: 'school', distanceM: 120, occupantCount: 860, contact: '校安办 010-0000-1101' },
  },
  {
    key: 'siteMainHospital', typeKey: 'GasSensitiveSite', title: '梧桐里社区医院',
    payload: { name: '梧桐里社区医院', kind: 'hospital', distanceM: 210, occupantCount: 140, contact: '值班室 010-0000-1102' },
  },
  {
    key: 'teamMain', typeKey: 'GasRepairTeam', title: '城东抢修一班',
    payload: { name: '城东抢修一班', code: 'TEAM-E1', onDuty: true, etaMinutes: 12, skills: '中压管线、阀门操作、泄漏检测' },
  },
  {
    key: 'workOrderMain', typeKey: 'GasWorkOrder', title: 'WO-昨日巡检测量记录',
    payload: { name: 'WO-20261027-041', orderNo: 'WO-20261027-041', status: 'done', assignee: '城东巡检组', note: '昨日巡检测得浓度 3% LEL，未达报警阈值。' },
  },
  // --- 辅链 B ---
  {
    key: 'alarmSecondary', typeKey: 'GasLeakAlarm', title: '建设路餐饮街燃气异味报警',
    payload: {
      name: 'ALM-GAS-002', alarmTime: '@now-1h', location: '建设路餐饮街 DN200 低压管段',
      methanePct: 9, pressureDropKpa: 8, verificationStatus: 'unverified', sourceCount: 1,
      description: '12345 热线转来商户燃气异味反映，尚未现场核实。', status: 'open',
    },
  },
  {
    key: 'sensorSecondary', typeKey: 'GasSensor', title: '建设路餐饮街阀井监测终端 PT-052',
    payload: { name: 'PT-052', code: 'PT-052', location: '建设路餐饮街阀井', methanePct: 9, pressureKpa: 104, batteryPct: 64, status: 'online' },
  },
  {
    key: 'pipelineSecondary', typeKey: 'GasPipeline', title: 'DN200 建设路低压管段',
    payload: { name: 'DN200 建设路低压管段', code: 'PL-JS-200', diameterMm: 200, pressureLevel: 'low', lengthM: 460, households: 150, status: 'normal' },
  },
  {
    key: 'valveSecondary', typeKey: 'GasValveStation', title: '建设路支线阀门',
    payload: { name: '建设路支线阀门', valveId: 'VALVE-JS-02', upstreamPressureKpa: 105, controllable: true, status: 'open' },
  },
  {
    key: 'siteSecondaryMarket', typeKey: 'GasSensitiveSite', title: '建设路农贸市场',
    payload: { name: '建设路农贸市场', kind: 'market', distanceM: 80, occupantCount: 600, contact: '市场管理处 010-0000-2201' },
  },
  {
    key: 'teamSecondary', typeKey: 'GasRepairTeam', title: '城西巡检二班',
    payload: { name: '城西巡检二班', code: 'TEAM-W2', onDuty: true, etaMinutes: 20, skills: '低压管线、泄漏检测' },
  },
];

export interface DemoLinkData { linkKey: string; from: string; to: string }

export const gasLinksData: DemoLinkData[] = [
  { linkKey: 'gas_alarm_monitored_by', from: 'alarmMain', to: 'sensorMain' },
  { linkKey: 'gas_sensor_on_pipeline', from: 'sensorMain', to: 'pipelineMain' },
  { linkKey: 'gas_pipeline_has_valve', from: 'pipelineMain', to: 'valveMain' },
  { linkKey: 'gas_pipeline_near_site', from: 'pipelineMain', to: 'siteMainSchool' },
  { linkKey: 'gas_pipeline_near_site', from: 'pipelineMain', to: 'siteMainHospital' },
  { linkKey: 'gas_team_responsible_for', from: 'teamMain', to: 'pipelineMain' },
  { linkKey: 'gas_workorder_for_alarm', from: 'workOrderMain', to: 'alarmMain' },
  { linkKey: 'gas_alarm_monitored_by', from: 'alarmSecondary', to: 'sensorSecondary' },
  { linkKey: 'gas_sensor_on_pipeline', from: 'sensorSecondary', to: 'pipelineSecondary' },
  { linkKey: 'gas_pipeline_has_valve', from: 'pipelineSecondary', to: 'valveSecondary' },
  { linkKey: 'gas_pipeline_near_site', from: 'pipelineSecondary', to: 'siteSecondaryMarket' },
  { linkKey: 'gas_team_responsible_for', from: 'teamSecondary', to: 'pipelineSecondary' },
];

export interface DemoSource {
  key: string;
  sourceKey: string;
  externalKey: string;
  sourceType: string;
  /** 相对时间占位：-2h / -1h，导入时替换为实际时间 */
  observedOffsetHours: number;
  confidence: number;
  purpose: string;
  raw: Record<string, unknown>;
}

export const gasSources: DemoSource[] = [
  {
    key: 'scadaMain', sourceKey: 'gas-scada-log', externalKey: 'gas-demo-scada-001', sourceType: 'system',
    observedOffsetHours: -2, confidence: 0.95, purpose: 'gas_emergency_response',
    raw: { system: 'SCADA', point: 'PT-031', pressureKpa: 96, methanePct: 18, note: '压力由 138 kPa 降至 96 kPa' },
  },
  {
    key: 'patrolMain', sourceKey: 'gas-patrol-record', externalKey: 'gas-demo-patrol-001', sourceType: 'manual',
    observedOffsetHours: -1.8, confidence: 0.9, purpose: 'gas_emergency_response',
    raw: { inspector: '城东巡检组', reading: '18% LEL', note: '两处井盖有异味，已设置临时警戒' },
  },
  {
    key: 'hotlineSecondary', sourceKey: 'gas-hotline', externalKey: 'gas-demo-hotline-001', sourceType: 'manual',
    observedOffsetHours: -1, confidence: 0.4, purpose: 'gas_emergency_response',
    raw: { channel: '12345', caller: '餐饮街商户', note: '反映店内有燃气味，未现场核实' },
  },
];

export interface DemoEvidence { objectKey: string; sourceKey: string; claim: string; observedOffsetHours: number }

export const gasEvidence: DemoEvidence[] = [
  { objectKey: 'alarmMain', sourceKey: 'scadaMain', claim: 'SCADA 压力由 138 kPa 降至 96 kPa', observedOffsetHours: -2 },
  { objectKey: 'alarmMain', sourceKey: 'patrolMain', claim: '现场便携检测仪读数 18% LEL，井盖有异味', observedOffsetHours: -1.8 },
  { objectKey: 'alarmSecondary', sourceKey: 'hotlineSecondary', claim: '12345 热线反映餐饮街燃气异味', observedOffsetHours: -1 },
];

export interface DemoAlternative {
  name: string;
  description: string;
  proposedActions: Array<Record<string, unknown>>;
}

export interface DemoCase {
  key: string;
  decisionTypeKey: string;
  title: string;
  summary: string;
  triggerKey: string;
  ownerUsername: string;
  stage: 'OptionsReady' | 'PendingApproval';
  weights: Record<string, number>;
  selectedAlternativeName?: string;
  rationale?: string;
  alternatives: DemoAlternative[];
}

export const gasDecisionType = {
  typeKey: 'gas_leak_response',
  displayName: '燃气泄漏应急处置决策',
  description: '比较继续监测、派发核实、关阀隔离与全城停气，按安全、时效、影响与合规性评分。',
  targetObjectType: 'GasLeakAlarm',
  requiredFacts: ['alarmTime', 'verificationStatus'],
  roleMatrix: {
    propose: ['analyst', 'commander', 'safety_officer', 'admin'],
    approve: ['safety_officer', 'commander', 'admin'],
    execute: ['operator', 'commander', 'admin'],
  },
  policyVersion: 'gas-v1',
  criteria: [
    { key: 'safety', name: '安全收益', direction: 'higher_better', weight: 40, normalize: 'min_max', expression: 'coalesce(proposed[0].safetyScore, 50)' },
    { key: 'timeliness', name: '处置时效', direction: 'higher_better', weight: 25, normalize: 'min_max', expression: 'coalesce(proposed[0].timelinessScore, 50)' },
    { key: 'impact', name: '影响可控', direction: 'higher_better', weight: 20, normalize: 'min_max', expression: 'coalesce(proposed[0].impactScore, 50)' },
    { key: 'compliance', name: '程序合规', direction: 'higher_better', weight: 15, normalize: 'min_max', expression: 'coalesce(proposed[0].complianceScore, 50)' },
  ],
  constraints: [
    {
      key: 'gas_verified_before_isolation', name: '未核实报警不得隔离或停气', severity: 'hard',
      expression: 'coalesce(proposed[0].restrictive, false) == false or coalesce(proposed[0].verified, false) == true',
      message: '报警尚未核实，不能执行隔离、停气或疏散等影响居民的措施',
      basis: '应急处置规程 GAS-02',
    },
    {
      key: 'gas_emergency_authority', name: '应急授权有效', severity: 'hard',
      expression: 'coalesce(proposed[0].requiresAuthority, false) == false or coalesce(proposed[0].hasAuthority, false) == true',
      message: '缺少有效应急授权，不能执行停气或疏散措施',
      basis: '燃气应急授权流程',
    },
    {
      key: 'gas_impact_ceiling', name: '单次处置影响上限', severity: 'soft',
      expression: 'coalesce(proposed[0].affectedHouseholds, 0) <= 500',
      message: '单次处置影响超过 500 户，应升级会商并扩大通知范围',
    },
    {
      key: 'gas_response_window', name: '到场时限', severity: 'soft',
      expression: 'coalesce(proposed[0].responseMinutes, 0) <= 30',
      message: '预计到场时间超过 30 分钟，存在风险扩大可能',
    },
    {
      key: 'gas_single_source_review', name: '单源报警需补充核实', severity: 'soft',
      expression: 'coalesce(object.sourceCount, 1) >= 2',
      message: '报警仅有单一来源，建议先补充核实再采取影响性措施',
    },
  ],
  approvalRoute: ['safety_officer', 'commander'],
};

export const gasActionTypes: Array<Record<string, unknown>> = [
  {
    actionKey: 'gas_record_observation',
    name: '记录继续监测',
    description: '不采取现场处置，只记录监测频次与观察结论',
    paramsSchema: {
      type: 'object', required: ['objectId', 'note'],
      properties: { objectId: { type: 'string' }, note: { type: 'string' } },
    },
    preconditions: [],
    writeSet: [
      { op: 'update', objectId: '${params.objectId}', payload: { responseStatus: 'monitoring', observationNote: '${params.note}' } },
    ],
    requiredRoles: ['operator', 'commander', 'admin'],
    approvalPolicy: { requiredRoles: ['safety_officer', 'commander'] },
  },
  {
    actionKey: 'gas_dispatch_inspection',
    name: '派发抢修核实工单',
    description: '派发抢修班组到场核实，生成处置工单并关联报警',
    paramsSchema: {
      type: 'object', required: ['objectId', 'teamId', 'reason'],
      properties: { objectId: { type: 'string' }, teamId: { type: 'string' }, reason: { type: 'string' } },
    },
    preconditions: ['params.teamId != null'],
    writeSet: [
      { op: 'create', type: 'GasWorkOrder', payload: { name: '抢修核实工单-${params.teamId}', status: 'open', assignee: '${params.teamId}', note: '${params.reason}' } },
      { op: 'link', linkKey: 'gas_workorder_for_alarm', fromObjectId: '${results.0.objectId}', toObjectId: '${params.objectId}' },
      { op: 'update', objectId: '${params.objectId}', payload: { responseStatus: 'inspecting', assignedTeam: '${params.teamId}' } },
    ],
    requiredRoles: ['operator', 'commander', 'admin'],
    approvalPolicy: { requiredRoles: ['safety_officer', 'commander'] },
  },
  {
    actionKey: 'gas_isolate_valve',
    name: '关闭上游阀门隔离管段',
    description: '关闭上游阀门、隔离泄漏管段并生成抢修工单',
    paramsSchema: {
      type: 'object', required: ['objectId', 'pipelineId', 'valveId', 'reason'],
      properties: {
        objectId: { type: 'string' }, pipelineId: { type: 'string' },
        valveId: { type: 'string' }, reason: { type: 'string' },
      },
    },
    preconditions: ['params.valveId != null'],
    writeSet: [
      { op: 'create', type: 'GasWorkOrder', payload: { name: '关阀隔离抢修工单', status: 'in_progress', assignee: '抢修班组', note: '${params.reason}' } },
      { op: 'link', linkKey: 'gas_workorder_for_alarm', fromObjectId: '${results.0.objectId}', toObjectId: '${params.objectId}' },
      { op: 'update', objectId: '${params.objectId}', payload: { responseStatus: 'isolating' } },
      { op: 'update', objectId: '${params.pipelineId}', payload: { status: 'isolated', isolationReason: '${params.reason}' } },
      { op: 'update', objectId: '${params.valveId}', payload: { status: 'closed' } },
    ],
    requiredRoles: ['operator', 'commander', 'admin'],
    approvalPolicy: { requiredRoles: ['safety_officer', 'commander'] },
  },
];

export const gasCases: DemoCase[] = [
  {
    key: 'main',
    decisionTypeKey: 'gas_leak_response',
    title: '梧桐路中压管段燃气泄漏应急处置',
    summary: 'SCADA 与现场巡检共同确认 18% LEL 泄漏，需在继续监测、派发核实、关阀隔离与全城停气之间作出选择。',
    triggerKey: 'alarmMain',
    ownerUsername: 'analyst',
    stage: 'OptionsReady',
    weights: { safety: 40, timeliness: 25, impact: 20, compliance: 15 },
    alternatives: [
      {
        name: '继续监测并记录',
        description: '不进入现场处置，维持监测并每小时报告',
        proposedActions: [{
          actionKey: 'gas_record_observation',
          safetyScore: 45, timelinessScore: 35, impactScore: 95, complianceScore: 95,
          responseMinutes: 45, affectedHouseholds: 0,
          restrictive: false, requiresAuthority: false, hasAuthority: true, verified: true,
          params: { note: '持续监测甲烷浓度与压力变化，每小时报告一次' },
        }],
      },
      {
        name: '派发抢修班组现场核实',
        description: '先派城东抢修一班到场复核泄漏点，再决定是否隔离',
        proposedActions: [{
          actionKey: 'gas_dispatch_inspection',
          safetyScore: 78, timelinessScore: 80, impactScore: 82, complianceScore: 92,
          responseMinutes: 18, affectedHouseholds: 0,
          restrictive: false, requiresAuthority: false, hasAuthority: true, verified: true,
          params: { teamId: 'TEAM-E1', reason: '复核阀门井与管段泄漏点，确认是否需要关阀' },
        }],
      },
      {
        name: '关闭上游阀门隔离管段',
        description: '关闭梧桐路调压站上游阀门，隔离 320 户供气并派单抢修',
        proposedActions: [{
          actionKey: 'gas_isolate_valve',
          safetyScore: 90, timelinessScore: 72, impactScore: 68, complianceScore: 96,
          responseMinutes: 22, affectedHouseholds: 320,
          restrictive: true, requiresAuthority: true, hasAuthority: true, verified: true,
          params: { pipelineId: '@pipelineMain', valveId: '@valveMain', reason: '甲烷浓度 18% LEL，关闭上游阀门隔离泄漏管段' },
        }],
      },
      {
        name: '立即全城停气并限制通行',
        description: '缺少全城停气授权且影响 2600 户，硬约束应拒绝',
        proposedActions: [{
          actionKey: 'gas_isolate_valve',
          safetyScore: 95, timelinessScore: 60, impactScore: 20, complianceScore: 30,
          responseMinutes: 30, affectedHouseholds: 2600,
          restrictive: true, requiresAuthority: true, hasAuthority: false, verified: true,
          params: { pipelineId: '@pipelineMain', valveId: '@valveMain', reason: '全城管网停气并限制通行' },
        }],
      },
    ],
  },
  {
    key: 'pending',
    decisionTypeKey: 'gas_leak_response',
    title: '建设路餐饮街燃气异味核实处置',
    summary: '仅有 12345 单一来源反映异味，现场尚未核实；已记录先派巡检班组核实并提交审批。',
    triggerKey: 'alarmSecondary',
    ownerUsername: 'analyst',
    stage: 'PendingApproval',
    weights: { safety: 40, timeliness: 25, impact: 20, compliance: 15 },
    selectedAlternativeName: '派发巡检班组核实',
    rationale: '单源报警且未核实，先派城西巡检二班到场复核，避免过度处置。',
    alternatives: [
      {
        name: '派发巡检班组核实',
        description: '派城西巡检二班到场检测，不采取影响性措施',
        proposedActions: [{
          actionKey: 'gas_dispatch_inspection',
          safetyScore: 70, timelinessScore: 78, impactScore: 88, complianceScore: 90,
          responseMinutes: 20, affectedHouseholds: 0,
          restrictive: false, requiresAuthority: false, hasAuthority: true, verified: false,
          params: { teamId: 'TEAM-W2', reason: '单源异味反映，现场核实是否发生泄漏' },
        }],
      },
      {
        name: '关闭支线阀门隔离',
        description: '未核实即关阀，硬约束应拒绝',
        proposedActions: [{
          actionKey: 'gas_isolate_valve',
          safetyScore: 86, timelinessScore: 70, impactScore: 64, complianceScore: 80,
          responseMinutes: 25, affectedHouseholds: 150,
          restrictive: true, requiresAuthority: true, hasAuthority: true, verified: false,
          params: { pipelineId: '@pipelineSecondary', valveId: '@valveSecondary', reason: '未核实即关闭建设路支线阀门' },
        }],
      },
      {
        name: '继续观察并联系商户',
        description: '联系市场管理处协助排查，暂不派单',
        proposedActions: [{
          actionKey: 'gas_record_observation',
          safetyScore: 50, timelinessScore: 40, impactScore: 95, complianceScore: 90,
          responseMinutes: 40, affectedHouseholds: 0,
          restrictive: false, requiresAuthority: false, hasAuthority: true, verified: false,
          params: { note: '联系市场管理处协助排查，暂不采取隔离措施' },
        }],
      },
    ],
  },
];
