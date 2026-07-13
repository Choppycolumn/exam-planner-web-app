import { useQuery } from '@tanstack/react-query';
import { serverApi } from '../api/client';
import { queryKeys } from '../api/queryClient';

export function useAccountSession() {
  return useQuery({
    queryKey: queryKeys.session,
    queryFn: serverApi.getSession,
    staleTime: 5 * 60_000,
  });
}
