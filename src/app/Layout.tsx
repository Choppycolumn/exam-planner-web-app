import { useEffect, useState } from 'react';
import { Activity, BookOpen, CalendarCheck, ClipboardList, Download, Flag, Home, Languages, LogOut, Moon, Settings, ShieldCheck, Sun, TimerReset, TrendingUp, Users, WifiOff } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';
import { useDashboardData } from '../hooks/useDashboardData';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { calculateCountdownDays, formatChineseDate } from '../utils/date';
import { preloadRoute } from '../router/preload';
import { applyTheme, resolveInitialTheme, type ThemeMode } from '../utils/theme';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { useAccountSession } from '../hooks/useAccountSession';

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/study-time', label: '学习时间', icon: BookOpen },
  { to: '/focus-timer', label: '专注计时', icon: TimerReset, capability: 'focus_timer.use' },
  { to: '/reviews', label: '每日复盘', icon: CalendarCheck },
  { to: '/review-insights', label: '复盘趋势', icon: Activity },
  { to: '/progress', label: '学习进度', icon: TrendingUp },
  { to: '/study-comparison', label: '学习对比', icon: Users },
  { to: '/goal-review', label: '目标复盘', icon: Flag },
  { to: '/mock-exams', label: '模考成绩', icon: ClipboardList },
  { to: '/confusing-words', label: '易混单词', icon: Languages },
  { to: '/settings', label: '设置', icon: Settings, capability: 'settings.manage' },
  { to: '/operations', label: '运维与健康', icon: ShieldCheck, capability: 'operations.manage' },
];

function AdminGoalSummary() {
  const { activeGoal } = useDashboardData();
  return (
    <p className="text-sm text-strong">
      {activeGoal ? `当前目标：${activeGoal.name}，剩余 ${calculateCountdownDays(activeGoal.deadline)} 天` : '还没有启用目标'}
    </p>
  );
}

export function Layout() {
  const { data: session } = useAccountSession();
  const { online } = useNetworkStatus();
  const { canInstall, installed, install } = usePwaInstall();
  const [theme, setTheme] = useState<ThemeMode>(() => resolveInitialTheme());

  useEffect(() => applyTheme(theme), [theme]);
  const readOnly = session?.role === 'read';
  const visibleNavItems = navItems.filter((item) => !item.capability || session?.capabilities?.includes(item.capability));

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <span className="app-brand-mark" aria-hidden="true"><BookOpen size={19} strokeWidth={2.2} /></span>
          <div>
            <p className="app-brand-kicker">Exam Planner</p>
            <h1 className="app-brand-title">考研计划管理</h1>
          </div>
        </div>
        <nav className="app-nav-list" aria-label="主要导航">
          {visibleNavItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `app-nav-link ${isActive ? 'app-nav-link-active' : ''}`
              }
              onMouseEnter={() => preloadRoute(to)}
              onFocus={() => preloadRoute(to)}
            >
              <Icon size={18} strokeWidth={2} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="app-main">
        <header className="app-header">
          <div className="app-header-inner">
            <div className="app-header-context">
              <p className="app-header-date">{formatChineseDate()}</p>
              {session ? (session.userRole === 'owner' ? <AdminGoalSummary /> : <p className="app-header-summary">独立学习空间 · 仅学习时长汇总参与对比</p>) : <p className="app-header-summary">正在读取账户...</p>}
            </div>
            <div className="app-header-actions">
              {readOnly ? <span className="app-status-pill app-status-warning">只读模式</span> : null}
              {session ? <span className="app-account-pill">{session.displayName}</span> : null}
              {canInstall && !installed ? (
                <button className="app-icon-button" type="button" onClick={() => void install()} aria-label="安装到桌面" title="安装到桌面">
                  <Download size={17} />
                </button>
              ) : null}
              <button
                className="app-icon-button"
                type="button"
                onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
                aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
                title={theme === 'dark' ? '浅色模式' : '深色模式'}
              >
                {theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
              </button>
              <form method="post" action="/logout">
                <button className="app-icon-button" type="submit" aria-label="退出登录" title="退出登录">
                  <LogOut size={17} />
                </button>
              </form>
            </div>
          </div>
          <nav className="app-mobile-nav" aria-label="移动端导航">
              {visibleNavItems.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to} onMouseEnter={() => preloadRoute(to)} onFocus={() => preloadRoute(to)} className={({ isActive }) => `app-mobile-link ${isActive ? 'app-mobile-link-active' : ''}`}>
                  <Icon size={16} strokeWidth={2} aria-hidden="true" />
                  <span>{label}</span>
                </NavLink>
              ))}
          </nav>
        </header>
        <div className="app-content">
          {!online ? (
            <div className="app-offline-banner" role="status">
              <WifiOff size={17} aria-hidden="true" />
              <span>当前处于离线状态。已打开的页面可以继续查看，保存、同步和行情更新会在恢复网络后再操作。</span>
            </div>
          ) : null}
          <Outlet />
        </div>
      </main>
    </div>
  );
}
