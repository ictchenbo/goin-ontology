/**
 * 城市燃气演示领域集成测试：领域隔离、模型、对象、决策、审批与动作执行闭环
 * 使用临时数据库，不污染开发库。
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';

process.env.DATABASE_PATH = path.join(os.tmpdir(), `ooda-gas-demo-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-secret';

let db: ReturnType<typeof import('../src/db/database').getDb>;
let domainService: typeof import('../src/modules/domains/domain-service');
let decisionService: typeof import('../src/modules/decision/decision-service');
let actionService: typeof import('../src/modules/actions/action-service');
let objectService: typeof import('../src/modules/objects/object-service');
let seedUrbanGasDemo: typeof import('../src/seed/seed-urban-gas-demo').seedUrbanGasDemo;
let domainId = '';

interface TestUser {
  id: string; username: string; displayName: string; roles: string[]; securityClearance: string;
}

function loadUser(username: string): TestUser {
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as any;
  assert.ok(row, `缺少测试用户: ${username}`);
  return {
    id: row.id, username: row.username, displayName: row.display_name,
    roles: JSON.parse(row.roles || '[]'), securityClearance: row.security_clearance || 'PUBLIC',
  };
}

before(async () => {
  db = require('../src/db/database').getDb();
  require('../src/db/migrate').runMigrations();
  require('../src/seed/seed').seedAll();
  ({ seedUrbanGasDemo } = require('../src/seed/seed-urban-gas-demo'));
  seedUrbanGasDemo();
  domainService = require('../src/modules/domains/domain-service');
  decisionService = require('../src/modules/decision/decision-service');
  actionService = require('../src/modules/actions/action-service');
  objectService = require('../src/modules/objects/object-service');
  const domain = db.prepare('SELECT id FROM application_domain WHERE domain_key = ?')
    .get('urban-gas-safety') as { id: string };
  assert.ok(domain?.id, '应创建城市燃气安全领域');
  domainId = domain.id;
});

after(() => {
  try { db.close(); } catch { /* 忽略 */ }
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(process.env.DATABASE_PATH! + suffix); } catch { /* 忽略 */ }
  }
});

test('演示领域：本体模型、对象、关系与证据齐备', () => {
  domainService.runInDomain(domainId, () => {
    const typeCount = (db.prepare('SELECT COUNT(*) AS c FROM ontology_type WHERE domain_id = ?')
      .get(domainId) as { c: number }).c;
    assert.equal(typeCount, 7, '应创建 7 个燃气对象类型');
    const linkCount = (db.prepare('SELECT COUNT(*) AS c FROM link_def WHERE domain_id = ?')
      .get(domainId) as { c: number }).c;
    assert.equal(linkCount, 6, '应创建 6 个燃气关系定义');
    const actionCount = (db.prepare('SELECT COUNT(*) AS c FROM action_type WHERE domain_id = ?')
      .get(domainId) as { c: number }).c;
    assert.equal(actionCount, 3, '应创建 3 个燃气 Action');
    const decisionCount = (db.prepare('SELECT COUNT(*) AS c FROM decision_type WHERE domain_id = ?')
      .get(domainId) as { c: number }).c;
    assert.equal(decisionCount, 1, '应创建 1 个燃气决策类型');
    const alarms = (db.prepare("SELECT COUNT(*) AS c FROM object_instance WHERE domain_id = ? AND type_key = 'GasLeakAlarm'")
      .get(domainId) as { c: number }).c;
    assert.equal(alarms, 2, '应创建两条报警链');
    const evidenceCount = (db.prepare('SELECT COUNT(*) AS c FROM evidence WHERE domain_id = ?')
      .get(domainId) as { c: number }).c;
    assert.ok(evidenceCount >= 3, `应至少写入 3 条证据，实际 ${evidenceCount}`);
  });
});

test('演示案例：主线待决策，辅线待审批', () => {
  domainService.runInDomain(domainId, () => {
    const main = db.prepare("SELECT id, state FROM decision_case WHERE title = '梧桐路中压管段燃气泄漏应急处置'")
      .get() as { id: string; state: string };
    assert.equal(main.state, 'OptionsReady', '主线案例应停在 OptionsReady');
    const mainAlts = db.prepare('SELECT COUNT(*) AS c FROM alternative WHERE case_id = ?')
      .get(main.id) as { c: number };
    assert.equal(mainAlts.c, 4, '主线案例应有 4 个方案');

    const pending = db.prepare("SELECT id, state FROM decision_case WHERE title = '建设路餐饮街燃气异味核实处置'")
      .get() as { id: string; state: string };
    assert.equal(pending.state, 'PendingApproval', '辅线案例应处于待审批');
    const approval = db.prepare("SELECT COUNT(*) AS c FROM approval WHERE case_id = ? AND status = 'pending'")
      .get(pending.id) as { c: number };
    assert.equal(approval.c, 1, '辅线案例应有一条待审记录');
  });
});

test('主线闭环：评分硬约束 → 记录决策 → 提交审批 → 批准 → 执行', () => {
  const analyst = loadUser('analyst');
  const safety = loadUser('safety');
  const operator = loadUser('operator');

  domainService.runInDomain(domainId, () => {
    const main = db.prepare("SELECT id FROM decision_case WHERE title = '梧桐路中压管段燃气泄漏应急处置'")
      .get() as { id: string };
    const score = decisionService.scoreAlternatives({
      caseId: main.id, scenarioRunId: 'test-gas-main', weights: { safety: 40, timeliness: 25, impact: 20, compliance: 15 },
      actor: analyst as never,
    });
    const ranking = (score as any).ranking as Array<{ alternativeId: string; name: string; feasible: boolean; infeasibleReasons: string[] }>;
    const winner = ranking.find((item) => item.alternativeId === (score as any).winnerAlternativeId);
    assert.equal(winner?.name, '关闭上游阀门隔离管段', '硬约束下的最优方案应为关阀隔离');
    assert.ok(ranking.some((item) => !item.feasible), '全城停气应因缺少授权而不可行');

    decisionService.recordDecision({
      caseId: main.id, selectedAlternativeId: winner!.alternativeId,
      rationale: '泄漏已核实且影响 320 户，优先隔离管段。', actor: analyst as never,
    });
    decisionService.requestApproval({
      caseId: main.id, alternativeId: winner!.alternativeId, actor: analyst as never, comment: '请批准关阀隔离。',
    });

    const approval = db.prepare("SELECT id FROM approval WHERE case_id = ? AND status = 'pending'")
      .get(main.id) as { id: string };
    decisionService.decideApproval({
      approvalId: approval.id, decision: 'approved', comment: '同意关阀隔离', actor: safety as never,
    });

    const alt = db.prepare('SELECT proposed_actions FROM alternative WHERE id = ?')
      .get(winner!.alternativeId) as { proposed_actions: string };
    const proposed = JSON.parse(alt.proposed_actions)[0] as { actionKey: string; params: Record<string, unknown> };
    const run = actionService.executeAction({
      actionKey: proposed.actionKey,
      params: proposed.params,
      caseId: main.id,
      alternativeId: winner!.alternativeId,
      idempotencyKey: `test-gas-main-${Date.now()}`,
      actor: operator as never,
    });
    assert.equal(run.status, 'succeeded', '执行应成功');

    const pipeline = objectService.getObject(String(proposed.params.pipelineId));
    assert.equal((pipeline.payload as any).status, 'isolated', '管段应变为已隔离');
    const valve = objectService.getObject(String(proposed.params.valveId));
    assert.equal((valve.payload as any).status, 'closed', '阀门应变为已关闭');
    const workOrders = (db.prepare("SELECT COUNT(*) AS c FROM object_instance WHERE domain_id = ? AND type_key = 'GasWorkOrder'")
      .get(domainId) as { c: number }).c;
    assert.ok(workOrders >= 2, '执行后应新增抢修工单');
    const caseState = (db.prepare('SELECT state FROM decision_case WHERE id = ?').get(main.id) as { state: string }).state;
    assert.equal(caseState, 'Executing', '案例应进入执行中');
  });
});

test('辅线闭环：审批中心批准后由执行角色派发巡检工单', () => {
  const safety = loadUser('safety');
  const operator = loadUser('operator');

  domainService.runInDomain(domainId, () => {
    const pending = db.prepare("SELECT id FROM decision_case WHERE title = '建设路餐饮街燃气异味核实处置'")
      .get() as { id: string };
    const approval = db.prepare("SELECT id, alternative_id FROM approval WHERE case_id = ? AND status = 'pending'")
      .get(pending.id) as { id: string; alternative_id: string };
    decisionService.decideApproval({
      approvalId: approval.id, decision: 'approved', comment: '同意先核实', actor: safety as never,
    });
    const alt = db.prepare('SELECT proposed_actions FROM alternative WHERE id = ?')
      .get(approval.alternative_id) as { proposed_actions: string };
    const proposed = JSON.parse(alt.proposed_actions)[0] as { actionKey: string; params: Record<string, unknown> };
    const before = (db.prepare("SELECT COUNT(*) AS c FROM object_instance WHERE domain_id = ? AND type_key = 'GasWorkOrder'")
      .get(domainId) as { c: number }).c;
    const run = actionService.executeAction({
      actionKey: proposed.actionKey, params: proposed.params,
      caseId: pending.id, alternativeId: approval.alternative_id,
      idempotencyKey: `test-gas-pending-${Date.now()}`, actor: operator as never,
    });
    assert.equal(run.status, 'succeeded');
    const after = (db.prepare("SELECT COUNT(*) AS c FROM object_instance WHERE domain_id = ? AND type_key = 'GasWorkOrder'")
      .get(domainId) as { c: number }).c;
    assert.equal(after, before + 1, '应新增一条巡检工单');
    const linked = (db.prepare("SELECT COUNT(*) AS c FROM link_instance WHERE domain_id = ? AND link_key = 'gas_workorder_for_alarm' AND is_valid = 1")
      .get(domainId) as { c: number }).c;
    assert.ok(linked >= 3, '新工单应关联报警（含执行产生的两条）');
  });
});
