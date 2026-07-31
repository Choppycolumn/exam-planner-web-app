import { expect, test, type Page } from '@playwright/test';

async function mockLocalOwnerSession(page: Page) {
  if (process.env.E2E_BASE_URL) return;
  await page.route('**/api/session', (route) => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({
      userId: 1,
      displayName: '本地验收',
      accountType: 'admin',
      userRole: 'owner',
      role: 'write',
      capabilities: [
        'study.use', 'comparison.view', 'focus_timer.use', 'settings.manage',
        'operations.manage', 'notifications.manage', 'brief.manage',
        'break_guard.sync', 'users.manage', 'data.import',
      ],
    }),
  }));
}

async function loginIfNeeded(page: Page) {
  const passwordInput = page.locator('#password');
  if (!(await passwordInput.count())) return;
  const password = process.env.E2E_PASSWORD || '';
  test.skip(!password, 'E2E_PASSWORD is required when the target is protected by the login page.');
  await passwordInput.fill(password);
  await page.getByRole('button', { name: '进入网站' }).click();
  await expect(passwordInput).toHaveCount(0);
}

test('dark theme remains readable, responsive and persistent', async ({ page }) => {
  await mockLocalOwnerSession(page);
  await page.goto('/');
  await loginIfNeeded(page);

  const themeButton = page.locator('button[aria-label^="切换到"]');
  await expect(themeButton).toBeVisible();
  if (await themeButton.getAttribute('aria-label') === '切换到深色模式') await themeButton.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  const themeState = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const body = getComputedStyle(document.body);
    const card = document.querySelector('.card');
    const cardStyle = card ? getComputedStyle(card) : null;
    return {
      textPrimary: root.getPropertyValue('--text-primary').trim(),
      textSecondary: root.getPropertyValue('--text-secondary').trim(),
      bodyColor: body.color,
      bodyBackground: body.backgroundImage,
      cardBackground: cardStyle?.backgroundColor || '',
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(themeState.textPrimary).toBe('#f4f8fd');
  expect(themeState.textSecondary).toBe('#b7c6d8');
  expect(themeState.bodyColor).toBe('rgb(244, 248, 253)');
  expect(themeState.bodyBackground).toContain('linear-gradient');
  expect(themeState.cardBackground).not.toBe('rgb(255, 255, 255)');
  expect(themeState.overflow).toBeLessThanOrEqual(0);

  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});
