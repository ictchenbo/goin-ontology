-- 建议评估与公共安全演示策略升级。
ALTER TABLE ai_suggestion ADD COLUMN created_by TEXT NOT NULL DEFAULT '';
CREATE TABLE ai_evaluation (
  id TEXT PRIMARY KEY,
  suggestion_id TEXT NOT NULL REFERENCES ai_suggestion(id),
  checks_json TEXT NOT NULL,
  passed INTEGER NOT NULL,
  reviewed_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
UPDATE action_type SET approval_policy =
  '{"requiredRoles":["legal"],"legalAuthorityParam":"legalAuthorityId","requiredAuthorityType":"LegalAuthority","requireVerifiedField":"verificationStatus"}'
  WHERE action_key = 'ps_record_intervention';
