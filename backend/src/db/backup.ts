// 在线 SQLite 备份入口；使用 SQLite 备份 API 保证 WAL 中数据一致。
import fs from 'fs';
import path from 'path';
import { getDb } from './database';

async function main() {
  const target = process.argv[2];
  if (!target) throw new Error('请提供备份文件路径');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await getDb().backup(target);
  const size = fs.statSync(target).size;
  if (size === 0) throw new Error('备份文件为空');
  console.log(JSON.stringify({ target, bytes: size }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
