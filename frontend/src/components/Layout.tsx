/**
 * 应用布局：侧边导航 + 顶栏（主题切换/用户信息）
 * 支持移动端抽屉式导航、键盘可达
 */
import React, { useEffect, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Boxes, GitBranch, ClipboardList, CheckSquare,
  Rocket, Upload, Shield, Moon, Sun, Menu, X, LogOut, Activity
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';

const NAV_ITEMS = [
  { to: '/', label: '仪表盘', icon: LayoutDashboard, roles: null },
  { to: '/ontology', label: '本体模型', icon: GitBranch, roles: ['admin', 'analyst'] },
  { to: '/objects', label: '对象浏览', icon: Boxes, roles: null },
  { to: '/cases', label: '决策工作台', icon: ClipboardList, roles: null },
  { to: '/approvals', label: '审批中心', icon: CheckSquare, roles: ['approver', 'commander', 'admin'] },
  { to: '/actions', label: '动作执行', icon: Rocket, roles: ['operator', 'admin', 'commander'] },
  { to: '/ingest', label: '数据导入', icon: Upload, roles: ['analyst', 'intel', 'admin'] },
  { to: '/audit', label: '审计日志', icon: Shield, roles: ['admin', 'safety_officer'] },
];

export function Layout() {
  const { user, logout, hasRole } = useAuth();
  const navigate = useNavigate();
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('ooda_theme') !== 'light';
    } catch {
      return true;
    }
  });
  const [mobileOpen, setMobileOpen] = useState(false);

  // 主题切换：html.dark 类控制
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('ooda_theme', dark ? 'dark' : 'light');
    } catch {
      /* 忽略 */
    }
  }, [dark]);

  const visibleNav = NAV_ITEMS.filter((item) => !item.roles || item.roles.some((r) => hasRole(r)));

  return (
    <div className="flex min-h-screen">
      {/* 侧边栏（桌面固定 / 移动抽屉） */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 w-60 transform border-r border-border bg-card transition-transform lg:static lg:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-label="主导航"
      >
        <div className="flex h-14 items-center gap-2 border-b border-border px-4">
          <Activity className="h-6 w-6 text-primary" aria-hidden />
          <span className="font-semibold">OODA 决策平台</span>
          <button
            className="ml-auto lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-label="关闭导航"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <nav className="space-y-1 p-3">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )
              }
            >
              <item.icon className="h-4 w-4" aria-hidden />
              {item.label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* 遮罩（移动端） */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden
        />
      )}

      {/* 主内容区 */}
      <div className="flex flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-supports-[backdrop-filter]:bg-background/80">
          <button
            className="lg:hidden"
            onClick={() => setMobileOpen(true)}
            aria-label="打开导航"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDark(!dark)}
            aria-label={dark ? '切换到亮色模式' : '切换到暗色模式'}
          >
            {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
          {user && (
            <div className="flex items-center gap-2">
              <div className="hidden text-right sm:block">
                <div className="text-sm font-medium">{user.displayName}</div>
                <div className="flex justify-end gap-1">
                  {user.roles.slice(0, 3).map((r) => (
                    <Badge key={r} variant="secondary" className="text-[10px]">
                      {r}
                    </Badge>
                  ))}
                </div>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  logout();
                  navigate('/login');
                }}
                aria-label="退出登录"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          )}
        </header>

        <main className="flex-1 p-4 md:p-6" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
