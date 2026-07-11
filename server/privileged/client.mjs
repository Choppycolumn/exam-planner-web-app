import { request } from 'node:http';

export function createPrivilegedClient({ socketPath = process.env.PRIVILEGED_HELPER_SOCKET || '/run/exam-planner/privileged.sock', timeoutMs = 30_000 } = {}) {
  const call = (pathname, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? '' : JSON.stringify(body);
    const req = request({
      socketPath,
      path: pathname,
      method,
      headers: payload ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } : {},
      timeout: timeoutMs,
    }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { text = `${text}${chunk}`.slice(-9 * 1024 * 1024); });
      res.on('end', () => {
        let parsed = {};
        try { parsed = text ? JSON.parse(text) : {}; } catch { reject(new Error('privileged helper returned invalid JSON')); return; }
        if ((res.statusCode || 500) >= 400) reject(new Error(parsed.error || `privileged helper HTTP ${res.statusCode}`));
        else resolve(parsed);
      });
    });
    req.on('timeout', () => req.destroy(new Error('privileged helper timed out')));
    req.on('error', reject);
    req.end(payload);
  });

  return {
    health: () => call('/health'),
    proxyStatus: () => call('/v1/proxy'),
    proxySave: (body) => call('/v1/proxy/subscription', { method: 'POST', body }),
    proxyImport: (body) => call('/v1/proxy/import', { method: 'POST', body }),
    proxySelect: (body) => call('/v1/proxy/select', { method: 'POST', body }),
    proxyTest: () => call('/v1/proxy/test', { method: 'POST', body: {} }),
    wechatStatus: () => call('/v1/wechat/status'),
    wechatSend: (text) => call('/v1/wechat/send', { method: 'POST', body: { text: String(text || '').slice(0, 3500) } }),
  };
}
