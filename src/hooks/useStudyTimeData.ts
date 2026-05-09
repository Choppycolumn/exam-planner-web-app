import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { serverApi } from '../api/client';
import { queryKeys } from '../api/queryClient';

export function useStudyTimeData(date: string) {
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects,
    queryFn: serverApi.getProjects,
    placeholderData: { items: [], readOnly: false },
  });
  const recordsQuery = useQuery({
    queryKey: queryKeys.studyRecords(date),
    queryFn: () => serverApi.getStudyRecordsByDate(date),
    placeholderData: { records: [], readOnly: false },
  });

  const projects = useMemo(() => [...(projectsQuery.data?.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [projectsQuery.data?.items]);
  const activeProjects = useMemo(() => projects.filter((project) => project.isActive), [projects]);

  return {
    projects,
    activeProjects,
    recordsForDate: recordsQuery.data?.records ?? [],
    readOnly: Boolean(projectsQuery.data?.readOnly || recordsQuery.data?.readOnly),
  };
}
