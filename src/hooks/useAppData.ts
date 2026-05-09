import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { serverApi, type ServerState } from '../api/client';
import { queryKeys } from '../api/queryClient';

const emptyState: ServerState = {
  goals: [],
  dailyReviews: [],
  studyProjects: [],
  studyTimeRecords: [],
  subjects: [],
  mockExamRecords: [],
  shortTermTasks: [],
  waterIntakeRecords: [],
  readOnly: false,
};

export function useAppData() {
  const { data: state = emptyState } = useQuery({
    queryKey: queryKeys.state,
    queryFn: serverApi.getState,
    placeholderData: emptyState,
  });

  const goals = useMemo(() => [...state.goals].sort((a, b) => b.createdAt.localeCompare(a.createdAt)), [state.goals]);
  const activeGoal = useMemo(() => goals.find((goal) => goal.isActive), [goals]);
  const projects = useMemo(() => [...state.studyProjects].sort((a, b) => a.sortOrder - b.sortOrder), [state.studyProjects]);
  const activeProjects = useMemo(() => projects.filter((project) => project.isActive), [projects]);
  const studyRecords = state.studyTimeRecords;
  const reviews = state.dailyReviews;
  const subjects = useMemo(() => [...state.subjects].sort((a, b) => a.sortOrder - b.sortOrder), [state.subjects]);
  const activeSubjects = useMemo(() => subjects.filter((subject) => subject.isActive), [subjects]);
  const exams = useMemo(() => [...state.mockExamRecords].sort((a, b) => b.date.localeCompare(a.date)), [state.mockExamRecords]);
  const shortTermTasks = useMemo(() => [...state.shortTermTasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [state.shortTermTasks]);
  const waterIntakeRecords = state.waterIntakeRecords;
  const readOnly = Boolean(state.readOnly);

  return { goals, activeGoal, projects, activeProjects, studyRecords, reviews, subjects, activeSubjects, exams, shortTermTasks, waterIntakeRecords, readOnly };
}
