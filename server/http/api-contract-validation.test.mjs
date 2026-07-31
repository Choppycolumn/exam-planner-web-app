import { describe, expect, it } from 'vitest';
import { API_CONTRACTS, findApiContract } from '../../shared/api-contracts.js';
import { validateContractRequest } from './api-contract-validation.mjs';

describe('shared API contracts', () => {
  it('keeps method and path pairs unique', () => {
    const pairs = Object.values(API_CONTRACTS).map((contract) => `${contract.method} ${contract.path}`);
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(findApiContract('POST', '/api/tasks/save')?.[0]).toBe('taskSave');
    expect(findApiContract('GET', '/api/tasks/status')?.[0]).toBe('taskCenterStatus');
  });

  it('validates required scalar and structured request fields', () => {
    expect(() => validateContractRequest('POST', '/api/tasks/toggle', { id: 2, completed: true })).not.toThrow();
    expect(() => validateContractRequest('POST', '/api/tasks/toggle', { id: 2, completed: 'yes' }))
      .toThrow('字段 completed 必须是布尔值');
    expect(() => validateContractRequest('POST', '/api/study-records/save-day', { date: '2026-07-31', records: [] }))
      .not.toThrow();
    expect(() => validateContractRequest('POST', '/api/study-records/save-day', { date: '2026-07-31', records: {} }))
      .toThrow('字段 records 必须是数组');
    expect(() => validateContractRequest('POST', '/api/break-guard/config', { config: {} })).not.toThrow();
  });

  it('uses contracts as the capability source of truth', () => {
    expect(API_CONTRACTS.notificationCenter.capability).toBe('notifications.manage');
    expect(API_CONTRACTS.studyComparison.capability).toBe('comparison.view');
    expect(API_CONTRACTS.backupRestore.capability).toBe('operations.manage');
    expect(API_CONTRACTS.goalSave.capability).toBe('study.use');
  });
});
