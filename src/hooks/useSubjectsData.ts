import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { serverApi } from '../api/client';
import { queryKeys } from '../api/queryClient';

export function useSubjectsData() {
  const { data } = useQuery({
    queryKey: queryKeys.subjects,
    queryFn: serverApi.getSubjects,
    placeholderData: { items: [], readOnly: false },
  });
  const subjects = useMemo(() => [...(data?.items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [data?.items]);
  const activeSubjects = useMemo(() => subjects.filter((subject) => subject.isActive), [subjects]);
  return { subjects, activeSubjects, readOnly: Boolean(data?.readOnly) };
}
