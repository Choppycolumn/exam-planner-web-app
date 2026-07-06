import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';

async function loginIfNeeded(page: Page) {
  const password = process.env.E2E_PASSWORD;
  const passwordInput = page.locator('input[type="password"]');
  if (!(await passwordInput.count())) return;
  test.skip(!password, 'E2E_PASSWORD is required when the target is protected by the login page.');
  await passwordInput.fill(password);
  await page.locator('button[type="submit"], button').first().click();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
}

test('loads main app and core navigation', async ({ page }) => {
  await page.goto('/');
  await loginIfNeeded(page);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('body')).toContainText(/首页|学习时间|Exam Planner|考研/);
});

test('opens operations and task center pages', async ({ page }) => {
  await page.goto('/');
  await loginIfNeeded(page);

  await page.goto('/operations');
  await expect(page.locator('main')).toContainText(/运维|访问|日志|备份/);

  await page.goto('/task-center');
  await expect(page.locator('main')).toContainText(/任务|后台|SQLite|备份/);
});

test('opens calendar and goal review pages', async ({ page }) => {
  await page.goto('/');
  await loginIfNeeded(page);

  await page.goto('/calendar');
  await expect(page.locator('main')).toContainText(/日历|Calendar|学习|复盘/);

  await page.goto('/goal-review');
  await expect(page.locator('main')).toContainText(/目标复盘|长期目标|项目动量/);
});
