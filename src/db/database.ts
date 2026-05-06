import Dexie, { type Table } from 'dexie';
import type { AppSetting, DailyReview, Goal, MockExamRecord, ShortTermTask, StudyProject, StudyTimeRecord, Subject } from '../types/models';
import { DB_NAME, ENTITY_SCHEMA_VERSION } from './schema';
import { nowISO } from '../utils/date';

class ExamPlannerDatabase extends Dexie {
  goals!: Table<Goal, number>;
  dailyReviews!: Table<DailyReview, number>;
  studyProjects!: Table<StudyProject, number>;
  studyTimeRecords!: Table<StudyTimeRecord, number>;
  subjects!: Table<Subject, number>;
  mockExamRecords!: Table<MockExamRecord, number>;
  shortTermTasks!: Table<ShortTermTask, number>;
  appSettings!: Table<AppSetting, number>;

  constructor() {
    super(DB_NAME);

    this.version(1)
      .stores({
        goals: '++id, isActive, deadline, type, createdAt, schemaVersion',
        dailyReviews: '++id, &date, createdAt, updatedAt, schemaVersion',
        studyProjects: '++id, name, isActive, sortOrder, schemaVersion',
        studyTimeRecords: '++id, [date+projectId], date, projectId, createdAt, schemaVersion',
        subjects: '++id, name, isActive, sortOrder, schemaVersion',
        mockExamRecords: '++id, date, subjectId, [subjectId+date], createdAt, schemaVersion',
        appSettings: '++id, &key, schemaVersion',
      })
      .upgrade(async (tx) => {
        // Future migrations can normalize records here without changing repository APIs.
        await tx.table('appSettings').put({
          key: 'dbSchemaVersion',
          value: 1,
          schemaVersion: ENTITY_SCHEMA_VERSION,
          createdAt: nowISO(),
          updatedAt: nowISO(),
        });
      });

    this.version(2)
      .stores({
        goals: '++id, isActive, deadline, type, createdAt, schemaVersion',
        dailyReviews: '++id, &date, createdAt, updatedAt, schemaVersion',
        studyProjects: '++id, name, isActive, sortOrder, schemaVersion',
        studyTimeRecords: '++id, [date+projectId], date, projectId, createdAt, schemaVersion',
        subjects: '++id, name, isActive, sortOrder, schemaVersion',
        mockExamRecords: '++id, date, subjectId, [subjectId+date], createdAt, schemaVersion',
        shortTermTasks: '++id, dueDate, urgency, isCompleted, completedAt, createdAt, schemaVersion',
        appSettings: '++id, &key, schemaVersion',
      })
      .upgrade(async (tx) => {
        await tx.table('appSettings').put({
          key: 'dbSchemaVersion',
          value: 2,
          schemaVersion: ENTITY_SCHEMA_VERSION,
          createdAt: nowISO(),
          updatedAt: nowISO(),
        });
      });
  }
}

export const db = new ExamPlannerDatabase();
