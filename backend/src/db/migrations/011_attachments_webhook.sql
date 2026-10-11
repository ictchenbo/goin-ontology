-- 附件元数据与 Webhook 投递幂等记录。
CREATE TABLE attachment (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES object_instance(object_id),
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  security_labels TEXT NOT NULL DEFAULT '["PUBLIC"]',
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_attachment_object ON attachment(object_id, created_at);
CREATE TABLE webhook_delivery (
  source_key TEXT NOT NULL,
  delivery_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES ingest_job(id),
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_key, delivery_key)
);
