function numeric(value) {
  return Number(value || 0);
}

export function createStudyComparisonService({ repository, todayISO, addDaysISO, nowISO, maxUsers = 10 }) {
  if (!repository) throw new Error('study comparison repository is required');
  const getComparison = ({ days = 30 } = {}) => {
    const safeDays = Math.max(7, Math.min(90, Number(days) || 30));
    const today = todayISO();
    const periodStart = addDaysISO(today, -(safeDays - 1));
    const dayOfWeek = new Date(`${today}T00:00:00Z`).getUTCDay() || 7;
    const weekStart = addDaysISO(today, -(dayOfWeek - 1));
    const monthStart = `${today.slice(0, 8)}01`;
    const streakStart = addDaysISO(today, -364);
    const { accounts, totals, dailyRows } = repository.snapshot({
      today,
      weekStart,
      monthStart,
      streakStart,
    });
    const totalsByUser = new Map(totals.map((row) => [Number(row.userId), row]));
    const dailyMap = new Map(dailyRows.map((row) => [`${row.userId}:${row.date}`, numeric(row.minutes)]));

    const accountSummaries = accounts.map((account) => {
      const total = totalsByUser.get(Number(account.userId)) || {};
      let streakDays = 0;
      for (let offset = 0; offset < 365; offset += 1) {
        const date = addDaysISO(today, -offset);
        if (!dailyMap.get(`${account.userId}:${date}`)) break;
        streakDays += 1;
      }
      return {
        userId: Number(account.userId),
        displayName: account.displayName,
        accountType: account.accountType,
        userRole: account.userRole || 'member',
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
