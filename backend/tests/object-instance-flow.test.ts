import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';

test('新对象类型可经导入创建实例并由触发规则执行受控 Action', () => {
  const file = path.join(os.tmpdir(), `ooda-object-flow-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  const { closeDb } = require('../src/db/database') as typeof import('../src/db/database');
  const { runMigrations } = require('../src/db/migrate') as typeof import('../src/db/migrate');
  const model = require('../src/modules/ontology/ontology-service') as typeof import('../src/modules/ontology/ontology-service');
  const objects = require('../src/modules/objects/object-service') as typeof import('../src/modules/objects/object-service');
  const rules = require('../src/modules/rules/rule-service') as typeof import('../src/modules/rules/rule-service');
  const actions = require('../src/modules/actions/action-service') as typeof import('../src/modules/actions/action-service');
  const automations = require('../src/modules/automation/automation-service') as typeof import('../src/modules/automation/automation-service');
  const ingest = require('../src/modules/ingestion/ingest-service') as typeof import('../src/modules/ingestion/ingest-service');
  try {
    runMigrations();
    model.createType({ typeKey: 'Telemetry', displayName: '遥测读数', createdBy: 'tester',
      definition: { displayProperty: 'readingId', properties: [
        { name: 'readingId', label: '读数编号', type: 'string', required: true },
        { name: 'temperatureC', label: '温度', type: 'number', required: true },
        { name: 'status', label: '状态', type: 'string' },
      ] } });
    assert.throws(() => objects.createObject({ typeKey: 'Telemetry', payload: {
      readingId: '001', temperatureC: 9 }, actor: 'tester' }), /尚未发布/);
    model.publishType('Telemetry', 'tester');
    model.createType({ typeKey: 'SensorEvent', displayName: '传感器事件', createdBy: 'tester',
      definition: { properties: [{ name: 'readingId', label: '编号', type: 'string', required: true }] } });
    model.publishType('SensorEvent', 'tester');
    assert.equal(objects.buildTitle('SensorEvent', { readingId: '001' }), '001');
    rules.upsertRule({ ruleKey: 'high_temperature', name: '超温', kind: 'trigger',
      scopeType: 'Telemetry', expression: 'object.temperatureC > 8' }, 'tester');
    actions.upsertActionType({ actionKey: 'mark_review', name: '标记待核查',
      paramsSchema: { required: ['objectId'], properties: { objectId: { type: 'string' } } },
      writeSet: [{ op: 'update', objectId: '${params.objectId}', payload: { status: 'review' } }],
      approvalPolicy: { allowAutomation: true }, requiredRoles: ['operator'] }, 'tester');
    const actor = { id: 'admin', username: 'admin', displayName: '管理员', roles: ['admin'],
      securityClearance: 'TOP_SECRET' };
    assert.throws(() => automations.upsertAutomation({ name: '缺少运行上下文', typeKey: 'Telemetry',
      expression: 'temperatureC > 8',
      effect: { type: 'execute_action', actionKey: 'mark_review', params: {} } }, actor),
    /自动化条件只能读取/);
    automations.upsertAutomation({ name: '自动标记超温', typeKey: 'Telemetry', ruleKey: 'high_temperature',
      effect: { type: 'execute_action', actionKey: 'mark_review', params: {} } }, actor);
    assert.throws(() => rules.deleteRule('high_temperature', 'tester'), /已被自动化引用/);
    assert.throws(() => rules.upsertRule({ ruleKey: 'high_temperature', name: '超温',
      kind: 'constraint', expression: 'true' }, 'tester'), /不能改为不兼容/);
    const job = ingest.createIngestJob({ sourceType: 'csv', filename: 'telemetry.csv', createdBy: 'tester',
      rows: [{ readingId: '001', temperatureC: '9' }],
      mapping: { typeKey: 'Telemetry', fieldMap: { readingId: 'readingId', temperatureC: 'temperatureC' },
        matchKeys: ['readingId'], sourceKey: 'sensor-demo' } });
    const result = ingest.applyIngestJob(job.id, 'tester');
    assert.equal(result.accepted, 1);
    assert.equal(result.rejected, 0);
    const list = objects.queryObjects({ typeKey: 'Telemetry' });
    assert.equal(list.total, 1);
    assert.equal(list.items[0].preview.readingId, '001');
    assert.equal(list.items[0].preview.temperatureC, 9);
    assert.equal(list.items[0].preview.status, 'review');
    assert.equal(automations.listAutomationRuns()[0].status, 'succeeded');
    assert.equal(actions.listActionRuns()[0].status, 'succeeded');
    const secondJob = ingest.createIngestJob({ sourceType: 'csv', filename: 'telemetry-update.csv', createdBy: 'tester',
      rows: [{ readingId: '001', temperatureC: '7' }],
      mapping: { typeKey: 'Telemetry', fieldMap: { readingId: 'readingId', temperatureC: 'temperatureC' },
        matchKeys: ['readingId'], sourceKey: 'sensor-demo' } });
    assert.equal(ingest.applyIngestJob(secondJob.id, 'tester').accepted, 1);
    const updated = objects.queryObjects({ typeKey: 'Telemetry' });
    assert.equal(updated.total, 1);
    assert.equal(updated.items[0].preview.temperatureC, 7);
    assert.equal(automations.listAutomationRuns().length, 1,
      JSON.stringify(automations.listAutomationRuns()));
    const cleared = objects.updateObject({ objectId: updated.items[0].objectId,
      payload: { status: null }, title: '人工命名的读数', actor: 'tester' });
    assert.equal(cleared.payload.status, undefined);
    assert.equal(cleared.title, '人工命名的读数');
    assert.equal(objects.updateObject({ objectId: cleared.objectId, payload: { temperatureC: 6 },
      actor: 'tester' }).title, '人工命名的读数');
    actions.upsertActionType({ actionKey: 'mark_review', name: '标记待核查',
      writeSet: [{ op: 'update', objectId: '${params.objectId}', payload: { status: 'review' } }],
      approvalPolicy: { allowAutomation: true, requiredRoles: ['approver'] } }, 'tester');
    assert.throws(() => automations.upsertAutomation({ name: '不安全动作', typeKey: 'Telemetry',
      expression: 'true', effect: { type: 'execute_action', actionKey: 'mark_review', params: {} } }, actor),
      /不允许自动执行/);
  } finally {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(file + suffix); } catch { /* 临时文件不存在时忽略 */ }
    }
  }
});
