import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addDays, format, startOfMonth, startOfWeek, endOfMonth, endOfWeek, subMonths, addMonths } from 'date-fns';
import { CalendarDays, ChevronLeft, ChevronRight, Bell, BookOpen, CheckSquare, FileText, ListChecks } from 'lucide-react';
import { Page } from '../components/Page';
import { serverApi, type CalendarEventItem } from '../api/client';
import { queryKeys } from '../api/queryClient';

const toneClass: Record<string, string> = {
  slate: 'border-slate-200 bg-slate-50 text-slate-700',
  emerald: 'border-emerald-100 bg-emerald-50 text-emerald-700',
  blue: 'border-blue-100 bg-blue-50 text-blue-700',
  amber: 'border-amber-100 bg-amber-50 text-amber-700',
  rose: 'border-rose-100 bg-rose-50 text-rose-700',
};

const typeIcon: Record<string, typeof CalendarDays> = {
  study: BookOpen,
  review: ListChecks,
  task: CheckSquare,
  report: FileText,
  notification: Bell,
};

function dateISO(date: Date) {
  return format(date, 'yyyy-MM-dd');
}

function monthRange(monthDate: Date) {
  const start = startOfWeek(startOfMonth(monthDate), { weekStartsOn: 1 });
  const end = endOfWeek(endOfMonth(monthDate), { weekStartsOn: 1 });
  return { from: dateISO(start), to: dateISO(end) };
}

function monthDays(monthDate: Date) {
  const { from, to } = monthRange(monthDate);
  const days: Date[] = [];
  for (let current = new Date(`${from}T00:00:00`); dateISO(current) <= to; current = addDays(current, 1)) {
    days.push(current);
  }
  return days;
}

function eventLabel(event: CalendarEventItem) {
  if (event.type === 'study') return '学习';
  if (event.type === 'review') return '复盘';
  if (event.type === 'task') return '任务';
  if (event.type === 'report') return '报告';
  if (event.type === 'notification') return '通知';
  return event.type;
}

function EventPill({ event }: { event: CalendarEventItem }) {
  const Icon = typeIcon[event.type] ?? CalendarDays;
  return (
    <div className={`rounded border px-2 py-1 text-xs ${toneClass[event.tone] ?? toneClass.slate}`} title={event.detail || event.title}>
      <div className="flex min-w-0 items-center gap-1">
        <Icon size={12} className="shrink-0" />
        <span className="truncate font-semibold">{event.title}</span>
      </div>
    </div>
  );
}

export function CalendarPage() {
  const [monthDate, setMonthDate] = useState(() => new Date());
  const range = useMemo(() => monthRange(monthDate), [monthDate]);
  const days = useMemo(() => monthDays(monthDate), [monthDate]);
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.calendar(range.from, range.to),
    queryFn: () => serverApi.getCalendarEvents(range.from, range.to),
    placeholderData: { generatedAt: '', from: range.from, to: range.to, events: [] },
  });
  const eventsByDate = useMemo(() => {
    const grouped = new Map<string, CalendarEventItem[]>();
    (data?.events ?? []).forEach((event) => {
      grouped.set(event.date, [...(grouped.get(event.date) ?? []), event]);
    });
    return grouped;
  }, [data?.events]);
  const selectedMonth = format(monthDate, 'yyyy-MM');
  const totalEvents = data?.events.length ?? 0;
  const openNotifications = data?.events.filter((event) => event.type === 'notification' && event.tone !== 'slate').length ?? 0;
  const studyDays = new Set(data?.events.filter((event) => event.type === 'study').map((event) => event.date)).size;

  return (
    <Page title="日历视图" subtitle="把学习、复盘、任务、报告和系统通知放到同一张月历里。">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button className="btn btn-soft h-10 w-10 px-0" type="button" title="上个月" onClick={() => setMonthDate((current) => subMonths(current, 1))}>
            <ChevronLeft size={17} />
          </button>
          <div className="min-w-36 rounded-lg border border-slate-200 bg-white px-4 py-2 text-center font-semibold text-slate-900">{selectedMonth}</div>
          <button className="btn btn-soft h-10 w-10 px-0" type="button" title="下个月" onClick={() => setMonthDate((current) => addMonths(current, 1))}>
            <ChevronRight size={17} />
          </button>
        </div>
        <button className="btn btn-soft" type="button" onClick={() => setMonthDate(new Date())}>回到本月</button>
      </div>

      <div className="mb-5 grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs font-semibold text-slate-500">本视图事件</p>
          <p className="mt-1 text-2xl font-semibold text-slate-950">{totalEvents}</p>
        </div>
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-4 text-blue-700">
          <p className="text-xs font-semibold opacity-80">有学习记录天数</p>
          <p className="mt-1 text-2xl font-semibold">{studyDays}</p>
        </div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-amber-700">
          <p className="text-xs font-semibold opacity-80">需关注通知</p>
          <p className="mt-1 text-2xl font-semibold">{openNotifications}</p>
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-semibold text-slate-500">
          {['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((item) => <div key={item} className="px-2 py-2">{item}</div>)}
        </div>
        <div className="grid grid-cols-7">
          {days.map((day) => {
            const date = dateISO(day);
            const events = eventsByDate.get(date) ?? [];
            const inMonth = date.startsWith(selectedMonth);
            return (
              <div key={date} className={`min-h-32 border-b border-r border-slate-100 p-2 ${inMonth ? 'bg-white' : 'bg-slate-50/70'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-sm font-semibold ${inMonth ? 'text-slate-800' : 'text-slate-400'}`}>{format(day, 'd')}</span>
                  {events.length ? <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-500">{events.length}</span> : null}
                </div>
                <div className="mt-2 space-y-1">
                  {events.slice(0, 4).map((event) => <EventPill key={event.id} event={event} />)}
                  {events.length > 4 ? <p className="text-xs font-semibold text-slate-400">还有 {events.length - 4} 项</p> : null}
                </div>
              </div>
            );
          })}
        </div>
        {isLoading ? <div className="border-t border-slate-100 px-4 py-3 text-sm text-slate-500">日历同步中...</div> : null}
      </section>

      <section className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        {(['study', 'review', 'task', 'report', 'notification'] as const).map((type) => {
          const Icon = typeIcon[type];
          const count = data?.events.filter((event) => event.type === type).length ?? 0;
          return (
            <div key={type} className="rounded-lg border border-slate-200 bg-white px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-slate-800"><Icon size={15} />{eventLabel({ type } as CalendarEventItem)}</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">{count}</p>
            </div>
          );
        })}
      </section>
    </Page>
  );
}
