// HTTP 中间件：认证、correlation_id、错误处理、幂等键
import { Request, Response, NextFunction } from 'express';
import { verifyToken, AuthUser } from '../modules/auth/auth-service';
import { AppError, isAppError } from '../shared/errors';
import multer from 'multer';
import { correlationId } from '../shared/ids';
import { getDb, nowIso } from '../db/database';
import { sha256, stableStringify } from '../shared/hash';

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
      correlationId?: string;
    }
  }
}

export function requestContext(req: Request, res: Response, next: NextFunction) {
  const cid = (req.header('x-correlation-id') as string) || correlationId();
  req.correlationId = cid;
  res.setHeader('x-correlation-id', cid);
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return next(new AppError('UNAUTHORIZED', '缺少登录凭证'));
  try {
    req.user = verifyToken(token);
    next();
  } catch (e) {
    next(e);
  }
}

export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token) {
    try { req.user = verifyToken(token); } catch { /* 可选鉴权失败忽略 */ }
  }
  next();
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  const cid = req.correlationId ?? '';
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: err.code === 'LIMIT_FILE_SIZE' ? '附件不能超过 10 MB' : '附件上传格式错误', correlationId: cid } });
    return;
  }
  if (isAppError(err)) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
        correlationId: cid,
      },
    });
    return;
  }
  console.error('[internal]', err);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: '服务器内部错误',
      correlationId: cid,
    },
  });
}

// 幂等键：同一 key 重复请求只产生一次业务效果
export function idempotencyGuard(endpoint: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.header('idempotency-key') || (req.body && req.body.idempotencyKey);
    if (!key) return next();
    const requestHash = sha256(stableStringify({ endpoint, actor: req.user?.id, body: req.body }));
    const db = getDb();
    const existing = db.prepare('SELECT * FROM idempotency_record WHERE idempotency_key = ?').get(key) as any;
    if (existing) {
      if (existing.endpoint !== endpoint || existing.request_hash !== requestHash) {
        return next(new AppError('CONFLICT', '幂等键已用于不同请求'));
      }
      res.status(existing.status_code).setHeader('x-idempotent-replay', 'true');
      res.json(JSON.parse(existing.response_json));
      return;
    }
    // 记录位置由路由在成功后调用 storeIdempotent
    res.locals.idempotencyKey = key;
    res.locals.idempotencyEndpoint = endpoint;
    res.locals.idempotencyRequestHash = requestHash;
    next();
  };
}

export function storeIdempotent(res: Response, key: string, endpoint: string, status: number, body: unknown) {
  const db = getDb();
  try {
    db.prepare(`INSERT OR IGNORE INTO idempotency_record
      (idempotency_key, endpoint, request_hash, response_json, status_code, created_at)
      VALUES (?,?,?,?,?,?)`).run(key, endpoint, res.locals.idempotencyRequestHash,
        JSON.stringify(body), status, nowIso());
  } catch { /* 幂等记录失败不影响主流程 */ }
}

export function asyncHandler(fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = fn(req, res, next);
      if (result instanceof Promise) result.catch(next);
    } catch (e) {
      next(e);
    }
  };
}
