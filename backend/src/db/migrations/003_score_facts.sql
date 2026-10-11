-- 评分事实完备性持久化：刷新后可回放 factsComplete / missingFacts
ALTER TABLE score_run ADD COLUMN facts_json TEXT NOT NULL DEFAULT '{}';
