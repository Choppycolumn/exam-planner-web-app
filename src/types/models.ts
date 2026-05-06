export type GoalType = '考研' | '课程' | '项目';

export interface BaseEntity {
  id?: number;
  schemaVersion: number;
  createdAt: string;
  updatedAt?: string;
}

export interface Goal extends BaseEntity {
  name: string;
  description: string;
  deadline: string;
  isActive: boolean;
  type: GoalType;
  notes?: string;
}

export interface DailyReview extends BaseEntity {
  date: string;
  summary: string;
  wins: string;
  problems: string;
  tomorrowPlan: string;
  statusScore: number;
  satisfactionScore: number;
}

export interface StudyProject extends BaseEntity {
  name: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
}

export interface StudyTimeRecord extends BaseEntity {
  date: string;
  projectId: number;
  projectNameSnapshot: string;
  minutes: number;
  note?: string;
}

export interface Subject extends BaseEntity {
  name: string;
  color: string;
  isActive: boolean;
  sortOrder: number;
}

export interface MockExamRecord extends BaseEntity {
  date: string;
  subjectId: number;
  subjectNameSnapshot: string;
  score: number;
  fullScore: number;
  paperName: string;
  durationMinutes: number;
  wrongCount: number;
  note?: string;
}

export type TaskUrgency = 'low' | 'medium' | 'high';

export interface ShortTermTask extends BaseEntity {
  title: string;
  dueDate: string;
  urgency: TaskUrgency;
  isCompleted: boolean;
  completedAt?: string;
  note?: string;
}

export interface AppSetting extends BaseEntity {
  key: string;
  value: unknown;
}

export interface ChartPoint {
  name: string;
  value: number;
  color?: string;
}
