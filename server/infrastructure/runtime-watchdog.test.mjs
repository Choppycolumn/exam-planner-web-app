import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decideRecoveryAction, runRuntimeWatchdog, validateRuntime } from './runtime-watchdog.mjs';

const temporaryDirectories = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe('runtime recovery policy', () => {
  it('restarts after two failures and prioritizes rollback for a failing new release', () => {
    expect(decideRecoveryAction({ failureCount: 1 })).toBe('none');
    expect(decideRecoveryAction({ failureCount: 2 })).toBe('restart');
    expect(decideRecoveryAction({ failureCount: 3, rollbackEligible: true })).toBe('rollback');
    expect(decideRecoveryAction({ failureCount: 3, rollbackEligible: true, rollbackAttempted: true })).toBe('restart');
  });

  it('respects restart cooldown outside the automatic rollback window', () => {
    expect(decideRecoveryAction({
      failureCount: 5,
      rollbackEligible: false,
      nowMs: 1_000_000,
      lastActionAtMs: 900_000,
      actionCooldownMs: 600_000,
    })).toBe('none');
  });

  it('restarts failed services after two consecutive failures and clears the counter after recovery', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'watchdog-state-'));
    temporaryDirectories.push(stateDir);
    const release = '/opt/exam-planner/releases/20260717000000';
    const commands = [];
    const runCommand = (command, args) => {
      commands.push([command, ...args]);
      return { status: 0 };
    };
    const validateRuntimeImpl = async () => ({ ok: false, release, checks: [{ name: 'readiness', ok: false }] });
    const waitForHealthyImpl = async () => ({ ok: true, release, checks: [] });

    const first = await runRuntimeWatchdog({ stateDir, runCommand, validateRuntimeImpl, waitForHealthyImpl });
    const second = await runRuntimeWatchdog({ stateDir, runCommand, validateRuntimeImpl, waitForHealthyImpl });

    expect(first.action).toBe('none');
    expect(second.action).toBe('restart');
    expect(second.recovered).toBe(true);
    expect(commands).toContainEqual(['systemctl', 'restart', 'exam-planner']);
    expect(commands).toContainEqual(['systemctl', 'restart', 'exam-planner-worker']);
    expect(JSON.parse(readFileSync(join(stateDir, 'watchdog-state.json'), 'utf8')).failureCount).toBe(0);
  });

  it('rolls a repeatedly failing fresh release back only through the locked rollback script', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'watchdog-state-'));
    temporaryDirectories.push(stateDir);
    const release = '/opt/exam-planner/releases/20260717000000';
    const previousRelease = '/opt/exam-planner/releases/20260716000000';
    writeFileSync(join(stateDir, 'watchdog-state.json'), JSON.stringify({
      observedRelease: release,
      failureCount: 2,
      lastActionAtMs: 0,
      rollbackAttempted: false,
    }));
    writeFileSync(join(stateDir, 'deployment-state.json'), JSON.stringify({
      release,
      previousRelease,
      activatedAtMs: 900_000,
    }));
    const commands = [];
    const runCommand = (command, args, options = {}) => {
      commands.push({ command, args, options });
      return { status: 0 };
    };
    const validateRuntimeImpl = async () => ({
      ok: false,
      release,
      checks: [
        { name: 'service:nginx', ok: true },
        { name: 'service:exam-planner-privileged', ok: true },
        { name: 'readiness', ok: false },
      ],
    });
    const waitForHealthyImpl = async () => ({ ok: true, release: previousRelease, checks: [] });

    const result = await runRuntimeWatchdog({
      stateDir,
      now: () => 1_000_000,
      runCommand,
      validateRuntimeImpl,
      waitForHealthyImpl,
    });

    expect(result.action).toBe('rollback');
    expect(result.recovered).toBe(true);
    expect(commands).toContainEqual(expect.objectContaining({
      command: 'bash',
      args: [join(release, 'scripts', 'rollback-release.sh'), 'previous'],
      options: expect.objectContaining({ env: { EXAM_PLANNER_LOCK_HELD: '1' } }),
    }));
  });

  it('does not roll back application code while Nginx itself is unavailable', async () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'watchdog-state-'));
    temporaryDirectories.push(stateDir);
    const release = '/opt/exam-planner/releases/20260717000000';
    writeFileSync(join(stateDir, 'watchdog-state.json'), JSON.stringify({
      observedRelease: release,
      failureCount: 2,
      rollbackAttempted: false,
    }));
    writeFileSync(join(stateDir, 'deployment-state.json'), JSON.stringify({
      release,
      previousRelease: '/opt/exam-planner/releases/20260716000000',
      activatedAtMs: 900_000,
    }));
    const commands = [];
    const runCommand = (command, args) => {
      commands.push([command, ...args]);
      if (args[0] === 'is-active' && args.at(-1) === 'nginx') return { status: 3 };
      return { status: 0 };
    };
    const result = await runRuntimeWatchdog({
      stateDir,
      now: () => 1_000_000,
      runCommand,
      validateRuntimeImpl: async () => ({
        ok: false,
        release,
        checks: [
          { name: 'service:nginx', ok: false },
          { name: 'readiness', ok: false },
        ],
      }),
      waitForHealthyImpl: async () => ({ ok: true, release, checks: [] }),
    });

    expect(result.action).toBe('restart');
    expect(commands).toContainEqual(['systemctl', 'restart', 'nginx']);
    expect(commands.some(([command]) => command === 'bash')).toBe(false);
  });
});

describe('runtime end-to-end validation', () => {
  it('verifies services, readiness and the exact Nginx JavaScript payload', async () => {
    const release = mkdtempSync(join(tmpdir(), 'watchdog-release-'));
    temporaryDirectories.push(release);
    mkdirSync(join(release, 'dist', 'assets'), { recursive: true });
    writeFileSync(join(release, 'dist', 'index.html'), '<script type="module" src="/assets/app-hash.js"></script>');
    writeFileSync(join(release, 'dist', 'assets', 'app-hash.js'), 'console.log("ok")');
    const fetchImpl = async (url) => url.endsWith('/ready')
      ? new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
      : new Response('console.log("ok")', { headers: { 'content-type': 'application/javascript' } });
    const result = await validateRuntime({
      resolveRelease: () => release,
      runCommand: () => ({ status: 0 }),
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    expect(result.checks).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'nginx-active-asset', ok: true })]));
  });

  it('rejects an HTML fallback returned for a JavaScript asset', async () => {
    const release = mkdtempSync(join(tmpdir(), 'watchdog-release-'));
    temporaryDirectories.push(release);
    mkdirSync(join(release, 'dist', 'assets'), { recursive: true });
    writeFileSync(join(release, 'dist', 'index.html'), '<script type="module" src="/assets/app-hash.js"></script>');
    writeFileSync(join(release, 'dist', 'assets', 'app-hash.js'), 'console.log("ok")');
    const fetchImpl = async (url) => url.endsWith('/ready')
      ? new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } })
      : new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } });
    const result = await validateRuntime({
      resolveRelease: () => release,
      runCommand: () => ({ status: 0 }),
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    expect(result.checks.find((check) => check.name === 'nginx-active-asset')?.ok).toBe(false);
  });
});
