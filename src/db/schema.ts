import type { AppSetting, DailyReview, Goal, MockExamRecord, ShortTermTask, StudyProject, StudyTimeRecord, Subject } from '../types/models';

export const DB_NAME = 'exam_plan_manager';
export const DB_SCHEMA_VERSION = 2;
export const ENTITY_SCHEMA_VERSION = 1;

export interface ExamPlannerSchema {
  goals: Goal;
  dailyReviews: DailyReview;
  studyProjects: StudyProject;
  studyTimeRecords: StudyTimeRecord;
  subjects: Subject;
  mockExamRecords: MockExamRecord;
  shortTermTasks: ShortTermTask;
  appSettings: AppSetting;
}
