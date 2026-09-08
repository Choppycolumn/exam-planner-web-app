const RESOURCE_HOST = 'libresource.hust.edu.cn';
const PRODUCTION_EXAM_PLANNER_ORIGIN = 'https://8.130.68.9';
const FORBIDDEN_COOKIE_NAMES = /^(?:access[_-]?token|userid|user[_-]?id)$/i;

const originInput = document.querySelector('#origin');
const resourceInput = document.querySelector('#resourceUrl');
const pairingIdInput = document.querySelector('#pairingId');
const codeInput = document.querySelector('#code');
const inspectButton = document.querySelector('#inspect');
const confirmButton = document.querySelector('#confirm');
const statusNode = document.querySelector('#status');
const cookiesNode = document.querySelector('#cookies');
let pendingPairing = null;

function setStatus(message, error = false) {
  statusNode.textContent = message;
  statusNode.className = error ? 'error' : '';
}

function originOf(value) {
  const parsed = new URL(String(value || '').trim());
  const isLocal = parsed.protocol === 'http:' && parsed.hostname === '127.0.0.1';
  if ((parsed.protocol !== 'https:' && !isLocal) || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.hostname === 'localhost' || (!isLocal && parsed.origin !== PRODUCTION_EXAM_PLANNER_ORIGIN)) {
    throw new Error('ExamPlanner origin 必须是 https://8.130.68.9（本机开发可用 127.0.0.1）');
  }
  return parsed.origin;
}

function resourceUrlOf(value) {
  const parsed = new URL(String(value || '').trim());
  if (parsed.protocol !== 'https:' || parsed.hostname !== RESOURCE_HOST) throw new Error('图书馆 URL 必须是 https://libresource.hust.edu.cn');
  return parsed.toString();
}

function permissionPatternForOrigin(origin) {
  const parsed = new URL(origin);
  return `${parsed.protocol}//${parsed.hostname}/*`;
}

function showCookies(cookies) {
  cookiesNode.replaceChildren();
  for (const cookie of cookies) {
    const item = document.createElement('li');
    const expiry = cookie.expirationDate ? new Date(cookie.expirationDate * 1000).toLocaleString() : '浏览器会话结束时';
    item.textContent = `${cookie.name} · ${cookie.httpOnly ? 'HttpOnly' : '非 HttpOnly'} · ${cookie.secure ? 'Secure' : '非 Secure'} · 到期 ${expiry}`;
    cookiesNode.append(item);
  }
}

function resetPreview(message = '') {
  pendingPairing = null;
  confirmButton.disabled = true;
  cookiesNode.replaceChildren();
  if (message) setStatus(message);
}

function pairingForm() {
  const origin = originOf(originInput.value);
  const resourceUrl = resourceUrlOf(resourceInput.value);
  const pairingId = Number(pairingIdInput.value);
  const code = String(codeInput.value || '').trim();
  if (!Number.isSafeInteger(pairingId) || pairingId <= 0 || !/^[A-Za-z0-9_-]{16,128}$/.test(code)) throw new Error('请填写有效的一次性配对 ID 和配对码');
  return { origin, resourceUrl, pairingId, code };
}

async function inspectCookies() {
  inspectButton.disabled = true;
  resetPreview();
  try {
    const form = pairingForm();
    const granted = await chrome.permissions.request({ origins: [permissionPatternForOrigin(form.origin)] });
    if (!granted) throw new Error('未授予向该 ExamPlanner origin 发送请求的权限');
    const cookies = (await chrome.cookies.getAll({ url: form.resourceUrl }))
      .filter((cookie) => String(cookie.domain || '').replace(/^\.+/, '').toLowerCase() === RESOURCE_HOST);
    if (!cookies.length) throw new Error('目标 URL 没有可用 Cookie；请先在官方页面正常登录');
    if (cookies.some((cookie) => FORBIDDEN_COOKIE_NAMES.test(String(cookie.name || '')))) throw new Error('检测到不允许转移的 access_token/userid Cookie；未发送任何数据');
    showCookies(cookies);
    pendingPairing = { ...form, cookies };
    confirmButton.disabled = false;
    setStatus(`已读取 ${cookies.length} 个 Cookie，尚未发送。请核对上方名称、属性和到期时间，再点击“确认并配对”。`);
  } catch (error) {
    resetPreview();
    setStatus(error instanceof Error ? error.message : '读取失败', true);
  } finally {
    inspectButton.disabled = false;
  }
}

async function confirmPairing() {
  if (!pendingPairing) return;
  inspectButton.disabled = true;
  confirmButton.disabled = true;
  try {
    const current = pairingForm();
    if (current.origin !== pendingPairing.origin || current.resourceUrl !== pendingPairing.resourceUrl || current.pairingId !== pendingPairing.pairingId || current.code !== pendingPairing.code) throw new Error('配对信息已改变，请重新检查 Cookie 清单');
    setStatus(`正在通过 HTTPS 传送 ${pendingPairing.cookies.length} 个 Cookie；服务器接收后会立即加密保存…`);
    const response = await fetch(`${pendingPairing.origin}/api/seat-assistant/pair/complete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairingId: pendingPairing.pairingId, code: pendingPairing.code, origin: pendingPairing.origin, cookies: pendingPairing.cookies.map((cookie) => ({
        name: cookie.name, value: cookie.value, domain: cookie.domain, path: cookie.path, secure: cookie.secure, httpOnly: cookie.httpOnly, sameSite: cookie.sameSite, expirationDate: cookie.expirationDate, session: cookie.session,
      })) }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.ok) throw new Error(payload.error || '配对失败；请在 ExamPlanner 中重新生成一次性配对码');
    setStatus(`配对成功。会话将在 ${new Date(payload.expiresAt).toLocaleString()} 前有效；服务器只保存加密 bundle。`);
    codeInput.value = '';
    pendingPairing = null;
    cookiesNode.replaceChildren();
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '配对失败', true);
  } finally {
    inspectButton.disabled = false;
    confirmButton.disabled = !pendingPairing;
  }
}

chrome.storage.local.get(['examPlannerOrigin'], (stored) => {
  originInput.value = stored.examPlannerOrigin || PRODUCTION_EXAM_PLANNER_ORIGIN;
});
for (const input of [originInput, resourceInput, pairingIdInput, codeInput]) input.addEventListener('input', () => resetPreview('信息已改变，请重新检查 Cookie 清单。'));
originInput.addEventListener('change', () => { void chrome.storage.local.set({ examPlannerOrigin: originInput.value.trim() }); });
inspectButton.addEventListener('click', () => { void inspectCookies(); });
confirmButton.addEventListener('click', () => { void confirmPairing(); });
