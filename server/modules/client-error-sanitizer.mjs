const secretPatterns = [
  /(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
  /(password|passwd|token|secret|cookie|session|api[_-]?key)(\s*[:=]\s*)[^\s,;]+/gi,
  /(exam_planner_session=)[^;\s]+/gi,
];

function compactText(value, maxLength = 1800) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function redactClientText(value, maxLength = 1800) {
  let text = compactText(value, maxLength);
  for (const pattern of secretPatterns) {
    text = text.replace(pattern, (_match, prefix, separator = '') => `${prefix}${separator}[redacted]`);
  }
  return text;
}

export function sanitizeClientPath(value) {
  const raw = String(value || '/').trim() || '/';
  try {
    const url = new URL(raw, 'http://localhost');
    return `${url.pathname || '/'}${url.hash ? '#hash' : ''}`.slice(0, 240);
  } catch {
    return raw.split('?')[0].slice(0, 240) || '/';
  }
}

export function sanitizeClientErrorPayload(body = {}, meta = {}) {
  const source = ['render', 'window-error', 'unhandledrejection', 'manual'].includes(body.source) ? body.source : 'client';
  return {
    source,
    path: sanitizeClientPath(body.path || meta.path || '/'),
    message: redactClientText(body.message || body.reason || 'Unknown client error', 600),
    stack: redactClientText(body.stack || '', 3000),
    componentStack: redactClientText(body.componentStack || '', 3000),
    userAgent: redactClientText(meta.userAgent || body.userAgent || '', 240),
    createdAt: meta.createdAt || new Date().toISOString(),
  };
}
