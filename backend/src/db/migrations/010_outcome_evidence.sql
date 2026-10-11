-- 结果证据和单位随结果记录保存，以便复盘与回放。
ALTER TABLE outcome ADD COLUMN evidence_refs TEXT NOT NULL DEFAULT '[]';
ALTER TABLE outcome ADD COLUMN units_json TEXT NOT NULL DEFAULT '{}';
