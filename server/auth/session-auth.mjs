import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

function sign(value, cookieSecret) {
  return createHmac('sha256', cookieSecret).update(value).digest('hex');
}

export function createSessionAuth({
  appPassword,
  readOnlyPassword,
  cookieSecret,
  cookieName,
  loginAttemptsFile,
  loginFailureLimit = 3,
  loginLockMs = 30 * 60 * 1000,
  loginFailureDelayMinMs = 1000,
  loginFailureDelaySpreadMs = 1000,
}) {
  let loginAttempts = loadLoginAttempts();

  function createSessionValue(role = 'write') {
    const payload = JSON.stringify({ role, issuedAt: Date.now() });
    const encoded = Buffer.from(payload).toString('base64url');
    return `${encoded}.${sign(encoded, cookieSecret)}`;
  }

  function getSessionRole(cookieHeader = '') {
    const cookies = Object.fromEntries(String(cookieHeader || '').split(';').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    }).filter(([key]) => key));
    const value = cookies[cookieName];
    if (!value) return null;
    const [encoded, signature] = value.split('.');
    if (!encoded || !signature || !safeSecretEqual(sign(encoded, cookieSecret), signature)) return null;
    try {
      const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      if (!payload?.issuedAt || Date.now() - Number(payload.issuedAt) > 30 * 24 * 60 * 60 * 1000) return null;
      return payload.role === 'read' ? 'read' : 'write';
    } catch {
      return null;
    }
  }

  function isValidSession(cookieHeader = '') {
    return Boolean(getSessionRole(cookieHeader));
  }

  function loadLoginAttempts() {
    if (!existsSync(loginAttemptsFile)) return {};
    try {
      return JSON.parse(readFileSync(loginAttemptsFile, 'utf8')) || {};
    } catch {
      return {};
    }
  }

  function saveLoginAttempts() {
    try {
      writeFileSync(loginAttemptsFile, JSON.stringify(loginAttempts, null, 2));
    } catch {
      // Login protection is best-effort and must never take the app down.
    }
  }

  function pruneLoginAttempts() {
    const cutoff = Date.now() - loginLockMs;
    for (const [key, value] of Object.entries(loginAttempts)) {
      if ((value.lastAttemptAt || 0) < cutoff && !(value.lockedUntil && value.lockedUntil > Date.now())) {
        delete loginAttempts[key];
      }
    }
  }

  function getLoginLock(clientIp) {
    pruneLoginAttempts();
    const attempt = loginAttempts[clientIp];
    if (attempt?.lockedUntil && attempt.lockedUntil > Date.now()) {
      return { remainingMs: attempt.lockedUntil - Date.now() };
    }
    return null;
  }

  function recordLoginSuccess(clientIp) {
    delete loginAttempts[clientIp];
    saveLoginAttempts();
  }

  function recordLoginFailure(clientIp) {
    pruneLoginAttempts();
    const attempt = loginAttempts[clientIp] || { failures: 0, lockedUntil: 0, lastAttemptAt: 0 };
    attempt.failures += 1;
    attempt.lastAttemptAt = Date.now();
    if (attempt.failures >= loginFailureLimit) {
      attempt.lockedUntil = Date.now() + loginLockMs;
      attempt.failures = 0;
    }
    loginAttempts[clientIp] = attempt;
    saveLoginAttempts();
    return attempt;
  }

  function loginFailureDelay() {
    return sleep(loginFailureDelayMinMs + Math.floor(Math.random() * loginFailureDelaySpreadMs));
  }

  function loginPage(error = '') {
    const safeError = String(error || '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>考研计划管理</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f8fb;color:#111827;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(420px,calc(100vw - 32px));border:1px solid #e5e7eb;border-radius:12px;background:#fff;padding:28px;box-shadow:0 18px 50px rgba(15,23,42,.08)}
    h1{margin:0;font-size:22px}p{color:#64748b;line-height:1.7}label{display:block;margin:20px 0 8px;font-size:13px;font-weight:700;color:#475569}
    input{width:100%;box-sizing:border-box;border:1px solid #d9dee8;border-radius:8px;padding:12px;font:inherit;outline:none}
    input:focus{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.12)}
    button{width:100%;margin-top:14px;border:0;border-radius:8px;background:#2563eb;color:white;padding:12px;font-weight:700;cursor:pointer}
    .error{margin-top:12px;color:#be123c;background:#fff1f2;border:1px solid #fecaca;border-radius:8px;padding:10px;font-size:14px}
  </style>
</head>
<body>
  <main>
    <h1>考研计划管理</h1>
    <p>请输入访问密码进入你的学习管理面板。</p>
    <form method="post" action="/login">
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" autofocus autocomplete="current-password" />
      <button type="submit">进入网站</button>
    </form>
    ${safeError ? `<div class="error">${safeError}</div>` : ''}
  </main>
</body>
</html>`;
  }

  return {
    appPassword,
    readOnlyPassword,
    cookieName,
    createSessionValue,
    getSessionRole,
    isValidSession,
    getLoginLock,
    recordLoginSuccess,
    recordLoginFailure,
    loginFailureDelay,
    loginPage,
  };
}

export function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || 'unknown';
}

export function clientHashForRequest(req) {
  return createHash('sha256').update(getClientIp(req)).digest('hex').slice(0, 16);
}

export function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

export function lockMessage(remainingMs) {
  const minutes = Math.max(1, Math.ceil(remainingMs / 60_000));
  return `登录失败次数过多，已临时锁定。请 ${minutes} 分钟后再试。`;
}

export function safeSecretEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
