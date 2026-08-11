import { useSyncExternalStore } from 'react';

export async function probeServerHealth(timeoutMs = 4000): Promise<boolean> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch('/health', {
      cache: 'no-store',
      credentials: 'same-origin',
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

let currentOnline = typeof navigator === 'undefined' ? true : navigator.onLine;
let probeTimer = 0;
let started = false;
let probeGeneration = 0;
const subscribers = new Set<() => void>();

function publish(nextOnline: boolean) {
  if (nextOnline === currentOnline) return;
  const wasOnline = currentOnline;
  currentOnline = nextOnline;
  for (const subscriber of subscribers) subscriber();
  if (!wasOnline && nextOnline && typeof window !== 'undefined') {
    window.dispatchEvent(new Event('server-reconnected'));
  }
}

function scheduleProbe(delayMs: number) {
  window.clearTimeout(probeTimer);
  probeTimer = window.setTimeout(runProbe, delayMs);
}

async function runProbe() {
  const generation = ++probeGeneration;
  if (!navigator.onLine) {
    publish(false);
    scheduleProbe(10_000);
    return;
  }
  const reachable = await probeServerHealth();
  if (!started || generation !== probeGeneration) return;
  publish(reachable);
  scheduleProbe(reachable ? 60_000 : 10_000);
}

function startNetworkMonitor() {
  if (started || typeof window === 'undefined') return;
  started = true;
  const handleOnline = () => void runProbe();
  const handleOffline = () => publish(false);
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') void runProbe();
  };
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', handleOffline);
  document.addEventListener('visibilitychange', handleVisibility);
  void runProbe();
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);
  startNetworkMonitor();
  return () => subscribers.delete(subscriber);
}

export function useNetworkStatus() {
  const online = useSyncExternalStore(subscribe, () => currentOnline, () => true);
  return { online };
}
