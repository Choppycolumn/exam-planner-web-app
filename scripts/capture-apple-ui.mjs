import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:4180';
const password = process.env.E2E_PASSWORD || '';
const outputDir = resolve(process.env.VISUAL_OUTPUT_DIR || 'test-results/apple-design');
mkdirSync(outputDir, { recursive: true });

async function login(page) {
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  const passwordInput = page.locator('#password');
  if (await passwordInput.count()) {
    if (!password) throw new Error('E2E_PASSWORD is required for the protected preview');
    await passwordInput.fill(password);
    await page.getByRole('button', { name: '进入网站', exact: true }).click();
    await page.waitForURL((url) => url.pathname === '/');
  }
  await page.waitForLoadState('networkidle').catch(() => undefined);
}

async function setTheme(page, theme) {
  const toggle = page.locator('button[aria-label^="切换到"]');
  if (!(await toggle.count())) return;
  const targetLabel = theme === 'dark' ? '切换到深色模式' : '切换到浅色模式';
  if ((await toggle.getAttribute('aria-label')) === targetLabel) await toggle.click();
  await page.locator('html').waitFor({ state: 'attached' });
}

async function captureLogin(context, name) {
  const page = await context.newPage();
  await page.goto(baseURL, { waitUntil: 'domcontentloaded' });
  await page.locator('#password').waitFor();
  await page.locator('main').evaluate(async (element) => {
    await Promise.all(element.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`${name} has ${overflow}px horizontal overflow`);
  await page.screenshot({ path: resolve(outputDir, `${name}.png`), fullPage: true });
  await page.close();
}

async function capture(context, name, route, theme = 'light') {
  const page = await context.newPage();
  await login(page);
  await page.goto(new URL(route, baseURL).toString(), { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await setTheme(page, theme);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 1) throw new Error(`${name} has ${overflow}px horizontal overflow`);
  await page.screenshot({ path: resolve(outputDir, `${name}-${theme}.png`), fullPage: true });
  await page.close();
}

const browser = await chromium.launch({ headless: true });
try {
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  await captureLogin(desktop, 'login-desktop-light');
  await capture(desktop, 'dashboard-desktop', '/', 'light');
  await capture(desktop, 'focus-desktop', '/focus-timer', 'light');
  await capture(desktop, 'settings-desktop', '/settings', 'dark');
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  await captureLogin(mobile, 'login-mobile-light');
  await capture(mobile, 'dashboard-mobile', '/', 'light');
  await capture(mobile, 'focus-mobile', '/focus-timer', 'dark');
  await mobile.close();
} finally {
  await browser.close();
}

console.log(`Visual captures written to ${outputDir}`);
