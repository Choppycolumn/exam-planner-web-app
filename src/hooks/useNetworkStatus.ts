import { useEffect, useState } from 'react';

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

export function useNetworkStatus() {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    let disposed = false;
    let probeTimer = 0;

    const scheduleProbe = (delayMs: number) => {
      window.clearTimeout(probeTimer);
      probeTimer = window.setTimeout(runProbe, delayMs);
    };
    const runProbe = async () => {
      if (!navigator.onLine) {
        if (!disposed) setOnline(false);
        scheduleProbe(10_000);
        return;
      }
      const reachable = await probeServerHealth();
      if (disposed) return;
      setOnline(reachable);
      scheduleProbe(reachable ? 60_000 : 10_000);
    };
    const handleOnline = () => {
      void runProbe();
    };
    const handleOffline = () => setOnline(false);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void runProbe();
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibility);
    void runProbe();
    return () => {
      disposed = true;
      window.clearTimeout(probeTimer);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return { online };
}
