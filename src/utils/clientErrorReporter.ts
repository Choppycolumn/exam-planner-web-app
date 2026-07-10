type ClientErrorPayload = {
  source: 'render' | 'window-error' | 'unhandledrejection' | 'manual';
  message: string;
  stack?: string;
  componentStack?: string;
  path?: string;
};

const recentReports = new Map<string, number>();
const duplicateWindowMs = 5 * 60 * 1000;

function compact(value: unknown, maxLength = 1800) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function errorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message || reason.name;
  if (typeof reason === 'string') return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function errorStack(reason: unknown) {
  return reason instanceof Error ? reason.stack || '' : '';
}

export function reportClientError(payload: ClientErrorPayload) {
  if (typeof window === 'undefined') return;
  const body = {
    ...payload,
    path: window.location.pathname + window.location.search + window.location.hash,
    message: compact(payload.message, 600),
    stack: compact(payload.stack, 3000),
    componentStack: compact(payload.componentStack, 3000),
  };
  const signature = `${body.source}:${body.path}:${body.message}`;
  const now = Date.now();
  if ((recentReports.get(signature) || 0) + duplicateWindowMs > now) return;
  recentReports.set(signature, now);

  void fetch('/api/client-errors', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // Error reporting must never affect the page itself.
  });
}

export function installGlobalClientErrorReporter() {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (event) => {
    reportClientError({
      source: 'window-error',
      message: event.message || errorMessage(event.error),
      stack: errorStack(event.error),
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportClientError({
      source: 'unhandledrejection',
      message: errorMessage(event.reason),
      stack: errorStack(event.reason),
    });
  });
}
