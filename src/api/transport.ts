import { apiContract, type ApiContractName } from '../../shared/api-contracts.js';

export type ApiOptions = {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
};

export type ApiQuery = URLSearchParams | Record<string, string | number | boolean | null | undefined>;

type ApiErrorEnvelope = {
  error?: string | { code?: string; message?: string; requestId?: string };
  message?: string;
  requestId?: string;
};

export async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  const response = await fetch(`/api${path}`, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body
      ? { accept: 'application/json', 'content-type': 'application/json', 'x-exam-planner-client': 'web' }
      : { accept: 'application/json', 'x-exam-planner-client': 'web' },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: controller.signal,
  }).finally(() => window.clearTimeout(timeoutId));

  if (!response.ok) {
    const text = await response.text();
    let message = text || `Request failed with ${response.status}`;
    try {
      const payload = JSON.parse(text) as ApiErrorEnvelope;
      message = typeof payload.error === 'object'
        ? payload.error.message || payload.message || message
        : payload.error || payload.message || message;
    } catch {
      // Non-JSON server errors still surface as plain text for debugging.
    }
    const error = new Error(message) as Error & { status?: number; requestId?: string };
    error.status = response.status;
    error.requestId = response.headers.get('x-request-id') || undefined;
    throw error;
  }

  return response.json() as Promise<T>;
}

export function apiContractRequest<T>(
  name: ApiContractName,
  options: Omit<ApiOptions, 'method'> & { query?: ApiQuery } = {},
) {
  const contract = apiContract(name);
  const { query, ...requestOptions } = options;
  const params = query instanceof URLSearchParams
    ? query
    : new URLSearchParams(Object.entries(query || {})
      .filter(([, value]) => value !== undefined && value !== null && value !== '')
      .map(([key, value]) => [key, String(value)]));
  const suffix = params.toString();
  const path = `${contract.path.replace(/^\/api/, '')}${suffix ? `?${suffix}` : ''}`;
  return apiRequest<T>(path, { ...requestOptions, method: contract.method });
}
