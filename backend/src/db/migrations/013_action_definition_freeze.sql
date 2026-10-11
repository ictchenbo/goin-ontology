-- 审批冻结 Action 版本；运行记录保存执行时的完整定义以供历史回放。
ALTER TABLE approval ADD COLUMN action_versions_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE action_run ADD COLUMN action_version INTEGER;
ALTER TABLE action_run ADD COLUMN action_definition_json TEXT NOT NULL DEFAULT '{}';
