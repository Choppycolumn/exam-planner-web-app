import type { DailyReview } from '../../types/models';
import { notifyDataChanged, serverApi } from '../../api/client';

export const reviewsRepository = {
  async getByDate(date: string) {
    const state = await serverApi.getState();
    return state.dailyReviews.find((review) => review.date === date);
  },
  async upsert(review: Partial<DailyReview> & { date: string }) {
    const id = await serverApi.upsertReview(review);
    notifyDataChanged();
    return id;
  },
};
