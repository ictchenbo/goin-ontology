import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import fs from 'fs';

test('类型属性版本、Interface 契约和 1:N Link 可通过管理接口完成生命周期', () => {
  const file = path.join(os.tmpdir(), `ooda-model-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  const { closeDb } = require('../src/db/database') as typeof import('../src/db/database');
  const { runMigrations } = require('../src/db/migrate') as typeof import('../src/db/migrate');
  const model = require('../src/modules/ontology/ontology-service') as typeof import('../src/modules/ontology/ontology-service');
  const objects = require('../src/modules/objects/object-service') as typeof import('../src/modules/objects/object-service');
  try {
    runMigrations();
    model.createInterface({ interfaceKey: 'Named', displayName: '具名对象',
      properties: [{ name: 'name', type: 'string', required: true }] });
    assert.throws(() => model.createType({ typeKey: 'Supplier', displayName: '供应商',
      definition: { properties: [] }, interfaces: ['Named'], createdBy: 'tester' }), /属性契约/);

    const definition = { properties: [{ name: 'name', label: '名称', type: 'string' as const, required: true }] };
    model.createType({ typeKey: 'Supplier', displayName: '供应商', definition, interfaces: ['Named'], createdBy: 'tester' });
    model.createType({ typeKey: 'Order', displayName: '订单', definition, createdBy: 'tester' });
    model.publishType('Supplier', 'tester');
    model.publishType('Order', 'tester');
    model.createLinkDef({ linkKey: 'supplier_orders', displayName: '供应商订单',
      fromType: 'Supplier', toType: 'Order', cardinality: '1:N', actor: 'tester' });
    const s1 = objects.createObject({ typeKey: 'Supplier', payload: { name: 'S1' }, actor: 'tester' });
    const s2 = objects.createObject({ typeKey: 'Supplier', payload: { name: 'S2' }, actor: 'tester' });
    const o1 = objects.createObject({ typeKey: 'Order', payload: { name: 'O1' }, actor: 'tester' });
    const o2 = objects.createObject({ typeKey: 'Order', payload: { name: 'O2' }, actor: 'tester' });
    const firstLink = objects.createLink({ linkKey: 'supplier_orders', fromObjectId: s1.objectId, toObjectId: o1.objectId, actor: 'tester' });
    objects.createLink({ linkKey: 'supplier_orders', fromObjectId: s1.objectId, toObjectId: o2.objectId, actor: 'tester' });
    assert.throws(() => objects.createLink({ linkKey: 'supplier_orders', fromObjectId: s2.objectId,
      toObjectId: o1.objectId, actor: 'tester' }), /多条入边/);

    const replaced = objects.replaceLink(firstLink.linkId, { linkKey: 'supplier_orders',
      fromObjectId: s2.objectId, toObjectId: o1.objectId, actor: 'tester' });
    assert.equal(objects.listLinks({ linkKey: 'supplier_orders' }).some((link) => link.linkId === firstLink.linkId), false);
    assert.equal(objects.listLinks({ linkKey: 'supplier_orders' }).some((link) => link.linkId === replaced.linkId), true);
    assert.throws(() => objects.replaceLink(replaced.linkId, { linkKey: 'supplier_orders',
      fromObjectId: s1.objectId, toObjectId: o2.objectId, actor: 'tester' }), /相同连接已存在/);
    assert.equal(objects.listLinks({ linkKey: 'supplier_orders' }).some((link) => link.linkId === replaced.linkId), true);

    model.createTypeVersion('Supplier', { properties: [
      definition.properties[0], { name: 'code', label: '编码', type: 'string', required: true },
    ] }, 'tester', { migration: { defaults: { code: 'UNKNOWN' } } });
    objects.createObject({ typeKey: 'Supplier', payload: { name: 'S3' }, actor: 'tester' });
    model.publishVersionWithMigration('Supplier', 2, 'tester', { defaults: { code: 'UNKNOWN' } });
    assert.equal(model.getType('Supplier').currentVersion, 2);
    assert.equal(objects.getObject(s1.objectId).payload.code, 'UNKNOWN');
    assert.throws(() => objects.createObject({ typeKey: 'Supplier', payload: { name: 'S4' }, actor: 'tester' }), /缺少必填属性/);

    model.rollbackTypeVersion('Supplier', 1, 'tester', { dropFields: ['code'] });
    assert.equal(model.getType('Supplier').currentVersion, 3);
    assert.equal(objects.getObject(s1.objectId).payload.code, undefined);
    assert.equal(objects.getObject(s1.objectId).schemaVersion, 3);

    const archived = model.deleteLinkDef('supplier_orders', 'tester');
    assert.equal(archived.archived, true);
    assert.equal(objects.listLinks({ linkKey: 'supplier_orders' }).length, 0);
    assert.throws(() => objects.createLink({ linkKey: 'supplier_orders', fromObjectId: s2.objectId,
      toObjectId: o1.objectId, actor: 'tester' }), /已归档/);
  } finally {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(file + suffix); } catch { /* 临时文件不存在时忽略 */ }
    }
  }
});

test('共享属性可复用，更新后类型须分别发布新版本', () => {
  const file = path.join(os.tmpdir(), `ooda-shared-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  const { closeDb } = require('../src/db/database') as typeof import('../src/db/database');
  const { runMigrations } = require('../src/db/migrate') as typeof import('../src/db/migrate');
  const model = require('../src/modules/ontology/ontology-service') as typeof import('../src/modules/ontology/ontology-service');
  try {
    runMigrations();
    const first = model.createSharedProperty('status',
      { name: 'status', label: '状态', type: 'string', required: true }, 'tester');
    const refV1 = { ...first.definition, sharedKey: 'status', sharedVersion: 1 };
    for (const typeKey of ['Shipment', 'Order']) {
      model.createType({ typeKey, displayName: typeKey, definition: { properties: [refV1] }, createdBy: 'tester' });
      model.publishType(typeKey, 'tester');
    }
    assert.deepEqual(model.listSharedProperties()[0].usedBy.sort(), ['Order', 'Shipment']);
    const second = model.updateSharedProperty('status',
      { name: 'status', label: '处理状态', type: 'string', required: true }, 1, 'tester');
    assert.equal(second.version, 2);
    assert.equal(model.getType('Order').publishedDefinition.properties[0].label, '状态');
    assert.throws(() => model.updateSharedProperty('status', second.definition, 1, 'tester'), /版本冲突/);
    assert.throws(() => model.createTypeVersion('Shipment', { properties: [
      { ...second.definition, label: '伪造标签', sharedKey: 'status', sharedVersion: 2 },
    ] }, 'tester'), /与引用版本不一致/);
    model.createTypeVersion('Shipment', { properties: [
      { ...second.definition, sharedKey: 'status', sharedVersion: 2 },
    ] }, 'tester');
    model.publishType('Shipment', 'tester');
    assert.equal(model.getType('Shipment').publishedDefinition.properties[0].label, '处理状态');
    assert.equal(model.getType('Order').publishedDefinition.properties[0].label, '状态');
  } finally {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(file + suffix); } catch { /* 临时文件不存在时忽略 */ }
    }
  }
});

test('关系自环默认禁止，可显式开启，关闭前需清理已有自环', () => {
  const file = path.join(os.tmpdir(), `ooda-self-link-${process.pid}-${Date.now()}.db`);
  process.env.DATABASE_PATH = file;
  const { closeDb } = require('../src/db/database') as typeof import('../src/db/database');
  const { runMigrations } = require('../src/db/migrate') as typeof import('../src/db/migrate');
  const model = require('../src/modules/ontology/ontology-service') as typeof import('../src/modules/ontology/ontology-service');
  const objects = require('../src/modules/objects/object-service') as typeof import('../src/modules/objects/object-service');
  try {
    runMigrations();
    model.createType({ typeKey: 'Person', displayName: '人员', definition: { properties: [] }, createdBy: 'tester' });
    model.publishType('Person', 'tester');
    const person = objects.createObject({ typeKey: 'Person', payload: {}, actor: 'tester' });
    const other = objects.createObject({ typeKey: 'Person', payload: {}, actor: 'tester' });
    const relation = model.createLinkDef({ linkKey: 'Friend', displayName: '朋友',
      fromType: 'Person', toType: 'Person', cardinality: 'N:M', actor: 'tester' });
    assert.equal(relation.allowSelfLoop, false);
    assert.throws(() => objects.createLink({ linkKey: 'Friend', fromObjectId: person.objectId,
      toObjectId: person.objectId, actor: 'tester' }), /不允许对象连接自身/);
    const ordinary = objects.createLink({ linkKey: 'Friend', fromObjectId: person.objectId,
      toObjectId: other.objectId, actor: 'tester' });
    assert.throws(() => objects.replaceLink(ordinary.linkId, { linkKey: 'Friend',
      fromObjectId: person.objectId, toObjectId: person.objectId, actor: 'tester' }), /不允许对象连接自身/);
    assert.equal(objects.listLinks({ linkKey: 'Friend' }).some((link) => link.linkId === ordinary.linkId), true);
    model.updateLinkDef('Friend', { allowSelfLoop: true }, 'tester');
    const self = objects.createLink({ linkKey: 'Friend', fromObjectId: person.objectId,
      toObjectId: person.objectId, actor: 'tester' });
    assert.throws(() => model.updateLinkDef('Friend', { allowSelfLoop: false }, 'tester'), /先移除/);
    objects.invalidateLink(self.linkId, 'tester');
    assert.equal(model.updateLinkDef('Friend', { allowSelfLoop: false }, 'tester').allowSelfLoop, false);
  } finally {
    closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      try { fs.unlinkSync(file + suffix); } catch { /* 临时文件不存在时忽略 */ }
    }
  }
});
