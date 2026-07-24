import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { FocusTimerAction, FocusTimerActionName, FocusTimerDashboard } from '../api/contracts';
import { serverApi } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
import {
  applyOptimisticFocusTimerAction,
  createFocusTimerId,
  enqueueFocusTimerAction,
  loadFocusTimerCache,
  loadFocusTimerQueue,
  removeFocusTimerAction,
  saveFocusTimerCache,
} from '../features/focus-timer/offlineQueue';

type ActionInput = Omit<FocusTimerAction, 'action' | 'operationId' | 'occurredAt'> & {
  action: FocusTimerActionName;
  operationId?: string;
  occurredAt?: string;
  projectName?: string;
};

const activeFlushes = new Map<number, Promise<FocusTimerDashboard | undefined>>();

function isRetryable(error: unknown) {
  const status = typeof error === 'object' && error && 'status' in error
    ? Number((error as { status?: number }).status || 0)
    : 0;
  return status === 0 || status >= 500;
}

async function flushUserQueue(userId: number) {
  const running = activeFlushes.get(userId);
  if (running) return running;
  const flush = (async () => {
    let latest: FocusTimerDashboard | undefined;
    let queue = loadFocusTimerQueue(userId);
    while (queue.length) {
      const current = queue[0];
      try {
        const response = await serverApi.focusTimerAction(current);
        latest = response.dashboard;
        queue = removeFocusTimerAction(userId, current.operationId);
        saveFocusTimerCache(userId, latest);
      } catch (error) {
        if (isRetryable(error)) throw error;
        queue = removeFocusTimerAction(userId, current.operationId);
      }
    }
    latest = await serverApi.getFocusTimer();
    saveFocusTimerCache(userId, latest);
    return latest;
  })().finally(() => activeFlushes.delete(userId));
  activeFlushes.set(userId, flush);
  return flush;
}

export function useFocusTimer(userId: number, online: boolean) {
  const [pendingCount, setPendingCount] = useState(() => loadFocusTimerQueue(userId).length);
  const [syncError, setSyncError] = useState('');
  const mounted = useRef(true);
  const focusKey = useMemo(() => queryKeys.focusTimer(userId), [userId]);
  const query = useQuery({
    queryKey: focusKey,
    queryFn: serverApi.getFocusTimer,
    enabled: userId > 0,
    placeholderData: () => loadFocusTimerCache(userId),
    refetchInterval: online && userId > 0 ? 15_000 : false,
    staleTime: 5_000,
  });

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (query.data) saveFocusTimerCache(userId, query.data);
  }, [query.data, userId]);

  const flush = useCallback(async () => {
    if (!online || !loadFocusTimerQueue(userId).length) return undefined;
    try {
      const latest = await flushUserQueue(userId);
      if (latest) queryClient.setQueryData(focusKey, latest);
      if (mounted.current) {
        setPendingCount(loadFocusTimerQueue(userId).length);
        setSyncError('');
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard });
      void queryClient.invalidateQueries({ queryKey: ['server', 'study-records'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.learningProgress });
      return latest;
    } catch {
      if (mounted.current) {
        setPendingCount(loadFocusTimerQueue(userId).length);
        setSyncError('暂时无法连接服务器，记录已保存在本机，联网后会自动补传。');
      }
      return undefined;
    }
  }, [focusKey, online, userId]);

  useEffect(() => {
    if (!online) return undefined;
    const timeoutId = window.setTimeout(() => void flush(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [flush, online]);

  const dispatch = useCallback(async (input: ActionInput) => {
    const { projectName = '', ...values } = input;
    const action: FocusTimerAction = {
      ...values,
      action: input.action,
      operationId: input.operationId || createFocusTimerId('operation'),
      occurredAt: input.occurredAt || new Date().toISOString(),
    };
    const current = queryClient.getQueryData<FocusTimerDashboard>(focusKey) || loadFocusTimerCache(userId);
    enqueueFocusTimerAction(userId, action);
    setPendingCount(loadFocusTimerQueue(userId).length);
    if (current) {
      const optimistic = applyOptimisticFocusTimerAction(current, action, projectName);
      queryClient.setQueryData(focusKey, optimistic);
      saveFocusTimerCache(userId, optimistic);
    }
    if (online) await flush();
    return action;
  }, [flush, focusKey, online, userId]);

  return {
    ...query,
    dashboard: query.data,
    pendingCount,
    syncError,
    dispatch,
    flush,
  };
}
