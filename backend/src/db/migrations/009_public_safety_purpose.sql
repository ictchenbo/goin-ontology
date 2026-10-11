-- 现有演示来源和后续案例采用明确用途；旧案例保持原有版本引用。
UPDATE source_record SET purpose = 'public_safety_review',
  expires_at = strftime('%Y-%m-%dT%H:%M:%SZ', observed_at, '+180 days')
WHERE source_key = 'public-safety' AND purpose = '';
UPDATE source_record_revision SET purpose = 'public_safety_review',
  expires_at = strftime('%Y-%m-%dT%H:%M:%SZ', observed_at, '+180 days')
WHERE source_id IN (SELECT id FROM source_record WHERE source_key = 'public-safety')
  AND purpose = '';
UPDATE decision_type SET trigger_config = '{"requiredPurpose":"public_safety_review"}',
  policy_version = 'ps-v2'
WHERE type_key = 'ps_case_response';
INSERT INTO decision_type_version (id, type_key, policy_version, definition_json, created_by, created_at)
SELECT 'dtv_' || lower(hex(randomblob(12))), type_key, policy_version,
  json_object('typeKey', type_key, 'displayName', display_name, 'description', description,
    'triggerConfig', json(trigger_config), 'targetObjectType', target_object_type,
    'requiredFacts', json(required_facts), 'roleMatrix', json(role_matrix),
    'policyVersion', policy_version, 'criteria', json(criteria),
    'constraints', json(constraints), 'approvalRoute', json(approval_route),
    'state', state, 'updatedAt', updated_at),
  'migration', datetime('now')
FROM decision_type WHERE type_key = 'ps_case_response';
