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
  sessionRepository,
  loginAttemptsFile,
  loginFailureLimit = 3,
  loginLockMs = 30 * 60 * 1000,
  loginFailureDelayMinMs = 1000,
  loginFailureDelaySpreadMs = 1000,
  ownerUserId,
}) {
  if (typeof ownerUserId !== 'function') throw new Error('ownerUserId resolver is required');
  let loginAttempts = loadLoginAttempts();

  function validUserId(value) {
    const userId = Number(value);
    if (!Number.isInteger(userId) || userId < 1) throw new Error('valid session userId is required');
    return userId;
  }

  function normalizeSession(session = 'write') {
    if (typeof session === 'string') {
      const ownerId = validUserId(ownerUserId());
      return session === 'read'
        ? { role: 'read', userId: ownerId, accountType: 'visitor', displayName: '访客' }
        : { role: 'write', userId: ownerId, accountType: 'admin', displayName: '我' };
    }
    return {
      role: session?.role === 'read' ? 'read' : 'write',
      userId: validUserId(session?.userId),
      publicId: String(session?.publicId || ''),
      accountType: ['admin', 'learner', 'visitor'].includes(session?.accountType) ? session.accountType : 'admin',
      displayName: String(session?.displayName || (session?.accountType === 'learner' ? '学习伙伴' : '我')).slice(0, 40),
      sessionVersion: Number(session?.sessionVersion || 1),
      capabilities: Array.isArray(session?.capabilities) ? [...session.capabilities] : [],
    };
  }

  function createSessionValue(session = 'write', metadata = {}) {
    if (!sessionRepository) throw new Error('persistent session repository is required');
    const token = sessionRepository.create(normalizeSession(session), metadata);
    return `${token}.${sign(token, cookieSecret)}`;
  }

  function getSession(cookieHeader = '') {
    const cookies = Object.fromEntries(String(cookieHeader || '').split(';').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    }).filter(([key]) => key));
    const value = cookies[cookieName];
    if (!value) return null;
    const [token, signature] = value.split('.');
    if (!token || !signature || !safeSecretEqual(sign(token, cookieSecret), signature)) return null;
    return sessionRepository?.find(token) || null;
  }

  function revokeSession(cookieHeader = '') {
    const cookies = Object.fromEntries(String(cookieHeader || '').split(';').map((part) => {
      const [key, ...rest] = part.trim().split('=');
      return [key, rest.join('=')];
    }).filter(([key]) => key));
    const [token, signature] = String(cookies[cookieName] || '').split('.');
    if (!token || !signature || !safeSecretEqual(sign(token, cookieSecret), signature)) return false;
    return sessionRepository?.revoke(token) || false;
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

  function loginPage(error = '', {
    accounts = [],
    canRegister = false,
    maxUsers = 10,
    userCount = 1,
    readOnlyAvailable = false,
  } = {}) {
    const safeError = String(error || '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
    const accountCards = [
      ...accounts.map((account, index) => `<label class="account-card">
        <input type="radio" name="accountId" value="${String(account.publicId || account.id).replace(/[&<>\"']/g, '')}" ${index === 0 ? 'checked' : ''} />
        <span class="account-avatar">${account.userRole === 'owner' ? '管' : '学'}</span>
        <span><strong>${String(account.displayName || '').replace(/[&<>\"']/g, '')}</strong><small>${account.userRole === 'owner' ? '管理员' : '独立学习空间'}</small></span>
      </label>`),
      ...(readOnlyAvailable ? [`<label class="account-card">
        <input type="radio" name="accountId" value="visitor" ${accounts.length ? '' : 'checked'} />
        <span class="account-avatar visitor">访</span>
        <span><strong>访客</strong><small>只读浏览</small></span>
      </label>`] : []),
    ].join('');
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>考研计划管理</title>
  <style>
    :root{color-scheme:light;--bg-a:#eaf2ff;--bg-b:#f7faff;--bg-c:#edf8f5;--panel:rgba(252,254,255,.72);--panel-strong:rgba(255,255,255,.88);--line:rgba(66,101,145,.22);--line-strong:rgba(66,101,145,.34);--text:#111c2e;--secondary:#52647a;--tertiary:#728399;--accent:#0a84ff;--accent-hover:#0077ed;--accent-soft:rgba(10,132,255,.1);--danger:#c93457;--danger-soft:rgba(201,52,87,.1);--highlight:rgba(255,255,255,.9);--shadow:0 2px 2px rgba(35,65,98,.04),0 24px 70px rgba(35,65,98,.15),inset 0 1px 0 var(--highlight);--radius:28px;--control-radius:14px;--motion:150ms;--curve:cubic-bezier(.2,.78,.2,1)}
    *{box-sizing:border-box}html{min-width:320px;min-height:100%;background:var(--bg-a)}
    body{margin:0;min-width:320px;min-height:100vh;display:grid;place-items:center;padding:24px;background:linear-gradient(125deg,rgba(10,132,255,.11),transparent 43%),linear-gradient(315deg,rgba(22,136,95,.08),transparent 46%),linear-gradient(145deg,var(--bg-a),var(--bg-b) 52%,var(--bg-c));color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI Variable","Segoe UI","Microsoft YaHei UI",sans-serif;font-optical-sizing:auto;-webkit-font-smoothing:antialiased}
    main{width:min(470px,100%);border:1px solid var(--line);border-radius:var(--radius);background:var(--panel);padding:30px;box-shadow:var(--shadow);-webkit-backdrop-filter:blur(34px) saturate(150%);backdrop-filter:blur(34px) saturate(150%);animation:enter 240ms var(--curve) both}
    .brand{display:flex;align-items:center;gap:11px}.dot{width:9px;height:9px;border-radius:999px;background:#34c759;box-shadow:0 0 0 4px rgba(52,199,89,.12)}
    h1{margin:0;color:var(--text);font-size:24px;font-weight:730;letter-spacing:0;line-height:1.2}p{margin:10px 0 0;color:var(--secondary);font-size:14px;line-height:1.6}label{display:block;margin:22px 0 8px;color:var(--secondary);font-size:13px;font-weight:680}
    input[type=password],input[type=text]{width:100%;min-height:46px;border:1px solid var(--line-strong);border-radius:var(--control-radius);background:var(--panel-strong);padding:12px 14px;color:var(--text);font:inherit;letter-spacing:0;outline:none;box-shadow:0 1px 2px rgba(35,65,98,.06),inset 0 1px 0 var(--highlight);transition:border-color var(--motion) ease,box-shadow var(--motion) ease,background var(--motion) ease}
    input[type=password]:hover,input[type=text]:hover{border-color:rgba(10,132,255,.3)}input[type=password]:focus,input[type=text]:focus{border-color:var(--accent);box-shadow:0 0 0 4px rgba(10,132,255,.14),inset 0 1px 0 var(--highlight);background:var(--panel-strong)}
    .accounts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px;margin-top:18px}.account-card{position:relative;display:flex;align-items:center;gap:10px;margin:0;border:1px solid var(--line);border-radius:15px;background:rgba(255,255,255,.38);padding:11px;cursor:pointer;transition:background var(--motion),border-color var(--motion),transform var(--motion)}.account-card:hover{background:var(--panel-strong);transform:translateY(-1px)}.account-card:has(input:checked){border-color:var(--accent);background:var(--accent-soft);box-shadow:0 0 0 3px rgba(10,132,255,.09)}.account-card input{position:absolute;opacity:0;pointer-events:none}.account-avatar{display:grid;place-items:center;width:34px;height:34px;flex:0 0 34px;border-radius:11px;background:var(--accent);color:#fff;font-size:13px;font-weight:760}.account-avatar.visitor{background:#718096}.account-card strong,.account-card small{display:block}.account-card strong{font-size:14px;color:var(--text)}.account-card small{margin-top:2px;color:var(--tertiary);font-size:11px;font-weight:500}
    button{width:100%;min-height:46px;margin-top:15px;border:1px solid var(--accent);border-radius:var(--control-radius);background:var(--accent);color:white;padding:12px 14px;font:inherit;font-weight:720;letter-spacing:0;cursor:pointer;box-shadow:0 10px 26px rgba(10,132,255,.24),inset 0 1px 0 rgba(255,255,255,.3);transition:transform 90ms ease,background var(--motion) ease,box-shadow var(--motion) ease}
    button:hover{background:var(--accent-hover);box-shadow:0 13px 30px rgba(10,132,255,.28),inset 0 1px 0 rgba(255,255,255,.34);transform:translateY(-1px)}button:active{transform:scale(.98)}button:focus-visible,input:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    details{margin-top:20px;border-top:1px solid var(--line);padding-top:18px}summary{border-radius:10px;color:var(--accent);font-size:14px;font-weight:680;cursor:pointer;list-style:none}summary::-webkit-details-marker{display:none}
    .secondary{background:var(--panel-strong);color:var(--accent);border-color:rgba(10,132,255,.22);box-shadow:0 1px 2px rgba(35,65,98,.06),inset 0 1px 0 var(--highlight)}.secondary:hover{background:var(--accent-soft)}.hint{margin-top:8px;color:var(--tertiary);font-size:12px}.error{margin-top:16px;border:1px solid rgba(201,52,87,.22);border-radius:var(--control-radius);padding:11px 12px;color:var(--danger);background:var(--danger-soft);font-size:13px;line-height:1.45}
    @keyframes enter{from{opacity:0;transform:translateY(8px) scale(.99)}to{opacity:1;transform:none}}
    @media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg-a:#07101d;--bg-b:#0a1524;--bg-c:#091915;--panel:rgba(16,29,46,.72);--panel-strong:rgba(20,36,56,.9);--line:rgba(207,225,245,.14);--line-strong:rgba(207,225,245,.23);--text:#f4f8fd;--secondary:#b7c6d8;--tertiary:#8fa2b8;--accent:#5aaaff;--accent-hover:#79baff;--accent-soft:rgba(72,159,249,.16);--danger:#ff8ba3;--danger-soft:rgba(226,77,111,.16);--highlight:rgba(255,255,255,.075);--shadow:0 2px 2px rgba(0,0,0,.18),0 28px 80px rgba(0,0,0,.42),inset 0 1px 0 var(--highlight)}}
    @media(prefers-reduced-motion:reduce){main{animation:none}*{transition-duration:.01ms!important}}
    @media(prefers-reduced-transparency:reduce){main{background:#f8fbff;-webkit-backdrop-filter:none;backdrop-filter:none}}
    @media(prefers-reduced-transparency:reduce) and (prefers-color-scheme:dark){main{background:#101d2f}}
    @media(prefers-contrast:more){:root{--line:rgba(56,86,124,.42);--line-strong:rgba(36,69,112,.64);--secondary:#394c65}}
    @media(prefers-contrast:more) and (prefers-color-scheme:dark){:root{--line:rgba(226,237,249,.34);--line-strong:rgba(236,244,252,.54);--secondary:#d9e5f2}}
    @media(max-width:480px){body{padding:16px}main{border-radius:24px;padding:24px 20px}.accounts{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main>
    <div class="brand"><span class="dot"></span><h1>考研计划管理</h1></div>
    <p>选择你的学习空间，再输入对应密码。</p>
    <form method="post" action="/login">
      <div class="accounts">${accountCards}</div>
      <label for="password">访问密码</label>
      <input id="password" name="password" type="password" autofocus autocomplete="current-password" />
      <button type="submit">进入网站</button>
    </form>
    ${canRegister ? `<details>
      <summary>使用邀请码创建学习空间</summary>
      <p class="hint">当前 ${Number(userCount || 1)} / ${Number(maxUsers || 10)} 个席位。邀请码由管理员在设置页生成。</p>
      <form method="post" action="/register-invite">
        <label for="invite-token">邀请码</label>
        <input id="invite-token" name="inviteToken" type="text" maxlength="128" autocomplete="one-time-code" required />
        <label for="display-name">显示名称</label>
        <input id="display-name" name="displayName" type="text" maxlength="30" autocomplete="nickname" required />
        <label for="new-password">设置密码</label>
        <input id="new-password" name="password" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
        <label for="confirm-password">确认密码</label>
        <input id="confirm-password" name="confirmPassword" type="password" minlength="8" maxlength="128" autocomplete="new-password" required />
        <button class="secondary" type="submit">创建学习空间</button>
      </form>
    </details>` : `<p class="hint">当前用户席位已满。</p>`}
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
    revokeSession,
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
