import type { DailyReview } from '../../types/models';
import { notifyDataChanged, serverApi } from '../../api/client';
import type { DashboardData } from '../../api/client';
import { queryClient, queryKeys } from '../../api/queryClient';
import { todayISO, previousDateISO } from '../../utils/date';

function optimisticReview(review: Partial<DailyReview> & { date: string }): DailyReview {
  return {
    id: review.id ?? -Date.now(),
    date: review.date,
    summary: review.summary ?? '',
    wins: review.wins ?? '',
    problems: review.problems ?? '',
    tomorrowPlan: review.tomorrowPlan ?? '',
    score: Math.max(1, Math.min(10, Number(review.score || 6))),
    schemaVersion: review.schemaVersion ?? 1,
    createdAt: review.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function updateDashboardReview(review: DailyReview) {
  queryClient.setQueryData<DashboardData | undefined>(queryKeys.dashboard, (current) => {
    if (!current) return current;
    const today = todayISO();
    const yesterday = previousDateISO(today);
    return {
      ...current,
      todayReview: review.date === today ? review : current.todayReview,
      yesterdayReview: review.date === yesterday ? review : current.yesterdayReview,
    };
  });
}

export const reviewsRepository = {
  async getByDate(date: string) {
    const state = await serverApi.getState();
    return state.dailyReviews.find((review) => review.date === date);
  },
  async upsert(review: Partial<DailyReview> & { date: string }) {
    updateDashboardReview(optimisticReview(review));
    const id = await serverApi.upsertReview(review);
    notifyDataChanged();
    return id;
  },
};
