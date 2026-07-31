import { describe, expect, it, vi } from 'vitest';
import { handleLearningReadRoutes } from './learning-read-routes.mjs';
import { handleLearningWriteRoutes } from './learning-write-routes.mjs';

describe('learning route modules', () => {
  it('dispatches dashboard reads through the extracted read router', async () => {
    const sendJson = vi.fn();
    const handled = await handleLearningReadRoutes(
      { method: 'GET', url: '/api/dashboard' },
      {},
      {
        sessionRole: 'write',
        session: { userId: 1, capabilities: ['study.use'] },
        learningRepository: { forUser: () => ({}) },
        sendJson,
        ensureSqliteStore: vi.fn(),
        getDashboardPayload: () => ({ generatedAt: 'fixture' }),
      },
    );
    expect(handled).toBe(true);
    expect(sendJson).toHaveBeenCalledWith({}, { generatedAt: 'fixture' });
  });

  it('dispatches task writes without falling through to other modules', async () => {
    const sendJson = vi.fn();
    const handled = await handleLearningWriteRoutes(
      { method: 'POST', url: '/api/tasks/save' },
      {},
      {
        sessionRole: 'write',
        session: { userId: 1, capabilities: ['study.use'] },
        sendJson,
        readJsonBody: async () => ({ title: 'fixture task' }),
        nowISO: () => '2026-07-10T00:00:00.000Z',
        learningRepository: { forUser: () => ({ saveTask: (body) => body.title === 'fixture task' ? 42 : 0 }) },
      },
    );
    expect(handled).toBe(true);
    expect(sendJson).toHaveBeenCalledWith({}, 42);
  });

  it('returns false for an unknown POST route', async () => {
    const handled = await handleLearningWriteRoutes(
      { method: 'POST', url: '/api/unknown' },
      {},
      {
        readJsonBody: async () => ({}),
        nowISO: () => '2026-07-10T00:00:00.000Z',
        session: { userId: 1, capabilities: ['study.use'] },
        learningRepository: { forUser: () => ({}) },
      },
    );
    expect(handled).toBe(false);
  });
});
