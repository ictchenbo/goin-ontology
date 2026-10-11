-- 决策类型只追加版本，案例持有确切版本标识。
CREATE TABLE decision_type_version (
  id TEXT PRIMARY KEY,
  type_key TEXT NOT NULL REFERENCES decision_type(type_key),
  policy_version TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_decision_type_version ON decision_type_version(type_key, created_at);
INSERT INTO decision_type_version (id, type_key, policy_version, definition_json, created_by, created_at)
SELECT 'dtv_' || lower(hex(randomblob(12))), type_key, policy_version,
  json_object('typeKey', type_key, 'displayName', display_name, 'description', description,
    'triggerConfig', json(trigger_config), 'targetObjectType', target_object_type,
    'requiredFacts', json(required_facts), 'roleMatrix', json(role_matrix),
    'policyVersion', policy_version, 'criteria', json(criteria),
    'constraints', json(constraints), 'approvalRoute', json(approval_route),
    'state', state, 'updatedAt', updated_at),
  'migration', updated_at
FROM decision_type;
