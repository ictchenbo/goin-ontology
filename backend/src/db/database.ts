// SQLite 连接与事务封装
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

export function getDbPath(): string {
  return process.env.DATABASE_PATH || path.join(process.cwd(), 'data', 'ontology.db');
}

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new Database(dbPath);
  // 开启 WAL 与外键，符合方案 §07 SQLite 设计原则
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

// 事务执行：单个 Action 的对象变更、案例状态、审计与 Outbox 同事务提交
export function withTransaction<T>(fn: (d: Database.Database) => T): T {
  const d = getDb();
  const tx = d.transaction(fn);
  return tx(d);
}

export function nowIso(): string {
  return new Date().toISOString();
}
