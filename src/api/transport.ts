export type ApiOptions = {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
};

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body ? { accept: 'application/json', 'content-type': 'application/json' } : { accept: 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: controller.signal,
  }).finally(() => window.clearTimeout(timeoutId));

  if (!response.ok) {
    const text = await response.text();
    let message = text || `Request failed with ${response.status}`;
    try {
      const payload = JSON.parse(text) as { error?: string; message?: string };
      message = payload.error || payload.message || message;
    } catch {
      // Non-JSON server errors still surface as plain text for debugging.
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }

  return response.json() as Promise<T>;
}
