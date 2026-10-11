// 服务入口：HTTP API 应用边界 — 身份、权限、输入校验、版本与幂等键
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { runMigrations } from './db/migrate';
import { getDb } from './db/database';
import { apiRouter } from './routes';
import { requestContext, errorHandler } from './routes/middleware';

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

function bootstrap() {
  // 数据库迁移
  const migration = runMigrations();
  if (migration.applied.length) {
    console.log(`[db] 已应用迁移: ${migration.applied.join(', ')}`);
  }

  // 首次启动自动种子数据（SEED_ON_BOOT=1 且库为空时）
  if (process.env.SEED_ON_BOOT === '1' || process.env.SEED_ON_BOOT === 'true') {
    try {
      const db = getDb();
      const userCount = (db.prepare('SELECT COUNT(*) AS c FROM users').get() as { c: number }).c;
      if (userCount === 0) {
        console.log('[db] 检测到空库，开始写入种子数据…');
        // 动态引入种子模块，避免生产依赖硬耦合
        const { seedAll } = require('./seed/seed') as typeof import('./seed/seed');
        seedAll();
        console.log('[db] 种子数据写入完成');
      }
    } catch (e) {
      console.error('[db] 种子数据写入失败（服务继续启动）:', e instanceof Error ? e.message : e);
    }
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(requestContext);

  // 健康检查
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  app.use('/api', apiRouter);

  // 静态文件（可选：若存在 frontend 构建产物）
  const staticDir = process.env.STATIC_DIR || path.join(__dirname, '..', 'public');
  if (fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  app.use(errorHandler);

  const server = app.listen(PORT, HOST, () => {
    console.log(`[api] Ontology OODA 后端已启动 http://${HOST}:${PORT}`);
    console.log(`[api] 健康检查 http://${HOST}:${PORT}/api/health`);
  });

  // 优雅关闭
  const shutdown = () => {
    console.log('[api] 正在关闭...');
    server.close(() => {
      try { getDb().close(); } catch { /* 忽略 */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap();
