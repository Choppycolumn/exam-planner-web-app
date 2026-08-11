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
  latestExam: null,
  todayReview: null,
  yesterdayReview: null,
  visibleTasks: [],
  todayWaterRecord: null,
  todayBrief: null,
  startupPlan: undefined,
  reminders: [],
  activityCalendar: [],
  errorThemeWall: [],
  readOnly: false,
};

export function useDashboardData() {
  const query = useQuery({
    queryKey: queryKeys.dashboard,
    queryFn: serverApi.getDashboard,
    placeholderData: emptyDashboard,
  });

  if (query.error && query.isPlaceholderData) throw query.error;
  return query.data ?? emptyDashboard;
}
