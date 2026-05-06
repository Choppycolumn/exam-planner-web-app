import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/database';

export function useAppData() {
  const goals = useLiveQuery(() => db.goals.orderBy('createdAt').reverse().toArray(), [], []);
  const activeGoal = useMemo(() => goals.find((goal) => goal.isActive), [goals]);
  const projects = useLiveQuery(() => db.studyProjects.orderBy('sortOrder').toArray(), [], []);
  const activeProjects = useMemo(() => projects.filter((project) => project.isActive), [projects]);
  const studyRecords = useLiveQuery(() => db.studyTimeRecords.toArray(), [], []);
  const reviews = useLiveQuery(() => db.dailyReviews.toArray(), [], []);
  const subjects = useLiveQuery(() => db.subjects.orderBy('sortOrder').toArray(), [], []);
  const activeSubjects = useMemo(() => subjects.filter((subject) => subject.isActive), [subjects]);
  const exams = useLiveQuery(() => db.mockExamRecords.orderBy('date').reverse().toArray(), [], []);
  const shortTermTasks = useLiveQuery(() => db.shortTermTasks.orderBy('dueDate').toArray(), [], []);

  return { goals, activeGoal, projects, activeProjects, studyRecords, reviews, subjects, activeSubjects, exams, shortTermTasks };
}
