"""从清理前备份恢复战场态势数据，并创建政治安全空领域。"""

import argparse
import json
import sqlite3
from contextlib import closing
from datetime import datetime
from pathlib import Path


TYPES = {
    "IntelReport", "Observation", "ThreatAssessment", "CourseOfAction",
    "CommandOrder", "Acknowledgement", "MissionObjective", "Capability",
    "OperationalConstraint", "Operation", "AreaOfInterest", "SourceAssessment",
    "FriendlyCapability",
}
LINKS = {
    "report_supports_observation", "report_refutes_observation",
    "assessment_cites_observation", "assessment_considers_coa",
    "coa_uses_capability", "order_implements_coa", "ack_for_order",
    "observation_in_area", "source_assesses_report", "operation_has_objective",
}
RULES = {"mil_evidence_strength", "mil_needs_review"}
ACTIONS = {"mil_issue_order", "mil_ack_order"}
DECISIONS = {"mil_threat_response"}
DOMAIN_ID = "dom_battlefield"


def select_ids(db, table, key, values, result_key):
    if not values:
        return set()
    placeholders = ",".join("?" for _ in values)
    return {row[0] for row in db.execute(
        f"SELECT {result_key} FROM {table} WHERE {key} IN ({placeholders})", tuple(sorted(values))
    )}


def copy_rows(source, target, table, key, values, domain_id=None):
    if not values:
        return 0
    source_columns = [row[1] for row in source.execute(f"PRAGMA table_info({table})")]
    target_info = list(target.execute(f"PRAGMA table_info({table})"))
    target_columns = {row[1] for row in target_info}
    primary_key = next(row[1] for row in target_info if row[5] == 1)
    columns = [column for column in source_columns if column in target_columns]
    if domain_id and "domain_id" in target_columns:
        columns.append("domain_id")
    placeholders = ",".join("?" for _ in values)
    rows = source.execute(
        f"SELECT {','.join(source_columns)} FROM {table} WHERE {key} IN ({placeholders})",
        tuple(sorted(values)),
    ).fetchall()
    inserted = 0
    for row in rows:
        source_row = dict(zip(source_columns, row))
        values_to_insert = [domain_id if column == "domain_id" else source_row[column] for column in columns]
        existing = target.execute(
            f"SELECT {','.join(columns)} FROM {table} WHERE {primary_key} = ?", (source_row[primary_key],)
        ).fetchone()
        if existing:
            if tuple(existing) != tuple(values_to_insert):
                raise RuntimeError(f"{table} 主键冲突: {source_row[primary_key]}")
            continue
        target.execute(
            f"INSERT INTO {table} ({','.join(columns)}) VALUES ({','.join('?' for _ in columns)})",
            values_to_insert,
        )
        inserted += 1
    return inserted


def create_domain(db, domain_id, key, name, description, admin_id, now):
    existing = db.execute("SELECT id FROM application_domain WHERE domain_key = ?", (key,)).fetchone()
    if existing and existing[0] != domain_id:
        raise RuntimeError(f"领域技术键已被其他 ID 占用: {key}")
    if not existing:
        db.execute(
            "INSERT INTO application_domain VALUES (?, ?, ?, ?, 'active', ?, ?, ?)",
            (domain_id, key, name, description, admin_id, now, now),
        )
    db.execute(
        "INSERT OR IGNORE INTO application_domain_member VALUES (?, ?, ?)",
        (domain_id, admin_id, now),
    )


def restore(source, target):
    now = datetime.now().astimezone().isoformat(timespec="seconds")
    admin = target.execute("SELECT id FROM users WHERE username = 'admin'").fetchone()
    if not admin:
        raise RuntimeError("目标库缺少 admin 用户")
    create_domain(target, DOMAIN_ID, "battlefield", "战场态势", "战场态势本体与演训样例", admin[0], now)
    create_domain(target, "dom_political_security", "political-security", "政治安全", "政治安全工作领域", admin[0], now)

    objects = select_ids(source, "object_instance", "type_key", TYPES, "object_id")
    sources = select_ids(source, "source_record", "source_key", {"military"}, "id")
    cases = select_ids(source, "decision_case", "decision_type_key", DECISIONS, "id")
    alternatives = select_ids(source, "alternative", "case_id", cases, "id")
    runs = select_ids(source, "scenario_run", "case_id", cases, "id")
    links = select_ids(source, "link_instance", "link_key", LINKS, "id")
    links = {row[0] for row in source.execute(
        f"SELECT id FROM link_instance WHERE id IN ({','.join('?' for _ in links)})"
        f" AND from_object_id IN ({','.join('?' for _ in objects)})"
        f" AND to_object_id IN ({','.join('?' for _ in objects)})",
        (*sorted(links), *sorted(objects), *sorted(objects)),
    )} if links and objects else set()
    evidence = select_ids(source, "evidence", "object_id", objects, "id")
    evidence = {row[0] for row in source.execute(
        f"SELECT id FROM evidence WHERE id IN ({','.join('?' for _ in evidence)})"
        f" AND source_id IN ({','.join('?' for _ in sources)})",
        (*sorted(evidence), *sorted(sources)),
    )} if evidence and sources else set()
    case_objects = select_ids(source, "case_object", "case_id", cases, "id")
    if case_objects:
        bad = source.execute(
            f"SELECT object_id FROM case_object WHERE id IN ({','.join('?' for _ in case_objects)})"
            f" AND object_id NOT IN ({','.join('?' for _ in objects)}) LIMIT 1",
            (*sorted(case_objects), *sorted(objects)),
        ).fetchone()
        if bad:
            raise RuntimeError(f"战场态势案例引用了未恢复的对象: {bad[0]}")

    steps = [
        ("ontology_type", "type_key", TYPES, DOMAIN_ID),
        ("type_version", "type_key", TYPES, None),
        ("link_def", "link_key", LINKS, DOMAIN_ID),
        ("rule_def", "rule_key", RULES, DOMAIN_ID),
        ("action_type", "action_key", ACTIONS, DOMAIN_ID),
        ("decision_type", "type_key", DECISIONS, DOMAIN_ID),
        ("decision_type_version", "type_key", DECISIONS, None),
        ("object_instance", "object_id", objects, DOMAIN_ID),
        ("object_revision", "object_id", objects, None),
        ("source_record", "id", sources, DOMAIN_ID),
        ("source_record_revision", "source_id", sources, None),
        ("link_instance", "id", links, DOMAIN_ID),
        ("evidence", "id", evidence, DOMAIN_ID),
        ("decision_case", "id", cases, DOMAIN_ID),
        ("case_snapshot", "case_id", cases, None),
        ("case_object", "id", case_objects, DOMAIN_ID),
        ("assumption", "case_id", cases, None),
        ("alternative", "id", alternatives, None),
        ("scenario_run", "id", runs, None),
        ("constraint_result", "scenario_run_id", runs, None),
        ("score_result", "scenario_run_id", runs, None),
        ("score_run", "case_id", cases, None),
    ]
    counts = {table: copy_rows(source, target, table, key, values, domain_id)
              for table, key, values, domain_id in steps}
    resources = {
        "ontology_type": TYPES, "link_def": LINKS, "rule_def": RULES,
        "action_type": ACTIONS, "decision_type": DECISIONS, "object": objects,
        "link": links, "source_record": sources, "evidence": evidence,
        "decision_case": cases, "alternative": alternatives, "scenario_run": runs,
    }
    audit_ids = set()
    for kind, identifiers in resources.items():
        if identifiers:
            placeholders = ",".join("?" for _ in identifiers)
            audit_ids.update(row[0] for row in source.execute(
                f"SELECT id FROM audit_event WHERE resource_type = ? AND resource_id IN ({placeholders})",
                (kind, *sorted(identifiers)),
            ))
    counts["audit_event"] = copy_rows(source, target, "audit_event", "id", audit_ids, DOMAIN_ID)
    expected = {"ontology_type": 13, "link_def": 10, "rule_def": 2,
                "action_type": 2, "decision_type": 1, "object_instance": 10,
                "link_instance": 8, "decision_case": 2}
    for table, count in expected.items():
        column = {"ontology_type": "type_key", "link_def": "link_key",
                  "rule_def": "rule_key", "action_type": "action_key",
                  "decision_type": "type_key", "object_instance": "object_id",
                  "link_instance": "id", "decision_case": "id"}[table]
        actual = target.execute(f"SELECT COUNT({column}) FROM {table} WHERE domain_id = ?", (DOMAIN_ID,)).fetchone()[0]
        if actual < count:
            raise RuntimeError(f"{table} 至少应有 {count} 条，实际 {actual} 条")
    if list(target.execute("PRAGMA foreign_key_check")):
        raise RuntimeError("恢复后外键检查失败")
    return counts


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("database", type=Path)
    parser.add_argument("source", type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    database = args.database.resolve()
    source_path = args.source.resolve()
    if database == source_path:
        raise RuntimeError("目标库不能与来源备份相同")
    with closing(sqlite3.connect(f"file:{source_path.as_posix()}?mode=ro", uri=True)) as source:
        with closing(sqlite3.connect(str(database), timeout=20)) as target:
            target.execute("PRAGMA foreign_keys = ON")
            target.execute("PRAGMA busy_timeout = 20000")
            if args.apply:
                backup = database.parent.parent.parent / "backups" / f"pre-battlefield-restore-{datetime.now():%Y%m%d-%H%M%S}.db"
                backup.parent.mkdir(parents=True, exist_ok=True)
                with closing(sqlite3.connect(str(backup))) as saved:
                    target.backup(saved)
            else:
                backup = None
            try:
                target.execute("BEGIN IMMEDIATE")
                counts = restore(source, target)
                if args.apply:
                    target.commit()
                else:
                    target.rollback()
            except Exception:
                target.rollback()
                raise
    print(json.dumps({"applied": args.apply, "database": str(database),
                      "backup": str(backup) if backup else None, "inserted": counts}, ensure_ascii=False))


if __name__ == "__main__":
    main()
