// 三个领域场景的配置：对象图、决策类型、约束、备选方案、角色矩阵
// 领域对象与政策作为配置进入系统，不写死在平台内核

import type { TypeDefinition, PropertyDef } from '../modules/ontology/ontology-service';

export interface ScenarioPack {
  key: string;
  name: string;
  description: string;
  types: Array<{ typeKey: string; displayName: string; description?: string; category?: string; definition: TypeDefinition }>;
  links: Array<{ linkKey: string; displayName: string; fromType: string; toType: string; cardinality?: string; inverseName?: string; description?: string }>;
  rules: Array<{ ruleKey: string; name: string; kind: string; description?: string; expression: string; outputType?: string; scopeType?: string; testCases?: Array<{ input: any; expected: any }> }>;
  actionTypes: Array<Record<string, unknown>>;
  decisionTypes: Array<Record<string, unknown>>;
  objects: Array<{ typeKey: string; title?: string; payload: Record<string, unknown>; securityLabels?: string[] }>;
  linksData: Array<{ linkKey: string; fromIndex: number; toIndex: number; props?: Record<string, unknown> }>;
  sampleCase?: {
    decisionTypeKey: string;
    title: string;
    summary: string;
    triggerObjectIndex: number;
    alternatives: Array<{
      name: string;
      description: string;
      proposedActions: Array<Record<string, unknown>>;
    }>;
    weights?: Record<string, number>;
  };
}

function props(list: PropertyDef[]): TypeDefinition {
  return { properties: list, displayProperty: list.find((p) => p.name === 'name')?.name ?? list[0]?.name };
}

export const sharedOntologyTypes: ScenarioPack['types'] = [
  { typeKey: 'DecisionCase', displayName: '决策案例对象', category: 'decision', definition: props([
    { name: 'name', type: 'string', label: '案例名', required: true },
    { name: 'caseId', type: 'string', label: '案例 ID' },
    { name: 'state', type: 'string', label: '状态' },
  ]) },
  { typeKey: 'ActionPlan', displayName: '行动计划', category: 'decision', definition: props([
    { name: 'name', type: 'string', label: '计划名', required: true },
    { name: 'actionKey', type: 'string', label: '动作类型' },
    { name: 'status', type: 'string', label: '状态' },
  ]) },
  { typeKey: 'ScenarioRun', displayName: '推演记录对象', category: 'decision', definition: props([
    { name: 'name', type: 'string', label: '推演名', required: true },
    { name: 'caseId', type: 'string', label: '案例 ID' },
  ]) },
  { typeKey: 'DecisionRecord', displayName: '决策记录对象', category: 'decision', definition: props([
    { name: 'name', type: 'string', label: '决策名', required: true },
    { name: 'rationale', type: 'string', label: '选择理由' },
  ]) },
  { typeKey: 'Outcome', displayName: '结果对象', category: 'event', definition: props([
    { name: 'name', type: 'string', label: '结果名', required: true },
    { name: 'caseId', type: 'string', label: '案例 ID' },
    { name: 'status', type: 'string', label: '复盘状态' },
  ]) },
];

// ============================================================
// 场景一：供应链异常处置
// ============================================================
const supplyChain: ScenarioPack = {
  key: 'supply-chain',
  name: '供应链异常处置',
  description: '供应商发货延迟场景，验证跨实体关系、硬约束、方案推演、审批和结果反馈',
  types: [
    {
      typeKey: 'Supplier', displayName: '供应商', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '名称', required: true },
        { name: 'code', type: 'string', label: '编码', required: true },
        { name: 'qualification', type: 'enum', label: '资格状态', enumValues: ['qualified', 'probation', 'suspended'] },
        { name: 'riskScore', type: 'number', label: '风险分', min: 0, max: 100 },
        { name: 'country', type: 'string', label: '国家/地区' },
      ]),
    },
    {
      typeKey: 'Facility', displayName: '仓库/设施', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '名称', required: true },
        { name: 'code', type: 'string', label: '编码', required: true },
        { name: 'capacityUnits', type: 'number', label: '容量(单位)', unit: 'units' },
        { name: 'usedUnits', type: 'number', label: '已用(单位)' },
        { name: 'region', type: 'string', label: '区域' },
      ]),
    },
    {
      typeKey: 'InventoryLot', displayName: '库存批次', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '批次号', required: true },
        { name: 'sku', type: 'string', label: 'SKU', required: true },
        { name: 'quantity', type: 'number', label: '数量', unit: 'units' },
        { name: 'availableQty', type: 'number', label: '可用数量' },
        { name: 'qualityStatus', type: 'enum', label: '质量状态', enumValues: ['released', 'hold', 'rejected'] },
        { name: 'expiryDate', type: 'datetime', label: '有效期' },
      ]),
    },
    {
      typeKey: 'PurchaseOrder', displayName: '采购订单', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '订单号', required: true },
        { name: 'sku', type: 'string', label: 'SKU' },
        { name: 'quantity', type: 'number', label: '数量' },
        { name: 'promisedEta', type: 'datetime', label: '承诺到货' },
        { name: 'status', type: 'enum', label: '状态', enumValues: ['open', 'delayed', 'received', 'cancelled'] },
        { name: 'budgetUsd', type: 'number', label: '预算(USD)', unit: 'USD' },
      ]),
    },
    {
      typeKey: 'SalesOrder', displayName: '销售订单', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '订单号', required: true },
        { name: 'sku', type: 'string', label: 'SKU' },
        { name: 'quantity', type: 'number', label: '数量' },
        { name: 'customerDueDate', type: 'datetime', label: '客户交期' },
        { name: 'priority', type: 'enum', label: '优先级', enumValues: ['normal', 'high', 'critical'] },
        { name: 'servicePenaltyUsd', type: 'number', label: '违约金(USD)' },
      ]),
    },
    {
      typeKey: 'Shipment', displayName: '货运', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '运单号', required: true },
        { name: 'mode', type: 'enum', label: '运输方式', enumValues: ['sea', 'air', 'truck', 'rail'] },
        { name: 'estimatedArrival', type: 'datetime', label: '预计到达' },
        { name: 'delayDays', type: 'number', label: '延迟天数' },
        { name: 'status', type: 'enum', label: '状态', enumValues: ['planned', 'in_transit', 'delayed', 'arrived'] },
        { name: 'costUsd', type: 'number', label: '成本(USD)' },
      ]),
    },
    {
      typeKey: 'CapacityWindow', displayName: '产能窗口', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '窗口名', required: true },
        { name: 'startDate', type: 'datetime', label: '开始' },
        { name: 'endDate', type: 'datetime', label: '结束' },
        { name: 'availableUnits', type: 'number', label: '可用产能' },
        { name: 'transportMode', type: 'enum', label: '运输方式', enumValues: ['sea', 'air', 'truck', 'rail'] },
      ]),
    },
    {
      typeKey: 'Disruption', displayName: '异常事件', category: 'event',
      definition: props([
        { name: 'name', type: 'string', label: '事件名', required: true },
        { name: 'severity', type: 'enum', label: '严重度', enumValues: ['low', 'medium', 'high', 'critical'] },
        { name: 'detectedAt', type: 'datetime', label: '发现时间', required: true },
        { name: 'description', type: 'string', label: '描述' },
        { name: 'status', type: 'enum', label: '状态', enumValues: ['open', 'mitigating', 'resolved'] },
      ]),
    },
    {
      typeKey: 'Budget', displayName: '预算额度', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '名称', required: true },
        { name: 'totalUsd', type: 'number', label: '总额(USD)' },
        { name: 'spentUsd', type: 'number', label: '已用(USD)' },
      ]),
    },
  ],
  links: [
    { linkKey: 'supplier_supplies_po', displayName: '供应商供货', fromType: 'Supplier', toType: 'PurchaseOrder', cardinality: '1:N' },
    { linkKey: 'facility_holds_lot', displayName: '仓库存放库存', fromType: 'Facility', toType: 'InventoryLot', cardinality: '1:N' },
    { linkKey: 'shipment_fulfills_po', displayName: '货运履行采购单', fromType: 'Shipment', toType: 'PurchaseOrder', cardinality: 'N:1' },
    { linkKey: 'disruption_affects_shipment', displayName: '异常影响货运', fromType: 'Disruption', toType: 'Shipment', cardinality: '1:N' },
    { linkKey: 'po_supports_so', displayName: '采购支持销售单', fromType: 'PurchaseOrder', toType: 'SalesOrder', cardinality: 'N:M' },
    { linkKey: 'facility_serves_so', displayName: '仓库服务销售单', fromType: 'Facility', toType: 'SalesOrder', cardinality: '1:N' },
    { linkKey: 'window_at_facility', displayName: '产能窗口属于仓库', fromType: 'CapacityWindow', toType: 'Facility', cardinality: 'N:1' },
    { linkKey: 'budget_tracks_action', displayName: '预算约束处置', fromType: 'Budget', toType: 'Disruption', cardinality: '1:N' },
  ],
  rules: [
    {
      ruleKey: 'sc_inventory_coverage_days',
      name: '库存可覆盖天数',
      kind: 'derived_metric',
      expression: 'coalesce(object.availableQty, 0) / max(coalesce(object.dailyDemand, 1), 1)',
      outputType: 'number',
    },
    {
      ruleKey: 'sc_expedite_cost_score',
      name: '加急成本得分',
      kind: 'derived_metric',
      expression: 'clamp(100 - coalesce(object.expediteCostUsd, 0) / 50, 0, 100)',
      outputType: 'number',
    },
    {
      ruleKey: 'sc_delay_is_serious',
      name: '延迟是否严重',
      kind: 'trigger',
      scopeType: 'Disruption',
      expression: 'coalesce(object.delayDays, 0) >= 3',
      testCases: [{ input: { object: { delayDays: 5 } }, expected: true }, { input: { object: { delayDays: 1 } }, expected: false }],
    },
  ],
  actionTypes: [
    {
      actionKey: 'sc_create_disruption_case',
      name: '创建异常处置案例',
      description: '从异常事件创建决策案例',
      paramsSchema: { type: 'object', required: ['disruptionId', 'title'], properties: { disruptionId: { type: 'string' }, title: { type: 'string' } } },
      preconditions: [],
      writeSet: [],
      requiredRoles: ['analyst', 'admin'],
      approvalPolicy: {},
    },
    {
      actionKey: 'sc_transfer_inventory',
      name: '跨仓调拨',
      description: '将库存从源仓调拨到目标仓',
      paramsSchema: {
        type: 'object', required: ['objectId', 'targetFacility', 'quantity', 'costUsd'],
        properties: {
          objectId: { type: 'string' }, targetFacility: { type: 'string' },
          quantity: { type: 'number' }, costUsd: { type: 'number' }, etaDays: { type: 'number' },
        },
      },
      preconditions: [
        'params.quantity > 0',
        'params.costUsd >= 0',
      ],
      // 写回目标是案例根对象（Disruption）：status 必须落在 open/mitigating/resolved 枚举内
      writeSet: [
        { op: 'update', objectId: '${params.objectId}', payload: { status: 'mitigating', targetFacility: '${params.targetFacility}', transferQty: '${params.quantity}' } },
      ],
      requiredRoles: ['operator', 'admin'],
      approvalPolicy: { requiredRoles: ['approver'] },
      externalEffects: [
        { target: 'warehouse.wms', template: '{"event":"transfer","lot":"${params.objectId}","qty":${params.quantity}}' },
      ],
      compensation: { note: '若目标仓拒收，回滚库存状态并通知计划员' },
    },
    {
      actionKey: 'sc_expedite_shipment',
      name: '加急运输',
      description: '升级货运方式并支付加急费用',
      paramsSchema: {
        type: 'object', required: ['objectId', 'mode', 'costUsd'],
        properties: { objectId: { type: 'string' }, mode: { type: 'string' }, costUsd: { type: 'number' } },
      },
      preconditions: ['params.costUsd > 0'],
      // 写回 Disruption：status 仅允许 open/mitigating/resolved，运输方式写入扩展字段
      writeSet: [
        { op: 'update', objectId: '${params.objectId}', payload: { status: 'mitigating', transportMode: '${params.mode}', expediteCostUsd: '${params.costUsd}' } },
      ],
      requiredRoles: ['operator', 'admin'],
      approvalPolicy: { requiredRoles: ['approver'] },
      externalEffects: [
        { target: 'logistics.carrier', template: '{"event":"expedite","shipment":"${params.objectId}","mode":"${params.mode}"}' },
      ],
    },
    {
      actionKey: 'sc_alternative_procurement',
      name: '替代采购',
      description: '向替代供应商下采购单',
      paramsSchema: {
        type: 'object', required: ['supplierId', 'sku', 'quantity', 'costUsd'],
        properties: { supplierId: { type: 'string' }, sku: { type: 'string' }, quantity: { type: 'number' }, costUsd: { type: 'number' } },
      },
      preconditions: ['params.quantity > 0'],
      // 写回 Disruption：status 仅允许 open/mitigating/resolved
      writeSet: [
        { op: 'update', objectId: '${params.objectId}', payload: { status: 'mitigating', altSupplierId: '${params.supplierId}', altQty: '${params.quantity}' } },
      ],
      requiredRoles: ['operator', 'admin'],
      approvalPolicy: { requiredRoles: ['approver'] },
    },
    {
      actionKey: 'sc_hold_plan',
      name: '维持原计划',
      description: '不改变执行计划，仅记录监控',
      paramsSchema: { type: 'object', required: ['objectId'], properties: { objectId: { type: 'string' } } },
      preconditions: [],
      // 维持原计划：Disruption 保持 open，仅记录处置策略
      writeSet: [{ op: 'update', objectId: '${params.objectId}', payload: { status: 'open', planAction: 'hold' } }],
      requiredRoles: ['operator', 'analyst', 'admin'],
      approvalPolicy: {},
    },
    {
      actionKey: 'sc_update_capacity',
      name: '更新可用量',
      description: '更新库存或容量（模拟外部变化）',
      paramsSchema: {
        type: 'object', required: ['objectId', 'field', 'value'],
        properties: { objectId: { type: 'string' }, field: { type: 'string' }, value: { type: 'number' } },
      },
      preconditions: [],
      writeSet: [{ op: 'update', objectId: '${params.objectId}', payload: {} }],
      requiredRoles: ['operator', 'analyst', 'admin'],
      approvalPolicy: {},
    },
  ],
  decisionTypes: [
    {
      typeKey: 'sc_disruption_response',
      displayName: '供应链异常处置决策',
      description: '在订单交期、转运成本、替代供应风险和仓库容量之间选择措施',
      targetObjectType: 'Disruption',
      requiredFacts: ['delayDays', 'availableQty', 'customerDueDate'],
      roleMatrix: { propose: ['analyst', 'admin'], approve: ['approver', 'admin'], execute: ['operator', 'admin'] },
      policyVersion: 'sc-v1',
      criteria: [
        {
          key: 'service', name: '交期保障', direction: 'higher_better', weight: 50,
          normalize: 'min_max', unit: 'score',
          expression: 'coalesce(proposed[0].serviceScore, metrics.serviceScore, 50)',
          explanationTemplate: '交期保障得分越高，越能按客户交期交付',
        },
        {
          key: 'cost', name: '成本控制', direction: 'higher_better', weight: 30,
          normalize: 'min_max', unit: 'score',
          expression: 'coalesce(proposed[0].costScore, metrics.costScore, 50)',
          explanationTemplate: '成本控制得分越高，额外支出越低',
        },
        {
          key: 'risk', name: '执行稳健', direction: 'higher_better', weight: 20,
          normalize: 'min_max', unit: 'score',
          expression: 'coalesce(proposed[0].riskScore, metrics.riskScore, 50)',
          explanationTemplate: '执行稳健得分越高，实施失败风险越低',
        },
      ],
      constraints: [
        {
          key: 'sc_budget', name: '预算上限', severity: 'hard',
          expression: 'coalesce(proposed[0].costUsd, 0) <= 25000',
          message: '方案成本超过本次处置预算上限 25000 USD',
          basis: '采购政策 POL-SC-002',
        },
        {
          key: 'sc_supplier_qualified', name: '供应商资格', severity: 'hard',
          expression: 'coalesce(proposed[0].supplierQualified, true) == true',
          message: '替代供应商资格未满足（非 qualified 状态）',
          basis: '供应商管理规范',
        },
        {
          key: 'sc_capacity', name: '仓库容量', severity: 'hard',
          expression: 'coalesce(proposed[0].capacityOk, true) == true',
          message: '目标仓库容量不足',
          basis: '仓储运营手册',
        },
        {
          key: 'sc_lead_time', name: '最长可接受提前期', severity: 'soft',
          expression: 'coalesce(proposed[0].etaDays, 0) <= 10',
          message: '预计耗时超过 10 天（软约束）',
        },
        {
          key: 'sc_service_floor', name: '服务水平底线', severity: 'soft',
          expression: 'coalesce(proposed[0].serviceScore, 0) >= 40',
          message: '交期保障低于 40 分（软约束）',
        },
        {
          key: 'sc_risk_ceiling', name: '风险上限', severity: 'soft',
          expression: 'coalesce(proposed[0].riskScore, 0) >= 50',
          message: '执行稳健低于 50 分（软约束）',
        },
      ],
      approvalRoute: ['approver'],
    },
  ],
  objects: [
    { typeKey: 'Supplier', title: '华东精密制造', payload: { name: '华东精密制造', code: 'SUP-001', qualification: 'qualified', riskScore: 32, country: 'CN' } },
    { typeKey: 'Supplier', title: '南方替代供应商', payload: { name: '南方替代供应商', code: 'SUP-002', qualification: 'probation', riskScore: 58, country: 'CN' } },
    { typeKey: 'Facility', title: '上海中心仓', payload: { name: '上海中心仓', code: 'WH-SH', capacityUnits: 10000, usedUnits: 7200, region: '华东' } },
    { typeKey: 'Facility', title: '广州分仓', payload: { name: '广州分仓', code: 'WH-GZ', capacityUnits: 6000, usedUnits: 2100, region: '华南' } },
    { typeKey: 'InventoryLot', title: 'LOT-A1', payload: { name: 'LOT-A1', sku: 'SKU-1001', quantity: 800, availableQty: 320, qualityStatus: 'released', dailyDemand: 40, expiryDate: '2027-06-30T00:00:00Z' } },
    { typeKey: 'InventoryLot', title: 'LOT-B2', payload: { name: 'LOT-B2', sku: 'SKU-2002', quantity: 500, availableQty: 500, qualityStatus: 'released', dailyDemand: 25, expiryDate: '2027-03-31T00:00:00Z' } },
    { typeKey: 'PurchaseOrder', title: 'PO-2026-001', payload: { name: 'PO-2026-001', sku: 'SKU-1001', quantity: 1000, promisedEta: '2026-10-12T00:00:00Z', status: 'delayed', budgetUsd: 18000 } },
    { typeKey: 'PurchaseOrder', title: 'PO-2026-002', payload: { name: 'PO-2026-002', sku: 'SKU-2002', quantity: 600, promisedEta: '2026-10-20T00:00:00Z', status: 'open', budgetUsd: 9000 } },
    { typeKey: 'SalesOrder', title: 'SO-2026-101', payload: { name: 'SO-2026-101', sku: 'SKU-1001', quantity: 900, customerDueDate: '2026-10-18T00:00:00Z', priority: 'high', servicePenaltyUsd: 5000 } },
    { typeKey: 'SalesOrder', title: 'SO-2026-102', payload: { name: 'SO-2026-102', sku: 'SKU-2002', quantity: 400, customerDueDate: '2026-10-25T00:00:00Z', priority: 'normal', servicePenaltyUsd: 1200 } },
    { typeKey: 'Shipment', title: 'SHP-7781', payload: { name: 'SHP-7781', mode: 'sea', estimatedArrival: '2026-10-16T00:00:00Z', delayDays: 5, status: 'delayed', costUsd: 3200 } },
    { typeKey: 'CapacityWindow', title: '空运窗口 W1', payload: { name: '空运窗口 W1', startDate: '2026-10-11T00:00:00Z', endDate: '2026-10-14T00:00:00Z', availableUnits: 800, transportMode: 'air' } },
    { typeKey: 'Disruption', title: '供应商发货延迟', payload: { name: '供应商发货延迟', severity: 'high', detectedAt: '2026-10-10T08:00:00Z', description: 'SHP-7781 因港口拥堵预计延迟 5 天，影响 SO-2026-101 交期', status: 'open', delayDays: 5 } },
    { typeKey: 'Budget', title: 'Q4 应急预算', payload: { name: 'Q4 应急预算', totalUsd: 50000, spentUsd: 12000 } },
  ],
  linksData: [
    { linkKey: 'supplier_supplies_po', fromIndex: 0, toIndex: 6 },
    { linkKey: 'supplier_supplies_po', fromIndex: 1, toIndex: 7 },
    { linkKey: 'facility_holds_lot', fromIndex: 2, toIndex: 4 },
    { linkKey: 'facility_holds_lot', fromIndex: 3, toIndex: 5 },
    { linkKey: 'shipment_fulfills_po', fromIndex: 10, toIndex: 6 },
    { linkKey: 'disruption_affects_shipment', fromIndex: 12, toIndex: 10 },
    { linkKey: 'po_supports_so', fromIndex: 6, toIndex: 8 },
    { linkKey: 'facility_serves_so', fromIndex: 2, toIndex: 8 },
    { linkKey: 'window_at_facility', fromIndex: 11, toIndex: 2 },
    { linkKey: 'budget_tracks_action', fromIndex: 13, toIndex: 12 },
  ],
  sampleCase: {
    decisionTypeKey: 'sc_disruption_response',
    title: 'SHP-7781 延迟影响 SO-2026-101 处置',
    summary: '港口拥堵导致货运延迟 5 天，威胁客户交期，需在调拨、加急、替代采购与维持原计划之间选择。',
    triggerObjectIndex: 12,
    weights: { service: 50, cost: 30, risk: 20 },
    alternatives: [
      {
        name: '跨仓调拨',
        description: '从广州分仓调拨 LOT-B2 部分库存到上海中心仓，满足交期',
        proposedActions: [{
          actionKey: 'sc_transfer_inventory',
          serviceScore: 82, costScore: 64, riskScore: 85,
          costUsd: 12000, etaDays: 3, capacityOk: true, supplierQualified: true,
          params: { targetFacility: 'WH-GZ', quantity: 400, costUsd: 12000, etaDays: 3 },
        }],
      },
      {
        name: '加急运输',
        description: '将 SHP-7781 升级为空运，压缩运输时间',
        proposedActions: [{
          actionKey: 'sc_expedite_shipment',
          serviceScore: 93, costScore: 38, riskScore: 74,
          costUsd: 22000, etaDays: 2, capacityOk: true, supplierQualified: true,
          params: { mode: 'air', costUsd: 22000 },
        }],
      },
      {
        name: '维持原计划',
        description: '不采取额外措施，接受可能延迟并提前通知客户',
        proposedActions: [{
          actionKey: 'sc_hold_plan',
          serviceScore: 42, costScore: 95, riskScore: 58,
          costUsd: 0, etaDays: 5, capacityOk: true, supplierQualified: true,
          params: {},
        }],
      },
      {
        name: '替代采购',
        description: '向南方替代供应商下单（试用期资格未满，硬约束不满足）',
        proposedActions: [{
          actionKey: 'sc_alternative_procurement',
          serviceScore: 90, costScore: 72, riskScore: 68,
          costUsd: 15000, etaDays: 6, capacityOk: true, supplierQualified: false,
          params: { supplierId: 'SUP-ALT-01', sku: 'SKU-1001', quantity: 900, costUsd: 15000 },
        }],
      },
    ],
  },
};

// ============================================================
// 场景二：军事行动决策支持（合成演训样板，不含战术参数）
// ============================================================
const military: ScenarioPack = {
  key: 'military',
  name: '军事行动决策支持（演训）',
  description: '情报证据管理、态势研判、备选方案比较、授权命令流转与反馈的合成演训样板',
  types: [
    {
      typeKey: 'IntelReport', displayName: '情报报告', category: 'event',
      definition: props([
        { name: 'name', type: 'string', label: '报告编号', required: true },
        { name: 'sourceType', type: 'enum', label: '来源类型', enumValues: ['humint', 'osint', 'sigint', 'imagery'] },
        { name: 'observedAt', type: 'datetime', label: '采集时间', required: true },
        { name: 'confidence', type: 'number', label: '可信度', min: 0, max: 1 },
        { name: 'content', type: 'string', label: '内容摘要' },
        { name: 'classification', type: 'enum', label: '密级', enumValues: ['PUBLIC', 'CONFIDENTIAL', 'SECRET'] },
        { name: 'validHours', type: 'number', label: '有效时窗(小时)' },
      ]),
    },
    {
      typeKey: 'Observation', displayName: '观察结论', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '观察标识', required: true },
        { name: 'statement', type: 'string', label: '观察陈述', required: true },
        { name: 'status', type: 'enum', label: '证实状态', enumValues: ['unverified', 'corroborated', 'refuted', 'stale'] },
        { name: 'confidence', type: 'number', label: '置信度', min: 0, max: 1 },
      ]),
    },
    {
      typeKey: 'ThreatAssessment', displayName: '威胁评估', category: 'decision',
      definition: props([
        { name: 'name', type: 'string', label: '评估编号', required: true },
        { name: 'level', type: 'enum', label: '威胁等级', enumValues: ['low', 'medium', 'high', 'critical'] },
        { name: 'confidence', type: 'number', label: '置信度' },
        { name: 'unknowns', type: 'string', label: '未知项' },
        { name: 'assessedAt', type: 'datetime', label: '评估时间' },
      ]),
    },
    {
      typeKey: 'CourseOfAction', displayName: '应对方向', category: 'decision',
      definition: props([
        { name: 'name', type: 'string', label: '方向名称', required: true },
        { name: 'category', type: 'enum', label: '类别', enumValues: ['recon', 'defensive', 'support', 'schedule'] },
        { name: 'resourceNeed', type: 'string', label: '资源需求' },
        { name: 'expectedEffect', type: 'string', label: '预期影响' },
        { name: 'authorized', type: 'boolean', label: '是否已授权' },
      ]),
    },
    {
      typeKey: 'CommandOrder', displayName: '任务指令', category: 'decision',
      definition: props([
        { name: 'name', type: 'string', label: '指令编号', required: true },
        { name: 'content', type: 'string', label: '指令内容' },
        { name: 'issuedAt', type: 'datetime', label: '签发时间' },
        { name: 'status', type: 'enum', label: '状态', enumValues: ['draft', 'issued', 'acknowledged', 'completed', 'cancelled'] },
        { name: 'receiverRole', type: 'string', label: '接收角色' },
        { name: 'classification', type: 'enum', label: '密级', enumValues: ['CONFIDENTIAL', 'SECRET'] },
      ]),
    },
    {
      typeKey: 'Acknowledgement', displayName: '接收回执', category: 'event',
      definition: props([
        { name: 'name', type: 'string', label: '回执号', required: true },
        { name: 'receivedAt', type: 'datetime', label: '接收时间' },
        { name: 'receiverRole', type: 'string', label: '接收角色' },
        { name: 'orderId', type: 'reference', label: '任务指令 ID', refType: 'CommandOrder' },
        { name: 'note', type: 'string', label: '备注' },
      ]),
    },
    {
      typeKey: 'MissionObjective', displayName: '任务目标', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '目标名称', required: true },
        { name: 'priority', type: 'enum', label: '优先级', enumValues: ['primary', 'secondary'] },
        { name: 'description', type: 'string', label: '描述' },
      ]),
    },
    {
      typeKey: 'Capability', displayName: '可用能力', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '能力名称', required: true },
        { name: 'readiness', type: 'number', label: '战备程度', min: 0, max: 100 },
        { name: 'available', type: 'boolean', label: '是否可用' },
      ]),
    },
    {
      typeKey: 'OperationalConstraint', displayName: '行动约束', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '约束名', required: true },
        { name: 'kind', type: 'enum', label: '类型', enumValues: ['legal', 'authorization', 'resource', 'classification'] },
        { name: 'expression', type: 'string', label: '约束表达' },
        { name: 'description', type: 'string', label: '说明' },
      ]),
    },
    { typeKey: 'Operation', displayName: '演训行动', category: 'entity', definition: props([
      { name: 'name', type: 'string', label: '行动名称', required: true },
      { name: 'authorized', type: 'boolean', label: '已授权' },
      { name: 'validTo', type: 'datetime', label: '授权截止' },
    ]) },
    { typeKey: 'AreaOfInterest', displayName: '关注区域', category: 'entity', definition: props([
      { name: 'name', type: 'string', label: '区域名称', required: true },
      { name: 'classification', type: 'enum', label: '密级', enumValues: ['PUBLIC', 'CONFIDENTIAL', 'SECRET'] },
    ]) },
    { typeKey: 'SourceAssessment', displayName: '来源评估', category: 'decision', definition: props([
      { name: 'name', type: 'string', label: '评估名称', required: true },
      { name: 'confidence', type: 'number', label: '可信度', min: 0, max: 1 },
      { name: 'assessor', type: 'string', label: '评估人' },
    ]) },
    { typeKey: 'FriendlyCapability', displayName: '可用能力状态', category: 'entity', definition: props([
      { name: 'name', type: 'string', label: '能力名称', required: true },
      { name: 'available', type: 'boolean', label: '可用' },
      { name: 'validAt', type: 'datetime', label: '状态时间' },
    ]) },
    // 平台、驻地与活动事件只描述态势事实，不包含具体战术参数。
    { typeKey: 'MilitaryAircraft', displayName: '军机', category: 'entity', description: '战场态势中的有人或无人军用航空器', definition: props([
      { name: 'name', type: 'string', label: '名称', required: true },
      { name: 'aircraftClass', type: 'enum', label: '类别', enumValues: ['fighter', 'bomber', 'transport', 'reconnaissance', 'helicopter', 'unmanned', 'other'] },
      { name: 'affiliation', type: 'enum', label: '所属方', enumValues: ['friendly', 'hostile', 'neutral', 'unknown'] },
      { name: 'status', type: 'enum', label: '状态', enumValues: ['active', 'maintenance', 'unknown'] },
      { name: 'lastObservedAt', type: 'datetime', label: '最近观察时间' },
    ]) },
    { typeKey: 'Warship', displayName: '军舰', category: 'entity', description: '战场态势中的水面或水下军用舰艇', definition: props([
      { name: 'name', type: 'string', label: '名称', required: true },
      { name: 'shipClass', type: 'enum', label: '类别', enumValues: ['carrier', 'destroyer', 'frigate', 'submarine', 'amphibious', 'support', 'other'] },
      { name: 'affiliation', type: 'enum', label: '所属方', enumValues: ['friendly', 'hostile', 'neutral', 'unknown'] },
      { name: 'status', type: 'enum', label: '状态', enumValues: ['active', 'maintenance', 'unknown'] },
      { name: 'lastObservedAt', type: 'datetime', label: '最近观察时间' },
    ]) },
    { typeKey: 'WeaponSystem', displayName: '武器装备', category: 'entity', description: '可关联至军机或军舰的装备类别', definition: props([
      { name: 'name', type: 'string', label: '装备名称', required: true },
      { name: 'equipmentClass', type: 'enum', label: '装备类别', enumValues: ['missile', 'gun', 'air_defense', 'radar', 'electronic_warfare', 'other'] },
      { name: 'operatingDomain', type: 'enum', label: '应用范围', enumValues: ['air', 'sea', 'land', 'multi'] },
      { name: 'status', type: 'enum', label: '状态', enumValues: ['available', 'unavailable', 'unknown'] },
    ]) },
    { typeKey: 'MilitaryBase', displayName: '军事基地', category: 'entity', description: '军用机场或港口所属的基地', definition: props([
      { name: 'name', type: 'string', label: '基地名称', required: true },
      { name: 'baseClass', type: 'enum', label: '基地类别', enumValues: ['air', 'naval', 'joint', 'other'] },
      { name: 'affiliation', type: 'enum', label: '所属方', enumValues: ['friendly', 'hostile', 'neutral', 'unknown'] },
      { name: 'region', type: 'string', label: '所在区域' },
    ]) },
    { typeKey: 'MilitaryAirfield', displayName: '军用机场', category: 'entity', description: '军机起降或驻扎的机场', definition: props([
      { name: 'name', type: 'string', label: '机场名称', required: true },
      { name: 'affiliation', type: 'enum', label: '所属方', enumValues: ['friendly', 'hostile', 'neutral', 'unknown'] },
      { name: 'region', type: 'string', label: '所在区域' },
      { name: 'status', type: 'enum', label: '状态', enumValues: ['open', 'restricted', 'closed', 'unknown'] },
    ]) },
    { typeKey: 'MilitaryPort', displayName: '港口', category: 'entity', description: '军舰停靠或出入的港口', definition: props([
      { name: 'name', type: 'string', label: '港口名称', required: true },
      { name: 'affiliation', type: 'enum', label: '所属方', enumValues: ['friendly', 'hostile', 'neutral', 'unknown'] },
      { name: 'region', type: 'string', label: '所在区域' },
      { name: 'status', type: 'enum', label: '状态', enumValues: ['open', 'restricted', 'closed', 'unknown'] },
    ]) },
    { typeKey: 'AircraftActivity', displayName: '军机活动事件', category: 'event', description: '军机起降、发现或状态变化记录', definition: props([
      { name: 'name', type: 'string', label: '事件名称', required: true },
      { name: 'eventKind', type: 'enum', label: '事件类别', enumValues: ['detected', 'takeoff', 'landing', 'status_change', 'other'] },
      { name: 'occurredAt', type: 'datetime', label: '发生时间', required: true },
      { name: 'summary', type: 'string', label: '事件摘要' },
      { name: 'confidence', type: 'number', label: '置信度', min: 0, max: 1 },
    ]) },
    { typeKey: 'WarshipActivity', displayName: '军舰活动事件', category: 'event', description: '军舰出入港、发现或状态变化记录', definition: props([
      { name: 'name', type: 'string', label: '事件名称', required: true },
      { name: 'eventKind', type: 'enum', label: '事件类别', enumValues: ['detected', 'departure', 'arrival', 'status_change', 'other'] },
      { name: 'occurredAt', type: 'datetime', label: '发生时间', required: true },
      { name: 'summary', type: 'string', label: '事件摘要' },
      { name: 'confidence', type: 'number', label: '置信度', min: 0, max: 1 },
    ]) },
  ],
  links: [
    { linkKey: 'report_supports_observation', displayName: '报告支持观察', fromType: 'IntelReport', toType: 'Observation', cardinality: 'N:M' },
    { linkKey: 'report_refutes_observation', displayName: '报告反驳观察', fromType: 'IntelReport', toType: 'Observation', cardinality: 'N:M' },
    { linkKey: 'assessment_cites_observation', displayName: '评估引用观察', fromType: 'ThreatAssessment', toType: 'Observation', cardinality: 'N:M' },
    { linkKey: 'assessment_considers_coa', displayName: '评估比较应对方向', fromType: 'ThreatAssessment', toType: 'CourseOfAction', cardinality: 'N:M' },
    { linkKey: 'coa_uses_capability', displayName: '方案调用能力', fromType: 'CourseOfAction', toType: 'Capability', cardinality: 'N:M' },
    { linkKey: 'order_implements_coa', displayName: '指令落实方案', fromType: 'CommandOrder', toType: 'CourseOfAction', cardinality: 'N:1' },
    { linkKey: 'ack_for_order', displayName: '回执关联指令', fromType: 'Acknowledgement', toType: 'CommandOrder', cardinality: 'N:1' },
    { linkKey: 'observation_in_area', displayName: '观察关联区域', fromType: 'Observation', toType: 'AreaOfInterest', cardinality: 'N:M' },
    { linkKey: 'source_assesses_report', displayName: '来源评估引用报告', fromType: 'SourceAssessment', toType: 'IntelReport', cardinality: 'N:M' },
    { linkKey: 'operation_has_objective', displayName: '行动关联目标', fromType: 'Operation', toType: 'MissionObjective', cardinality: '1:N' },
    { linkKey: 'aircraft_based_at_airfield', displayName: '军机驻扎机场', fromType: 'MilitaryAircraft', toType: 'MilitaryAirfield', cardinality: 'N:1' },
    { linkKey: 'airfield_part_of_base', displayName: '机场隶属基地', fromType: 'MilitaryAirfield', toType: 'MilitaryBase', cardinality: 'N:1' },
    { linkKey: 'warship_homeported_at_port', displayName: '军舰母港', fromType: 'Warship', toType: 'MilitaryPort', cardinality: 'N:1' },
    { linkKey: 'port_part_of_base', displayName: '港口隶属基地', fromType: 'MilitaryPort', toType: 'MilitaryBase', cardinality: 'N:1' },
    { linkKey: 'aircraft_uses_weapon', displayName: '军机配备装备', fromType: 'MilitaryAircraft', toType: 'WeaponSystem', cardinality: 'N:M' },
    { linkKey: 'warship_uses_weapon', displayName: '军舰配备装备', fromType: 'Warship', toType: 'WeaponSystem', cardinality: 'N:M' },
    { linkKey: 'aircraft_activity_involves_aircraft', displayName: '军机事件涉及军机', fromType: 'AircraftActivity', toType: 'MilitaryAircraft', cardinality: 'N:M' },
    { linkKey: 'aircraft_activity_at_warship', displayName: '军机事件发生于军舰', fromType: 'AircraftActivity', toType: 'Warship', cardinality: 'N:1' },
    { linkKey: 'warship_activity_involves_warship', displayName: '军舰事件涉及军舰', fromType: 'WarshipActivity', toType: 'Warship', cardinality: 'N:M' },
    { linkKey: 'aircraft_activity_at_airfield', displayName: '军机事件发生于机场', fromType: 'AircraftActivity', toType: 'MilitaryAirfield', cardinality: 'N:1' },
    { linkKey: 'warship_activity_at_port', displayName: '军舰事件发生于港口', fromType: 'WarshipActivity', toType: 'MilitaryPort', cardinality: 'N:1' },
    { linkKey: 'aircraft_activity_in_area', displayName: '军机事件关联区域', fromType: 'AircraftActivity', toType: 'AreaOfInterest', cardinality: 'N:M' },
    { linkKey: 'warship_activity_in_area', displayName: '军舰事件关联区域', fromType: 'WarshipActivity', toType: 'AreaOfInterest', cardinality: 'N:M' },
    { linkKey: 'report_describes_aircraft_activity', displayName: '报告描述军机事件', fromType: 'IntelReport', toType: 'AircraftActivity', cardinality: 'N:M' },
    { linkKey: 'report_describes_warship_activity', displayName: '报告描述军舰事件', fromType: 'IntelReport', toType: 'WarshipActivity', cardinality: 'N:M' },
  ],
  rules: [
    {
      ruleKey: 'mil_evidence_strength',
      name: '证据强度',
      kind: 'derived_metric',
      expression: 'clamp(coalesce(object.confidence, 0) * 100, 0, 100)',
      outputType: 'number',
    },
    {
      ruleKey: 'mil_needs_review',
      name: '需要复核',
      kind: 'trigger',
      scopeType: 'IntelReport',
      expression: 'coalesce(object.confidence, 1) < 0.5',
    },
  ],
  actionTypes: [
    {
      actionKey: 'mil_issue_order',
      name: '下达任务指令',
      description: '把批准的高层级方向转为 CommandOrder 并送达',
      paramsSchema: {
        type: 'object', required: ['objectId', 'coaObjectId', 'content', 'receiverRole'],
        properties: { objectId: { type: 'string' }, coaObjectId: { type: 'string' },
          content: { type: 'string' }, receiverRole: { type: 'string' }, classification: { type: 'string' } },
      },
      preconditions: ['params.content != null'],
      // 下达指令应生成 CommandOrder 实例（status 枚举 draft/issued/acknowledged/completed/cancelled）
      writeSet: [
        { op: 'create', type: 'CommandOrder', payload: { name: 'CMD-${params.objectId}',
          content: '${params.content}', receiverRole: '${params.receiverRole}', status: 'issued' } },
        { op: 'link', linkKey: 'order_implements_coa', fromObjectId: '${results.0.objectId}',
          toObjectId: '${params.coaObjectId}' },
        { op: 'update', objectId: '${params.objectId}', payload: { orderIssued: true } },
      ],
      requiredRoles: ['commander', 'admin'],
      approvalPolicy: { requiredRoles: ['commander'], relatedObjectParam: 'coaObjectId',
        relatedObjectType: 'CourseOfAction', relatedRequiredField: 'authorized', relatedRequiredValue: true },
      externalEffects: [{ target: 'command.channel', template: '{"event":"issue_order","orderId":"${results.0.objectId}","receiverRole":"${params.receiverRole}"}' }],
    },
    {
      actionKey: 'mil_ack_order',
      name: '记录接收回执',
      description: '收集命令接收确认',
      paramsSchema: { type: 'object', required: ['objectId', 'receiverRole'], properties: { objectId: { type: 'string' }, receiverRole: { type: 'string' } } },
      preconditions: ['object.status == "issued"', 'object.receiverRole == params.receiverRole'],
      // 回执应生成 Acknowledgement 实例，避免覆写根对象字段
      writeSet: [
        { op: 'create', type: 'Acknowledgement', payload: { name: 'ACK-${params.objectId}',
          orderId: '${params.objectId}', receiverRole: '${params.receiverRole}', note: '接收确认' } },
        { op: 'link', linkKey: 'ack_for_order', fromObjectId: '${results.0.objectId}',
          toObjectId: '${params.objectId}' },
        { op: 'update', objectId: '${params.objectId}', payload: { status: 'acknowledged' } },
      ],
      requiredRoles: ['operator', 'commander', 'admin'],
      approvalPolicy: {},
    },
  ],
  decisionTypes: [
    {
      typeKey: 'mil_threat_response',
      displayName: '威胁评估与应对决策',
      description: '从新情报事件形成威胁评估，比较应对方向，由有权指挥员批准并下达指令',
      targetObjectType: 'IntelReport',
      requiredFacts: ['confidence', 'observedAt'],
      roleMatrix: { propose: ['intelligence', 'analyst', 'admin'], approve: ['commander', 'admin'], execute: ['commander', 'operator', 'admin'] },
      policyVersion: 'mil-v1',
      criteria: [
        { key: 'mission', name: '任务完成度', direction: 'higher_better', weight: 40, normalize: 'min_max', expression: 'coalesce(proposed[0].missionScore, 50)' },
        { key: 'resource', name: '资源占用', direction: 'higher_better', weight: 25, normalize: 'min_max', expression: 'coalesce(proposed[0].resourceScore, 50)' },
        { key: 'time', name: '时效', direction: 'higher_better', weight: 15, normalize: 'min_max', expression: 'coalesce(proposed[0].timeScore, 50)' },
        { key: 'safety', name: '安全影响', direction: 'higher_better', weight: 20, normalize: 'min_max', expression: 'coalesce(proposed[0].safetyScore, 50)' },
      ],
      constraints: [
        {
          key: 'mil_authorization', name: '授权约束', severity: 'hard',
          expression: 'coalesce(proposed[0].authorized, false) == true',
          message: '方案缺少适用授权，不可下发',
          basis: '演训授权规则 AUT-MIL-01',
        },
        {
          key: 'mil_resource', name: '资源可用性', severity: 'hard',
          expression: 'coalesce(proposed[0].resourceOk, false) == true',
          message: '所需资源不可用',
        },
        {
          key: 'mil_info_integrity', name: '情报完整性', severity: 'hard',
          expression: 'coalesce(proposed[0].intelComplete, false) == true',
          message: '情报证据缺口过大，不能仅凭总分形成执行指令',
        },
        {
          key: 'mil_time_window', name: '时间窗口', severity: 'soft',
          expression: 'coalesce(proposed[0].hoursNeeded, 0) <= 48',
          message: '预计耗时超过 48 小时',
        },
      ],
      approvalRoute: ['commander'],
    },
  ],
  objects: [
    { typeKey: 'IntelReport', title: 'RPT-001', securityLabels: ['CONFIDENTIAL'], payload: { name: 'RPT-001', sourceType: 'humint', observedAt: '2026-10-09T14:00:00Z', confidence: 0.72, content: '某区域出现异常活动迹象（合成演训数据）', classification: 'CONFIDENTIAL', validHours: 24 } },
    { typeKey: 'IntelReport', title: 'RPT-002', securityLabels: ['CONFIDENTIAL'], payload: { name: 'RPT-002', sourceType: 'osint', observedAt: '2026-10-09T18:30:00Z', confidence: 0.41, content: '公开来源显示该区域平静，与 RPT-001 存在矛盾（合成演训数据）', classification: 'CONFIDENTIAL', validHours: 48 } },
    { typeKey: 'Observation', title: 'OBS-A', securityLabels: ['CONFIDENTIAL'], payload: { name: 'OBS-A', statement: '区域活动水平上升', status: 'unverified', confidence: 0.55 } },
    { typeKey: 'ThreatAssessment', title: 'TA-001', securityLabels: ['SECRET'], payload: { name: 'TA-001', level: 'medium', confidence: 0.55, unknowns: '缺少实时影像核实；来源可信度不一致', assessedAt: '2026-10-10T02:00:00Z' } },
    { typeKey: 'CourseOfAction', title: '继续侦察核实', payload: { name: '继续侦察核实', category: 'recon', resourceNeed: '侦察单元 1 支', expectedEffect: '提高置信度，消除矛盾', authorized: true } },
    { typeKey: 'CourseOfAction', title: '加强防护准备', payload: { name: '加强防护准备', category: 'defensive', resourceNeed: '值班力量加强', expectedEffect: '降低突发风险', authorized: true } },
    { typeKey: 'CourseOfAction', title: '请求协同支援', payload: { name: '请求协同支援', category: 'support', resourceNeed: '跨部门协同', expectedEffect: '扩大感知范围', authorized: false } },
    { typeKey: 'MissionObjective', title: '维护区域稳定', payload: { name: '维护区域稳定', priority: 'primary', description: '确保演训区域内安全态势可控' } },
    { typeKey: 'Capability', title: '侦察力量', payload: { name: '侦察力量', readiness: 78, available: true } },
    { typeKey: 'Capability', title: '协同渠道', payload: { name: '协同渠道', readiness: 45, available: false } },
  ],
  linksData: [
    { linkKey: 'report_supports_observation', fromIndex: 0, toIndex: 2 },
    { linkKey: 'report_refutes_observation', fromIndex: 1, toIndex: 2 },
    { linkKey: 'assessment_cites_observation', fromIndex: 3, toIndex: 2 },
    { linkKey: 'assessment_considers_coa', fromIndex: 3, toIndex: 4 },
    { linkKey: 'assessment_considers_coa', fromIndex: 3, toIndex: 5 },
    { linkKey: 'assessment_considers_coa', fromIndex: 3, toIndex: 6 },
    { linkKey: 'coa_uses_capability', fromIndex: 4, toIndex: 8 },
    { linkKey: 'coa_uses_capability', fromIndex: 6, toIndex: 9 },
  ],
  sampleCase: {
    decisionTypeKey: 'mil_threat_response',
    title: 'RPT-001/RPT-002 矛盾情报研判（指令闭环 v2）',
    summary: '两条相互矛盾的报告并存，需形成威胁评估，比较应对方向，并由指挥员批准。',
    triggerObjectIndex: 0,
    weights: { mission: 40, resource: 25, time: 15, safety: 20 },
    alternatives: [
      {
        name: '继续侦察核实',
        description: '派出侦察力量核实矛盾情报，提高置信度',
        proposedActions: [{
          actionKey: 'mil_issue_order',
          missionScore: 70, resourceScore: 60, timeScore: 55, safetyScore: 85,
          authorized: true, resourceOk: true, intelComplete: false, hoursNeeded: 12,
          params: { receiverRole: 'recon', content: '继续核查矛盾情报并回报' },
        }],
      },
      {
        name: '加强防护准备',
        description: '提高值班与防护等级，等待更多信息',
        proposedActions: [{
          actionKey: 'mil_issue_order',
          missionScore: 60, resourceScore: 45, timeScore: 80, safetyScore: 90,
          authorized: true, resourceOk: true, intelComplete: true, hoursNeeded: 2,
          params: { receiverRole: 'commander', content: '加强防护准备并持续复核情报' },
        }],
      },
      {
        name: '请求协同支援',
        description: '跨部门协同扩大感知（协同渠道当前不可用且未授权）',
        proposedActions: [{
          actionKey: 'mil_issue_order',
          missionScore: 85, resourceScore: 35, timeScore: 50, safetyScore: 70,
          authorized: false, resourceOk: false, intelComplete: true, hoursNeeded: 24,
          params: { receiverRole: 'joint', content: '请求协同支援并等待授权' },
        }],
      },
    ],
  },
};

// ============================================================
// 场景三：公共安全个案审查与响应（虚构个案）
// ============================================================
const publicSafety: ScenarioPack = {
  key: 'public-safety',
  name: '公共安全个案审查与响应',
  description: '虚构个案的事件核查、评估、响应比较与法定措施审查；不预设被关注人员有违法行为',
  types: [
    {
      typeKey: 'ObservedEvent', displayName: '观察事件', category: 'event',
      definition: props([
        { name: 'name', type: 'string', label: '事件编号', required: true },
        { name: 'eventTime', type: 'datetime', label: '事件时间', required: true },
        { name: 'location', type: 'string', label: '地点' },
        { name: 'description', type: 'string', label: '描述' },
        { name: 'verificationStatus', type: 'enum', label: '核实状态', enumValues: ['unverified', 'partial', 'verified', 'corrected'] },
        { name: 'purposeLimit', type: 'string', label: '用途限定' },
      ]),
    },
    {
      typeKey: 'SourceRecord', displayName: '来源记录', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '来源标识', required: true },
        { name: 'channel', type: 'enum', label: '渠道', enumValues: ['report', 'sensor', 'patrol', 'public'] },
        { name: 'reliability', type: 'number', label: '可靠性', min: 0, max: 1 },
        { name: 'retentionDays', type: 'number', label: '保留天数' },
        { name: 'authorizedUse', type: 'boolean', label: '是否授权用途' },
      ]),
    },
    {
      typeKey: 'RiskIndicator', displayName: '风险指标', category: 'decision',
      definition: props([
        { name: 'name', type: 'string', label: '指标名', required: true },
        { name: 'value', type: 'number', label: '指标值', min: 0, max: 100 },
        { name: 'basedOnEvent', type: 'string', label: '依据事件' },
        { name: 'ruleVersion', type: 'string', label: '规则版本' },
        { name: 'status', type: 'enum', label: '状态', enumValues: ['active', 'corrected', 'expired'] },
      ]),
    },
    {
      typeKey: 'Assessment', displayName: '个案评估', category: 'decision',
      definition: props([
        { name: 'name', type: 'string', label: '评估编号', required: true },
        { name: 'level', type: 'enum', label: '评估等级', enumValues: ['none', 'watch', 'elevated'] },
        { name: 'evidenceBasis', type: 'string', label: '事实依据' },
        { name: 'counterEvidence', type: 'string', label: '反证' },
        { name: 'gaps', type: 'string', label: '信息缺口' },
        { name: 'assessor', type: 'string', label: '评估人' },
        { name: 'reviewAt', type: 'datetime', label: '复核时间' },
      ]),
    },
    {
      typeKey: 'LegalAuthority', displayName: '法律授权', category: 'entity',
      definition: props([
        { name: 'name', type: 'string', label: '授权名称', required: true },
        { name: 'scope', type: 'string', label: '适用范围' },
        { name: 'validFrom', type: 'datetime', label: '生效' },
        { name: 'validTo', type: 'datetime', label: '失效' },
        { name: 'approverRole', type: 'string', label: '审批角色' },
        { name: 'active', type: 'boolean', label: '是否有效' },
      ]),
    },
    {
      typeKey: 'ResponseOption', displayName: '响应选项', category: 'decision',
      definition: props([
        { name: 'name', type: 'string', label: '选项名', required: true },
        { name: 'impactLevel', type: 'enum', label: '影响程度', enumValues: ['none', 'low', 'medium', 'high'] },
        { name: 'requiresAuthority', type: 'boolean', label: '是否需法定授权' },
        { name: 'proportionalityNote', type: 'string', label: '比例性说明' },
      ]),
    },
    {
      typeKey: 'FollowUpTask', displayName: '跟进任务', category: 'event',
      definition: props([
        { name: 'name', type: 'string', label: '任务名', required: true },
        { name: 'dueAt', type: 'datetime', label: '截止' },
        { name: 'status', type: 'enum', label: '状态', enumValues: ['open', 'done', 'cancelled'] },
        { name: 'assignee', type: 'string', label: '负责人' },
      ]),
    },
    {
      typeKey: 'SafetyCase', displayName: '公共安全个案', category: 'decision',
      definition: props([
        { name: 'name', type: 'string', label: '个案编号', required: true },
        { name: 'status', type: 'enum', label: '状态', enumValues: ['intake', 'review', 'monitoring', 'closed'] },
        { name: 'openedAt', type: 'datetime', label: '开启时间' },
        { name: 'purposeStatement', type: 'string', label: '目的声明' },
      ]),
    },
    { typeKey: 'Subject', displayName: '个案主体', category: 'entity', definition: props([
      { name: 'name', type: 'string', label: '主体代号', required: true, sensitive: 'PII' },
      { name: 'id_number', type: 'string', label: '身份号码', sensitive: 'PII' },
      { name: 'context', type: 'string', label: '背景说明' },
    ]) },
    { typeKey: 'Corroboration', displayName: '独立佐证或反证', category: 'event', definition: props([
      { name: 'name', type: 'string', label: '佐证名称', required: true },
      { name: 'stance', type: 'enum', label: '证据立场', enumValues: ['support', 'refute'] },
      { name: 'sourceRef', type: 'string', label: '来源引用' },
    ]) },
    { typeKey: 'ContextFactor', displayName: '上下文因素', category: 'entity', definition: props([
      { name: 'name', type: 'string', label: '因素名称', required: true },
      { name: 'explanation', type: 'string', label: '解释' },
    ]) },
    { typeKey: 'ReviewRequest', displayName: '人工核查请求', category: 'event', definition: props([
      { name: 'name', type: 'string', label: '请求名称', required: true },
      { name: 'status', type: 'enum', label: '状态', enumValues: ['open', 'reviewed', 'cancelled'] },
      { name: 'subjectObjectId', type: 'string', label: '对象 ID' },
      { name: 'reason', type: 'string', label: '触发理由' },
    ]) },
    { typeKey: 'InterventionRecord', displayName: '法定措施记录', category: 'event', definition: props([
      { name: 'name', type: 'string', label: '记录名称', required: true },
      { name: 'authorityId', type: 'string', label: '授权对象 ID', sensitive: 'LEGAL' },
      { name: 'status', type: 'string', label: '执行状态' },
    ]) },
  ],
  links: [
    { linkKey: 'event_from_source', displayName: '事件来自来源', fromType: 'ObservedEvent', toType: 'SourceRecord', cardinality: 'N:1' },
    { linkKey: 'indicator_based_on_event', displayName: '指标依据事件', fromType: 'RiskIndicator', toType: 'ObservedEvent', cardinality: 'N:1' },
    { linkKey: 'assessment_uses_indicator', displayName: '评估引用指标', fromType: 'Assessment', toType: 'RiskIndicator', cardinality: 'N:M' },
    { linkKey: 'option_requires_authority', displayName: '选项需要授权', fromType: 'ResponseOption', toType: 'LegalAuthority', cardinality: 'N:M' },
    { linkKey: 'case_has_event', displayName: '个案包含事件', fromType: 'SafetyCase', toType: 'ObservedEvent', cardinality: '1:N' },
    { linkKey: 'task_for_case', displayName: '任务属于个案', fromType: 'FollowUpTask', toType: 'SafetyCase', cardinality: 'N:1' },
    { linkKey: 'event_has_subject', displayName: '事件关联主体', fromType: 'ObservedEvent', toType: 'Subject', cardinality: 'N:M' },
    { linkKey: 'corroboration_for_assessment', displayName: '佐证用于评估', fromType: 'Corroboration', toType: 'Assessment', cardinality: 'N:M' },
    { linkKey: 'review_for_event', displayName: '核查请求关联事件', fromType: 'ReviewRequest', toType: 'ObservedEvent', cardinality: 'N:1' },
    { linkKey: 'intervention_authorized_by', displayName: '措施依据授权', fromType: 'InterventionRecord', toType: 'LegalAuthority', cardinality: 'N:1' },
  ],
  rules: [
    {
      ruleKey: 'ps_single_source_flag',
      name: '单一来源提示',
      kind: 'trigger',
      scopeType: 'ObservedEvent',
      description: '仅提示事件来源数为 1，需人工核查；不证明异常行为成立。',
      expression: 'coalesce(object.sourceCount, 1) == 1',
    },
    {
      ruleKey: 'ps_freshness_score',
      name: '信息新鲜度',
      kind: 'derived_metric',
      expression: 'clamp(100 - coalesce(object.ageDays, 0) * 10, 0, 100)',
    },
  ],
  actionTypes: [
    {
      actionKey: 'ps_create_review_request',
      name: '创建核查请求',
      description: '规则命中后创建 ReviewRequest，仅进入核查队列',
      paramsSchema: { type: 'object', required: ['objectId', 'reason'], properties: { objectId: { type: 'string' }, reason: { type: 'string' } } },
      preconditions: ['params.reason != null'],
      // 核查请求生成 FollowUpTask（status 枚举 open/done/cancelled），不在根对象上写非法 status
      writeSet: [
        { op: 'create', type: 'FollowUpTask', payload: { name: 'REVIEW-${params.reason}', status: 'open', assignee: 'review-queue' } },
        { op: 'update', objectId: '${params.objectId}', payload: { reviewStatus: 'requested', reviewReason: '${params.reason}' } },
      ],
      // 与 ps_case_response.roleMatrix.execute 对齐，避免执行人无法落地选定方案
      requiredRoles: ['operator', 'legal', 'safety_officer', 'analyst', 'admin'],
      approvalPolicy: {},
    },
    {
      actionKey: 'ps_create_followup',
      name: '派发跟进任务',
      description: '派发经批准的跟进任务',
      paramsSchema: { type: 'object', required: ['objectId', 'assignee'], properties: { objectId: { type: 'string' }, assignee: { type: 'string' } } },
      preconditions: [],
      // 跟进任务生成 FollowUpTask 实例
      writeSet: [
        { op: 'create', type: 'FollowUpTask', payload: { name: 'FU-${params.objectId}', status: 'open', assignee: '${params.assignee}' } },
        { op: 'update', objectId: '${params.objectId}', payload: { followupAssignee: '${params.assignee}' } },
      ],
      requiredRoles: ['operator', 'legal', 'safety_officer', 'admin'],
      approvalPolicy: { requiredRoles: ['safety_officer'] },
    },
    {
      actionKey: 'ps_record_intervention',
      name: '记录法定措施',
      description: '仅记录批准和执行状态，由有权限机构办理',
      paramsSchema: {
        type: 'object', required: ['objectId', 'legalAuthorityId'],
        properties: { objectId: { type: 'string' }, legalAuthorityId: { type: 'string' }, note: { type: 'string' } },
      },
      preconditions: ['params.legalAuthorityId != null'],
      // 仅记录法定措施状态到扩展字段，不覆写 ObservedEvent.verificationStatus
      writeSet: [
        { op: 'update', objectId: '${params.objectId}', payload: { interventionStatus: 'recorded', legalAuthorityId: '${params.legalAuthorityId}' } },
      ],
      // 法定措施仅限法务角色，与 roleMatrix.execute 中的 legal 对齐
      requiredRoles: ['legal', 'admin'],
      approvalPolicy: {
        requiredRoles: ['legal'], legalAuthorityParam: 'legalAuthorityId',
        requiredAuthorityType: 'LegalAuthority', requireVerifiedField: 'verificationStatus',
      },
    },
  ],
  decisionTypes: [
    {
      typeKey: 'ps_case_response',
      displayName: '公共安全个案响应决策',
      description: '比较不采取进一步行动、补充核实、转交专责部门、申请法定响应等选项',
      triggerConfig: { requiredPurpose: 'public_safety_review' },
      targetObjectType: 'ObservedEvent',
      requiredFacts: ['eventTime', 'verificationStatus'],
      roleMatrix: { propose: ['safety_officer', 'analyst', 'admin'], approve: ['safety_officer', 'legal', 'admin'], execute: ['operator', 'legal', 'admin'] },
      policyVersion: 'ps-v2',
      criteria: [
        { key: 'safety', name: '安全收益', direction: 'higher_better', weight: 40, normalize: 'min_max', expression: 'coalesce(proposed[0].safetyScore, 50)' },
        { key: 'proportionality', name: '比例性', direction: 'higher_better', weight: 35, normalize: 'min_max', expression: 'coalesce(proposed[0].proportionalityScore, 50)' },
        { key: 'burden', name: '负担成本', direction: 'higher_better', weight: 25, normalize: 'min_max', expression: 'coalesce(proposed[0].burdenScore, 50)' },
      ],
      constraints: [
        {
          key: 'ps_no_unverified_restriction', name: '未核实事件不得限制权利', severity: 'hard',
          expression: 'coalesce(proposed[0].isRestrictive, false) == false or coalesce(proposed[0].verified, false) == true',
          message: '单一未核实事件不能生成限制性措施的执行请求',
          basis: '隐私与公民自由原则 PC-01',
        },
        {
          key: 'ps_legal_authority', name: '法定授权有效', severity: 'hard',
          expression: 'coalesce(proposed[0].requiresAuthority, false) == false or coalesce(proposed[0].hasAuthority, false) == true',
          message: '缺少有效 LegalAuthority，拒绝生成限制性措施执行请求',
          basis: '法定措施审批流程',
        },
        {
          key: 'ps_purpose_limit', name: '用途限定', severity: 'hard',
          expression: 'coalesce(proposed[0].purposeOk, true) == true',
          message: '数据用途超出授权范围',
        },
        {
          key: 'ps_false_positive', name: '误报可降级', severity: 'soft',
          expression: 'coalesce(proposed[0].falsePositiveLikely, false) == false',
          message: '存在较高误报可能，建议补充核实',
        },
        {
          key: 'ps_review_deadline', name: '复审期限', severity: 'soft',
          expression: 'coalesce(proposed[0].reviewDays, 0) <= 30',
          message: '复审周期超过 30 天',
        },
      ],
      approvalRoute: ['safety_officer'],
    },
  ],
  objects: [
    { typeKey: 'SourceRecord', title: 'SRC-市民反映', payload: { name: 'SRC-市民反映', channel: 'report', reliability: 0.5, retentionDays: 180, authorizedUse: true } },
    { typeKey: 'SourceRecord', title: 'SRC-巡逻记录', payload: { name: 'SRC-巡逻记录', channel: 'patrol', reliability: 0.8, retentionDays: 365, authorizedUse: true } },
    { typeKey: 'ObservedEvent', title: '市民疑似异常行为反映-20261009-001', payload: { name: 'EVT-2026-001', eventTime: '2026-10-08T20:00:00Z', location: '虚构市示例广场', description: '市民反映某人行为异常（虚构误报示例）', verificationStatus: 'unverified', purposeLimit: '公共安全核查', sourceCount: 1, ageDays: 2 } },
    { typeKey: 'ObservedEvent', title: '广场巡逻未见异常-20261009-002', payload: { name: 'EVT-2026-002', eventTime: '2026-10-09T10:00:00Z', location: '虚构市示例广场', description: '巡逻记录显示该时段一切正常（反证）', verificationStatus: 'verified', purposeLimit: '公共安全核查', sourceCount: 1, ageDays: 1 } },
    { typeKey: 'RiskIndicator', title: '单源行为线索指标-20261009-001', payload: { name: 'RI-行为异常', value: 45, basedOnEvent: 'EVT-2026-001', status: 'active' } },
    { typeKey: 'Assessment', title: 'ASSESS-001', payload: { name: 'ASSESS-001', level: 'none', evidenceBasis: '仅有一条未经核实的市民反映', counterEvidence: '巡逻记录显示无异常', gaps: '缺少独立可核查来源', assessor: '值班人员', reviewAt: '2026-10-15T00:00:00Z' } },
    { typeKey: 'LegalAuthority', title: '法定措施授权 A', payload: { name: '法定措施授权 A', scope: '仅限经核实的重大公共安全风险', validFrom: '2026-01-01T00:00:00Z', validTo: '2026-12-31T00:00:00Z', approverRole: 'legal', active: true } },
    { typeKey: 'ResponseOption', title: '继续观察', payload: { name: '继续观察', impactLevel: 'none', requiresAuthority: false, proportionalityNote: '影响最小' } },
    { typeKey: 'ResponseOption', title: '补充核实', payload: { name: '补充核实', impactLevel: 'low', requiresAuthority: false, proportionalityNote: '在合法范围内进一步核实' } },
    { typeKey: 'ResponseOption', title: '申请法定措施', payload: { name: '申请法定措施', impactLevel: 'high', requiresAuthority: true, proportionalityNote: '须具备法定授权与必要性' } },
    { typeKey: 'SafetyCase', title: '公共安全核查个案-20261009-001', payload: { name: 'PS-2026-001', status: 'review', openedAt: '2026-10-09T08:00:00Z', purposeStatement: '依法核查可能影响公共安全的行为事件' } },
  ],
  linksData: [
    { linkKey: 'event_from_source', fromIndex: 2, toIndex: 0 },
    { linkKey: 'event_from_source', fromIndex: 3, toIndex: 1 },
    { linkKey: 'indicator_based_on_event', fromIndex: 4, toIndex: 2 },
    { linkKey: 'case_has_event', fromIndex: 10, toIndex: 2 },
    { linkKey: 'case_has_event', fromIndex: 10, toIndex: 3 },
    { linkKey: 'option_requires_authority', fromIndex: 9, toIndex: 6 },
  ],
  sampleCase: {
    decisionTypeKey: 'ps_case_response',
    title: 'EVT-2026-001 虚构误报个案审查',
    summary: '单一未经核实的市民反映，巡逻反证显示无异常；比较继续观察、补充核实、申请法定措施。',
    triggerObjectIndex: 2,
    weights: { safety: 40, proportionality: 35, burden: 25 },
    alternatives: [
      {
        name: '继续观察',
        description: '不采取进一步行动，保留监控但不介入',
        proposedActions: [{
          actionKey: 'ps_create_followup',
          safetyScore: 40, proportionalityScore: 95, burdenScore: 90,
          isRestrictive: false, requiresAuthority: false, hasAuthority: true, purposeOk: true,
          verified: false, falsePositiveLikely: true, reviewDays: 7,
          params: { assignee: 'patrol-a' },
        }],
      },
      {
        name: '补充核实',
        description: '要求独立可核查来源，消除误报可能',
        proposedActions: [{
          actionKey: 'ps_create_review_request',
          safetyScore: 70, proportionalityScore: 85, burdenScore: 65,
          isRestrictive: false, requiresAuthority: false, hasAuthority: true, purposeOk: true,
          verified: false, falsePositiveLikely: true, reviewDays: 3,
          params: { reason: '单一来源需独立核实' },
        }],
      },
      {
        name: '转交专责部门',
        description: '移交专责部门依法办理，系统仅记录流转',
        proposedActions: [{
          actionKey: 'ps_create_followup',
          safetyScore: 75, proportionalityScore: 70, burdenScore: 55,
          isRestrictive: false, requiresAuthority: false, hasAuthority: true, purposeOk: true,
          verified: false, falsePositiveLikely: true, reviewDays: 14,
          params: { assignee: 'special-unit' },
        }],
      },
      {
        name: '申请法定措施',
        description: '因事件未核实且缺少必要性，硬约束应拒绝',
        proposedActions: [{
          actionKey: 'ps_record_intervention',
          safetyScore: 88, proportionalityScore: 30, burdenScore: 25,
          isRestrictive: true, requiresAuthority: true, hasAuthority: false, purposeOk: true,
          verified: false, falsePositiveLikely: true, reviewDays: 30,
          params: { legalAuthorityId: 'LA-PENDING', note: '未核实不启动' },
        }],
      },
    ],
  },
};

export const scenarioPacks: ScenarioPack[] = [supplyChain, military, publicSafety];
