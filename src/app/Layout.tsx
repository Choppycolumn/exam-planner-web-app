import { useEffect, useState } from 'react';
import { Activity, Bell, BookOpen, BriefcaseBusiness, CalendarCheck, ClipboardList, Download, Flag, Home, Languages, LibraryBig, Moon, Settings, ShieldCheck, Sun, TrendingUp } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useDashboardData } from '../hooks/useDashboardData';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { calculateCountdownDays, formatChineseDate } from '../utils/date';
import { preloadSecondaryRoutes } from '../router/preload';
import { applyTheme, resolveInitialTheme, type ThemeMode } from '../utils/theme';
import { usePwaInstall } from '../hooks/usePwaInstall';

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/study-time', label: '学习时间', icon: BookOpen },
  { to: '/reviews', label: '每日复盘', icon: CalendarCheck },
  { to: '/review-insights', label: '复盘趋势', icon: Activity },
  { to: '/progress', label: '学习进度', icon: TrendingUp },
  { to: '/project-progress', label: '项目进展', icon: BriefcaseBusiness },
  { to: '/goal-review', label: '目标复盘', icon: Flag },
  { to: '/notifications', label: '通知中心', icon: Bell },
  { to: '/mock-exams', label: '模考成绩', icon: ClipboardList },
  { to: '/confusing-words', label: '易混单词', icon: Languages },
  { to: '/library', label: '资料图书馆', icon: LibraryBig },
  { to: '/settings', label: '设置', icon: Settings },
  { to: '/operations', label: '运维与健康', icon: ShieldCheck },
];

export function Layout() {
  const { activeGoal, readOnly } = useDashboardData();
  const { online } = useNetworkStatus();
  const { canInstall, installed, install } = usePwaInstall();
  const location = useLocation();
  const [theme, setTheme] = useState<ThemeMode>(() => resolveInitialTheme());

  useEffect(() => preloadSecondaryRoutes(), []);
  useEffect(() => applyTheme(theme), [theme]);

  return (
    <div className="min-h-screen bg-[#f7f8fb] text-slate-900">
      <aside className="fixed left-0 top-0 hidden h-screen w-64 overflow-y-auto border-r border-slate-200 bg-white/90 px-4 py-5 backdrop-blur lg:block">
        <div className="px-2">
          <p className="text-sm font-semibold text-blue-700">Exam Planner</p>
          <h1 className="mt-1 text-lg font-semibold text-slate-950">考研计划管理</h1>
        </div>
        <nav className="mt-8 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                  isActive ? 'bg-blue-50 text-blue-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      <main className="lg:pl-64">
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/85 px-4 py-3 backdrop-blur lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-500">{formatChineseDate()}</p>
              <p className="text-sm text-slate-700">
                {activeGoal ? `当前目标：${activeGoal.name}，剩余 ${calculateCountdownDays(activeGoal.deadline)} 天` : '还没有启用目标'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {readOnly ? <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700">只读模式</span> : null}
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
            </div>
            <div className="flex gap-2 overflow-x-auto lg:hidden">
              {navItems.map(({ to, label }) => (
                <NavLink key={to} to={to} className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-2 text-sm ${isActive ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>
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
          <AnimatePresence mode="wait">
            <Outlet key={location.pathname} />
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
