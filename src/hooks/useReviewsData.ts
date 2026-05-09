import { useEffect, useState } from 'react';
import { serverApi } from '../api/client';
import type { DailyReview } from '../types/models';

export function useReviewsData(from?: string, to?: string) {
  const [reviews, setReviews] = useState<DailyReview[]>([]);
  const [readOnly, setReadOnly] = useState(false);

  useEffect(() => {
    let active = true;
    const load = () => serverApi.getReviews(from, to)
      .then((result) => {
        if (!active) return;
        setReviews(result.reviews);
        setReadOnly(Boolean(result.readOnly));
      })
      .catch(() => {
        if (!active) return;
        setReviews([]);
        setReadOnly(false);
      });
    void load();
    window.addEventListener('server-data-changed', load);
    return () => {
      active = false;
      window.removeEventListener('server-data-changed', load);
    };
  }, [from, to]);

  return { reviews, readOnly };
}
