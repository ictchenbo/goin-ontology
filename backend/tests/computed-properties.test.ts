import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';

test('对象计算属性按读取时的输入和权限计算，且不可写入', () => {
  const file = path.join(os.tmpdir(), `ooda-computed-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  const { closeDb, getDb } = require('../src/db/database') as typeof import('../src/db/database');
  const { runMigrations } = require('../src/db/migrate') as typeof import('../src/db/migrate');
  const functions = require('../src/modules/functions/function-service') as typeof import('../src/modules/functions/function-service');
  const model = require('../src/modules/ontology/ontology-service') as typeof import('../src/modules/ontology/ontology-service');
  const objects = require('../src/modules/objects/object-service') as typeof import('../src/modules/objects/object-service');
  try {
    runMigrations();
    functions.upsertFunction({ functionKey: 'double_value', name: '加倍', parameters: ['value'],
      expression: 'value * 2', outputType: 'number' }, 'tester');
    assert.throws(() => model.createType({ typeKey: 'Invalid', displayName: '错误类型', createdBy: 'tester',
      definition: { properties: [{ name: 'result', label: '结果', type: 'number',
        computed: { functionKey: 'double_value', inputs: { value: 'missing' } } }] } }), /输入属性不存在/);
    model.createType({ typeKey: 'Reading', displayName: '读数', createdBy: 'tester', definition: { properties: [
      { name: 'temperature', label: '温度', type: 'number', required: true },
      { name: 'privateValue', label: '敏感值', type: 'number', sensitive: 'LEGAL' },
      { name: 'doubleTemperature', label: '双倍温度', type: 'number',
        computed: { functionKey: 'double_value', inputs: { value: 'temperature' } } },
      { name: 'doublePrivate', label: '双倍敏感值', type: 'number',
        computed: { functionKey: 'double_value', inputs: { value: 'privateValue' } } },
    ] } });
    model.publishType('Reading', 'tester');
    assert.throws(() => objects.createObject({ typeKey: 'Reading', actor: 'tester',
      payload: { temperature: 3, doubleTemperature: 6 } }), /计算属性不可写入/);
    const created = objects.createObject({ typeKey: 'Reading', actor: 'tester',
      payload: { temperature: 3, privateValue: 4 } });
    const next = model.createTypeVersion('Reading', { properties: [
      ...model.getType('Reading').definition.properties,
      { name: 'anotherDouble', label: '另一计算值', type: 'number',
        computed: { functionKey: 'double_value', inputs: { value: 'temperature' } } },
    ] }, 'tester');
    model.publishVersionWithMigration('Reading', next.versions[0].schemaVersion, 'tester');
    assert.equal(created.payload.doubleTemperature, 6);
    assert.equal(created.payload.doublePrivate, 8);
    assert.equal(objects.getObject(created.objectId).payload.anotherDouble, 6);
    const stored = getDb().prepare('SELECT payload_json FROM object_instance WHERE object_id = ?')
      .get(created.objectId) as { payload_json: string };
    assert.equal(Object.hasOwn(JSON.parse(stored.payload_json), 'doubleTemperature'), false);
    assert.equal(objects.queryObjects({ typeKey: 'Reading' }).items[0].preview.doubleTemperature, 6);
    const viewer = { id: 'viewer', username: 'viewer', displayName: '查看者', roles: ['operator'],
      securityClearance: 'TOP_SECRET' };
    const visible = objects.getObject(created.objectId, { actor: viewer });
    assert.equal(visible.payload.doubleTemperature, 6);
    assert.equal(Object.hasOwn(visible.payload, 'privateValue'), false);
    assert.equal(Object.hasOwn(visible.payload, 'doublePrivate'), false);
    assert.equal(Object.hasOwn(objects.queryObjects({ typeKey: 'Reading' }, viewer).items[0].preview,
      'doublePrivate'), false);
    assert.throws(() => objects.updateObject({ objectId: created.objectId,
      payload: { doubleTemperature: 999 }, actor: 'tester' }), /计算属性不可写入/);
    assert.equal(objects.updateObject({ objectId: created.objectId,
      payload: { temperature: 5 }, actor: 'tester' }).payload.doubleTemperature, 10);
    assert.throws(() => functions.deleteFunction('double_value', 'tester'), /仍被引用/);
    assert.throws(() => functions.upsertFunction({ functionKey: 'double_value', name: '加倍',
      parameters: ['value'], expression: 'value * 2', outputType: 'string' }, 'tester'), /已有引用/);
    functions.upsertFunction({ functionKey: 'double_value', name: '三倍', parameters: ['value'],
      expression: 'value * 3', outputType: 'number' }, 'tester');
    assert.equal(objects.getObject(created.objectId).payload.doubleTemperature, 15);
  } finally {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(file + suffix); } catch { /* 临时数据库文件不存在 */ }
    }
  }
});
