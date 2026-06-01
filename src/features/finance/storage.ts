import type { FinanceData } from '../../types/finance';
import { createDefaultFinanceTargets } from './constants';
import { nowISO, todayDateISO } from './calculations';

const vaultKey = 'portfolio.finance.v1.encryptedVault';
const rememberedPassphraseKey = 'portfolio.finance.v1.rememberedPassphrase';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type FinanceEncryptedVault = {
  version: 1;
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  salt: string;
  iv: string;
  ciphertext: string;
  updatedAt: string;
};

export function createEmptyFinanceData(): FinanceData {
  const timestamp = nowISO();
  return {
    schemaVersion: 1,
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: {
      baseCurrency: 'CNY',
      displayCurrency: 'CNY',
      amountHidden: false,
      useChinaFundColors: true,
      dailyAutoUpdate: true,
      performanceStartDate: todayDateISO(),
    },
    assets: [],
    transactions: [],
    plans: [],
    targets: createDefaultFinanceTargets(),
    quotes: {},
    exchangeRates: {},
    quoteLogs: [],
  };
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes);
  return copy.buffer as ArrayBuffer;
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number) {
  const baseKey = await crypto.subtle.importKey('raw', toArrayBuffer(textEncoder.encode(passphrase)), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

function migrateFinanceData(input: Partial<FinanceData>): FinanceData {
  const empty = createEmptyFinanceData();
  return {
    ...empty,
    ...input,
    schemaVersion: 1,
    settings: { ...empty.settings, ...input.settings, baseCurrency: 'CNY' },
    assets: Array.isArray(input.assets) ? input.assets : [],
    transactions: Array.isArray(input.transactions) ? input.transactions : [],
    plans: Array.isArray(input.plans) ? input.plans : [],
    targets: Array.isArray(input.targets) && input.targets.length ? input.targets : empty.targets,
    quotes: input.quotes && typeof input.quotes === 'object' ? input.quotes : {},
    exchangeRates: input.exchangeRates && typeof input.exchangeRates === 'object' ? input.exchangeRates : {},
    quoteLogs: Array.isArray(input.quoteLogs) ? input.quoteLogs : [],
    updatedAt: nowISO(),
  };
}

export function financeVaultExists() {
  return Boolean(localStorage.getItem(vaultKey));
}

export function deleteFinanceVault() {
  localStorage.removeItem(vaultKey);
  localStorage.removeItem(rememberedPassphraseKey);
}

export function getRememberedFinancePassphrase() {
  return localStorage.getItem(rememberedPassphraseKey) ?? '';
}

export function setRememberedFinancePassphrase(passphrase: string) {
  if (!passphrase) return;
  localStorage.setItem(rememberedPassphraseKey, passphrase);
}

export function clearRememberedFinancePassphrase() {
  localStorage.removeItem(rememberedPassphraseKey);
}

export function getEncryptedFinanceVault(): FinanceEncryptedVault | null {
  const raw = localStorage.getItem(vaultKey);
  return raw ? (JSON.parse(raw) as FinanceEncryptedVault) : null;
}

export function setEncryptedFinanceVault(vault: FinanceEncryptedVault) {
  localStorage.setItem(vaultKey, JSON.stringify(vault));
}

export async function decryptFinanceVault(vault: FinanceEncryptedVault, passphrase: string): Promise<FinanceData> {
  const key = await deriveKey(passphrase, base64ToBytes(vault.salt), vault.iterations);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: toArrayBuffer(base64ToBytes(vault.iv)) }, key, toArrayBuffer(base64ToBytes(vault.ciphertext)));
  return migrateFinanceData(JSON.parse(textDecoder.decode(decrypted)) as Partial<FinanceData>);
}

export async function saveFinanceVault(data: FinanceData, passphrase: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const iterations = 180_000;
  const key = await deriveKey(passphrase, salt, iterations);
  const payload = JSON.stringify({ ...data, updatedAt: nowISO() });
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: toArrayBuffer(iv) }, key, toArrayBuffer(textEncoder.encode(payload)));
  const vault: FinanceEncryptedVault = {
    version: 1,
    kdf: 'PBKDF2-SHA256',
    iterations,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(encrypted)),
    updatedAt: nowISO(),
  };
  setEncryptedFinanceVault(vault);
  return vault;
}

export async function loadFinanceVault(passphrase: string): Promise<FinanceData> {
  const raw = localStorage.getItem(vaultKey);
  if (!raw) return createEmptyFinanceData();
  return decryptFinanceVault(JSON.parse(raw) as FinanceEncryptedVault, passphrase);
}

export function normalizeImportedFinanceData(input: unknown) {
  if (!input || typeof input !== 'object') throw new Error('导入文件不是有效 JSON 对象。');
  const maybeWrapped = input as { financeData?: unknown };
  const payload = (maybeWrapped.financeData ?? input) as Partial<FinanceData>;
  const migrated = migrateFinanceData(payload);
  if (!Array.isArray(migrated.assets) || !Array.isArray(migrated.transactions)) {
    throw new Error('导入文件缺少资产或交易数组。');
  }
  return migrated;
}

export function downloadBlob(fileName: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
