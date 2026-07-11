import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runProcess } from '../core/process-runner.mjs';

const envKeys = ['MIHOMO_CONTROLLER_SECRET', 'MIHOMO_SUBSCRIPTION_URL', 'MIHOMO_SELECTED_PROXY', 'MIHOMO_PROVIDER_MODE'];

function parseEnv(text = '') {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.trim().match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match || !envKeys.includes(match[1])) continue;
    let value = match[2] || '';
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
  }
  return values;
}

function envValue(value = '') {
  const text = String(value || '');
  if (/^[A-Za-z0-9_./:=+\-@]*$/.test(text)) return text;
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$')}"`;
}

function yaml(value = '') {
  return `"${String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;
}

function normalizeUrl(value = '') {
  if (!String(value || '').trim()) return '';
  let url;
  try { url = new URL(String(value).trim()); } catch { throw Object.assign(new Error('订阅链接格式不正确'), { statusCode: 400 }); }
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('订阅链接仅支持 http:// 或 https://'), { statusCode: 400 });
  return url.toString();
}

function normalizeProvider(value = '') {
  const text = String(value || '').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').trim();
  if (!text) throw Object.assign(new Error('订阅内容为空'), { statusCode: 400 });
  if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw Object.assign(new Error('订阅内容过大'), { statusCode: 413 });
  if (!/^proxies\s*:/m.test(text)) throw Object.assign(new Error('订阅内容不是 Clash/Mihomo YAML'), { statusCode: 400 });
  return `${text}\n`;
}

export function createPrivilegedProxyService({
  envFile = '/etc/exam-planner/proxy.env',
  configDir = '/etc/mihomo',
  providerDir = '/etc/mihomo/proxy-providers',
  binary = '/usr/local/bin/mihomo',
  controllerUrl = 'http://127.0.0.1:9097',
  proxyUrl = 'http://127.0.0.1:7890',
} = {}) {
  const configFile = join(configDir, 'config.yaml');
  const providerFile = join(providerDir, 'subscription.yaml');

  const readValues = () => ({ ...parseEnv(existsSync(envFile) ? readFileSync(envFile, 'utf8') : ''), ...Object.fromEntries(envKeys.map((key) => [key, process.env[key] || undefined]).filter(([, value]) => value)) });
  const ensureSecret = (values) => (values.MIHOMO_CONTROLLER_SECRET ||= randomBytes(24).toString('hex'));
  const writeEnv = (values) => {
    mkdirSync(dirname(envFile), { recursive: true });
    writeFileSync(envFile, `${envKeys.map((key) => `${key}=${envValue(values[key] || '')}`).join('\n')}\n`, { mode: 0o640 });
    chmodSync(envFile, 0o640);
  };
  const writeConfig = (values) => {
    const secret = ensureSecret(values);
    const useFile = values.MIHOMO_PROVIDER_MODE === 'file' && existsSync(providerFile);
    const useHttp = Boolean(values.MIHOMO_SUBSCRIPTION_URL) && !useFile;
    const useProvider = useFile || useHttp;
    const lines = [
      'mixed-port: 7890', 'allow-lan: false', 'bind-address: 127.0.0.1', 'mode: rule', 'log-level: info',
      'profile:', '  store-selected: true', 'external-controller: 127.0.0.1:9097', `secret: ${yaml(secret)}`,
    ];
    if (useProvider) lines.push('proxy-providers:', '  subscription:', `    type: ${useFile ? 'file' : 'http'}`, ...(useHttp ? [`    url: ${yaml(values.MIHOMO_SUBSCRIPTION_URL)}`, '    interval: 3600'] : []), `    path: ${yaml(providerFile)}`, '    health-check:', '      enable: true', '      interval: 600', '      url: https://www.gstatic.com/generate_204');
    else lines.push('proxies: []');
    lines.push('proxy-groups:', '  - name: SELECT', '    type: select', '    proxies:', '      - DIRECT', ...(useProvider ? ['    use:', '      - subscription'] : []), 'rules:', '  - DOMAIN-SUFFIX,worldperatio.com,SELECT', '  - DOMAIN-SUFFIX,api.telegram.org,SELECT', '  - MATCH,DIRECT', '');
    mkdirSync(configDir, { recursive: true });
    mkdirSync(providerDir, { recursive: true });
    writeFileSync(configFile, lines.join('\n'), { mode: 0o640 });
    chmodSync(configFile, 0o640);
  };
  const restart = async () => {
    const result = await runProcess('systemctl', ['restart', 'mihomo.service'], { timeoutMs: 30_000 });
    return { ok: result.ok, message: (result.stderr || result.stdout || (result.ok ? 'active' : 'mihomo 重启失败')).trim() };
  };
  const controller = async (pathname, options = {}) => {
    const secret = readValues().MIHOMO_CONTROLLER_SECRET;
    if (!secret) throw new Error('mihomo 控制密钥未配置');
    const response = await fetch(`${controllerUrl}${pathname}`, { method: options.method || 'GET', headers: { Authorization: `Bearer ${secret}`, ...(options.body ? { 'content-type': 'application/json' } : {}) }, body: options.body ? JSON.stringify(options.body) : undefined, signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`mihomo controller HTTP ${response.status}`);
    return text ? JSON.parse(text) : {};
  };
  const status = async () => {
    const values = readValues();
    const service = await runProcess('systemctl', ['is-active', 'mihomo.service'], { timeoutMs: 10_000 });
    const version = existsSync(binary) ? await runProcess(binary, ['-v'], { timeoutMs: 10_000 }) : { stdout: '' };
    let current = '', nodes = [], error = '', controllerOk = false;
    try {
      const payload = await controller('/proxies');
      const proxies = payload.proxies || {};
      const group = proxies.SELECT || proxies.GLOBAL || {};
      current = String(group.now || values.MIHOMO_SELECTED_PROXY || '');
      nodes = (Array.isArray(group.all) ? group.all : []).map((name) => ({ name, type: String(proxies[name]?.type || ''), delay: proxies[name]?.history?.at(-1)?.delay ?? null }));
      controllerOk = true;
    } catch (failure) { error = failure.message || String(failure); }
    const rawUrl = String(values.MIHOMO_SUBSCRIPTION_URL || '');
    return { ok: true, installed: existsSync(binary), active: service.stdout.trim() === 'active', version: version.stdout?.split(/\r?\n/)[0] || '', controllerOk, controllerUrl, localProxyUrl: proxyUrl, subscriptionConfigured: Boolean(rawUrl), subscriptionLabel: rawUrl ? `已保存，尾号 ${rawUrl.slice(-4)}` : '', providerMode: values.MIHOMO_PROVIDER_MODE === 'file' ? 'file' : rawUrl ? 'http' : '', current, nodes, error };
  };
  const save = async (input = {}) => {
    const values = readValues(); ensureSecret(values);
    if (input.clearSubscription) { values.MIHOMO_SUBSCRIPTION_URL = ''; values.MIHOMO_SELECTED_PROXY = ''; values.MIHOMO_PROVIDER_MODE = ''; if (existsSync(providerFile)) unlinkSync(providerFile); }
    if (String(input.subscriptionUrl || '').trim()) { values.MIHOMO_SUBSCRIPTION_URL = normalizeUrl(input.subscriptionUrl); values.MIHOMO_PROVIDER_MODE = 'http'; if (existsSync(providerFile)) unlinkSync(providerFile); }
    writeConfig(values); writeEnv(values); const restarted = await restart();
    return { ...(await status()), restarted: restarted.ok, message: restarted.message, updatedAt: new Date().toISOString() };
  };
  const importProvider = async (input = {}) => {
    mkdirSync(providerDir, { recursive: true });
    writeFileSync(providerFile, normalizeProvider(input.subscriptionContent ?? input.content), { mode: 0o640 });
    const values = readValues(); ensureSecret(values); values.MIHOMO_PROVIDER_MODE = 'file'; writeConfig(values); writeEnv(values); const restarted = await restart();
    return { ...(await status()), restarted: restarted.ok, message: restarted.message, imported: true, updatedAt: new Date().toISOString() };
  };
  const select = async (input = {}) => {
    const name = String(input.name || '').trim(); if (!name) throw Object.assign(new Error('请选择一个节点'), { statusCode: 400 });
    await controller('/proxies/SELECT', { method: 'PUT', body: { name } });
    const values = readValues(); values.MIHOMO_SELECTED_PROXY = name; writeEnv(values);
    return { ...(await status()), selected: name, updatedAt: new Date().toISOString() };
  };
  const test = async () => {
    const targets = [['brief-pe', '简报 PE 数据源', 'https://www.worldperatio.com/'], ['telegram', 'Telegram API', 'https://api.telegram.org/']];
    const results = [];
    for (const [id, label, url] of targets) {
      const started = Date.now();
      const result = await runProcess('curl', ['-4', '-fsSL', '--proxy', proxyUrl, '--max-time', '15', '-o', '/dev/null', '-w', '%{http_code}', url], { timeoutMs: 18_000 });
      const responseStatus = Number(result.stdout.trim() || 0);
      results.push({ id, label, ok: result.ok && responseStatus >= 200 && responseStatus < 500, status: responseStatus, durationMs: Date.now() - started });
    }
    return { ok: results.every((item) => item.ok), testedAt: new Date().toISOString(), results };
  };
  return { status, save, importProvider, select, test };
}
