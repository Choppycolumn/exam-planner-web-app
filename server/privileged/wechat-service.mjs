import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runProcess } from '../core/process-runner.mjs';

function readJson(path, fallback = {}) {
  try { return path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback; } catch { return fallback; }
}

function nestedString(value, keys) {
  if (!value || typeof value !== 'object') return '';
  const expected = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, nested] of Object.entries(value)) if (expected.has(key.toLowerCase()) && typeof nested === 'string' && nested.trim()) return nested.trim();
  for (const nested of Object.values(value)) { const found = nestedString(nested, keys); if (found) return found; }
  return '';
}

export function createPrivilegedWechatService({
  accountDir = process.env.OPENCLAW_ACCOUNT_DIR || '/root/.openclaw/openclaw-weixin/accounts',
  npmProjectsDir = process.env.OPENCLAW_NPM_PROJECTS_DIR || '/root/.openclaw/npm/projects',
  accountId: configuredAccountId = process.env.OPENCLAW_WEIXIN_ACCOUNT_ID || '',
  target: configuredTarget = process.env.OPENCLAW_CLAWBOT_TARGET || '',
  senderFile = '/opt/exam-planner/server/openclaw-weixin-send.mjs',
  nodeBinary = '/opt/node-v22.22.3-linux-x64/bin/node',
} = {}) {
  const resolveConfig = () => {
    let accountId = configuredAccountId;
    if (!accountId && existsSync(accountDir)) accountId = readdirSync(accountDir).filter((file) => file.endsWith('.json') && !file.includes('context-token')).sort((a, b) => Number(b.includes('-im-bot')) - Number(a.includes('-im-bot')) || a.localeCompare(b))[0]?.replace(/\.json$/i, '') || '';
    const accountPath = accountId ? join(accountDir, `${accountId}.json`) : '';
    const contextPath = accountId ? join(accountDir, `${accountId}.context-tokens.json`) : '';
    const account = readJson(accountPath);
    const contextTokens = readJson(contextPath);
    const target = configuredTarget || Object.keys(contextTokens).find((key) => key && !key.startsWith('_')) || nestedString(account, ['userId', 'wxid', 'openId', 'target', 'userName']) || '';
    const contextEntry = target ? contextTokens[target] : null;
    const contextToken = (typeof contextEntry === 'string' ? contextEntry : '') || nestedString(contextEntry, ['contextToken', 'token']) || nestedString(contextTokens, ['contextToken']);
    let modulePath = '';
    if (existsSync(npmProjectsDir)) {
      for (const project of readdirSync(npmProjectsDir)) {
        const candidate = join(npmProjectsDir, project, 'node_modules', '@tencent-weixin', 'openclaw-weixin', 'dist', 'src', 'messaging', 'send.js');
        if (existsSync(candidate)) { modulePath = candidate; break; }
      }
    }
    return { accountId, target, contextToken, accountToken: account.token || '', baseUrl: account.baseUrl || 'https://ilinkai.weixin.qq.com', modulePath, accountDirExists: existsSync(accountDir), accountFileExists: Boolean(accountPath && existsSync(accountPath)) };
  };
  const publicStatus = () => {
    const config = resolveConfig();
    return { configured: Boolean(config.accountId && config.target && config.contextToken && config.accountToken && config.modulePath), accountId: config.accountId, accountDirExists: config.accountDirExists, accountFileExists: config.accountFileExists, targetConfigured: Boolean(config.target), hasContextToken: Boolean(config.contextToken) };
  };
  const send = async (text) => {
    const config = resolveConfig();
    if (!publicStatus().configured) throw new Error('OpenClaw Weixin account is incomplete');
    const result = await runProcess(nodeBinary, [senderFile], { timeoutMs: 25_000, maxBuffer: 64 * 1024, input: JSON.stringify({ modulePath: config.modulePath, to: config.target, text: String(text || '').slice(0, 3500), baseUrl: config.baseUrl, token: config.accountToken, contextToken: config.contextToken }) });
    if (!result.ok) throw new Error(result.stderr || result.stdout || 'OpenClaw Weixin sender failed');
    let response = {};
    try { response = JSON.parse(result.stdout || '{}'); } catch { throw new Error('OpenClaw Weixin sender returned invalid JSON'); }
    return { ok: true, method: 'openclaw-weixin-privileged', accountId: config.accountId, messageId: response.messageId || null };
  };
  return { status: publicStatus, send };
}
