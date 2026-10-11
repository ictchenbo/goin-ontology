-- 证据固定来源的确切版本，避免后续同键更新改变历史解释。
INSERT INTO source_record_revision
  (id, source_id, revision, hash, raw_json, observed_at, business_at, confidence,
   security_labels, recorded_at, purpose, expires_at)
SELECT 'srev_' || lower(hex(randomblob(12))), s.id, 1, s.hash, s.raw_json,
  s.observed_at, s.business_at, s.confidence, s.security_labels, s.recorded_at,
  s.purpose, s.expires_at
FROM source_record s
WHERE NOT EXISTS (SELECT 1 FROM source_record_revision r WHERE r.source_id = s.id);
ALTER TABLE evidence ADD COLUMN source_revision INTEGER NOT NULL DEFAULT 1;
