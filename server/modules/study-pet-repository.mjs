const allowedCategories = new Set(['study', 'entertainment', 'tool', 'social', 'unknown']);

function text(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function positiveInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.round(number));
}

function normalizeDate(value) {
  const date = text(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const error = new Error('Invalid study pet report date');
    error.statusCode = 400;
    throw error;
  }
  return date;
}

function normalizeCategory(value) {
  const category = text(value, 'unknown').toLowerCase();
  return allowedCategories.has(category) ? category : 'unknown';
}

function normalizeDomain(value) {
  return text(value).toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
}

function normalizeReport(report = {}) {
  const studyGoal = report.studyGoal && typeof report.studyGoal === 'object' ? report.studyGoal : {};
  return {
    date: normalizeDate(report.date),
    timezone: 'Asia/Shanghai',
    deviceId: text(report.deviceId, 'windows-main') || 'windows-main',
    totalComputerSeconds: positiveInteger(report.totalComputerSeconds),
    studySeconds: positiveInteger(report.studySeconds),
    entertainmentSeconds: positiveInteger(report.entertainmentSeconds),
    toolSeconds: positiveInteger(report.toolSeconds),
    socialSeconds: positiveInteger(report.socialSeconds),
    unknownSeconds: positiveInteger(report.unknownSeconds),
    entertainmentOvertimeCount: positiveInteger(report.entertainmentOvertimeCount),
    strongReminderCount: positiveInteger(report.strongReminderCount),
    studyGoal: {
      targetStudySeconds: positiveInteger(studyGoal.targetStudySeconds),
      completed: Boolean(studyGoal.completed),
    },
    sites: Array.isArray(report.sites)
      ? report.sites
          .map((site) => ({
            domain: normalizeDomain(site?.domain),
            category: normalizeCategory(site?.category),
            seconds: positiveInteger(site?.seconds),
            visits: positiveInteger(site?.visits),
          }))
          .filter((site) => site.domain && site.seconds > 0)
      : [],
  };
}

function rowToDailyReport(row = null) {
  if (!row) return null;
  return {
    date: row.date,
    timezone: row.timezone || 'Asia/Shanghai',
    deviceId: row.deviceId || row.device_id || 'windows-main',
    totalComputerSeconds: Number(row.totalComputerSeconds ?? row.total_computer_seconds ?? 0),
    studySeconds: Number(row.studySeconds ?? row.study_seconds ?? 0),
    entertainmentSeconds: Number(row.entertainmentSeconds ?? row.entertainment_seconds ?? 0),
    toolSeconds: Number(row.toolSeconds ?? row.tool_seconds ?? 0),
    socialSeconds: Number(row.socialSeconds ?? row.social_seconds ?? 0),
    unknownSeconds: Number(row.unknownSeconds ?? row.unknown_seconds ?? 0),
    entertainmentOvertimeCount: Number(row.entertainmentOvertimeCount ?? row.entertainment_overtime_count ?? 0),
    strongReminderCount: Number(row.strongReminderCount ?? row.strong_reminder_count ?? 0),
    studyGoal: {
      targetStudySeconds: Number(row.targetStudySeconds ?? row.target_study_seconds ?? 0),
      completed: Boolean(Number(row.goalCompleted ?? row.goal_completed ?? 0)),
    },
    createdAt: row.createdAt || row.created_at || '',
    updatedAt: row.updatedAt || row.updated_at || '',
  };
}

function rowToSiteUsage(row = null) {
  if (!row) return null;
  return {
    date: row.date,
    deviceId: row.deviceId || row.device_id || '',
    domain: row.domain,
    category: normalizeCategory(row.category),
    seconds: Number(row.seconds || 0),
    visits: Number(row.visits || 0),
    createdAt: row.createdAt || row.created_at || '',
    updatedAt: row.updatedAt || row.updated_at || '',
  };
}

export function saveDailyReport(db, report) {
  const normalized = normalizeReport(report);
  const now = new Date().toISOString();
  const sqlString = db.sqlString;
  const sqlValue = db.sqlValue;
  const payloadJson = JSON.stringify(normalized);
  const siteStatements = normalized.sites.map((site) => `INSERT INTO study_pet_site_usage (
  date, device_id, domain, category, seconds, visits, created_at, updated_at
) VALUES (
  ${sqlString(normalized.date)}, ${sqlString(normalized.deviceId)}, ${sqlString(site.domain)}, ${sqlString(site.category)},
  ${sqlValue(site.seconds)}, ${sqlValue(site.visits)}, ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(date, device_id, domain) DO UPDATE SET
  category = excluded.category,
  seconds = excluded.seconds,
  visits = excluded.visits,
  updated_at = excluded.updated_at;`);

  db.transaction([
    `INSERT INTO study_pet_daily_reports (
  date, timezone, device_id, total_computer_seconds, study_seconds, entertainment_seconds,
  tool_seconds, social_seconds, unknown_seconds, entertainment_overtime_count,
  strong_reminder_count, target_study_seconds, goal_completed, payload_json, created_at, updated_at
) VALUES (
  ${sqlString(normalized.date)}, ${sqlString(normalized.timezone)}, ${sqlString(normalized.deviceId)},
  ${sqlValue(normalized.totalComputerSeconds)}, ${sqlValue(normalized.studySeconds)}, ${sqlValue(normalized.entertainmentSeconds)},
  ${sqlValue(normalized.toolSeconds)}, ${sqlValue(normalized.socialSeconds)}, ${sqlValue(normalized.unknownSeconds)},
  ${sqlValue(normalized.entertainmentOvertimeCount)}, ${sqlValue(normalized.strongReminderCount)},
  ${sqlValue(normalized.studyGoal.targetStudySeconds)}, ${sqlValue(normalized.studyGoal.completed)},
  ${sqlString(payloadJson)}, ${sqlString(now)}, ${sqlString(now)}
)
ON CONFLICT(date) DO UPDATE SET
  timezone = excluded.timezone,
  device_id = excluded.device_id,
  total_computer_seconds = excluded.total_computer_seconds,
  study_seconds = excluded.study_seconds,
  entertainment_seconds = excluded.entertainment_seconds,
  tool_seconds = excluded.tool_seconds,
  social_seconds = excluded.social_seconds,
  unknown_seconds = excluded.unknown_seconds,
  entertainment_overtime_count = excluded.entertainment_overtime_count,
  strong_reminder_count = excluded.strong_reminder_count,
  target_study_seconds = excluded.target_study_seconds,
  goal_completed = excluded.goal_completed,
  payload_json = excluded.payload_json,
  updated_at = excluded.updated_at;`,
    `DELETE FROM study_pet_site_usage WHERE date = ${sqlString(normalized.date)};`,
    ...siteStatements,
  ]);

  return normalized;
}

export function getTodayReport(db, date) {
  const rows = db.json(`SELECT
  date,
  timezone,
  device_id AS deviceId,
  total_computer_seconds AS totalComputerSeconds,
  study_seconds AS studySeconds,
  entertainment_seconds AS entertainmentSeconds,
  tool_seconds AS toolSeconds,
  social_seconds AS socialSeconds,
  unknown_seconds AS unknownSeconds,
  entertainment_overtime_count AS entertainmentOvertimeCount,
  strong_reminder_count AS strongReminderCount,
  target_study_seconds AS targetStudySeconds,
  goal_completed AS goalCompleted,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM study_pet_daily_reports
WHERE date = ${db.sqlString(date)}
LIMIT 1;`);
  const report = rowToDailyReport(rows[0] || null);
  const sites = report ? getSiteUsage(db, date, date, { deviceId: report.deviceId }) : [];
  return { report, sites };
}

export function getStats(db, startDate, endDate) {
  return db.json(`SELECT
  date,
  timezone,
  device_id AS deviceId,
  total_computer_seconds AS totalComputerSeconds,
  study_seconds AS studySeconds,
  entertainment_seconds AS entertainmentSeconds,
  tool_seconds AS toolSeconds,
  social_seconds AS socialSeconds,
  unknown_seconds AS unknownSeconds,
  entertainment_overtime_count AS entertainmentOvertimeCount,
  strong_reminder_count AS strongReminderCount,
  target_study_seconds AS targetStudySeconds,
  goal_completed AS goalCompleted,
  created_at AS createdAt,
  updated_at AS updatedAt
FROM study_pet_daily_reports
WHERE date BETWEEN ${db.sqlString(startDate)} AND ${db.sqlString(endDate)}
ORDER BY date ASC;`).map(rowToDailyReport);
}

export function getSiteUsage(db, startDate, endDate, { deviceId = '', limit = 30 } = {}) {
  const safeLimit = Math.max(1, Math.min(100, positiveInteger(limit, 30)));
  const deviceFilter = deviceId ? `AND device_id = ${db.sqlString(deviceId)}` : '';
  return db.json(`SELECT
  MAX(date) AS date,
  device_id AS deviceId,
  domain,
  category,
  SUM(seconds) AS seconds,
  SUM(visits) AS visits,
  MIN(created_at) AS createdAt,
  MAX(updated_at) AS updatedAt
FROM study_pet_site_usage
WHERE date BETWEEN ${db.sqlString(startDate)} AND ${db.sqlString(endDate)}
${deviceFilter}
GROUP BY device_id, domain, category
ORDER BY seconds DESC, visits DESC, domain ASC
LIMIT ${safeLimit};`).map(rowToSiteUsage);
}

export function createStudyPetRepository(db) {
  return {
    saveDailyReport: (report) => saveDailyReport(db, report),
    getTodayReport: (date) => getTodayReport(db, date),
    getStats: (startDate, endDate) => getStats(db, startDate, endDate),
    getSiteUsage: (startDate, endDate, options) => getSiteUsage(db, startDate, endDate, options),
  };
}
