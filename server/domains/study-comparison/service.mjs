function numeric(value) {
  return Number(value || 0);
}

export function createStudyComparisonService({ database, todayISO, addDaysISO, nowISO, maxUsers = 3 }) {
  const getComparison = ({ days = 30 } = {}) => {
    const safeDays = Math.max(7, Math.min(90, Number(days) || 30));
    const today = todayISO();
    const periodStart = addDaysISO(today, -(safeDays - 1));
    const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
    const weekStart = addDaysISO(today, -(dayOfWeek - 1));
    const monthStart = `${today.slice(0, 8)}01`;
    const accounts = database.json(`SELECT id AS userId, display_name AS displayName, account_type AS accountType
FROM user_accounts WHERE is_active = 1 ORDER BY id;`);
    const totals = database.json(`SELECT user_id AS userId,
SUM(CASE WHEN date = ? THEN minutes ELSE 0 END) AS todayMinutes,
SUM(CASE WHEN date BETWEEN ? AND ? THEN minutes ELSE 0 END) AS weekMinutes,
SUM(CASE WHEN date BETWEEN ? AND ? THEN minutes ELSE 0 END) AS monthMinutes,
SUM(minutes) AS totalMinutes,
COUNT(DISTINCT CASE WHEN minutes > 0 THEN date END) AS studyDays
FROM study_time_records
GROUP BY user_id;`, [today, weekStart, today, monthStart, today]);
    const totalsByUser = new Map(totals.map((row) => [Number(row.userId), row]));
    const dailyRows = database.json(`SELECT user_id AS userId, date, SUM(minutes) AS minutes
FROM study_time_records
WHERE date BETWEEN ? AND ?
GROUP BY user_id, date
ORDER BY date, user_id;`, [periodStart, today]);
    const dailyMap = new Map(dailyRows.map((row) => [`${row.userId}:${row.date}`, numeric(row.minutes)]));

    const accountSummaries = accounts.map((account) => {
      const total = totalsByUser.get(Number(account.userId)) || {};
      let streakDays = 0;
      for (let offset = 0; offset < 365; offset += 1) {
        const date = addDaysISO(today, -offset);
        if (!dailyMap.get(`${account.userId}:${date}`) && date >= periodStart) break;
        if (date < periodStart) {
          const minutes = numeric(database.scalar(
            'SELECT COALESCE(SUM(minutes), 0) FROM study_time_records WHERE user_id = ? AND date = ?;',
            [Number(account.userId), date],
          ));
          if (!minutes) break;
        }
        streakDays += 1;
      }
      return {
        userId: Number(account.userId),
        displayName: account.displayName,
        accountType: account.accountType,
        todayMinutes: numeric(total.todayMinutes),
        weekMinutes: numeric(total.weekMinutes),
        monthMinutes: numeric(total.monthMinutes),
        totalMinutes: numeric(total.totalMinutes),
        studyDays: numeric(total.studyDays),
        streakDays,
      };
    });

    const daily = [];
    for (let offset = 0; offset < safeDays; offset += 1) {
      const date = addDaysISO(periodStart, offset);
      daily.push({
        date,
        users: Object.fromEntries(accountSummaries.map((account) => [
          String(account.userId),
          dailyMap.get(`${account.userId}:${date}`) || 0,
        ])),
      });
    }

    return {
      generatedAt: nowISO(),
      today,
      periodStart,
      periodEnd: today,
      maxUsers,
      accounts: accountSummaries,
      daily,
    };
  };

  return { getComparison };
}
