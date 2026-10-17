import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Layers3, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ApplicationDomain, setCurrentDomain } from '@/lib/domain';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Alert } from '@/components/ui/Alert';

const DOMAIN_IMAGES: Record<string, string> = {
  'public-safety': '/images/domain-public-safety.png',
  battlefield: '/images/domain-battlefield.png',
  'political-security': '/images/domain-political-security.png',
};

export function DomainSelectPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [domains, setDomains] = useState<ApplicationDomain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const from = (location.state as { from?: string } | null)?.from;

  useEffect(() => {
    let active = true;
    api.get<{ items: ApplicationDomain[] }>('/domains').then((result) => {
      if (active) setDomains(result.items.filter((item) => item.status === 'active'));
    }).catch((reason: { message?: string }) => {
      if (active) setError(reason.message ?? '加载应用领域失败');
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function choose(domain: ApplicationDomain) {
    setCurrentDomain(domain);
    navigate(from && from !== '/domains/select' ? from : '/', { replace: true });
  }

  return <main className="min-h-screen bg-background p-4 md:p-8">
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div><h1 className="flex items-center gap-2 text-2xl font-semibold"><Layers3 aria-hidden />选择应用领域</h1>
          <p className="mt-2 text-sm text-muted-foreground">{user?.displayName}，请选择本次工作的应用领域。</p></div>
        <Button variant="ghost" onClick={() => { logout(); navigate('/login', { replace: true }); }}><LogOut className="mr-2 h-4 w-4" />退出</Button>
      </div>
      {error && <Alert variant="error">{error}</Alert>}
      {loading ? <p role="status">正在加载领域…</p> : domains.length === 0 ?
        <Card><CardContent className="py-8 text-center text-muted-foreground">当前没有可访问的应用领域，请联系管理员。</CardContent></Card> :
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{domains.map((domain) =>
          <Card key={domain.id} className="flex min-h-80 flex-col overflow-hidden transition-shadow hover:shadow-lg">
            <div className="relative h-40 overflow-hidden bg-slate-800">
              {DOMAIN_IMAGES[domain.domainKey] ? <img src={DOMAIN_IMAGES[domain.domainKey]}
                alt={`${domain.displayName}示意背景图`} className="h-full w-full object-cover" loading="lazy" /> :
                <div className="h-full w-full bg-gradient-to-br from-slate-700 via-slate-600 to-slate-900" aria-hidden />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" aria-hidden />
              <span className="absolute bottom-3 left-4 rounded-full border border-white/30 bg-black/30 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                {domain.domainKey}
              </span>
            </div>
            <CardHeader className="pb-2"><CardTitle>{domain.displayName}</CardTitle></CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <p className="line-clamp-2 flex-1 text-sm text-muted-foreground">{domain.description || '进入该领域的本体与对象工作空间'}</p>
              <Button onClick={() => choose(domain)} aria-label={`进入${domain.displayName}`}>进入领域</Button>
            </CardContent>
          </Card>)}</div>}
    </div>
  </main>;
}
