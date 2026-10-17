-- 关联端点变更时继续校验领域，防止后续更新绕过创建时的隔离约束。
CREATE TRIGGER trg_object_domain_update BEFORE UPDATE OF type_key, domain_id ON object_instance BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ontology_type WHERE type_key = NEW.type_key AND domain_id = NEW.domain_id)
    THEN RAISE(ABORT, 'object type domain mismatch') END;
END;
CREATE TRIGGER trg_link_def_domain_update BEFORE UPDATE OF from_type, to_type, domain_id ON link_def BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM ontology_type WHERE type_key = NEW.from_type AND domain_id = NEW.domain_id)
    OR NOT EXISTS (SELECT 1 FROM ontology_type WHERE type_key = NEW.to_type AND domain_id = NEW.domain_id)
    THEN RAISE(ABORT, 'link definition domain mismatch') END;
END;
CREATE TRIGGER trg_link_instance_domain_update BEFORE UPDATE OF link_key, from_object_id, to_object_id, domain_id ON link_instance BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM link_def WHERE link_key = NEW.link_key AND domain_id = NEW.domain_id)
    OR NOT EXISTS (SELECT 1 FROM object_instance WHERE object_id = NEW.from_object_id AND domain_id = NEW.domain_id)
    OR NOT EXISTS (SELECT 1 FROM object_instance WHERE object_id = NEW.to_object_id AND domain_id = NEW.domain_id)
    THEN RAISE(ABORT, 'link domain mismatch') END;
END;
CREATE TRIGGER trg_evidence_domain_update BEFORE UPDATE OF object_id, source_id, domain_id ON evidence BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM object_instance WHERE object_id = NEW.object_id AND domain_id = NEW.domain_id)
    OR NOT EXISTS (SELECT 1 FROM source_record WHERE id = NEW.source_id AND domain_id = NEW.domain_id)
    THEN RAISE(ABORT, 'evidence domain mismatch') END;
END;
CREATE TRIGGER trg_case_object_domain_update BEFORE UPDATE OF case_id, object_id, domain_id ON case_object BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM decision_case WHERE id = NEW.case_id AND domain_id = NEW.domain_id)
    OR NOT EXISTS (SELECT 1 FROM object_instance WHERE object_id = NEW.object_id AND domain_id = NEW.domain_id)
    THEN RAISE(ABORT, 'case object domain mismatch') END;
END;
CREATE TRIGGER trg_case_domain_update BEFORE UPDATE OF decision_type_key, domain_id ON decision_case BEGIN
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM decision_type WHERE type_key = NEW.decision_type_key AND domain_id = NEW.domain_id)
    THEN RAISE(ABORT, 'decision type domain mismatch') END;
END;
