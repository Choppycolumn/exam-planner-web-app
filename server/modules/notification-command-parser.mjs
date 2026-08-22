const relativeDateOffsets = new Map([
  ['今天', 0],
  ['今日', 0],
  ['明天', 1],
  ['后天', 2],
  ['大后天', 3],
]);

const weekdayValues = new Map([
  ['一', 1],
  ['1', 1],
  ['二', 2],
  ['2', 2],
  ['三', 3],
  ['3', 3],
  ['四', 4],
  ['4', 4],
  ['五', 5],
  ['5', 5],
  ['六', 6],
  ['6', 6],
  ['日', 7],
  ['天', 7],
  ['7', 7],
]);

const urgencyTokens = [
  { urgency: 'high', tokens: ['高优先级', '高优先', '紧急', '重要', '高', 'p0', 'p1', 'urgent', 'high'] },
  { urgency: 'medium', tokens: ['中优先级', '中优先', '普通', '一般', '中', 'p2', 'medium', 'normal'] },
  { urgency: 'low', tokens: ['低优先级', '低优先', '不急', '低', 'p3', 'low'] },
];

export const notificationCommandHelpText = [
  '通知助手规则命令：',
  '1. 待办 明天 15:30 高 背单词 50 个',
  '2. 完成A / 完成 A / 完成 背单词',
  '3. 删除待办 A / 删除待办 背单词',
  '4. 今日待办 / 本周待办',
  '5. 每日简报 / 帮助',
].join('\n');

function cleanText(value = '') {
  return String(value)
    .replace(/[，。；;、|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseISODate(value) {
  const [year, month, day] = String(value || '').split('-').map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return date;
}

function formatISODate(date) {
  return date.toISOString().slice(0, 10);
}

function addDaysISO(value, days) {
  const date = parseISODate(value);
  if (!date) return value;
  date.setUTCDate(date.getUTCDate() + days);
  return formatISODate(date);
}

function currentYear(value) {
  return Number(String(value || '').slice(0, 4)) || new Date().getFullYear();
}

function normalizeDateParts(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return null;
  return formatISODate(date);
}

function removeSlice(text, start, end) {
  return cleanText(`${text.slice(0, start)} ${text.slice(end)}`);
}

function resolveWeekdayDate(token, today) {
  const nextWeek = /^下周|^下星期|^下礼拜/.test(token);
  const weekdayChar = token.at(-1);
  const target = weekdayValues.get(weekdayChar);
  const todayDate = parseISODate(today);
  if (!target || !todayDate) return null;
  const current = todayDate.getUTCDay() || 7;
  if (nextWeek) {
    const weekStart = new Date(todayDate);
    weekStart.setUTCDate(weekStart.getUTCDate() - current + 1);
    weekStart.setUTCDate(weekStart.getUTCDate() + 7 + target - 1);
    return formatISODate(weekStart);
  }
  const delta = target >= current ? target - current : target + 7 - current;
  return addDaysISO(today, delta);
}

function extractDueDate(input, today) {
  const text = cleanText(input);

  const iso = text.match(/\b(20\d{2})[./-](\d{1,2})[./-](\d{1,2})\b/);
  if (iso) {
    const date = normalizeDateParts(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (date) return { dueDate: date, text: removeSlice(text, iso.index, iso.index + iso[0].length) };
  }

  for (const [token, offset] of relativeDateOffsets.entries()) {
    const index = text.indexOf(token);
    if (index >= 0) return { dueDate: addDaysISO(today, offset), text: removeSlice(text, index, index + token.length) };
  }

  const weekday = text.match(/(下周|下星期|下礼拜|这周|本周|周|星期|礼拜)[一二三四五六日天1-7]/);
  if (weekday) {
    const dueDate = resolveWeekdayDate(weekday[0], today);
    if (dueDate) return { dueDate, text: removeSlice(text, weekday.index, weekday.index + weekday[0].length) };
  }

  const monthDay = text.match(/(^|[\s:：])(\d{1,2})(?:月|[/-])(\d{1,2})(?:日|号)?(?=$|[\s:：])/);
  if (monthDay) {
    const prefixLength = monthDay[1].length;
    const start = monthDay.index + prefixLength;
    const end = monthDay.index + monthDay[0].length;
    let date = normalizeDateParts(currentYear(today), Number(monthDay[2]), Number(monthDay[3]));
    if (date && date < today) date = normalizeDateParts(currentYear(today) + 1, Number(monthDay[2]), Number(monthDay[3]));
    if (date) return { dueDate: date, text: removeSlice(text, start, end) };
  }

  return { dueDate: null, text };
}

function normalizeHour(hour, meridiem = '') {
  let value = Number(hour);
  if (!Number.isFinite(value)) return null;
  if (/下午|晚上|傍晚/.test(meridiem) && value >= 1 && value <= 11) value += 12;
  if (/中午/.test(meridiem) && value >= 1 && value <= 10) value += 12;
  if (/凌晨|早上|上午/.test(meridiem) && value === 12) value = 0;
  return value >= 0 && value <= 23 ? value : null;
}

function normalizeTimeParts(hour, minute, meridiem = '') {
  const normalizedHour = normalizeHour(hour, meridiem);
  const normalizedMinute = Number(minute);
  if (normalizedHour === null || !Number.isFinite(normalizedMinute) || normalizedMinute < 0 || normalizedMinute > 59) return null;
  return `${String(normalizedHour).padStart(2, '0')}:${String(normalizedMinute).padStart(2, '0')}`;
}

function extractDueTime(input) {
  const text = cleanText(input);

  const colon = text.match(/(^|[\s:：])(?:(凌晨|早上|上午|中午|下午|傍晚|晚上)\s*)?(\d{1,2})[:：](\d{2})(?=$|[\s:：])/);
  if (colon) {
    const dueTime = normalizeTimeParts(colon[3], colon[4], colon[2] || '');
    if (dueTime) {
      const start = colon.index + colon[1].length;
      const end = colon.index + colon[0].length;
      return { dueTime, text: removeSlice(text, start, end) };
    }
  }

  const half = text.match(/(^|[\s:：])(?:(凌晨|早上|上午|中午|下午|傍晚|晚上)\s*)?(\d{1,2})点半(?=$|[\s:：])/);
  if (half) {
    const dueTime = normalizeTimeParts(half[3], 30, half[2] || '');
    if (dueTime) {
      const start = half.index + half[1].length;
      const end = half.index + half[0].length;
      return { dueTime, text: removeSlice(text, start, end) };
    }
  }

  const zh = text.match(/(^|[\s:：])(?:(凌晨|早上|上午|中午|下午|傍晚|晚上)\s*)?(\d{1,2})点(?:(\d{1,2})分?)?(?=$|[\s:：])/);
  if (zh) {
    const dueTime = normalizeTimeParts(zh[3], zh[4] || 0, zh[2] || '');
    if (dueTime) {
      const start = zh.index + zh[1].length;
      const end = zh.index + zh[0].length;
      return { dueTime, text: removeSlice(text, start, end) };
    }
  }

  return { dueTime: '', text };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractUrgency(input) {
  const text = cleanText(input);
  for (const item of urgencyTokens) {
    const tokenPattern = item.tokens.map(escapeRegex).join('|');
    const pattern = new RegExp(`(^|[\\s:：])(${tokenPattern})(?=$|[\\s:：])`, 'i');
    const match = text.match(pattern);
    if (match) {
      const start = match.index + match[1].length;
      const end = match.index + match[0].length;
      return { urgency: item.urgency, text: removeSlice(text, start, end) };
    }
  }
  return { urgency: 'medium', text };
}

function stripCreatePrefix(text) {
  return cleanText(text.replace(/^(请|帮我|给我|麻烦)?(提醒我|记一个|记录一个|添加|新增|新建)\s*/i, ''));
}

function unknown(reason, raw) {
  return { type: 'unknown', reason, raw, help: notificationCommandHelpText };
}

export function parseNotificationCommand(input, { today = formatISODate(new Date()) } = {}) {
  const raw = String(input || '').trim();
  const text = cleanText(raw);
  if (!text) return unknown('empty_message', raw);

  if (/^(帮助|说明|help|\/help)$/i.test(text)) return { type: 'help', raw };
  if (/^(今日待办|今天待办|待办列表|待办清单|待办)$/i.test(text)) return { type: 'list_tasks', range: 'today', raw };
  if (/^(本周待办|这周待办|周待办|本周任务)$/i.test(text)) return { type: 'list_tasks', range: 'week', raw };
  if (/^(每日简报|今日简报|日报|早报|今日提醒)$/i.test(text)) return { type: 'daily_digest', raw };

  const complete = text.match(/^(完成|搞定|已完成|打卡)\s*(.+)$/i);
  if (complete) return { type: 'complete_task', keyword: cleanText(complete[2]), raw };

  const remove = text.match(/^(删除待办|删除任务|删待办|取消待办|取消任务)\s*(.+)$/i);
  if (remove) return { type: 'delete_task', keyword: cleanText(remove[2]), raw };

  const create = text.match(/^(待办|添加待办|新增待办|新建待办|任务|添加任务|新增任务|新建任务)(?:\s|:|：)?(.+)$/i);
  if (!create) return unknown('unsupported_command', raw);

  let rest = stripCreatePrefix(create[2]);
  const firstDate = extractDueDate(rest, today);
  rest = firstDate.text;
  const firstTime = extractDueTime(rest);
  rest = firstTime.text;
  const urgency = extractUrgency(rest);
  rest = urgency.text;
  const secondDate = firstDate.dueDate ? { dueDate: firstDate.dueDate, text: rest } : extractDueDate(rest, today);
  rest = secondDate.text;
  const secondTime = firstTime.dueTime ? { dueTime: firstTime.dueTime, text: rest } : extractDueTime(rest);
  rest = secondTime.text;

  const title = cleanText(rest.replace(/^[:：]+/, ''));
  if (!title) return unknown('missing_task_title', raw);

  return {
    type: 'create_task',
    title: title.slice(0, 160),
    dueDate: secondDate.dueDate || today,
    dueTime: secondTime.dueTime || '',
    urgency: urgency.urgency,
    raw,
  };
}
