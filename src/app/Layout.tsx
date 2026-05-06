import { Activity, BarChart3, BookOpen, CalendarCheck, ClipboardList, Home, Settings, Target } from 'lucide-react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useAppData } from '../hooks/useAppData';
import { calculateCountdownDays, formatChineseDate } from '../utils/date';

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/goals', label: '长期目标', icon: Target },
  { to: '/study-time', label: '学习时间', icon: BookOpen },
  { to: '/reviews', label: '每日复盘', icon: CalendarCheck },
  { to: '/review-insights', label: '复盘趋势', icon: Activity },
  { to: '/statistics', label: '数据统计', icon: BarChart3 },
  { to: '/mock-exams', label: '模考成绩', icon: ClipboardList },
  { to: '/settings', label: '设置', icon: Settings },
];

export function Layout() {
  const { activeGoal } = useAppData();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-[#f7f8fb] text-slate-900">
      <aside className="fixed left-0 top-0 hidden h-screen w-64 border-r border-slate-200 bg-white/90 px-4 py-5 backdrop-blur lg:block">
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
          <AnimatePresence mode="wait">
            <Outlet key={location.pathname} />
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
