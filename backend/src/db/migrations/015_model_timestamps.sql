-- 让关系、Interface 和 Action 定义能按最近修改时间排序。
ALTER TABLE link_def ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE link_def SET updated_at = created_at;

ALTER TABLE interface_def ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE interface_def SET updated_at = created_at;

ALTER TABLE action_type ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE action_type SET updated_at = created_at;
