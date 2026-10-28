-- 兼容开发期间已执行过早期 019 迁移的演示库；新库执行时这些更新均为空操作。
UPDATE object_instance SET title = '市民疑似异常行为反映-20261009-001'
WHERE type_key = 'ObservedEvent' AND title IN ('EVT-2026-001', '市民反映某人行为异常-20261008-001')
  AND json_extract(payload_json, '$.description') = '市民反映某人行为异常（虚构误报示例）';
UPDATE object_instance SET title = '广场巡逻未见异常-20261009-002'
WHERE type_key = 'ObservedEvent' AND title IN ('EVT-2026-002', '巡逻记录显示该时段一切正常-20261009-002')
  AND json_extract(payload_json, '$.description') = '巡逻记录显示该时段一切正常（反证）';
UPDATE object_instance SET title = '单源行为线索指标-20261009-001'
WHERE type_key = 'RiskIndicator' AND title IN ('RI-行为异常', '单源行为线索指标-20261008-001')
  AND json_extract(payload_json, '$.basedOnEvent') = 'EVT-2026-001';
UPDATE object_instance SET title = '公共安全核查个案-20261009-001'
WHERE type_key = 'SafetyCase' AND title = 'PS-2026-001'
  AND json_extract(payload_json, '$.purposeStatement') = '依法核查可能影响公共安全的行为事件';

INSERT INTO object_revision
  (id, object_id, revision, payload_json, changed_fields, changed_by, change_reason, created_at)
SELECT 'rev_' || lower(hex(randomblob(12))), object_id, revision + 1,
  json_remove(payload_json, '$.ruleVersion'), '["ruleVersion"]', 'system',
  '演示指标来源说明更正', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM object_instance
WHERE type_key = 'RiskIndicator' AND title = '单源行为线索指标-20261009-001'
  AND json_extract(payload_json, '$.ruleVersion') = 'ps-rule-v1';
UPDATE object_instance SET payload_json = json_remove(payload_json, '$.ruleVersion'),
  revision = revision + 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE type_key = 'RiskIndicator' AND title = '单源行为线索指标-20261009-001'
  AND json_extract(payload_json, '$.ruleVersion') = 'ps-rule-v1';
