-- 应用领域：现有数据归入一个领域；新数据由服务端写入当前工作领域。
CREATE TABLE application_domain (
  id TEXT PRIMARY KEY,
  domain_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO application_domain (id, domain_key, display_name, created_by, created_at, updated_at)
SELECT 'dom_existing',
  CASE WHEN (SELECT COUNT(*) FROM object_instance) = 0 THEN 'demo'
       WHEN EXISTS (SELECT 1 FROM ontology_type WHERE type_key IN ('Supplier', 'IntelReport')) THEN 'legacy'
       ELSE 'public-safety' END,
  CASE WHEN (SELECT COUNT(*) FROM object_instance) = 0 THEN '演示领域'
       WHEN EXISTS (SELECT 1 FROM ontology_type WHERE type_key IN ('Supplier', 'IntelReport')) THEN '现有数据'
       ELSE '公共安全' END,
  'system', datetime('now'), datetime('now');

CREATE TABLE application_domain_member (
  domain_id TEXT NOT NULL REFERENCES application_domain(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (domain_id, user_id)
);
INSERT INTO application_domain_member (domain_id, user_id, created_at)
SELECT 'dom_existing', id, datetime('now') FROM users;

-- 首版保留现有全局唯一技术键；领域字段用于隔离和关联校验。
ALTER TABLE ontology_type ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE link_def ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE interface_def ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE shared_property ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE function_def ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE rule_def ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE action_type ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE automation_rule ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE decision_type ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE object_instance ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE link_instance ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE source_record ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE evidence ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE ingest_job ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE decision_case ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE case_object ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE action_run ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE audit_event ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE outbox_message ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE idempotency_record ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE attachment ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE ai_suggestion ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE webhook_delivery ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';
ALTER TABLE automation_run ADD COLUMN domain_id TEXT NOT NULL DEFAULT 'dom_existing';

CREATE INDEX idx_type_domain ON ontology_type(domain_id, updated_at DESC);
CREATE INDEX idx_object_domain ON object_instance(domain_id, type_key, deleted, updated_at DESC);
CREATE INDEX idx_link_domain ON link_instance(domain_id, is_valid);
CREATE INDEX idx_case_domain ON decision_case(domain_id, state, updated_at DESC);
CREATE INDEX idx_source_domain ON source_record(domain_id, recorded_at DESC);
CREATE INDEX idx_audit_domain ON audit_event(domain_id, created_at DESC);

-- 交叉引用必须落在同一应用领域。更新关联端点时同样执行检查。
CREATE TRIGGER trg_object_domain_insert BEFORE INSERT ON object_instance BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ontology_type WHERE type_key = NEW.type_key AND domain_id = NEW.domain_id)
    THEN RAISE(ABORT, 'object type domain mismatch') END;
END;
CREATE TRIGGER trg_link_def_domain_insert BEFORE INSERT ON link_def BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ontology_type WHERE type_key = NEW.from_type AND domain_id = NEW.domain_id)
    OR NOT EXISTS (SELECT 1 FROM ontology_type WHERE type_key = NEW.to_type AND domain_id = NEW.domain_id)
    THEN RAISE(ABORT, 'link definition domain mismatch') END;
END;
CREATE TRIGGER trg_link_instance_domain_insert BEFORE INSERT ON link_instance BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM link_def WHERE link_key = NEW.link_key AND domain_id = NEW.domain_id)
    OR NOT EXISTS (SELECT 1 FROM object_instance WHERE object_id = NEW.from_object_id AND domain_id = NEW.domain_id)
    OR NOT EXISTS (SELECT 1 FROM object_instance WHERE object_id = NEW.to_object_id AND domain_id = NEW.domain_id)
    THEN RAISE(ABORT, 'link domain mismatch') END;
END;
CREATE TRIGGER trg_evidence_domain_insert BEFORE INSERT ON evidence BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM object_instance WHERE object_id = NEW.object_id AND domain_id = NEW.domain_id)
    OR NOT EXISTS (SELECT 1 FROM source_record WHERE id = NEW.source_id AND domain_id = NEW.domain_id)
    THEN RAISE(ABORT, 'evidence domain mismatch') END;
END;
CREATE TRIGGER trg_case_object_domain_insert BEFORE INSERT ON case_object BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM decision_case WHERE id = NEW.case_id AND domain_id = NEW.domain_id)
    OR NOT EXISTS (SELECT 1 FROM object_instance WHERE object_id = NEW.object_id AND domain_id = NEW.domain_id)
    THEN RAISE(ABORT, 'case object domain mismatch') END;
END;
CREATE TRIGGER trg_case_domain_insert BEFORE INSERT ON decision_case BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM decision_type WHERE type_key = NEW.decision_type_key AND domain_id = NEW.domain_id)
    THEN RAISE(ABORT, 'decision type domain mismatch') END;
END;
