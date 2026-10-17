import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ApplicationDomain } from '@/lib/domain';
import { Alert } from '@/components/ui/Alert';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';

const PAGE_SIZE = 10;

function errorMessage(error: unknown): string {
  return (error as { message?: string })?.message ?? '操作失败';
}

export function DomainAdminPage() {
  const { hasRole } = useAuth();
  const navigate = useNavigate();
  const [domains, setDomains] = useState<ApplicationDomain[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [domainKey, setDomainKey] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ items: ApplicationDomain[] }>('/domains?includeArchived=true')
      .then((result) => setDomains(result.items)).catch((reason) => setError(errorMessage(reason)));
  }, []);
  const filtered = useMemo(() => domains.filter((domain) =>
    `${domain.domainKey} ${domain.displayName} ${domain.description}`.toLowerCase().includes(search.toLowerCase())), [domains, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));

  async function create(event: FormEvent) {
    event.preventDefault(); setError(''); setSaving(true);
    try {
      const domain = await api.post<ApplicationDomain>('/domains', { domainKey, displayName, description });
      navigate(`/admin/domains/${encodeURIComponent(domain.id)}`);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(false); }
  }

  if (!hasRole('admin')) return <Alert variant="error">仅管理员可以管理应用领域。</Alert>;
  return <div className="space-y-6">
    <div><h1 className="text-2xl font-semibold">应用领域</h1><p className="text-sm text-muted-foreground">创建领域并管理用户归属。</p></div>
    {error && <Alert variant="error">{error}</Alert>}
    <Card><CardHeader><CardTitle>创建应用领域</CardTitle></CardHeader><CardContent>
      <form onSubmit={create} className="grid gap-4 md:grid-cols-2">
        <div><Label htmlFor="domain-key">领域标识</Label><Input id="domain-key" required value={domainKey} onChange={(event) => setDomainKey(event.target.value)} placeholder="public-transport" /></div>
        <div><Label htmlFor="domain-name">领域名称</Label><Input id="domain-name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></div>
        <div className="md:col-span-2"><Label htmlFor="domain-description">说明</Label><Input id="domain-description" value={description} onChange={(event) => setDescription(event.target.value)} /></div>
        <div><Button type="submit" disabled={saving}>{saving ? '创建中…' : '创建领域'}</Button></div>
      </form>
    </CardContent></Card>
    <Card><CardHeader><CardTitle>领域列表</CardTitle></CardHeader><CardContent className="space-y-4">
      <Input aria-label="搜索领域" placeholder="搜索名称、标识或说明" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
      <div className="divide-y divide-border rounded-md border">{filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((domain) =>
        <Link key={domain.id} to={`/admin/domains/${encodeURIComponent(domain.id)}`} className="flex items-center justify-between gap-3 p-3 hover:bg-accent">
          <span><span className="font-medium">{domain.displayName}</span><span className="ml-2 text-sm text-muted-foreground">{domain.domainKey}</span></span>
          <span className="text-xs text-muted-foreground">{domain.status === 'active' ? '启用' : '已归档'}</span>
        </Link>)}{filtered.length === 0 && <p className="p-4 text-sm text-muted-foreground">没有匹配的领域</p>}</div>
      <div className="flex items-center justify-end gap-2 text-sm"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button><span>{page} / {totalPages}</span><Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button></div>
    </CardContent></Card>
  </div>;
}

interface Member { id: string; username: string; displayName: string; roles: string }
interface UserItem { id: string; username: string; displayName: string }

export function DomainDetailPage() {
  const { hasRole } = useAuth();
  const { domainId = '' } = useParams();
  const [domain, setDomain] = useState<ApplicationDomain | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function refresh() {
    try {
      const [item, memberResult, userResult] = await Promise.all([
        api.get<ApplicationDomain>(`/domains/${encodeURIComponent(domainId)}`),
        api.get<{ items: Member[] }>(`/domains/${encodeURIComponent(domainId)}/members`),
        api.get<{ items: UserItem[] }>('/users'),
      ]);
      setDomain(item); setName(item.displayName); setDescription(item.description);
      setMembers(memberResult.items); setUsers(userResult.items);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  useEffect(() => { void refresh(); }, [domainId]);

  async function save(event: FormEvent) {
    event.preventDefault(); setSaving(true); setError('');
    try { const item = await api.patch<ApplicationDomain>(`/domains/${encodeURIComponent(domainId)}`, { displayName: name, description }); setDomain(item); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(false); }
  }
  async function toggleMember(userId: string, enabled: boolean) {
    setError('');
    try {
      const path = `/domains/${encodeURIComponent(domainId)}/members/${encodeURIComponent(userId)}`;
      if (enabled) await api.put(path); else await api.delete(path);
      const result = await api.get<{ items: Member[] }>(`/domains/${encodeURIComponent(domainId)}/members`);
      setMembers(result.items);
    } catch (reason) { setError(errorMessage(reason)); }
  }
  if (!hasRole('admin')) return <Alert variant="error">仅管理员可以管理应用领域。</Alert>;
  return <div className="space-y-6">
    <Link to="/admin/domains" className="text-sm text-primary hover:underline">← 返回领域列表</Link>
    {error && <Alert variant="error">{error}</Alert>}
    {!domain ? <p role="status">正在加载领域…</p> : <>
      <div><h1 className="text-2xl font-semibold">{domain.displayName}</h1><p className="text-sm text-muted-foreground">{domain.domainKey} · {domain.status === 'active' ? '启用' : '已归档'}</p></div>
      <Card><CardHeader><CardTitle>基本信息</CardTitle></CardHeader><CardContent>
        <form onSubmit={save} className="space-y-4"><div><Label htmlFor="edit-domain-name">名称</Label><Input id="edit-domain-name" required value={name} onChange={(event) => setName(event.target.value)} /></div>
          <div><Label htmlFor="edit-domain-description">说明</Label><Input id="edit-domain-description" value={description} onChange={(event) => setDescription(event.target.value)} /></div>
          <Button type="submit" disabled={saving}>{saving ? '保存中…' : '保存'}</Button></form>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>领域成员</CardTitle></CardHeader><CardContent className="divide-y divide-border">
        {users.map((user) => { const enabled = members.some((member) => member.id === user.id); return <div key={user.id} className="flex items-center justify-between gap-3 py-3">
          <span>{user.displayName} <span className="text-sm text-muted-foreground">({user.username})</span></span>
          <Button variant={enabled ? 'outline' : 'primary'} size="sm" onClick={() => void toggleMember(user.id, !enabled)}>{enabled ? '移除' : '加入'}</Button>
        </div>; })}
      </CardContent></Card>
    </>}
  </div>;
}
