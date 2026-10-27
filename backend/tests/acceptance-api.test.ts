// 通过 HTTP 契约验证导入、定向、比选、审批、执行、结果和回放。
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';
import express from 'express';
import type { Server } from 'http';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ooda-acceptance-'));
process.env.DATABASE_PATH = path.join(tempDir, 'ontology.db');
process.env.ATTACHMENT_DIR = path.join(tempDir, 'attachments');
process.env.JWT_SECRET = 'acceptance-test-secret';

let server: Server;
let base = '';
const tokens: Record<string, string> = {};

async function request(method: string, url: string, user?: string, body?: unknown, domainId = 'dom_existing') {
  const response = await fetch(`${base}/api${url}`, {
    method,
    headers: { ...(user ? { Authorization: `Bearer ${tokens[user]}`, 'X-Domain-Id': domainId } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json() as any;
  return { status: response.status, data };
}

before(async () => {
  const { runMigrations } = require('../src/db/migrate');
  runMigrations();
  const { seedAll } = require('../src/seed/seed');
  seedAll();
  const { apiRouter } = require('../src/routes');
  const { requestContext, errorHandler } = require('../src/routes/middleware');
  const app = express();
  app.use(express.json());
  app.use(requestContext);
  app.use('/api', apiRouter);
  app.use(errorHandler);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as any).port}`;
  for (const name of ['admin', 'analyst', 'approver', 'operator', 'observer', 'legal', 'safety', 'intel', 'commander']) {
    const response = await request('POST', '/auth/login', undefined, { username: name, password: `${name}123` });
    assert.equal(response.status, 200, JSON.stringify(response.data));
    tokens[name] = response.data.token;
  }
});

test('对象密级、字段裁剪与案例导出权限', async () => {
  const military = await request('GET', '/objects?typeKey=IntelReport', 'admin');
  assert.equal(military.status, 200);
  const secretId = military.data.items[0].objectId;
  assert.equal((await request('GET', `/objects/${secretId}`, 'observer')).status, 403);
  const assessment = await request('GET', '/objects?typeKey=ThreatAssessment', 'admin');
  const secretAssessmentId = assessment.data.items[0].objectId;
  assert.equal((await request('PATCH', `/objects/${secretAssessmentId}`, 'analyst',
    { payload: { confidence: 0.9 }, expectedRevision: 1 })).status, 403);
  assert.equal((await request('POST', '/objects', 'analyst',
    { typeKey: 'Supplier', payload: {}, securityLabels: ['SECRET'] })).status, 403);
  assert.equal((await request('POST', '/objects', 'analyst',
    { typeKey: 'Supplier', payload: { phone: '123456' } })).status, 403);
  const hidden = await request('GET', '/objects?typeKey=IntelReport', 'observer');
  assert.equal(hidden.data.total, 0);
  const cases = await request('GET', '/cases?decisionTypeKey=mil_threat_response', 'admin');
  assert.equal((await request('GET', `/cases/${cases.data.items[0].id}/replay`, 'observer')).status, 403);

  const source = await request('POST', '/sources', 'admin', {
    sourceKey: 'security-test', externalKey: '1', observedAt: new Date().toISOString(),
    raw: { phone: '123456', event: 'test' },
  });
  assert.equal(source.status, 201);
  const visible = await request('GET', `/sources/${source.data.id}`, 'observer');
  assert.equal(visible.status, 200);
  assert.equal(visible.data.raw.phone, undefined);
});

test('案例标题拒绝编码替换字符', async () => {
  const response = await request('POST', '/cases', 'analyst', {
    title: 'E2E \uFFFD\uFFFD', decisionTypeKey: 'sc_disruption_response',
  });
  assert.equal(response.status, 400, JSON.stringify(response.data));
  assert.match(response.data.error.message, /UTF-8/);
});

test('演训样例快照包含指令所需的行动方案对象', () => {
  const { getDb } = require('../src/db/database');
  const sample = getDb().prepare(`SELECT id, owner FROM decision_case
    WHERE decision_type_key = 'mil_threat_response' ORDER BY created_at LIMIT 1`).get() as any;
  assert.equal(sample.owner, 'intel');
  const related = getDb().prepare(`SELECT COUNT(*) AS count FROM case_object co
    JOIN object_instance oi ON oi.object_id = co.object_id
    WHERE co.case_id = ? AND oi.type_key = 'CourseOfAction'`).get(sample.id) as any;
  assert.equal(related.count, 3);
});

test('Webhook 重试幂等与受控附件下载', async () => {
  process.env.WEBHOOK_SOURCES_JSON = JSON.stringify({ acceptance: {
    secret: 'source-secret', mapping: {
      typeKey: 'Supplier', fieldMap: { name: 'name', code: 'code', qualification: 'qualification' }, matchKeys: ['code'],
    },
  } });
  const payload = { rows: [{ id: 'webhook-1', name: 'Webhook 供应商', code: 'WEB-1', qualification: 'qualified' }] };
  const headers = { 'Content-Type': 'application/json', 'X-Webhook-Secret': 'source-secret', 'X-Delivery-Key': 'delivery-1', 'X-Domain-Id': 'dom_existing' };
  const send = () => fetch(`${base}/api/ingest/webhook/acceptance`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const first = await (await send()).json() as any;
  assert.equal(first.result.accepted, 1, JSON.stringify(first));
  const second = await (await send()).json() as any;
  assert.equal(second.replayed, true);
  assert.equal(second.jobId, first.jobId);
  const wrong = await fetch(`${base}/api/ingest/webhook/acceptance`, { method: 'POST', headers: { ...headers, 'X-Webhook-Secret': 'bad' }, body: JSON.stringify(payload) });
  assert.equal(wrong.status, 401);

  const objectId = first.result.objects[0].objectId;
  const form = new FormData();
  form.append('file', new Blob(['evidence attachment'], { type: 'text/plain' }), 'evidence.txt');
  const upload = await fetch(`${base}/api/objects/${objectId}/attachments`, {
    method: 'POST', headers: { Authorization: `Bearer ${tokens.analyst}`, 'X-Domain-Id': 'dom_existing' }, body: form,
  });
  assert.equal(upload.status, 201, await upload.clone().text());
  const meta = await upload.json() as any;
  const download = await fetch(`${base}/api/attachments/${meta.id}/download`, {
    headers: { Authorization: `Bearer ${tokens.observer}`, 'X-Domain-Id': 'dom_existing' },
  });
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'evidence attachment');
});

test('公共安全法定措施缺少有效授权时被拒', async () => {
  const cases = await request('GET', '/cases?decisionTypeKey=ps_case_response', 'legal');
  assert.equal(cases.status, 200);
  const caseId = cases.data.items[0].id;
  const detail = await request('GET', `/cases/${caseId}`, 'legal');
  const preview = await request('POST', '/actions/validate', 'legal', {
    actionKey: 'ps_record_intervention', caseId,
    params: { objectId: detail.data.rootObjectId, legalAuthorityId: 'missing-authority' },
  });
  assert.equal(preview.status, 200);
  assert.equal(preview.data.valid, false);
  assert.ok(preview.data.errors.some((item: string) => item.includes('法定授权')));
  const blocked = await request('POST', '/actions/execute', 'legal', {
    actionKey: 'ps_record_intervention', caseId,
    alternativeId: detail.data.alternatives[0].id,
    params: { objectId: detail.data.rootObjectId, legalAuthorityId: 'missing-authority' },
    idempotencyKey: 'public-safety-missing-authority',
  });
  assert.equal(blocked.status, 400);
});

test('案例退回与重新提交会使旧审批失效', async () => {
  const cases = await request('GET', '/cases?decisionTypeKey=ps_case_response', 'analyst');
  const caseId = cases.data.items[0].id;
  const scored = await request('POST', `/cases/${caseId}/score`, 'analyst', {});
  assert.equal(scored.status, 200, JSON.stringify(scored.data));
  const selected = scored.data.ranking.find((item: any) => item.feasible);
  assert.ok(selected);
  const decision = await request('POST', `/cases/${caseId}/decision`, 'analyst', {
    selectedAlternativeId: selected.alternativeId, rationale: '验收审批退回流程',
  });
  assert.equal(decision.status, 201, JSON.stringify(decision.data));
  const first = await request('POST', `/cases/${caseId}/approvals`, 'analyst', {
    alternativeId: selected.alternativeId,
  });
  assert.equal(first.status, 201, JSON.stringify(first.data));
  const returned = await request('POST', `/cases/${caseId}/transition`, 'analyst', {
    toState: 'OptionsReady', reason: '补充材料',
  });
  assert.equal(returned.status, 200, JSON.stringify(returned.data));
  assert.equal(returned.data.approvals.find((item: any) => item.id === first.data.id).status, 'invalidated');

  // 模拟升级前遗留的待审记录，重新提交时应自动替代它。
  const { getDb } = require('../src/db/database');
  getDb().prepare("UPDATE approval SET status = 'pending' WHERE id = ?").run(first.data.id);
  const second = await request('POST', `/cases/${caseId}/approvals`, 'analyst', {
    alternativeId: selected.alternativeId,
  });
  assert.equal(second.status, 201, JSON.stringify(second.data));
  const detail = await request('GET', `/cases/${caseId}`, 'analyst');
  assert.equal(detail.data.approvals.find((item: any) => item.id === first.data.id).status, 'invalidated');
  assert.equal(detail.data.approvals.filter((item: any) => item.status === 'pending').length, 1);
});

test('动作参数缺失时拒绝审批，补全并重新审批后可执行', async () => {
  const cases = await request('GET', '/cases?decisionTypeKey=ps_case_response', 'analyst');
  const template = await request('GET', `/cases/${cases.data.items[0].id}`, 'analyst');
  const rootObjectId = template.data.rootObjectId;
  const created = await request('POST', '/cases', 'analyst', {
    title: '验收动作参数补全', decisionTypeKey: 'ps_case_response', rootObjectId,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const caseId = created.data.id;
  assert.equal((await request('POST', `/cases/${caseId}/transition`, 'analyst',
    { toState: 'Observed', reason: '确认事实' })).status, 200);
  assert.equal((await request('POST', `/cases/${caseId}/orient`, 'analyst',
    { rootObjectId, depth: 5, maxAgeDays: 30 })).status, 200);
  assert.equal((await request('POST', `/cases/${caseId}/transition`, 'analyst',
    { toState: 'Oriented', reason: '确认快照' })).status, 200);
  const incomplete = await request('POST', `/cases/${caseId}/alternatives`, 'analyst', {
    name: '缺参跟进', proposedActions: [{ actionKey: 'ps_create_followup', safetyScore: 80,
      proportionalityScore: 80, burdenScore: 80, params: {} }],
  });
  assert.equal(incomplete.status, 201, JSON.stringify(incomplete.data));
  for (const item of template.data.alternatives.slice(0, 2)) {
    const added = await request('POST', `/cases/${caseId}/alternatives`, 'analyst', {
      name: item.name, proposedActions: item.proposedActions,
    });
    assert.equal(added.status, 201, JSON.stringify(added.data));
  }
  assert.equal((await request('POST', `/cases/${caseId}/transition`, 'analyst',
    { toState: 'OptionsReady', reason: '方案就绪' })).status, 200);
  assert.equal((await request('POST', `/cases/${caseId}/score`, 'analyst', {})).status, 200);
  assert.equal((await request('POST', `/cases/${caseId}/decision`, 'analyst', {
    selectedAlternativeId: incomplete.data.id, rationale: '核对执行参数',
  })).status, 201);
  const blocked = await request('POST', `/cases/${caseId}/approvals`, 'analyst', {
    alternativeId: incomplete.data.id,
  });
  assert.equal(blocked.status, 400);
  assert.match(blocked.data.error.message, /objectId/);
  assert.match(blocked.data.error.message, /assignee/);
  const correction = await request('POST', `/cases/${caseId}/alternatives`, 'analyst', {
    name: '补全参数跟进', proposedActions: [{ actionKey: 'ps_create_followup', safetyScore: 80,
      proportionalityScore: 80, burdenScore: 80, params: { objectId: rootObjectId, assignee: 'special-unit' } }],
  });
  assert.equal(correction.status, 201, JSON.stringify(correction.data));
  assert.equal((await request('POST', `/cases/${caseId}/score`, 'analyst', {})).status, 200);
  assert.equal((await request('POST', `/cases/${caseId}/decision`, 'analyst', {
    selectedAlternativeId: correction.data.id, rationale: '参数完整，重新比选',
  })).status, 201);
  const approval = await request('POST', `/cases/${caseId}/approvals`, 'analyst', {
    alternativeId: correction.data.id,
  });
  assert.equal(approval.status, 201, JSON.stringify(approval.data));
  assert.equal((await request('POST', `/approvals/${approval.data.id}/decide`, 'admin',
    { decision: 'approved' })).status, 200);
  const executed = await request('POST', '/actions/execute', 'admin', {
    actionKey: 'ps_create_followup', caseId, alternativeId: correction.data.id,
    approvalId: approval.data.id, params: { objectId: rootObjectId, assignee: 'special-unit' },
    idempotencyKey: `case-action-params-${caseId}`,
  });
  assert.equal(executed.status, 200, JSON.stringify(executed.data));
  assert.equal(executed.data.status, 'succeeded');
});

test('情报修订自动使已批准的演训案例失效', async () => {
  const cases = await request('GET', '/cases?decisionTypeKey=mil_threat_response', 'intel');
  const caseId = cases.data.items[0].id;
  const scored = await request('POST', `/cases/${caseId}/score`, 'intel', {});
  assert.equal(scored.status, 200, JSON.stringify(scored.data));
  const winner = scored.data.ranking.find((item: any) => item.feasible);
  assert.ok(winner, JSON.stringify(scored.data.ranking));
  const decision = await request('POST', `/cases/${caseId}/decision`, 'intel', {
    selectedAlternativeId: winner.alternativeId, rationale: '演训场景综合比较',
  });
  assert.equal(decision.status, 201, JSON.stringify(decision.data));
  const approval = await request('POST', `/cases/${caseId}/approvals`, 'intel', { alternativeId: winner.alternativeId });
  assert.equal(approval.status, 201, JSON.stringify(approval.data));
  const approved = await request('POST', `/approvals/${approval.data.id}/decide`, 'commander', { decision: 'approved' });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));

  const detail = await request('GET', `/cases/${caseId}`, 'intel');
  const rootId = detail.data.rootObjectId;
  const root = await request('GET', `/objects/${rootId}`, 'intel');
  const changed = await request('PATCH', `/objects/${rootId}`, 'intel', {
    payload: { confidence: 0.51 }, expectedRevision: root.data.revision, reason: '新情报修订',
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  const after = await request('GET', `/cases/${caseId}`, 'intel');
  assert.equal(after.data.approvals.find((item: any) => item.id === approval.data.id).status, 'invalidated');
  assert.notEqual(after.data.state, 'Approved');
});

test('演训指令经批准签发后形成关联回执', async () => {
  const cases = await request('GET', '/cases?decisionTypeKey=mil_threat_response', 'intel');
  const template = await request('GET', `/cases/${cases.data.items[0].id}`, 'intel');
  const created = await request('POST', '/cases', 'intel', {
    title: '演训指令验收', decisionTypeKey: 'mil_threat_response',
    rootObjectId: template.data.rootObjectId,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const caseId = created.data.id;
  assert.equal((await request('POST', `/cases/${caseId}/transition`, 'intel',
    { toState: 'Observed' })).status, 200);
  const snapshot = await request('POST', `/cases/${caseId}/orient`, 'intel', { depth: 5, maxAgeDays: 30 });
  assert.equal(snapshot.status, 200, JSON.stringify(snapshot.data));
  assert.equal((await request('POST', `/cases/${caseId}/transition`, 'intel',
    { toState: 'Oriented' })).status, 200);
  for (const alternative of template.data.alternatives) {
    const added = await request('POST', `/cases/${caseId}/alternatives`, 'intel', {
      name: alternative.name, description: alternative.description,
      proposedActions: alternative.proposedActions,
    });
    assert.equal(added.status, 201, JSON.stringify(added.data));
  }
  assert.equal((await request('POST', `/cases/${caseId}/transition`, 'intel',
    { toState: 'OptionsReady' })).status, 200);
  const scored = await request('POST', `/cases/${caseId}/score`, 'intel', {});
  assert.equal(scored.status, 200, JSON.stringify(scored.data));
  const chosen = scored.data.ranking.find((item: any) => item.feasible && item.name === '加强防护准备');
  assert.ok(chosen, JSON.stringify(scored.data.ranking));
  assert.equal((await request('POST', `/cases/${caseId}/decision`, 'intel', {
    selectedAlternativeId: chosen.alternativeId, rationale: '授权与资源条件满足',
  })).status, 201);
  const approval = await request('POST', `/cases/${caseId}/approvals`, 'intel', {
    alternativeId: chosen.alternativeId,
  });
  assert.equal(approval.status, 201);
  assert.equal((await request('POST', `/approvals/${approval.data.id}/decide`, 'commander',
    { decision: 'approved' })).status, 200);
  const detail = await request('GET', `/cases/${caseId}`, 'intel');
  const proposed = detail.data.alternatives.find((item: any) => item.id === chosen.alternativeId).proposedActions[0];
  const issued = await request('POST', '/actions/execute', 'commander', {
    actionKey: proposed.actionKey, params: proposed.params, caseId,
    alternativeId: chosen.alternativeId, idempotencyKey: 'mil-issue-acceptance',
  });
  assert.equal(issued.status, 200, JSON.stringify(issued.data));
  const orderId = issued.data.result.writes[0].objectId;
  assert.ok(orderId);
  const order = await request('GET', `/objects/${orderId}`, 'commander');
  assert.equal(order.data.payload.status, 'issued');
  assert.ok(order.data.links.some((item: any) => item.linkKey === 'order_implements_coa'));
  const ack = await request('POST', '/actions/execute', 'commander', {
    actionKey: 'mil_ack_order', params: { objectId: orderId, receiverRole: proposed.params.receiverRole },
    idempotencyKey: 'mil-ack-acceptance',
  });
  assert.equal(ack.status, 200, JSON.stringify(ack.data));
  const after = await request('GET', `/objects/${orderId}`, 'commander');
  assert.equal(after.data.payload.status, 'acknowledged');
  assert.ok(after.data.links.some((item: any) => item.linkKey === 'ack_for_order'));
  const { getActionType, upsertActionType } = require('../src/modules/actions/action-service');
  const beforeDefinition = getActionType('mil_issue_order');
  upsertActionType({ ...beforeDefinition, description: `${beforeDefinition.description}（版本校验）` }, 'admin');
  const historicalRun = await request('GET', `/actions/runs/${issued.data.id}`, 'commander');
  assert.equal(historicalRun.status, 200, JSON.stringify(historicalRun.data));
  assert.equal(historicalRun.data.actionVersion, beforeDefinition.version);
  assert.equal(historicalRun.data.actionDefinition.description, beforeDefinition.description);
});

test('自动化仅创建人工核查请求且同修订去重', async () => {
  const events = await request('GET', '/objects?typeKey=ObservedEvent', 'admin');
  const target = events.data.items.find((item: any) => item.preview.verificationStatus === 'unverified');
  assert.ok(target);
  const created = await request('POST', '/automations', 'admin', {
    name: '未核实事件待审', typeKey: 'ObservedEvent',
    expression: 'object.verificationStatus == "unverified"',
    effect: { type: 'create_review_request', taskTypeKey: 'ReviewRequest', title: '人工核查' },
    enabled: true,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const first = await request('POST', '/automations/process-object', 'admin', { objectId: target.objectId });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.results[0].status, 'succeeded');
  const second = await request('POST', '/automations/process-object', 'admin', { objectId: target.objectId });
  assert.deepEqual(second.data.results, []);
  const tasks = await request('GET', '/objects?typeKey=ReviewRequest', 'admin');
  assert.ok(tasks.data.items.some((item: any) => item.preview.subjectObjectId === target.objectId));
});

test('AI 适配器输出只保存为建议并接受人工纠正', async () => {
  const cases = await request('GET', '/cases?decisionTypeKey=sc_disruption_response', 'analyst');
  const caseId = cases.data.items[0].id;
  const detail = await request('GET', `/cases/${caseId}`, 'analyst');
  const snapshot = await request('GET', `/snapshots/${detail.data.snapshotId}`, 'analyst');
  const evidenceId = snapshot.data.objects.flatMap((item: any) => item.evidence ?? [])[0]?.evidenceId;
  assert.ok(evidenceId);
  const hardKeys = detail.data.decisionType.constraints.filter((item: any) => item.severity === 'hard')
    .map((item: any) => item.key);
  const mock = express();
  mock.post('/', express.json(), (_req, res) => res.json({
    text: '这是依据已引用证据生成的候选解释，仍需人工核对事实和约束。',
    citations: [evidenceId], constraintsMentioned: hardKeys,
    alternatives: [], modelVersion: 'mock-v1',
  }));
  const adapter = mock.listen(0);
  await new Promise<void>((resolve) => adapter.once('listening', resolve));
  process.env.AI_ADAPTER_URL = `http://127.0.0.1:${(adapter.address() as any).port}`;
  try {
    const objectsBefore = await request('GET', '/objects?typeKey=Disruption', 'analyst');
    const suggestion = await request('POST', `/cases/${caseId}/ai-suggestions`, 'analyst', { kind: 'explain' });
    assert.equal(suggestion.status, 201, JSON.stringify(suggestion.data));
    assert.equal(suggestion.data.status, 'suggestion');
    assert.equal(suggestion.data.evaluations[0].passed, true);
    const reviewed = await request('POST', `/ai-suggestions/${suggestion.data.id}/review`, 'analyst', {
      status: 'corrected', note: '需补充人工复核结论',
    });
    assert.equal(reviewed.status, 200);
    assert.equal(reviewed.data.status, 'corrected');
    const objectsAfter = await request('GET', '/objects?typeKey=Disruption', 'analyst');
    assert.equal(objectsAfter.data.total, objectsBefore.data.total);
  } finally {
    delete process.env.AI_ADAPTER_URL;
    await new Promise<void>((resolve) => adapter.close(() => resolve()));
  }
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  require('../src/db/database').closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

test('供应链案例从事实到结果并可回放', async () => {
  const cases = await request('GET', '/cases?decisionTypeKey=sc_disruption_response', 'analyst');
  assert.equal(cases.status, 200);
  const template = await request('GET', `/cases/${cases.data.items[0].id}`, 'analyst');
  assert.ok(template.data.alternatives.length >= 3);
  const rootObjectId = template.data.rootObjectId;

  const source = await request('POST', '/ingest/jobs', 'analyst', {
    filename: 'acceptance.json', rows: [{ id: 'acc-1', name: '验收供应商', code: 'ACC-1', qualification: 'qualified', riskScore: 10, country: 'CN' }],
    mapping: { typeKey: 'Supplier', sourceKey: 'acceptance', fieldMap: {
      name: 'name', code: 'code', qualification: 'qualification', riskScore: 'riskScore', country: 'country' }, matchKeys: ['code'] },
  });
  assert.equal(source.status, 201, JSON.stringify(source.data));
  const imported = await request('POST', `/ingest/jobs/${source.data.id}/apply`, 'analyst');
  assert.equal(imported.status, 200, JSON.stringify(imported.data));
  assert.equal(imported.data.accepted, 1);

  const created = await request('POST', '/cases', 'analyst', {
    title: '验收完整闭环', decisionTypeKey: 'sc_disruption_response',
    summary: '从来源导入到结果复盘', rootObjectId,
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const caseId = created.data.id;
  assert.equal((await request('POST', `/cases/${caseId}/transition`, 'analyst',
    { toState: 'Observed', reason: '事实已导入' })).status, 200);
  const oriented = await request('POST', `/cases/${caseId}/orient`, 'analyst', {
    rootObjectId, depth: 5, maxAgeDays: 30,
  });
  assert.equal(oriented.status, 200, JSON.stringify(oriented.data));
  assert.equal((await request('POST', `/cases/${caseId}/transition`, 'analyst',
    { toState: 'Oriented', reason: '已确认情境' })).status, 200);
  for (const item of template.data.alternatives) {
    const added = await request('POST', `/cases/${caseId}/alternatives`, 'analyst', {
      name: item.name, description: item.description, proposedActions: item.proposedActions,
    });
    assert.equal(added.status, 201, JSON.stringify(added.data));
  }
  assert.equal((await request('POST', `/cases/${caseId}/transition`, 'analyst',
    { toState: 'OptionsReady', reason: '备选已建立' })).status, 200);
  const detail = await request('GET', `/cases/${caseId}`, 'analyst');

  const scenario = await request('POST', `/cases/${caseId}/scenarios`, 'analyst', {
    alternativeId: detail.data.alternatives[0].id, overlay: { [rootObjectId]: { delayDays: 4 } },
  });
  assert.equal(scenario.status, 201, JSON.stringify(scenario.data));
  const snapshotBefore = await request('GET', `/objects/${rootObjectId}`, 'analyst');
  assert.equal(snapshotBefore.data.payload.delayDays, 5);

  const scored = await request('POST', `/cases/${caseId}/score`, 'analyst', {});
  assert.equal(scored.status, 200, JSON.stringify(scored.data));
  assert.ok(scored.data.ranking.length >= 3);
  const selected = scored.data.ranking.find((item: any) => item.feasible && item.name === '跨仓调拨');
  assert.ok(selected, JSON.stringify(scored.data.ranking));
  const garbledDecision = await request('POST', `/cases/${caseId}/decision`, 'analyst', {
    selectedAlternativeId: selected.alternativeId, rationale: '依据\uFFFD已损坏',
  });
  assert.equal(garbledDecision.status, 400);
  assert.match(garbledDecision.data.error.message, /UTF-8/);
  const decision = await request('POST', `/cases/${caseId}/decision`, 'analyst', {
    selectedAlternativeId: selected.alternativeId, rationale: '交期与风险综合较优', dissent: '成本增加',
  });
  assert.equal(decision.status, 201, JSON.stringify(decision.data));
  const garbledRequest = await request('POST', `/cases/${caseId}/approvals`, 'analyst', {
    alternativeId: selected.alternativeId, comment: '审批\uFFFD备注',
  });
  assert.equal(garbledRequest.status, 400);
  const approval = await request('POST', `/cases/${caseId}/approvals`, 'analyst', { alternativeId: selected.alternativeId });
  assert.equal(approval.status, 201, JSON.stringify(approval.data));
  const garbledApproval = await request('POST', `/approvals/${approval.data.id}/decide`, 'approver', {
    decision: 'approved', comment: '审批\uFFFD意见',
  });
  assert.equal(garbledApproval.status, 400);
  const approved = await request('POST', `/approvals/${approval.data.id}/decide`, 'approver', { decision: 'approved' });
  assert.equal(approved.status, 200, JSON.stringify(approved.data));
  const chosen = detail.data.alternatives.find((item: any) => item.id === selected.alternativeId).proposedActions[0];
  const tampered = await request('POST', '/actions/execute', 'operator', {
    actionKey: chosen.actionKey, params: { ...chosen.params, quantity: 999 }, caseId,
    alternativeId: selected.alternativeId, idempotencyKey: 'tampered-action',
  });
  assert.equal(tampered.status, 409);
  const executed = await request('POST', '/actions/execute', 'operator', {
    actionKey: chosen.actionKey, params: chosen.params, caseId, alternativeId: selected.alternativeId,
    idempotencyKey: 'acceptance-action-1',
  });
  assert.equal(executed.status, 200, JSON.stringify(executed.data));
  assert.equal(executed.data.status, 'succeeded');
  const repeated = await request('POST', '/actions/execute', 'operator', {
    actionKey: chosen.actionKey, params: chosen.params, caseId, alternativeId: selected.alternativeId,
    idempotencyKey: 'acceptance-action-1',
  });
  assert.equal(repeated.status, 200);
  assert.equal(repeated.data.id, executed.data.id);
  const objectAfter = await request('GET', `/objects/${rootObjectId}`, 'analyst');
  assert.equal(objectAfter.data.payload.status, 'mitigating');
  const evidence = objectAfter.data.evidence[0]?.id;
  assert.ok(evidence);
  const outcome = await request('POST', `/cases/${caseId}/outcomes`, 'operator', {
    expected: { service: 82 }, actual: { service: 80 }, units: { service: 'score' },
    evidenceRefs: [evidence], reviewNotes: '验收结果',
  });
  assert.equal(outcome.status, 201, JSON.stringify(outcome.data));
  const reviewed = await request('POST', `/outcomes/${outcome.data.id}/review`, 'approver', {
    reviewNotes: '完成复核', attribution: '执行偏差',
  });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.data));
  const closed = await request('POST', `/cases/${caseId}/close`, 'approver', {});
  assert.equal(closed.status, 200, JSON.stringify(closed.data));
  const replay = await request('GET', `/cases/${caseId}/replay`, 'analyst');
  assert.equal(replay.status, 200, JSON.stringify(replay.data));
  assert.ok(replay.data.snapshots?.length);
  assert.ok(replay.data.case.actionRuns?.length);
  assert.ok(replay.data.case.outcomes?.length);
});

test('已签发令牌使用当前权限，停用账号立即失效', async () => {
  const created = await request('POST', '/users', 'admin', {
    username: 'auth-change-test', displayName: '权限变更测试', password: 'test-password-123',
    roles: ['admin'], securityClearance: 'TOP_SECRET',
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const loginResult = await request('POST', '/auth/login', undefined, {
    username: 'auth-change-test', password: 'test-password-123',
  });
  assert.equal(loginResult.status, 200);
  const authRequest = (url: string) => fetch(`${base}/api${url}`, {
    headers: { Authorization: `Bearer ${loginResult.data.token}` },
  });
  assert.equal((await authRequest('/users')).status, 200);

  const { getDb } = require('../src/db/database');
  getDb().prepare('UPDATE users SET roles = ?, security_clearance = ? WHERE id = ?')
    .run('["observer"]', 'PUBLIC', created.data.id);
  const current = await (await authRequest('/auth/me')).json() as any;
  assert.deepEqual(current.user.roles, ['observer']);
  assert.equal(current.user.securityClearance, 'PUBLIC');
  assert.equal((await authRequest('/users')).status, 403);

  getDb().prepare('UPDATE users SET disabled = 1 WHERE id = ?').run(created.data.id);
  assert.equal((await authRequest('/auth/me')).status, 401);
});

test('应用领域自动写入、成员授权与跨领域隔离', async () => {
  const { getDb } = require('../src/db/database');
  const created = await request('POST', '/domains', 'admin', {
    domainKey: 'domain-isolation-test', displayName: '隔离测试领域', description: '接口验收',
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const domainId = created.data.id as string;
  const denied = await request('GET', '/ontology/types', 'analyst', undefined, domainId);
  assert.equal(denied.status, 403);
  const before = await request('GET', '/ontology/types', 'admin', undefined, domainId);
  assert.equal(before.status, 200);
  assert.equal(before.data.items.length, 0);

  const type = await request('POST', '/ontology/types', 'admin', {
    typeKey: 'DomainIsolationItem', displayName: '隔离对象',
    definition: { properties: [{ name: 'name', type: 'string', required: true }] },
  }, domainId);
  assert.equal(type.status, 201, JSON.stringify(type.data));
  const published = await request('POST', '/ontology/types/DomainIsolationItem/publish', 'admin', {}, domainId);
  assert.equal(published.status, 200, JSON.stringify(published.data));
  const object = await request('POST', '/objects', 'admin', {
    typeKey: 'DomainIsolationItem', payload: { name: '仅测试领域可见' },
  }, domainId);
  assert.equal(object.status, 201, JSON.stringify(object.data));
  assert.equal((await request('GET', `/objects/${object.data.objectId}`, 'admin')).status, 404);
  assert.equal((await request('GET', '/objects?typeKey=DomainIsolationItem', 'admin')).data.total, 0);
  assert.equal((await request('GET', '/objects?typeKey=Supplier', 'admin', undefined, domainId)).data.total, 0);
  assert.equal((await request('POST', '/objects', 'admin', { typeKey: 'Supplier', payload: {} }, domainId)).status, 404);

  const oldSource = getDb().prepare('SELECT id FROM source_record WHERE domain_id = ? LIMIT 1').get('dom_existing') as { id: string };
  const foreignEvidence = await request('POST', '/evidence', 'admin', {
    objectId: object.data.objectId, sourceId: oldSource.id, observedAt: new Date().toISOString(),
  }, domainId);
  assert.equal(foreignEvidence.status, 404);
  const foreignWebhook = await fetch(`${base}/api/ingest/webhook/acceptance`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Domain-Id': domainId,
      'X-Webhook-Secret': 'source-secret', 'X-Delivery-Key': 'foreign-domain' },
    body: JSON.stringify({ rows: [{ id: 'foreign', name: 'test' }] }),
  });
  assert.equal(foreignWebhook.status, 403);

  const analyst = getDb().prepare("SELECT id FROM users WHERE username = 'analyst'").get() as { id: string };
  const added = await request('PUT', `/domains/${domainId}/members/${analyst.id}`, 'admin');
  assert.equal(added.status, 200);
  const visible = await request('GET', '/objects?typeKey=DomainIsolationItem', 'analyst', undefined, domainId);
  assert.equal(visible.status, 200);
  assert.equal(visible.data.total, 1);
  const stored = getDb().prepare('SELECT domain_id FROM object_instance WHERE object_id = ?').get(object.data.objectId) as any;
  assert.equal(stored.domain_id, domainId);
  const removed = await request('DELETE', `/domains/${domainId}/members/${analyst.id}`, 'admin');
  assert.equal(removed.status, 200);
  assert.equal((await request('GET', '/objects', 'analyst', undefined, domainId)).status, 403);
});
