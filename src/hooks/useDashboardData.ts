import { useQuery } from '@tanstack/react-query';
import { serverApi, type DashboardData } from '../api/client';
import { queryKeys } from '../api/queryClient';
import { todayISO } from '../utils/date';

const emptyDashboard: DashboardData = {
  activeGoal: null,
  today: todayISO(),
  todayTotal: 0,
  totalStudyMinutes: 0,
  studyTargetMinutes: 0,
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
  const { data } = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: serverApi.getDashboard,
    placeholderData: emptyDashboard,
  });

  return data ?? emptyDashboard;
}
