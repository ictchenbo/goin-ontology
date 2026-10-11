-- 共享属性以独立版本保存；对象类型继续持有冻结的属性定义快照。
CREATE TABLE shared_property (
  property_key TEXT PRIMARY KEY,
  definition_json TEXT NOT NULL,
  current_version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE shared_property_version (
  id TEXT PRIMARY KEY,
  property_key TEXT NOT NULL REFERENCES shared_property(property_key),
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(property_key, version)
);
