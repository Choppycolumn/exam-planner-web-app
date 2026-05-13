export interface ReviewProblemExample {
  date: string;
  field: string;
  text: string;
}

export interface CommonProblemSummary {
  id: string;
  label: string;
  count: number;
  dates: string[];
  keywords: string[];
  examples: ReviewProblemExample[];
}
