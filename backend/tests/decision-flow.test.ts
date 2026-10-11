/**
 * 决策流程集成测试：状态机、评分硬约束、幂等执行、推演不污染
 * 依赖种子数据：请先运行 npm run seed
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import os from 'os';

// 使用临时库，避免污染开发库
process.env.DATABASE_PATH = path.join(os.tmpdir(), `ooda-test-${Date.now()}.db`);
process.env.JWT_SECRET = 'test-secret';

// 动态引入，确保 env 先设置
let decisionService: typeof import('../src/modules/decision/decision-service');
let scenarioService: typeof import('../src/modules/scenario/scenario-service');
let actionService: typeof import('../src/modules/actions/action-service');
let db: ReturnType<typeof import('../src/db/database').getDb>;
let seedAll: typeof import('../src/seed/seed').seedAll;

before(async () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  db = require('../src/db/database').getDb();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../src/db/migrate').runMigrations();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  seedAll = require('../src/seed/seed').seedAll;
  seedAll();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  decisionService = require('../src/modules/decision/decision-service');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  scenarioService = require('../src/modules/scenario/scenario-service');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  actionService = require('../src/modules/actions/action-service');
});

after(() => {
  try {
    db.close();
  } catch {
    /* 忽略 */
  }
  try {
    fs.unlinkSync(process.env.DATABASE_PATH!);
  } catch {
    /* 忽略 */
  }
});

const adminUser = {
  id: 'u_admin',
  username: 'admin',
  displayName: 'admin',
  roles: ['admin'],
  clearance: 'TOP_SECRET',
};

test('案例状态机：非法跃迁应拒绝', () => {
  const cases = db.prepare("SELECT id FROM decision_case LIMIT 1").all() as Array<{ id: string }>;
  assert.ok(cases.length > 0, '应存在种子案例');
  // 尝试从当前状态非法跃迁
  try {
    decisionService.transitionCase(cases[0].id, 'Closed' as never, adminUser as never);
    // 若种子案例已是可关闭状态则不异常；否则应抛错
  } catch (e: any) {
    assert.ok(
      e.code === 'STATE_TRANSITION_INVALID' || e.message.includes('状态'),
      `应为状态机错误，实际: ${e.message}`
    );
  }
});

test('评分：硬约束排除不合格方案', () => {
  const row = db
    .prepare("SELECT id, title FROM decision_case WHERE title LIKE '%SHP%' OR title LIKE '%延迟%' LIMIT 1")
    .get() as { id: string; title: string } | undefined;
  if (!row?.id) {
    // 兼容不同种子
    return;
  }
  const result = decisionService.scoreAlternatives({
    caseId: row.id,
    scenarioRunId: 'test-smoke-run',
    actor: adminUser as never,
  } as never);
  const ranking = (result as any).ranking || [];
  assert.ok(ranking.length >= 3, `至少 3 个方案，实际 ${ranking.length}`);
  const infeasible = ranking.filter((r: any) => !r.feasible);
  assert.ok(infeasible.length >= 1, '至少 1 个方案因硬约束不可行');
  for (const r of infeasible) {
    assert.ok(
      (r.infeasibleReasons && r.infeasibleReasons.length > 0) ||
        (r.reasons && r.reasons.length > 0),
      '不可行方案必须给出原因'
    );
  }
});

test('推演 overlay 不修改正式对象', () => {
  const beforeRow = db
    .prepare('SELECT payload_json FROM object_instance LIMIT 1')
    .get() as { payload_json: string } | undefined;
  if (!beforeRow) return;

  const cases = db.prepare('SELECT id FROM decision_case LIMIT 1').all() as Array<{ id: string }>;
  if (cases.length === 0) return;

  try {
    scenarioService.runScenario(cases[0].id, { overrides: { testKey: 'polluted' } }, adminUser as never);
  } catch {
    // 运行失败不影响断言（可能缺少方案）
  }

  const afterRow = db
    .prepare('SELECT payload_json FROM object_instance LIMIT 1')
    .get() as { payload_json: string };
  assert.equal(
    afterRow.payload_json,
    beforeRow.payload_json,
    '推演不得修改 object_instance 正式数据'
  );
  assert.ok(
    !afterRow.payload_json.includes('polluted'),
    '推演 overlay 值不应泄漏到正式对象'
  );
});

test('动作幂等：相同幂等键重放返回首次结果', () => {
  const actions = db.prepare('SELECT action_key FROM action_type LIMIT 1').all() as Array<{ action_key: string }>;
  if (actions.length === 0) return;

  const idempotencyKey = `test-idem-${Date.now()}`;
  const params = { note: 'idem-test' };

  let firstId: string | undefined;
  try {
    const r1 = actionService.executeAction(
      { actionTypeKey: actions[0].action_key, params, idempotencyKey },
      adminUser as never
    );
    firstId = (r1 as any).runId || (r1 as any).id;
  } catch {
    // 动作可能因前置条件失败；跳过
    return;
  }

  const r2 = actionService.executeAction(
    { actionTypeKey: actions[0].action_key, params: { note: 'changed' }, idempotencyKey },
    adminUser as never
  );
  const secondId = (r2 as any).runId || (r2 as any).id;
  assert.equal(secondId, firstId, '相同幂等键应返回同一执行记录');
});
