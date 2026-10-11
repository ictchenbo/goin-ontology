-- 001 初始 Schema：覆盖 Ontology 注册表、对象存储、证据、决策案例、审批执行、审计与 Outbox
PRAGMA foreign_keys = ON;

-- ===== 用户与角色 =====
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  roles TEXT NOT NULL DEFAULT '[]',          -- JSON 数组，如 ["analyst","approver"]
  security_clearance TEXT NOT NULL DEFAULT 'PUBLIC', -- PUBLIC/CONFIDENTIAL/SECRET
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===== Ontology 类型注册 =====
CREATE TABLE ontology_type (
  type_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'entity',   -- entity/event/decision
  interfaces TEXT NOT NULL DEFAULT '[]',     -- JSON 数组：所属 Interface
  icon TEXT NOT NULL DEFAULT 'box',
  state TEXT NOT NULL DEFAULT 'draft',       -- draft/published/archived
  current_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE type_version (
  id TEXT PRIMARY KEY,
  type_key TEXT NOT NULL REFERENCES ontology_type(type_key),
  schema_version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,             -- {properties:[...], display_property, title_template}
  state TEXT NOT NULL DEFAULT 'draft',       -- draft/published/archived
  change_note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  published_at TEXT,
  UNIQUE(type_key, schema_version)
);

CREATE TABLE link_def (
  link_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  from_type TEXT NOT NULL REFERENCES ontology_type(type_key),
  to_type TEXT NOT NULL REFERENCES ontology_type(type_key),
  cardinality TEXT NOT NULL DEFAULT '1:N',   -- 1:1 / 1:N / N:M
  inverse_name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  required INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL
);

CREATE TABLE interface_def (
  interface_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  properties TEXT NOT NULL DEFAULT '[]',     -- [{name,type,required}]
  capabilities TEXT NOT NULL DEFAULT '[]',   -- 可执行能力标识
  created_at TEXT NOT NULL
);

-- ===== 对象实例与修订 =====
CREATE TABLE object_instance (
  object_id TEXT PRIMARY KEY,
  type_key TEXT NOT NULL REFERENCES ontology_type(type_key),
  title TEXT NOT NULL DEFAULT '',
  payload_json TEXT NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  security_labels TEXT NOT NULL DEFAULT '["PUBLIC"]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_object_type ON object_instance(type_key, deleted);
CREATE INDEX idx_object_updated ON object_instance(updated_at);

CREATE TABLE object_revision (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES object_instance(object_id),
  revision INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  changed_fields TEXT NOT NULL DEFAULT '[]',
  changed_by TEXT NOT NULL,
  change_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE(object_id, revision)
);
CREATE INDEX idx_revision_object ON object_revision(object_id);

CREATE TABLE link_instance (
  id TEXT PRIMARY KEY,
  link_key TEXT NOT NULL REFERENCES link_def(link_key),
  from_object_id TEXT NOT NULL REFERENCES object_instance(object_id),
  to_object_id TEXT NOT NULL REFERENCES object_instance(object_id),
  props_json TEXT NOT NULL DEFAULT '{}',
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  is_valid INTEGER NOT NULL DEFAULT 1,
  source_id TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX idx_link_from ON link_instance(from_object_id, is_valid);
CREATE INDEX idx_link_to ON link_instance(to_object_id, is_valid);

-- ===== 来源与证据 =====
CREATE TABLE source_record (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL,                  -- 来源系统标识
  external_key TEXT NOT NULL,                -- 稳定去重键
  source_type TEXT NOT NULL DEFAULT 'manual', -- csv/json/webhook/manual/form
  hash TEXT NOT NULL,
  observed_at TEXT NOT NULL,                 -- 采集时间
  business_at TEXT,                          -- 业务生效时间
  confidence REAL NOT NULL DEFAULT 1.0,
  security_labels TEXT NOT NULL DEFAULT '["PUBLIC"]',
  raw_json TEXT NOT NULL DEFAULT '{}',
  recorded_at TEXT NOT NULL,
  UNIQUE(source_key, external_key)
);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  object_id TEXT NOT NULL REFERENCES object_instance(object_id),
  source_id TEXT NOT NULL REFERENCES source_record(id),
  field_path TEXT NOT NULL DEFAULT '',
  claim TEXT NOT NULL DEFAULT '',
  observed_at TEXT NOT NULL,
  business_at TEXT,
  confidence REAL NOT NULL DEFAULT 1.0,
  status TEXT NOT NULL DEFAULT 'active',     -- active/superseded/retracted
  created_at TEXT NOT NULL
);
CREATE INDEX idx_evidence_object ON evidence(object_id, status);

-- ===== 规则 / 派生指标 =====
CREATE TABLE rule_def (
  rule_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,                        -- derived_metric / constraint / trigger / score_normalizer
  description TEXT NOT NULL DEFAULT '',
  expression TEXT NOT NULL,                  -- 受限 DSL
  input_deps TEXT NOT NULL DEFAULT '[]',     -- 依赖字段列表
  output_type TEXT NOT NULL DEFAULT 'number',
  scope_type TEXT NOT NULL DEFAULT '',       -- 适用对象类型
  version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'published',
  test_cases TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===== Action 类型 =====
CREATE TABLE action_type (
  action_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  params_schema TEXT NOT NULL DEFAULT '{}',  -- JSON Schema 精简版
  preconditions TEXT NOT NULL DEFAULT '[]',  -- 规则表达式列表
  write_set TEXT NOT NULL DEFAULT '[]',      -- [{op, type, fields...}]
  approval_policy TEXT NOT NULL DEFAULT '{}',
  required_roles TEXT NOT NULL DEFAULT '[]',
  external_effects TEXT NOT NULL DEFAULT '[]',
  compensation TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL
);

-- ===== 来源导入任务 =====
CREATE TABLE ingest_job (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  filename TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',    -- pending/mapping/ready/done/failed
  total_rows INTEGER NOT NULL DEFAULT 0,
  accepted_rows INTEGER NOT NULL DEFAULT 0,
  rejected_rows INTEGER NOT NULL DEFAULT 0,
  mapping_json TEXT NOT NULL DEFAULT '{}',
  errors_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE ingest_row (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ingest_job(id),
  row_index INTEGER NOT NULL,
  raw_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',    -- pending/accepted/rejected/applied
  error TEXT NOT NULL DEFAULT '',
  mapped_object_id TEXT
);
CREATE INDEX idx_ingest_row_job ON ingest_row(job_id, status);

-- ===== 决策类型与案例 =====
CREATE TABLE decision_type (
  type_key TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  trigger_config TEXT NOT NULL DEFAULT '{}',
  target_object_type TEXT NOT NULL DEFAULT '',
  required_facts TEXT NOT NULL DEFAULT '[]',
  role_matrix TEXT NOT NULL DEFAULT '{}',    -- {propose:[], approve:[], execute:[]}
  policy_version TEXT NOT NULL DEFAULT 'v1',
  criteria TEXT NOT NULL DEFAULT '[]',       -- [{key,name,direction,unit,weight,normalize,threshold}]
  constraints TEXT NOT NULL DEFAULT '[]',    -- [{key,name,severity,expression,message,scope}]
  approval_route TEXT NOT NULL DEFAULT '[]',
  state TEXT NOT NULL DEFAULT 'published',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE decision_case (
  id TEXT PRIMARY KEY,
  case_key TEXT NOT NULL UNIQUE,
  decision_type_key TEXT NOT NULL REFERENCES decision_type(type_key),
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'New',
  owner TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal',
  deadline TEXT,
  trigger_ref TEXT NOT NULL DEFAULT '',
  snapshot_id TEXT,
  model_version_ref TEXT NOT NULL DEFAULT '{}',
  security_labels TEXT NOT NULL DEFAULT '["PUBLIC"]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX idx_case_state ON decision_case(state);
CREATE INDEX idx_case_type ON decision_case(decision_type_key);

CREATE TABLE case_object (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES decision_case(id),
  object_id TEXT NOT NULL REFERENCES object_instance(object_id),
  role TEXT NOT NULL DEFAULT 'related',      -- trigger/subject/related/constraint_ref
  frozen_revision INTEGER NOT NULL,
  frozen_payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(case_id, object_id, role)
);

CREATE TABLE case_snapshot (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES decision_case(id),
  kind TEXT NOT NULL DEFAULT 'orient',       -- orient/pre_decision/final
  objects_json TEXT NOT NULL,
  links_json TEXT NOT NULL DEFAULT '[]',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  rule_versions_json TEXT NOT NULL DEFAULT '{}',
  conflicts_json TEXT NOT NULL DEFAULT '[]',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE assumption (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES decision_case(id),
  statement TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.5,
  status TEXT NOT NULL DEFAULT 'open',       -- open/verified/refuted
  owner TEXT NOT NULL DEFAULT '',
  evidence_ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===== 备选方案、约束结果、评分 =====
CREATE TABLE alternative (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES decision_case(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  proposed_actions TEXT NOT NULL DEFAULT '[]',
  assumption_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',      -- draft/feasible/infeasible/selected/rejected
  infeasible_reasons TEXT NOT NULL DEFAULT '[]',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_alt_case ON alternative(case_id);

CREATE TABLE scenario_run (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES decision_case(id),
  alternative_id TEXT REFERENCES alternative(id),
  overlay_json TEXT NOT NULL DEFAULT '{}',
  inputs_json TEXT NOT NULL DEFAULT '{}',
  outputs_json TEXT NOT NULL DEFAULT '{}',
  metric_vector_json TEXT NOT NULL DEFAULT '{}',
  diffs_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'completed',
  run_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE constraint_result (
  id TEXT PRIMARY KEY,
  scenario_run_id TEXT NOT NULL REFERENCES scenario_run(id),
  alternative_id TEXT NOT NULL REFERENCES alternative(id),
  constraint_key TEXT NOT NULL,
  constraint_name TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL DEFAULT 'hard',
  passed INTEGER NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE score_result (
  id TEXT PRIMARY KEY,
  scenario_run_id TEXT NOT NULL REFERENCES scenario_run(id),
  alternative_id TEXT NOT NULL REFERENCES alternative(id),
  criterion_key TEXT NOT NULL,
  raw_value REAL NOT NULL,
  normalized REAL NOT NULL,
  weight REAL NOT NULL,
  weighted REAL NOT NULL,
  weights_version TEXT NOT NULL DEFAULT 'v1',
  created_at TEXT NOT NULL
);

CREATE TABLE score_run (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES decision_case(id),
  scenario_run_id TEXT NOT NULL,
  weights_json TEXT NOT NULL,
  ranking_json TEXT NOT NULL DEFAULT '[]',
  winner_alternative_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE decision_record (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES decision_case(id),
  selected_alternative_id TEXT REFERENCES alternative(id),
  rationale TEXT NOT NULL DEFAULT '',
  dissent TEXT NOT NULL DEFAULT '',
  overridden INTEGER NOT NULL DEFAULT 0,     -- 是否选择了非最高分方案
  score_run_id TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- ===== 审批 =====
CREATE TABLE approval (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES decision_case(id),
  alternative_id TEXT REFERENCES alternative(id),
  requested_by TEXT NOT NULL,
  actor TEXT,
  decision TEXT,                             -- approved/rejected/pending
  comment TEXT NOT NULL DEFAULT '',
  required_role TEXT NOT NULL DEFAULT 'approver',
  status TEXT NOT NULL DEFAULT 'pending',    -- pending/approved/rejected/invalidated
  invalidated_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE INDEX idx_approval_status ON approval(status);

-- ===== Action 执行 =====
CREATE TABLE action_run (
  id TEXT PRIMARY KEY,
  case_id TEXT REFERENCES decision_case(id),
  alternative_id TEXT REFERENCES alternative(id),
  action_key TEXT NOT NULL,
  params_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',    -- pending/validated/executing/succeeded/failed/compensated
  idempotency_key TEXT NOT NULL UNIQUE,
  result_json TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL,
  executed_at TEXT,
  created_at TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_action_run_case ON action_run(case_id, status);

CREATE TABLE outbox_message (
  id TEXT PRIMARY KEY,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  delivery_state TEXT NOT NULL DEFAULT 'pending', -- pending/sent/failed/dead
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  delivered_at TEXT
);
CREATE INDEX idx_outbox_state ON outbox_message(delivery_state);

-- ===== 结果反馈 =====
CREATE TABLE outcome (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES decision_case(id),
  expected_json TEXT NOT NULL DEFAULT '{}',
  actual_json TEXT NOT NULL DEFAULT '{}',
  deviation_json TEXT NOT NULL DEFAULT '{}',
  metrics_json TEXT NOT NULL DEFAULT '{}',
  review_notes TEXT NOT NULL DEFAULT '',
  attribution TEXT NOT NULL DEFAULT '',
  recorded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

-- ===== 审计 =====
CREATE TABLE audit_event (
  id TEXT PRIMARY KEY,
  actor TEXT NOT NULL,
  event_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL DEFAULT '',
  before_hash TEXT NOT NULL DEFAULT '',
  after_hash TEXT NOT NULL DEFAULT '',
  correlation_id TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit_resource ON audit_event(resource_type, resource_id);
CREATE INDEX idx_audit_time ON audit_event(created_at);

-- ===== 自动化触发 =====
CREATE TABLE automation_rule (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trigger_type TEXT NOT NULL,                -- object_change / schedule / event
  condition_json TEXT NOT NULL DEFAULT '{}',
  effect_json TEXT NOT NULL DEFAULT '{}',    -- create_case / create_review_request / outbox
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ===== AI 建议（受控适配器，核心功能不依赖） =====
CREATE TABLE ai_suggestion (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  kind TEXT NOT NULL,                        -- explain / missing_facts / alternative_draft
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  model_version TEXT NOT NULL DEFAULT 'none',
  input_labels TEXT NOT NULL DEFAULT '[]',
  content_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'suggestion', -- suggestion/accepted/corrected/rejected
  correction_note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- ===== 幂等请求 =====
CREATE TABLE idempotency_record (
  idempotency_key TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  status_code INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
