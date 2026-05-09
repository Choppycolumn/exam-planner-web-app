import { useQuery } from '@tanstack/react-query';
import { serverApi } from '../api/client';
import { queryKeys } from '../api/queryClient';
import type { DailyReview } from '../types/models';

export function useReviewsData(from?: string, to?: string, limit?: number, offset = 0) {
  const { data } = useQuery({
    queryKey: queryKeys.reviews(from, to, limit, offset),
    queryFn: () => serverApi.getReviews(from, to, limit, offset),
    placeholderData: { reviews: [] as DailyReview[], total: 0, limit: limit ?? null, offset, readOnly: false },
  });

  return {
    reviews: data?.reviews ?? [],
    total: data?.total ?? 0,
    limit: data?.limit ?? limit ?? null,
    offset: data?.offset ?? offset,
    readOnly: Boolean(data?.readOnly),
  };
}
