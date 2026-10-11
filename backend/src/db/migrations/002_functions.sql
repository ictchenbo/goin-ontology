-- 可复用的安全 DSL 函数定义。
CREATE TABLE function_def (
  function_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  parameters_json TEXT NOT NULL DEFAULT '[]',
  expression TEXT NOT NULL,
  output_type TEXT NOT NULL DEFAULT 'number',
  version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
