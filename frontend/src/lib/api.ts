/**
 * API 客户端：统一请求封装、错误处理与鉴权头注入
 */
export interface ApiError {
  code: string;
  message: string;
  details?: unknown;
  correlationId?: string;
}

const TOKEN_KEY = 'ooda_token';
const USER_KEY = 'ooda_user';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* localStorage 不可用时忽略 */
  }
}

export function getStoredUser<T>(): T | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: unknown | null): void {
  try {
    if (user) localStorage.setItem(USER_KEY, JSON.stringify(user));
    else localStorage.removeItem(USER_KEY);
  } catch {
    /* 忽略 */
  }
}

/**
 * 通用请求方法：自动附带 JWT，统一解析错误结构
 */
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string> | undefined),
  };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`/api${path}`, { ...options, headers });
  } catch (e) {
    throw {
      code: 'NETWORK_ERROR',
      message: e instanceof Error ? e.message : '网络请求失败',
    } satisfies ApiError;
  }

  if (res.status === 204) return undefined as T;

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text };
    }
  }

  if (!res.ok) {
    const err = (body as { error?: ApiError } | null)?.error;
    throw {
      code: err?.code || `HTTP_${res.status}`,
      message: err?.message || `请求失败 (${res.status})`,
      details: err?.details,
      correlationId: err?.correlationId,
    } satisfies ApiError;
  }

  return body as T;
}

export async function downloadAttachment(id: string, filename: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`/api/attachments/${encodeURIComponent(id)}/download`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    let message = `附件下载失败 (${response.status})`;
    try { message = (await response.json()).error?.message || message; } catch { /* 使用状态码 */ }
    throw new Error(message);
  }
  const url = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, data?: unknown) =>
    apiFetch<T>(path, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    apiFetch<T>(path, { method: 'PUT', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    apiFetch<T>(path, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string, data?: unknown) =>
    apiFetch<T>(path, { method: 'DELETE', body: data ? JSON.stringify(data) : undefined }),
};
