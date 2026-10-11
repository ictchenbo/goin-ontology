-- Action 运行层也固定原始请求，阻止同键变更参数。
ALTER TABLE action_run ADD COLUMN request_hash TEXT NOT NULL DEFAULT '';
