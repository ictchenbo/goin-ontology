// 当前工作领域仅在本次浏览器会话中保留；领域权限以服务端校验为准。
const DOMAIN_KEY = 'ooda_domain';

export interface ApplicationDomain {
  id: string;
  domainKey: string;
  displayName: string;
  description: string;
  status: 'active' | 'archived';
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export function getCurrentDomain(): ApplicationDomain | null {
  try {
    const raw = sessionStorage.getItem(DOMAIN_KEY);
    return raw ? JSON.parse(raw) as ApplicationDomain : null;
  } catch { return null; }
}

export function setCurrentDomain(domain: ApplicationDomain | null): void {
  try {
    if (domain) sessionStorage.setItem(DOMAIN_KEY, JSON.stringify(domain));
    else sessionStorage.removeItem(DOMAIN_KEY);
    window.dispatchEvent(new Event('domain-change'));
  } catch { /* 会话存储不可用时由服务端拒绝无领域请求 */ }
}
