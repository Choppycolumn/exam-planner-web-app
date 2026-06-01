import type { FinanceEncryptedVault } from './storage';

export interface FinanceCloudVaultMeta {
  updatedAt: string;
  clientUpdatedAt: string;
  deviceId: string;
  byteSize: number;
}

export interface FinanceCloudVaultResponse {
  vault: FinanceEncryptedVault | null;
  meta: FinanceCloudVaultMeta | null;
}

const deployedFinanceUrl = 'https://8.130.68.9/finance';

function isLocalPreviewHost() {
  return ['127.0.0.1', 'localhost', '::1'].includes(window.location.hostname);
}

function assertFinanceSyncAvailable() {
  if (isLocalPreviewHost() && !import.meta.env.VITE_API_PROXY_TARGET) {
    throw new Error(`当前是本地预览地址，不能直接上传到服务器。请打开 ${deployedFinanceUrl} 登录后同步，或重启本地 Vite 并配置 VITE_API_PROXY_TARGET。`);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  assertFinanceSyncAvailable();
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: options.body ? { 'content-type': 'application/json', ...options.headers } : options.headers,
  });
  const text = await response.text();
  if (!response.ok) {
    let message = text || `HTTP ${response.status}`;
    try {
      const payload = JSON.parse(text) as { error?: string };
      message = payload.error || message;
    } catch {
      // Keep the raw response text for HTML/empty error pages.
    }
    throw new Error(message);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error('服务器没有返回有效 JSON，请确认当前页面来自部署站点且 /api/finance-vault 可访问。');
  }
}

export function getFinanceDeviceId() {
  const key = 'portfolio.finance.deviceId';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const value = crypto.randomUUID();
  localStorage.setItem(key, value);
  return value;
}

export function getCloudFinanceVault() {
  return request<FinanceCloudVaultResponse>('/finance-vault');
}

export function uploadCloudFinanceVault(vault: FinanceEncryptedVault, deviceId = getFinanceDeviceId()) {
  return request<FinanceCloudVaultResponse>('/finance-vault', {
    method: 'POST',
    body: JSON.stringify({ vault, deviceId }),
  });
}

export function deleteCloudFinanceVault() {
  return request<FinanceCloudVaultResponse & { ok: boolean }>('/finance-vault', {
    method: 'DELETE',
  });
}
