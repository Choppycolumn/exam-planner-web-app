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

  function normalizeSession(session = 'write') {
    if (typeof session === 'string') {
      return session === 'read'
        ? { role: 'read', userId: 1, accountType: 'visitor', displayName: '访客' }
        : { role: 'write', userId: 1, accountType: 'admin', displayName: '我' };
    }
    return {
      role: session?.role === 'read' ? 'read' : 'write',
      userId: Number(session?.userId || 1),
      accountType: ['admin', 'learner', 'visitor'].includes(session?.accountType) ? session.accountType : 'admin',
      displayName: String(session?.displayName || (session?.accountType === 'learner' ? '学习伙伴' : '我')).slice(0, 40),
    };
  }

  function createSessionValue(session = 'write') {
    const payload = JSON.stringify({ ...normalizeSession(session), issuedAt: Date.now() });
    const encoded = Buffer.from(payload).toString('base64url');
    return `${encoded}.${sign(encoded, cookieSecret)}`;
  }

  function getSession(cookieHeader = '') {
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
      return { ...normalizeSession(payload), issuedAt: Number(payload.issuedAt) };
    } catch {
      return null;
    }
  }

  function getSessionRole(cookieHeader = '') {
    return getSession(cookieHeader)?.role || null;
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

  function loginPage(error = '', { canAddUser = false } = {}) {
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
    :root{color-scheme:light dark}*{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:radial-gradient(circle at 18% 12%,rgba(110,168,255,.32),transparent 38%),radial-gradient(circle at 82% 84%,rgba(119,230,190,.24),transparent 34%),linear-gradient(145deg,#edf4ff,#f8fbff 52%,#eef9f5);color:#111827;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    main{width:min(430px,100%);border:1px solid rgba(255,255,255,.78);border-radius:28px;background:rgba(255,255,255,.68);padding:28px;box-shadow:0 24px 70px rgba(34,71,115,.16),inset 0 1px 0 rgba(255,255,255,.9);backdrop-filter:blur(28px) saturate(145%)}
    .brand{display:flex;align-items:center;gap:10px}.dot{width:10px;height:10px;border-radius:999px;background:#34c759;box-shadow:0 0 0 5px rgba(52,199,89,.12)}
    h1{margin:0;font-size:23px;letter-spacing:0}p{margin:9px 0 0;color:#64748b;line-height:1.65}label{display:block;margin:20px 0 8px;font-size:13px;font-weight:700;color:#475569}
    input{width:100%;border:1px solid rgba(148,163,184,.38);border-radius:14px;background:rgba(255,255,255,.72);padding:13px 14px;color:#0f172a;font:inherit;outline:none;transition:.18s ease}
    input:focus{border-color:#2684ff;box-shadow:0 0 0 4px rgba(38,132,255,.13);background:rgba(255,255,255,.9)}
    button{width:100%;margin-top:14px;border:1px solid rgba(255,255,255,.62);border-radius:14px;background:#1687ff;color:white;padding:13px;font-weight:750;cursor:pointer;box-shadow:0 8px 24px rgba(22,135,255,.22);transition:.18s ease}
    button:hover{transform:translateY(-1px);filter:brightness(1.03)}button:active{transform:translateY(0)}
    details{margin-top:18px;border-top:1px solid rgba(148,163,184,.24);padding-top:16px}summary{cursor:pointer;color:#2563eb;font-size:14px;font-weight:700;list-style:none}summary::-webkit-details-marker{display:none}
    .secondary{background:rgba(255,255,255,.76);color:#1769c2;border-color:rgba(37,99,235,.16);box-shadow:none}.hint{font-size:12px;color:#718096;margin-top:8px}.error{margin-top:14px;color:#be123c;background:rgba(255,241,242,.86);border:1px solid #fecaca;border-radius:14px;padding:11px 12px;font-size:14px}
    @media(prefers-color-scheme:dark){body{background:radial-gradient(circle at 20% 10%,rgba(22,101,180,.35),transparent 38%),radial-gradient(circle at 80% 85%,rgba(23,125,98,.22),transparent 34%),#07101d;color:#f8fafc}main{background:rgba(18,28,43,.72);border-color:rgba(255,255,255,.13);box-shadow:0 28px 80px rgba(0,0,0,.46)}p,.hint{color:#9ba9bc}label{color:#cbd5e1}input{background:rgba(15,23,42,.72);border-color:rgba(255,255,255,.14);color:#f8fafc}input:focus{background:rgba(15,23,42,.9)}.secondary{background:rgba(255,255,255,.08);color:#8fc5ff;border-color:rgba(255,255,255,.12)}summary{color:#8fc5ff}}
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="dot"></span><h1>考研计划管理</h1></div>
    <p>请输入访问密码进入你的学习管理面板。</p>
    <form method="post" action="/login">
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" autofocus autocomplete="current-password" />
      <button type="submit">进入网站</button>
    </form>
    ${canAddUser ? `<details>
      <summary>+ 新增学习用户</summary>
      <p class="hint">无需用户名。设置一个独立密码后，它会成为第二位也是最后一位学习用户。</p>
      <form method="post" action="/register-learner">
        <label for="new-password">设置密码</label>
        <input id="new-password" name="password" type="password" minlength="6" maxlength="128" autocomplete="new-password" required />
        <label for="confirm-password">确认密码</label>
        <input id="confirm-password" name="confirmPassword" type="password" minlength="6" maxlength="128" autocomplete="new-password" required />
        <button class="secondary" type="submit">创建并进入</button>
      </form>
    </details>` : '<p class="hint">双用户席位已满。</p>'}
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
    getSession,
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
