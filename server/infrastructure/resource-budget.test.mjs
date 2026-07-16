import { describe, expect, it } from 'vitest';
import { createResourceBudget, ResourceBudgetUnavailableError } from './resource-budget.mjs';

describe('resource budget', () => {
  it('serializes heavy jobs', async () => {
    const budget = createResourceBudget({
      readResources: () => ({ availableMemoryBytes: 1024, loadAverage: [0], cpuCount: 1 }),
      minAvailableMemoryBytes: 1,
      pollIntervalMs: 1,
    });
    const order = [];
    await Promise.all([
      budget.run('first', async () => {
        order.push('first:start');
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push('first:end');
      }),
      budget.run('second', async () => {
        order.push('second:start');
        order.push('second:end');
      }),
    ]);
    expect(order).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('defers work when memory remains below the floor', async () => {
    const budget = createResourceBudget({
      readResources: () => ({ availableMemoryBytes: 0, loadAverage: [0], cpuCount: 1 }),
      minAvailableMemoryBytes: 1,
      pollIntervalMs: 1,
      maxWaitMs: 2,
    });
    await expect(budget.run('blocked', async () => true)).rejects.toBeInstanceOf(ResourceBudgetUnavailableError);
  });
});
