import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

describe('architecture boundaries', () => {
  it('keeps the server composition root below 500 lines', () => {
    const lines = read('server/auth-static-server.mjs').split(/\r?\n/).length;
    expect(lines).toBeLessThanOrEqual(500);
  });

  it('keeps SQL out of HTTP routes and domain services', () => {
    const files = [
      ...readdirSync(resolve(root, 'server/routes')).filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs')).map((name) => `server/routes/${name}`),
      'server/services/backup-service.mjs',
      'server/domains/break-guard/service.mjs',
    ];
    const sqlPattern = /\b(?:SELECT\s+[\w*]|INSERT\s+INTO\s+\w|UPDATE\s+\w|DELETE\s+FROM\s+\w|PRAGMA\s+\w|VACUUM\s+INTO)\b/i;
    expect(files.filter((file) => sqlPattern.test(read(file)))).toEqual([]);
  });

  it('keeps recurring timers behind the scheduler registry', () => {
    const domainDirectory = resolve(root, 'server/app/domains');
    const offenders = readdirSync(domainDirectory)
      .filter((name) => name.endsWith('.mjs'))
      .filter((name) => /\bsetInterval\s*\(/.test(read(`server/app/domains/${name}`)));
    expect(offenders).toEqual([]);
  });
});
