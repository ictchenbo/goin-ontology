// 迁移执行器：按文件名顺序执行 SQL 迁移，记录已执行版本
import fs from 'fs';
import path from 'path';
import { getDb, nowIso } from './database';

function migrationsDir(): string {
  // 编译后位于 dist/db/migrations，源码位于 src/db/migrations
  const candidates = [
    path.join(__dirname, 'migrations'),
    path.join(__dirname, '..', '..', 'src', 'db', 'migrations'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  throw new Error('找不到迁移目录');
}

export function runMigrations(): { applied: string[] } {
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )`);

  const dir = migrationsDir();
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r: any) => r.name)
  );
  const newly: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(file, nowIso());
    });
    tx();
    newly.push(file);
  }
  return { applied: newly };
}

// 直接执行入口：npm run migrate
if (require.main === module) {
  const result = runMigrations();
  console.log(result.applied.length ? `已应用迁移: ${result.applied.join(', ')}` : '数据库已是最新');
}
