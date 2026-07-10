export function nowISO() {
  return new Date().toISOString();
}

export function localDateISO(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function todayISO() {
  return localDateISO();
}

export function addYearISO() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  return localDateISO(date);
}

export function parseDateString(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  return new Date(year || 1970, (month || 1) - 1, day || 1);
}

export function formatDateString(date) {
  return localDateISO(date);
}

export function addDaysISO(value, days) {
  const date = parseDateString(value);
  date.setDate(date.getDate() + days);
  return formatDateString(date);
}

export function startOfWeekISO(value) {
  const date = parseDateString(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return formatDateString(date);
}

export function endOfWeekISO(value) {
  return addDaysISO(startOfWeekISO(value), 6);
}

export function startOfMonthISO(value) {
  const date = parseDateString(value);
  date.setDate(1);
  return formatDateString(date);
}

export function endOfMonthISO(value) {
  const date = parseDateString(value);
  date.setMonth(date.getMonth() + 1, 0);
  return formatDateString(date);
}

export function previousWeekPeriod(today = todayISO()) {
  const end = addDaysISO(startOfWeekISO(today), -1);
  return { start: startOfWeekISO(end), end };
}

export function previousMonthPeriod(today = todayISO()) {
  const date = parseDateString(today);
  date.setMonth(date.getMonth() - 1, 1);
  const start = formatDateString(date);
  return { start, end: endOfMonthISO(start) };
}

export function currentPeriod(kind, today = todayISO()) {
  if (kind === 'month') return { start: startOfMonthISO(today), end: endOfMonthISO(today) };
  return { start: startOfWeekISO(today), end: endOfWeekISO(today) };
}

export function previousPeriod(kind, today = todayISO()) {
  return kind === 'month' ? previousMonthPeriod(today) : previousWeekPeriod(today);
}
