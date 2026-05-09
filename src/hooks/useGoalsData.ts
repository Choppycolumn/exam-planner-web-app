import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { serverApi } from '../api/client';
import { queryKeys } from '../api/queryClient';

export function useGoalsData() {
  const { data } = useQuery({
    queryKey: queryKeys.goals,
    queryFn: serverApi.getGoals,
    placeholderData: { items: [], readOnly: false },
  });
  const goals = useMemo(() => [...(data?.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [data?.items]);
  const activeGoal = useMemo(() => goals.find((goal) => goal.isActive), [goals]);
  return { goals, activeGoal, readOnly: Boolean(data?.readOnly) };
}
