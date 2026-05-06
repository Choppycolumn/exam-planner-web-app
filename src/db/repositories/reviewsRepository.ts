import type { DailyReview } from '../../types/models';
import { nowISO } from '../../utils/date';
import { db } from '../database';
import { ENTITY_SCHEMA_VERSION } from '../schema';

export const reviewsRepository = {
  table: db.dailyReviews,
  getByDate(date: string) {
    return db.dailyReviews.where('date').equals(date).first();
  },
  async upsert(review: Partial<DailyReview> & { date: string }) {
    const existing = await this.getByDate(review.date);
    const timestamp = nowISO();
    if (existing?.id) {
      await db.dailyReviews.update(existing.id, { ...review, updatedAt: timestamp });
      return existing.id;
    }
    return db.dailyReviews.add({
      date: review.date,
      summary: review.summary ?? '',
      wins: review.wins ?? '',
      problems: review.problems ?? '',
      tomorrowPlan: review.tomorrowPlan ?? '',
      statusScore: review.statusScore ?? 3,
      satisfactionScore: review.satisfactionScore ?? 3,
      schemaVersion: ENTITY_SCHEMA_VERSION,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  },
};
