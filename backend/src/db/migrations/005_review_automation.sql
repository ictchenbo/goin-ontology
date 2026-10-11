-- 证据立场、用途与有效期，以及自动化去重记录。
ALTER TABLE source_record ADD COLUMN purpose TEXT NOT NULL DEFAULT '';
ALTER TABLE source_record ADD COLUMN expires_at TEXT;
ALTER TABLE source_record ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE source_record_revision ADD COLUMN purpose TEXT NOT NULL DEFAULT '';
ALTER TABLE source_record_revision ADD COLUMN expires_at TEXT;
ALTER TABLE evidence ADD COLUMN stance TEXT NOT NULL DEFAULT 'support';
CREATE TABLE automation_run (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES automation_rule(id),
  object_id TEXT NOT NULL REFERENCES object_instance(object_id),
  object_revision INTEGER NOT NULL,
  effect_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'succeeded',
  result_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(rule_id, object_id, object_revision)
);
