import { readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const read = (path) => readFileSync(resolve(root, path), 'utf8');

function filesBelow(directory, predicate = () => true) {
  const absolute = resolve(root, directory);
  const result = [];
  for (const entry of readdirSync(absolute)) {
    const path = resolve(absolute, entry);
    if (statSync(path).isDirectory()) {
      result.push(...filesBelow(relative(root, path), predicate));
    } else {
      const repositoryPath = relative(root, path).replaceAll('\\', '/');
      if (predicate(repositoryPath)) result.push(repositoryPath);
    }
  }
  return result;
}

const productionModules = (directory) => filesBelow(
  directory,
  (path) => path.endsWith('.mjs') && !path.endsWith('.test.mjs'),
);

describe('architecture boundaries', () => {
  it('keeps the server composition root and each domain implementation bounded', () => {
    expect(read('server/auth-static-server.mjs').split(/\r?\n/).length).toBeLessThanOrEqual(500);
    const oversized = productionModules('server/app/domains')
      .map((file) => ({ file, lines: read(file).split(/\r?\n/).length }))
      .filter((item) => item.lines > 500);
    expect(oversized).toEqual([]);
  });

  it('keeps SQL inside repositories and the schema persistence boundary', () => {
    const files = [
      ...productionModules('server/routes'),
      ...productionModules('server/services'),
      ...productionModules('server/domains'),
      ...productionModules('server/app/domains').filter((file) => file !== 'server/app/domains/persistence/schema.mjs'),
    ];
    const sqlPattern = /\b(?:SELECT\s+[\w*]|INSERT\s+INTO\s+\w|UPDATE\s+\w|DELETE\s+FROM\s+\w|PRAGMA\s+\w|VACUUM\s+INTO)\b/i;
    expect(files.filter((file) => sqlPattern.test(read(file)))).toEqual([]);
  });

  it('keeps recurring timers behind the scheduler registry', () => {
    const offenders = productionModules('server/app/domains')
      .filter((file) => /\bsetInterval\s*\(/.test(read(file)));
    expect(offenders).toEqual([]);
  });

  it('uses explicit domain composition without a global runtime service locator', () => {
    const serverFiles = ['server/auth-static-server.mjs', ...productionModules('server/app/domains')];
    expect(serverFiles.filter((file) => /runtime-context\.mjs/.test(read(file)))).toEqual([]);
    expect(read('server/app/application-context.mjs')).toContain('createApplicationContext');
    expect(read('server/app/application-context.mjs')).toContain('createDomainContext');
    expect(/installDomain\('brief\.settings'/.test(read('server/auth-static-server.mjs'))).toBe(true);
    expect(/installDomain\('notifications\.channels'/.test(read('server/auth-static-server.mjs'))).toBe(true);
  });

  it('does not encode the owner identity as user 1 in production code', () => {
    const files = [
      ...productionModules('server/auth'),
      ...productionModules('server/routes'),
      ...productionModules('server/domains'),
      ...productionModules('server/repositories'),
      ...productionModules('server/app/domains'),
    ];
    const ownerFallback = /(?:userId|ownerUserId)\s*(?:===?|:)\s*(?:\(\)\s*=>\s*)?1\b|user_id\s*=\s*1\b/;
    expect(files.filter((file) => ownerFallback.test(read(file)))).toEqual([]);
  });

  it('enforces shared API contracts and bundle budgets in CI', () => {
    expect(read('server/app/domains/api.mjs')).toContain('validateContractRequest');
    expect(read('src/api/transport.ts')).toContain('apiContract');
    expect(read('.github/workflows/ci.yml')).toContain('npm run check:bundle');
    expect(read('vite.config.ts')).toContain('modulePreload');
  });

  it('uses versioned releases and a persistent migration ledger', () => {
    const deployScript = read('scripts/remote-deploy.sh');
    expect(deployScript).toContain('RELEASES_DIR');
    expect(deployScript).toContain('CURRENT_LINK');
    expect(deployScript).toContain('publish_release_assets');
    expect(deployScript).toContain('verify_nginx_assets');
    expect(deployScript).toContain('write_deployment_state');
    expect(read('server/nginx-exam-planner.conf')).toContain('root /opt/exam-planner/shared;');
    expect(read('server/nginx-exam-planner.conf')).not.toContain('root /opt/exam-planner/current/dist;');
    expect(read('server/nginx-exam-planner.conf')).not.toContain('alias /opt/exam-planner/dist/assets/;');
    expect(read('infra/systemd/exam-planner.service')).toContain('/opt/exam-planner/current/server/web.mjs');
    expect(read('server/modules/migration-runner.mjs')).toContain('schema_migrations');
  });

  it('isolates HBR and other heavy I/O from interactive services', () => {
    const deployScript = read('scripts/remote-deploy.sh');
    const hbrResources = read('infra/systemd/service-overrides/hbrclient-resources.conf');
    expect(deployScript).toContain('exam-planner-heavy-io.lock');
    expect(deployScript).toContain('check-system-pressure.sh');
    expect(deployScript).not.toContain('try-restart hbrclient');
    expect(hbrResources).toContain('IOReadBandwidthMax=/dev/vda 2M');
    expect(hbrResources).toContain('IOReadIOPSMax=/dev/vda 40');
    expect(hbrResources).toContain('MemoryMax=160M');
    expect(read('infra/systemd/exam-planner-hbr-window-open.timer')).toContain('OnCalendar=*-*-* 03:05:00');
    expect(read('infra/systemd/exam-planner-hbr-window-open.timer')).toContain('Persistent=false');
    expect(read('infra/systemd/exam-planner-hbr-window-close.timer')).toContain('OnCalendar=*-*-* 06:45:00');
    expect(read('infra/systemd/exam-planner-hbr-guard.timer')).toContain('OnUnitActiveSec=2min');
    expect(read('scripts/hbr-window-control.sh')).toContain('exam-planner-pressure-check');
    expect(read('scripts/hbr-window-control.sh')).toContain('guard)');
    expect(read('server/infrastructure/linux-resource-health.mjs')).toContain('blockedProcessCount');
  });

  it('installs a bounded watchdog and staggered system maintenance windows', () => {
    const watchdogUnit = read('infra/systemd/exam-planner-health-watchdog.service');
    const watchdogTimer = read('infra/systemd/exam-planner-health-watchdog.timer');
    expect(watchdogUnit).toContain('runtime-watchdog.mjs');
    expect(watchdogUnit).toContain('exam-planner-deploy.lock');
    expect(watchdogUnit).toContain('MemoryLow=32M');
    expect(watchdogUnit).toContain('IOWeight=1000');
    expect(watchdogTimer).toContain('OnUnitActiveSec=2min');
    expect(read('scripts/remote-deploy.sh').toLowerCase()).not.toContain('openclaw');
    expect(read('infra/systemd/timer-overrides/logrotate.conf')).toContain('OnCalendar=*-*-* 03:10:00');
    expect(read('infra/systemd/timer-overrides/dpkg-db-backup.conf')).toContain('OnCalendar=*-*-* 03:20:00');
    expect(read('infra/systemd/timer-overrides/apt-daily.conf')).toContain('OnCalendar=*-*-* 03:50:00');
    expect(read('infra/systemd/timer-overrides/apt-daily-upgrade.conf')).toContain('OnCalendar=*-*-* 04:20:00');
  });
});
