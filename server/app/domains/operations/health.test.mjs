import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installOperationsHealthDomain } from './health.mjs';

const temporaryDirectories = [];

function install(runtime) {
  const api = {};
  installOperationsHealthDomain(runtime, (readers) => {
    for (const [name, read] of Object.entries(readers)) {
      Object.defineProperty(api, name, { configurable: true, enumerable: true, get: read });
    }
  });
  return api;
}

function runtimeFixture(metadata = {}) {
  return {
    getDailyBriefSettings: () => ({ taskReminders: { enabled: true } }),
    appMetadataRepository: { get: (key, fallback = '') => metadata[key] ?? fallback },
    taskRunsRepository: { listLatest: () => [] },
    hbrStatusFile: '',
    root: tmpdir(),
    join,
    existsSync: () => false,
    readFileSync: () => '',
    redactSecretText: (value) => String(value),
  };
}

afterEach(() => {
  vi.useRealTimers();
  while (temporaryDirectories.length) rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
});

describe('operations deep health', () => {
  it('reports a reminder scan failure that happened after the last success', () => {
    const api = install(runtimeFixture({
      worker_task_reminder_last_success_at: '2026-08-11T01:00:00.000Z',
      worker_task_reminder_last_error_at: '2026-08-11T01:01:00.000Z',
      worker_task_reminder_last_error: 'fixture failure',
    }));
    expect(api.getBackgroundJobStatus()).toMatchObject({
      status: 'failed',
      reminder: { error: 'fixture failure' },
    });
  });

  it('reads the bounded offsite backup status without exposing implementation data', () => {
    const temporary = mkdtempSync(join(tmpdir(), 'exam-planner-hbr-'));
    temporaryDirectories.push(temporary);
    const statusFile = join(temporary, 'hbr-status.json');
    writeFileSync(statusFile, JSON.stringify({
      action: 'guard', result: 'success', checkedAt: new Date().toISOString(), detail: 'safety-budget-ok',
    }));
    const runtime = runtimeFixture();
    runtime.hbrStatusFile = statusFile;
    runtime.existsSync = () => true;
    runtime.readFileSync = readFileSync;
    const api = install(runtime);
    expect(api.getHbrStatus()).toMatchObject({ status: 'normal', action: 'guard', result: 'success' });
  });

  it('treats a missing HBR report as pending during the first maintenance window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T04:00:00.000Z'));
    const runtime = runtimeFixture();
    runtime.hbrStatusFile = join(tmpdir(), 'missing-hbr-status.json');
    runtime.existsSync = (file) => String(file).endsWith('build-meta.json');
    runtime.readFileSync = () => JSON.stringify({ version: '1.0.0', builtAt: '2026-08-11T03:00:00.000Z' });
    const api = install(runtime);
    expect(api.getHbrStatus()).toMatchObject({ status: 'pending', result: 'not-reported' });
  });

  it('reports a missing HBR result after the first-window grace period', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-13T00:00:00.000Z'));
    const runtime = runtimeFixture();
    runtime.hbrStatusFile = join(tmpdir(), 'missing-hbr-status.json');
    runtime.existsSync = (file) => String(file).endsWith('build-meta.json');
    runtime.readFileSync = () => JSON.stringify({ version: '1.0.0', builtAt: '2026-08-11T03:00:00.000Z' });
    const api = install(runtime);
    expect(api.getHbrStatus()).toMatchObject({ status: 'degraded', result: 'not-reported' });
  });
});
