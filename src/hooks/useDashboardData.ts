import { useEffect, useState } from 'react';
import { serverApi, type DashboardData } from '../api/client';
import { todayISO } from '../utils/date';

const emptyDashboard: DashboardData = {
  activeGoal: null,
  today: todayISO(),
  todayTotal: 0,
  distribution: [],
  trend: [],
  latestExam: null,
  todayReview: null,
  yesterdayReview: null,
  visibleTasks: [],
  todayWaterRecord: null,
  readOnly: false,
};

export function useDashboardData() {
  const [data, setData] = useState<DashboardData>(emptyDashboard);

  useEffect(() => {
    let active = true;
    const load = () => serverApi.getDashboard()
      .then((next) => {
        if (active) setData(next);
      })
      .catch(() => {
        if (active) setData(emptyDashboard);
      });
    void load();
    window.addEventListener('server-data-changed', load);
    return () => {
      active = false;
      window.removeEventListener('server-data-changed', load);
    };
  }, []);

  return data;
}
