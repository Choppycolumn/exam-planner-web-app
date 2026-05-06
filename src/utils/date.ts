import { addDays, differenceInCalendarDays, format, parseISO, startOfDay, subDays } from 'date-fns';

export const todayISO = () => format(new Date(), 'yyyy-MM-dd');

export const formatChineseDate = (date = new Date()) => format(date, 'yyyy年MM月dd日');

export const nowISO = () => new Date().toISOString();

export const previousDateISO = (date: string) => format(subDays(parseISO(date), 1), 'yyyy-MM-dd');

export const calculateCountdownDays = (deadline: string) => {
  if (!deadline) return 0;
  return Math.max(0, differenceInCalendarDays(startOfDay(parseISO(deadline)), startOfDay(new Date())));
};

export const getDaysUntil = (date: string) => {
  if (!date) return 0;
  return differenceInCalendarDays(startOfDay(parseISO(date)), startOfDay(new Date()));
};

export const getDueStatus = (date: string) => {
  const days = getDaysUntil(date);
  const label = days < 0 ? `已逾期 ${Math.abs(days)} 天` : days === 0 ? '今天到期' : `剩余 ${days} 天`;
  const className =
    days <= 3
      ? 'border-rose-200 bg-rose-50 text-rose-700'
      : days <= 7
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  return { days, label, className };
};

export const dateRangeEndingToday = (days: number) => {
  const end = startOfDay(new Date());
  return Array.from({ length: days }, (_, index) => format(addDays(subDays(end, days - 1), index), 'yyyy-MM-dd'));
};

export const minutesToHoursText = (minutes: number) => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours <= 0) return `${rest} 分钟`;
  if (rest === 0) return `${hours} 小时`;
  return `${hours} 小时 ${rest} 分钟`;
};
