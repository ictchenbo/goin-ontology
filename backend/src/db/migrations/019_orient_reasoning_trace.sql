-- 新快照冻结适用触发规则的判断；旧快照保留 NULL，避免伪造历史结果。
ALTER TABLE case_snapshot ADD COLUMN rule_checks_json TEXT;

-- 仅校正原始演示规则的对象范围，不覆盖用户修改过的表达式。
UPDATE rule_def SET scope_type = 'Disruption', version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE rule_key = 'sc_delay_is_serious' AND scope_type = ''
  AND expression = 'coalesce(object.delayDays, 0) >= 3';
UPDATE rule_def SET scope_type = 'IntelReport', version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE rule_key = 'mil_needs_review' AND scope_type = ''
  AND expression = 'coalesce(object.confidence, 1) < 0.5';
UPDATE rule_def SET scope_type = 'ObservedEvent', version = version + 1,
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
WHERE rule_key = 'ps_single_source_flag' AND scope_type = ''
  AND expression = 'coalesce(object.sourceCount, 1) == 1';

-- 只调整精确匹配的合成事件标题；事件业务编号及历史快照原文保持不变。
UPDATE object_instance SET title = '市民疑似异常行为反映-20261009-001'
WHERE type_key = 'ObservedEvent' AND title = 'EVT-2026-001'
  AND json_extract(payload_json, '$.description') = '市民反映某人行为异常（虚构误报示例）';
UPDATE object_instance SET title = '广场巡逻未见异常-20261009-002'
WHERE type_key = 'ObservedEvent' AND title = 'EVT-2026-002'
  AND json_extract(payload_json, '$.description') = '巡逻记录显示该时段一切正常（反证）';
UPDATE object_instance SET title = '单源行为线索指标-20261009-001'
WHERE type_key = 'RiskIndicator' AND title = 'RI-行为异常'
  AND json_extract(payload_json, '$.basedOnEvent') = 'EVT-2026-001';
UPDATE object_instance SET title = '公共安全核查个案-20261009-001'
WHERE type_key = 'SafetyCase' AND title = 'PS-2026-001'
  AND json_extract(payload_json, '$.purposeStatement') = '依法核查可能影响公共安全的行为事件';

-- 演示指标原“规则版本”没有对应运行记录，移除该误导性字段并保留修订历史。
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
