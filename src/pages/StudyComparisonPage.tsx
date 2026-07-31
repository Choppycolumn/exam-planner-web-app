import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, Flame, Timer, Users } from 'lucide-react';
import { serverApi } from '../api/client';
import { queryKeys } from '../api/queryClient';
import { EmptyState } from '../components/EmptyState';
import { Page } from '../components/Page';
import { minutesToHoursText } from '../utils/date';

const periods = [
  { days: 7, label: '近 7 天' },
  { days: 30, label: '近 30 天' },
  { days: 90, label: '近 90 天' },
] as const;

const accountStyles = [
  { icon: 'bg-blue-50 text-blue-700', bar: 'bg-blue-500' },
  { icon: 'bg-emerald-50 text-emerald-700', bar: 'bg-emerald-500' },
  { icon: 'bg-violet-50 text-violet-700', bar: 'bg-violet-500' },
] as const;

export function StudyComparisonPage() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.studyComparison(days),
    queryFn: () => serverApi.getStudyComparison(days),
  });
  const recentDays = useMemo(() => data?.daily.slice(-14) ?? [], [data?.daily]);
  const maxDailyMinutes = Math.max(1, ...recentDays.flatMap((day) => Object.values(day.users)));

  return (
    <Page title="学习时间对比" subtitle="只比较真实记录，不共享彼此的课程编辑权限和个人功能。">
      <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="对比周期">
        {periods.map((period) => (
          <button
            key={period.days}
            type="button"
            className={days === period.days ? 'btn btn-primary' : 'btn btn-soft'}
            onClick={() => setDays(period.days)}
          >
            {period.label}
          </button>
        ))}
      </div>

      {!data ? (
        <EmptyState title={isLoading ? '正在读取各用户学习记录' : '暂无可对比数据'} />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.accounts.map((account, index) => {
              const style = accountStyles[index % accountStyles.length];
              return (
              <section key={account.userId} className="card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className={`grid h-10 w-10 place-items-center rounded-xl ${style.icon}`}>
                      <Users size={19} />
                    </span>
                    <div>
                      <h2 className="font-semibold text-slate-950">{account.displayName}</h2>
                      <p className="text-xs text-slate-500">{account.userRole === 'owner' ? '主账户' : '学习用户'}</p>
                    </div>
                  </div>
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">连续 {account.streakDays} 天</span>
                </div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <Metric icon={<Timer size={16} />} label="今天" value={minutesToHoursText(account.todayMinutes)} />
                  <Metric icon={<CalendarDays size={16} />} label="本周" value={minutesToHoursText(account.weekMinutes)} />
                  <Metric icon={<CalendarDays size={16} />} label="本月" value={minutesToHoursText(account.monthMinutes)} />
                  <Metric icon={<Flame size={16} />} label="累计" value={minutesToHoursText(account.totalMinutes)} />
                </div>
              </section>
              );
            })}
          </div>

          {data.accounts.length < data.maxUsers ? (
            <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50/70 px-4 py-3 text-sm text-blue-800">
              新的学习用户创建并产生记录后，这里会自动加入对比；系统最多显示 {data.maxUsers} 位用户。
            </div>
          ) : null}

          <section className="mt-5 card p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-semibold text-slate-950">最近 14 天</h2>
                <p className="mt-1 text-sm text-slate-500">同一天的条形使用相同刻度，仅展示学习分钟数。</p>
              </div>
              <p className="text-xs text-slate-500">数据截至 {data.today}</p>
            </div>
            <div className="mt-5 space-y-4">
              {recentDays.map((day) => (
                <div key={day.date} className="grid gap-2 sm:grid-cols-[72px_1fr] sm:items-center">
                  <p className="text-xs font-semibold text-slate-500">{day.date.slice(5)}</p>
                  <div className="space-y-1.5">
                    {data.accounts.map((account, index) => {
                      const minutes = Number(day.users[String(account.userId)] || 0);
                      const style = accountStyles[index % accountStyles.length];
                      return (
                        <div key={account.userId} className="grid grid-cols-[64px_1fr_56px] items-center gap-2">
                          <span className="truncate text-xs text-slate-600">{account.displayName}</span>
                          <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className={`h-full rounded-full ${style.bar}`}
                              style={{ width: `${minutes ? Math.max(3, (minutes / maxDailyMinutes) * 100) : 0}%` }}
                            />
                          </div>
                          <span className="text-right text-xs tabular-nums text-slate-500">{minutes} 分</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </Page>
  );
}

function Metric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">{icon}{label}</div>
      <p className="mt-2 text-lg font-semibold tabular-nums text-slate-950">{value}</p>
    </div>
  );
}
