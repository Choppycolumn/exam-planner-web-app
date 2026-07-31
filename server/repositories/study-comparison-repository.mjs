export function createStudyComparisonRepository(database) {
  function snapshot({ today, weekStart, monthStart, streakStart }) {
    const accounts = database.json(`SELECT id AS userId,display_name AS displayName,
account_type AS accountType,role AS userRole
FROM user_accounts WHERE status='active' AND is_active=1 ORDER BY id;`);
    const totals = database.json(`SELECT user_id AS userId,
SUM(CASE WHEN date=? THEN minutes ELSE 0 END) AS todayMinutes,
SUM(CASE WHEN date BETWEEN ? AND ? THEN minutes ELSE 0 END) AS weekMinutes,
SUM(CASE WHEN date BETWEEN ? AND ? THEN minutes ELSE 0 END) AS monthMinutes,
SUM(minutes) AS totalMinutes,
COUNT(DISTINCT CASE WHEN minutes>0 THEN date END) AS studyDays
FROM study_time_records GROUP BY user_id;`, [
      today, weekStart, today, monthStart, today,
    ]);
    const dailyRows = database.json(`SELECT user_id AS userId,date,SUM(minutes) AS minutes
FROM study_time_records WHERE date BETWEEN ? AND ?
GROUP BY user_id,date ORDER BY date,user_id;`, [streakStart, today]);
    return { accounts, totals, dailyRows };
  }

  return { snapshot };
}
