import { describe, expect, it } from 'vitest';
import { queryLimit, queryOffset } from './api-helpers.mjs';

describe('API query helpers', () => {
  it('bounds pagination inputs', () => {
    const params = new URLSearchParams({ limit: '500', offset: '-2' });
    expect(queryLimit(params, 20, 100)).toBe(100);
    expect(queryOffset(params)).toBe(0);
  });

  it('uses defaults for invalid values', () => {
    const params = new URLSearchParams({ limit: 'nope', offset: 'nope' });
    expect(queryLimit(params, 25, 100)).toBe(25);
    expect(queryOffset(params)).toBe(0);
  });
});
