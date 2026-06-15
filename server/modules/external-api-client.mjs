const DEFAULT_FRESH_MS = 30 * 60 * 1000;
const DEFAULT_STALE_MS = 24 * 60 * 60 * 1000;

export function createExternalApiClient({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  defaultTimeoutMs = 9000,
  failureThreshold = 3,
  circuitResetMs = 5 * 60 * 1000,
} = {}) {
  const cache = new Map();
  const circuits = new Map();

  const request = async (url, {
    responseType = 'json',
    timeoutMs = defaultTimeoutMs,
    retries = 1,
    freshMs = DEFAULT_FRESH_MS,
    staleMs = DEFAULT_STALE_MS,
    cacheKey = url,
    headers = {},
  } = {}) => {
    const timestamp = now();
    const cached = cache.get(cacheKey);
    if (cached && timestamp - cached.storedAt <= freshMs) {
      return { value: cached.value, cacheStatus: 'fresh', fetchedAt: cached.fetchedAt };
    }
    const circuit = circuits.get(cacheKey);
    if (circuit?.openUntil > timestamp && cached && timestamp - cached.storedAt <= staleMs) {
      return { value: cached.value, cacheStatus: 'stale-circuit-open', fetchedAt: cached.fetchedAt };
    }

    let lastError;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(url, {
          signal: controller.signal,
          headers: { 'user-agent': 'exam-planner/1.0', ...headers },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const value = responseType === 'text' ? await response.text() : await response.json();
        const fetchedAt = new Date(timestamp).toISOString();
        cache.set(cacheKey, { value, storedAt: timestamp, fetchedAt });
        circuits.delete(cacheKey);
        return { value, cacheStatus: 'network', fetchedAt };
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
    }

    const failures = Number(circuit?.failures || 0) + 1;
    circuits.set(cacheKey, {
      failures,
      openUntil: failures >= failureThreshold ? timestamp + circuitResetMs : 0,
    });
    if (cached && timestamp - cached.storedAt <= staleMs) {
      return { value: cached.value, cacheStatus: 'stale-fallback', fetchedAt: cached.fetchedAt, error: lastError };
    }
    throw lastError;
  };

  return {
    json: (url, options) => request(url, { ...options, responseType: 'json' }),
    text: (url, options) => request(url, { ...options, responseType: 'text' }),
    status: () => ({
      cacheEntries: cache.size,
      openCircuits: [...circuits.entries()]
        .filter(([, item]) => item.openUntil > now())
        .map(([key, item]) => ({ key, failures: item.failures, openUntil: new Date(item.openUntil).toISOString() })),
    }),
  };
}
