import { addDays, differenceInCalendarDays, format, parseISO, startOfDay, subDays } from 'date-fns';

export const todayISO = () => format(new Date(), 'yyyy-MM-dd');

export const formatChineseDate = (date = new Date()) => format(date, 'yyyy年MM月dd日');

export const nowISO = () => new Date().toISOString();

export const previousDateISO = (date: string) => format(subDays(parseISO(date), 1), 'yyyy-MM-dd');

export const calculateCountdownDays = (deadline: string) => {
  if (!deadline) return 0;
  return Math.max(0, differenceInCalendarDays(startOfDay(parseISO(deadline)), startOfDay(new Date())));
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
