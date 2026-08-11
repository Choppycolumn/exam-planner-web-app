import { expect, test, type Page, type Route } from '@playwright/test';

const session = {
  userId: 2,
  displayName: '学习用户',
  accountType: 'learner',
  userRole: 'learner',
  role: 'write',
  capabilities: ['study.use', 'comparison.view', 'focus_timer.use'],
};

function idleDashboard() {
  return {
    generatedAt: new Date().toISOString(),
    settings: { userId: 2, focusMinutes: 50, breakMinutes: 10, updatedAt: null },
    state: {
      userId: 2, mode: 'idle', sessionId: null, projectId: null, projectName: '', pauseLabel: '',
      startedAt: null, targetSeconds: 0, revision: 0, updatedAt: null,
      elapsedSeconds: 0, remainingSeconds: 0, overtimeSeconds: 0, expired: false, segments: [],
    },
    summary: { date: '2026-08-11', studySeconds: 0, sessionCount: 0, byProject: [], dayEnded: false },
    sessions: [],
  };
}

async function mockBaseApi(page: Page) {
  await page.route('**/api/session', (route) => route.fulfill({ json: session }));
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: {
    today: '2026-08-11', todayTotal: 0, totalStudyMinutes: 0, studyTargetMinutes: 300,
    distribution: [], trend: [], visibleTasks: [], reminders: [], activityCalendar: [], errorThemeWall: [],
  } }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: { items: [{
    id: 19, name: '英一', color: '#0a84ff', isActive: true, sortOrder: 1,
    schemaVersion: 1, createdAt: '2026-08-11T00:00:00Z', updatedAt: '2026-08-11T00:00:00Z',
  }], readOnly: false } }));
  await page.route('**/api/study-records*', (route) => route.fulfill({ json: { records: [], readOnly: false } }));
}

test('completes a focus session and enters break mode', async ({ page }) => {
  await mockBaseApi(page);
  let dashboard = idleDashboard();
  await page.route('**/api/focus-timer', (route) => route.fulfill({ json: dashboard }));
  await page.route('**/api/focus-timer/action', async (route) => {
    const action = route.request().postDataJSON();
    const occurredAt = action.occurredAt as string;
    if (action.action === 'start_focus') {
      dashboard = {
        ...dashboard,
        state: {
          ...dashboard.state,
          mode: 'focus', sessionId: action.sessionId, projectId: action.projectId, projectName: '英一',
          startedAt: occurredAt, targetSeconds: 3000, revision: 1, updatedAt: occurredAt,
        },
      };
    } else if (action.action === 'complete_focus') {
      dashboard = {
        ...dashboard,
        state: {
          ...dashboard.state,
          mode: 'break', sessionId: `break_${action.sessionId}`, pauseLabel: '课间休息',
          startedAt: occurredAt, targetSeconds: 600, revision: 2, updatedAt: occurredAt,
        },
      };
    }
    await route.fulfill({ json: { ok: true, dashboard } });
  });

  await page.goto('/focus-timer');
  await expect(page.getByRole('button', { name: /开始专注/ })).toBeVisible();
  await page.getByRole('button', { name: /开始专注/ }).click();
  await expect(page.getByRole('button', { name: /结束专注/ })).toBeVisible();
  await page.getByRole('button', { name: /结束专注/ }).click();
  await expect(page.getByText('课间休息', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /结束休息/ })).toBeVisible();
});

test('shows rejected offline operations instead of silently dropping them', async ({ page }) => {
  await mockBaseApi(page);
  const dashboard = idleDashboard();
  await page.route('**/api/focus-timer', (route) => route.fulfill({ json: dashboard }));
  await page.route('**/api/focus-timer/action', (route: Route) => route.fulfill({
    status: 409,
    contentType: 'application/json',
    body: JSON.stringify({ error: { message: '计时状态已在另一设备更新' } }),
  }));

  await page.goto('/focus-timer');
  await page.getByRole('button', { name: /开始专注/ }).click();
  await expect(page.getByText('1 条操作需要处理')).toBeVisible();
  await expect(page.getByText('计时状态已在另一设备更新')).toBeVisible();
  await expect(page.getByRole('button', { name: '重新同步' })).toBeVisible();
});
