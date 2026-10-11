-- 可回放事实与来源版本；旧数据保留默认值，由后续写入逐步补全。
ALTER TABLE case_snapshot ADD COLUMN freshness_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE object_instance ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE source_record_revision (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES source_record(id),
  revision INTEGER NOT NULL,
  hash TEXT NOT NULL,
  raw_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  business_at TEXT,
  confidence REAL NOT NULL,
  security_labels TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(source_id, revision)
);
CREATE INDEX idx_source_revision_source ON source_record_revision(source_id, revision);
