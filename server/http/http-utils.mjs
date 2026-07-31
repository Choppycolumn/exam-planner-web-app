export function createHttpUtils({ corsOrigin = '', jsonBodyMaxBytes = 10 * 1024 * 1024 } = {}) {
  const parsedJsonBodies = new WeakMap();
  const securityHeaders = {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
  };

  function sendJson(res, data, status = 200) {
    const headers = {
      ...securityHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type,x-backup-token,x-clawbot-secret,x-exam-planner-client,authorization',
    };
    if (corsOrigin) {
      headers['access-control-allow-origin'] = corsOrigin;
      headers.vary = 'Origin';
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(data));
  }

  function sendHtml(res, html, status = 200) {
    res.writeHead(status, {
      ...securityHeaders,
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    res.end(html);
  }

  function readBody(req, maxBytes = jsonBodyMaxBytes) {
    return new Promise((resolveBody, rejectBody) => {
      let body = '';
      let size = 0;
      let rejected = false;
      req.on('data', (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          if (!rejected) {
            rejected = true;
            const error = new Error('Request body is too large');
            error.statusCode = 413;
            rejectBody(error);
          }
          return;
        }
        if (!rejected) body += chunk.toString('utf8');
      });
      req.on('error', (error) => {
        if (!rejected) {
          rejected = true;
          rejectBody(error);
        }
      });
      req.on('end', () => {
        if (!rejected) resolveBody(body);
      });
    });
  }

  async function readJsonBody(req) {
    if (!parsedJsonBodies.has(req)) {
      parsedJsonBodies.set(req, (async () => {
        const body = await readBody(req, jsonBodyMaxBytes);
        if (!body) return {};
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          const error = new Error('Invalid JSON body');
          error.statusCode = 400;
          throw error;
        }
        if (parsed !== null && typeof parsed === 'object') return parsed;
        const error = new Error('JSON body must be an object or array');
        error.statusCode = 400;
        throw error;
      })());
    }
    return parsedJsonBodies.get(req);
  }

  return { sendJson, sendHtml, readBody, readJsonBody };
}

export function headerString(req, name) {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0] || '';
  return value || '';
}

export function isObjectPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}
