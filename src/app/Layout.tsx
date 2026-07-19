import { useEffect, useState } from 'react';
import { Activity, BookOpen, CalendarCheck, ClipboardList, Download, Flag, Home, Languages, LogOut, Moon, Settings, ShieldCheck, Sun, TrendingUp, Users } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useDashboardData } from '../hooks/useDashboardData';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { calculateCountdownDays, formatChineseDate } from '../utils/date';
import { preloadRoute, preloadSecondaryRoutes } from '../router/preload';
import { applyTheme, resolveInitialTheme, type ThemeMode } from '../utils/theme';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useAccountSession } from '../hooks/useAccountSession';

const adminNavItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/study-time', label: '学习时间', icon: BookOpen },
  { to: '/reviews', label: '每日复盘', icon: CalendarCheck },
  { to: '/review-insights', label: '复盘趋势', icon: Activity },
  { to: '/progress', label: '学习进度', icon: TrendingUp },
  { to: '/study-comparison', label: '学习对比', icon: Users },
  { to: '/goal-review', label: '目标复盘', icon: Flag },
  { to: '/mock-exams', label: '模考成绩', icon: ClipboardList },
  { to: '/confusing-words', label: '易混单词', icon: Languages },
  { to: '/settings', label: '设置', icon: Settings },
  { to: '/operations', label: '运维与健康', icon: ShieldCheck },
];

const learnerNavItems = adminNavItems.filter(({ to }) => !['/settings', '/operations'].includes(to));

function AdminGoalSummary() {
  const { activeGoal } = useDashboardData();
  return (
    <p className="text-sm text-slate-700">
      {activeGoal ? `当前目标：${activeGoal.name}，剩余 ${calculateCountdownDays(activeGoal.deadline)} 天` : '还没有启用目标'}
    </p>
  );
}

export function Layout() {
  const { data: session } = useAccountSession();
  const { online } = useNetworkStatus();
  const { canInstall, installed, install } = usePwaInstall();
  const [theme, setTheme] = useState<ThemeMode>(() => resolveInitialTheme());

  useEffect(() => preloadSecondaryRoutes(), []);
  useEffect(() => applyTheme(theme), [theme]);
  const isLearner = session?.accountType === 'learner';
  const readOnly = session?.role === 'read';
  const navItems = isLearner ? learnerNavItems : adminNavItems;

  return (
    <div className="app-shell">
      <aside className="app-sidebar fixed left-0 top-0 hidden h-screen w-64 overflow-y-auto border-r px-4 py-5 lg:block">
        <div className="px-2">
          <p className="app-brand-kicker text-sm font-semibold">Exam Planner</p>
          <h1 className="mt-1 text-lg font-semibold text-slate-950">考研计划管理</h1>
        </div>
        <nav className="mt-8 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `app-nav-link flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${isActive ? 'app-nav-link-active' : ''}`
              }
              onMouseEnter={() => preloadRoute(to)}
              onFocus={() => preloadRoute(to)}
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="lg:pl-64">
        <header className="app-header sticky top-0 z-30 border-b px-4 py-3 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-500">{formatChineseDate()}</p>
              {session ? (isLearner ? <p className="text-sm text-slate-700">独立学习空间 · 仅学习对比与其他账户共享</p> : <AdminGoalSummary />) : <p className="text-sm text-slate-500">正在读取账户...</p>}
            </div>
            <div className="flex items-center gap-2">
              {readOnly ? <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">只读模式</span> : null}
              {session ? <span className="hidden rounded-lg border border-slate-200 bg-white/70 px-3 py-2 text-sm font-semibold text-slate-700 sm:inline">{session.displayName}</span> : null}
              {canInstall && !installed ? (
                <button className="btn btn-soft h-10 w-10 px-0" type="button" onClick={() => void install()} aria-label="安装到桌面" title="安装到桌面">
                  <Download size={17} />
                </button>
              ) : null}
              <button
                className="btn btn-soft h-10 w-10 px-0"
                type="button"
                onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
                aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
                title={theme === 'dark' ? '浅色模式' : '深色模式'}
              >
                {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              </button>
              <form method="post" action="/logout">
                <button className="btn btn-soft h-10 w-10 px-0" type="submit" aria-label="退出登录" title="退出登录">
                  <LogOut size={17} />
                </button>
              </form>
            </div>
            <div className="flex gap-2 overflow-x-auto lg:hidden">
              {navItems.map(({ to, label }) => (
                <NavLink key={to} to={to} onMouseEnter={() => preloadRoute(to)} onFocus={() => preloadRoute(to)} className={({ isActive }) => `app-mobile-link whitespace-nowrap rounded-lg px-3 py-2 text-sm ${isActive ? 'app-mobile-link-active' : ''}`}>
                  {label}
                </NavLink>
              ))}
            </div>
          </div>
        </header>
        <div className="mx-auto max-w-7xl px-4 py-8 lg:px-8">
          {!online ? (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-800">
              当前处于离线状态。已打开的页面可以继续查看，保存、同步和行情更新会在恢复网络后再操作。
            </div>
          ) : null}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
