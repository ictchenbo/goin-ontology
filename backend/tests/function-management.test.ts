import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';

test('自定义函数可定义、在规则 DSL 中调用，并阻止删除仍被引用的函数', () => {
  const file = path.join(os.tmpdir(), `ooda-functions-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  const { closeDb } = require('../src/db/database') as typeof import('../src/db/database');
  const { runMigrations } = require('../src/db/migrate') as typeof import('../src/db/migrate');
  const functions = require('../src/modules/functions/function-service') as typeof import('../src/modules/functions/function-service');
  const { evaluate } = require('../src/shared/rule-dsl') as typeof import('../src/shared/rule-dsl');
  const { upsertRule } = require('../src/modules/rules/rule-service') as typeof import('../src/modules/rules/rule-service');
  try {
    runMigrations();
    const created = functions.upsertFunction({
      functionKey: 'risk_score', name: '风险分', parameters: ['severity', 'exposure'],
      expression: 'severity * exposure', outputType: 'number',
    }, 'tester');
    assert.equal(created.version, 1);
    assert.equal(functions.evaluateFunction('risk_score', { severity: 4, exposure: 5 }).result, 20);
    assert.equal(evaluate('risk_score(4, 5) + 1', {}), 21);
    assert.throws(() => functions.evaluateFunction('risk_score', { severity: 4 }), /缺少参数/);
    assert.throws(() => functions.upsertFunction({
      functionKey: 'risk_score', name: '递归', parameters: ['severity', 'exposure'],
      expression: 'risk_score(severity, exposure)', outputType: 'number',
    }, 'tester') && functions.evaluateFunction('risk_score', { severity: 4, exposure: 5 }), /递归调用/);
    functions.upsertFunction({
      functionKey: 'risk_score', name: '风险分', parameters: ['severity', 'exposure'],
      expression: 'severity * exposure', outputType: 'number',
    }, 'tester');
    upsertRule({ ruleKey: 'risk_rule', name: '风险规则', kind: 'derived_metric',
      expression: 'risk_score (params.severity, params.exposure)' }, 'tester');
    assert.throws(() => functions.deleteFunction('risk_score', 'tester'), /仍被引用/);
  } finally {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(file + suffix); } catch { /* 临时文件不存在时忽略 */ }
    }
  }
});
