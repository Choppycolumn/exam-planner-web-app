import { useQuery } from '@tanstack/react-query';
import { serverApi } from '../api/client';
import { queryKeys } from '../api/queryClient';

export function useMockExamsData(subjectId: number | 'all', limit: number, offset: number) {
  const { data } = useQuery({
    queryKey: queryKeys.mockExams(subjectId, limit, offset),
    queryFn: () => serverApi.getMockExams(subjectId, limit, offset),
    placeholderData: {
      exams: [],
      total: 0,
      limit,
      offset,
      stats: { latest: null, highest: null, average: null, lowest: null },
      trend: [],
      readOnly: false,
    },
  });

  return data;
}
