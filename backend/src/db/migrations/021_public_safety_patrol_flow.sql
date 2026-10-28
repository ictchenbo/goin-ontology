-- 仅为精确匹配的公共安全演示对象补充巡逻任务与记录连接；旧快照不回写。
INSERT INTO link_def (link_key, display_name, from_type, to_type, cardinality, created_at, domain_id)
SELECT 'task_produces_source', '任务产生来源记录', 'FollowUpTask', 'SourceRecord', '1:N',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), task_type.domain_id
FROM ontology_type AS task_type
JOIN ontology_type AS source_type ON source_type.type_key = 'SourceRecord'
  AND source_type.domain_id = task_type.domain_id
WHERE task_type.type_key = 'FollowUpTask'
  AND NOT EXISTS (SELECT 1 FROM link_def WHERE link_key = 'task_produces_source');

INSERT INTO object_instance
  (object_id, type_key, title, payload_json, revision, security_labels, created_at, updated_at, deleted, schema_version, domain_id)
SELECT 'obj_' || lower(hex(randomblob(12))), 'FollowUpTask', '广场巡逻核查任务-20261009-001',
  json_object('name', '广场巡逻核查任务-20261009-001',
    'dueAt', '2026-10-09T10:00:00Z', 'status', 'done', 'assignee', '巡逻组'),
  1, '["PUBLIC"]', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 0, 1, safety_case.domain_id
FROM object_instance AS safety_case
JOIN object_instance AS patrol_source ON patrol_source.type_key = 'SourceRecord'
  AND patrol_source.title = 'SRC-巡逻记录' AND patrol_source.deleted = 0
  AND patrol_source.domain_id = safety_case.domain_id
WHERE safety_case.type_key = 'SafetyCase'
  AND safety_case.title = '公共安全核查个案-20261009-001'
  AND json_extract(safety_case.payload_json, '$.purposeStatement') = '依法核查可能影响公共安全的行为事件'
  AND safety_case.deleted = 0
  AND NOT EXISTS (SELECT 1 FROM object_instance AS task WHERE task.type_key = 'FollowUpTask'
    AND task.title = '广场巡逻核查任务-20261009-001' AND task.deleted = 0
    AND task.domain_id = safety_case.domain_id);

INSERT INTO object_revision
  (id, object_id, revision, payload_json, changed_fields, changed_by, change_reason, created_at)
SELECT 'rev_' || lower(hex(randomblob(12))), object_id, 1, payload_json,
  '["name","dueAt","status","assignee"]', 'system', '补全公共安全演示巡逻流程', created_at
FROM object_instance AS task
WHERE task.type_key = 'FollowUpTask' AND task.title = '广场巡逻核查任务-20261009-001'
  AND NOT EXISTS (SELECT 1 FROM object_revision WHERE object_id = task.object_id);

INSERT INTO link_instance
  (id, link_key, from_object_id, to_object_id, valid_from, created_at, created_by, domain_id)
SELECT 'lnk_' || lower(hex(randomblob(12))), 'task_for_case', task.object_id, safety_case.object_id,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system', task.domain_id
FROM object_instance AS task
JOIN object_instance AS safety_case ON safety_case.type_key = 'SafetyCase'
  AND safety_case.title = '公共安全核查个案-20261009-001'
  AND safety_case.domain_id = task.domain_id AND safety_case.deleted = 0
WHERE task.type_key = 'FollowUpTask' AND task.title = '广场巡逻核查任务-20261009-001'
  AND task.deleted = 0
  AND EXISTS (SELECT 1 FROM link_def WHERE link_key = 'task_for_case' AND domain_id = task.domain_id)
  AND NOT EXISTS (SELECT 1 FROM link_instance AS existing
    WHERE existing.link_key = 'task_for_case' AND existing.from_object_id = task.object_id
      AND existing.to_object_id = safety_case.object_id AND existing.is_valid = 1);

INSERT INTO link_instance
  (id, link_key, from_object_id, to_object_id, valid_from, created_at, created_by, domain_id)
SELECT 'lnk_' || lower(hex(randomblob(12))), 'task_produces_source', task.object_id, patrol_source.object_id,
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'system', task.domain_id
FROM object_instance AS task
JOIN object_instance AS patrol_source ON patrol_source.type_key = 'SourceRecord'
  AND patrol_source.title = 'SRC-巡逻记录' AND patrol_source.domain_id = task.domain_id
  AND patrol_source.deleted = 0
WHERE task.type_key = 'FollowUpTask' AND task.title = '广场巡逻核查任务-20261009-001'
  AND task.deleted = 0
  AND EXISTS (SELECT 1 FROM link_def WHERE link_key = 'task_produces_source' AND domain_id = task.domain_id)
  AND NOT EXISTS (SELECT 1 FROM link_instance AS existing
    WHERE existing.link_key = 'task_produces_source' AND existing.from_object_id = task.object_id
      AND existing.to_object_id = patrol_source.object_id AND existing.is_valid = 1);
