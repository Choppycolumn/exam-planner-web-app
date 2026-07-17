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

  it('does not use a module-global runtime service locator', () => {
    const serverFiles = [
      'server/auth-static-server.mjs',
      ...readdirSync(resolve(root, 'server/app/domains')).filter((name) => name.endsWith('.mjs')).map((name) => `server/app/domains/${name}`),
    ];
    expect(serverFiles.filter((file) => /runtime-context\.mjs/.test(read(file)))).toEqual([]);
    expect(read('server/app/application-context.mjs')).toContain('createApplicationContext');
    expect(read('server/app/application-context.mjs')).toContain('createDomainContext');
    expect(read('server/auth-static-server.mjs')).toContain("installDomain('brief'");
  });

  it('keeps extracted brief settings and task execution outside giant compatibility domains', () => {
    expect(read('server/domains/brief/settings-service.mjs')).toContain('createBriefSettingsService');
    expect(read('server/domains/tasks/task-runner.mjs')).toContain('createTaskRunner');
    expect(read('server/app/domains/brief.mjs').length).toBeLessThan(70_000);
    expect(read('server/app/domains/notifications.mjs').length).toBeLessThan(70_000);
  });

  it('uses versioned releases and a persistent migration ledger', () => {
    const deployScript = read('scripts/remote-deploy.sh');
    expect(deployScript).toContain('RELEASES_DIR');
    expect(deployScript).toContain('CURRENT_LINK');
    expect(deployScript).toContain('verify_nginx_assets');
    expect(read('server/nginx-exam-planner.conf')).toContain('root /opt/exam-planner/current/dist;');
    expect(read('server/nginx-exam-planner.conf')).not.toContain('alias /opt/exam-planner/dist/assets/;');
    expect(read('infra/systemd/exam-planner.service')).toContain('/opt/exam-planner/current/server/web.mjs');
    expect(read('server/modules/migration-runner.mjs')).toContain('schema_migrations');
  });
});
