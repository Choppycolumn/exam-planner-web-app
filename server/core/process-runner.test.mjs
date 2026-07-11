import { describe, expect, test } from 'vitest';
import { runProcess } from './process-runner.mjs';

describe('runProcess', () => {
  test('captures output without blocking the event loop', async () => {
    let timerFired = false;
    setTimeout(() => { timerFired = true; }, 5);
    const result = await runProcess(process.execPath, ['-e', "setTimeout(() => console.log('ok'), 20)"], { timeoutMs: 2000 });
    expect(result.ok).toBe(true);
    expect(result.stdout.trim()).toBe('ok');
    expect(timerFired).toBe(true);
  });

  test('terminates a timed out process', async () => {
    const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 30 });
    expect(result.ok).toBe(false);
    expect(result.error?.message).toContain('timed out');
  });
});
