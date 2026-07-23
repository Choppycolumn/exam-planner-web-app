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
    expect(deployScript).toContain('publish_release_assets');
    expect(deployScript).toContain('verify_nginx_assets');
    expect(deployScript).toContain('write_deployment_state');
    expect(read('server/nginx-exam-planner.conf')).toContain('root /opt/exam-planner/shared;');
    expect(read('server/nginx-exam-planner.conf')).not.toContain('root /opt/exam-planner/current/dist;');
    expect(read('server/nginx-exam-planner.conf')).not.toContain('alias /opt/exam-planner/dist/assets/;');
    expect(read('infra/systemd/exam-planner.service')).toContain('/opt/exam-planner/current/server/web.mjs');
    expect(read('server/modules/migration-runner.mjs')).toContain('schema_migrations');
  });

  it('installs a bounded runtime watchdog and staggered maintenance windows', () => {
    const watchdogUnit = read('infra/systemd/exam-planner-health-watchdog.service');
    const watchdogTimer = read('infra/systemd/exam-planner-health-watchdog.timer');
    const deployScript = read('scripts/remote-deploy.sh');

    expect(watchdogUnit).toContain('runtime-watchdog.mjs');
    expect(watchdogUnit).toContain('exam-planner-deploy.lock');
    expect(watchdogUnit).toContain('MemoryLow=32M');
    expect(watchdogUnit).toContain('IOWeight=1000');
    expect(watchdogTimer).toContain('OnUnitActiveSec=2min');
    expect(deployScript).toContain('zz-exam-planner-window.conf');
    expect(deployScript).toContain('zz-exam-planner-resources.conf');
    const backupResources = read('infra/systemd/service-overrides/hbrclient-resources.conf');
    expect(backupResources).toContain('IOReadBandwidthMax=/dev/vda 3M');
    expect(backupResources).toContain('IOReadIOPSMax=/dev/vda 80');
    expect(backupResources).toContain('MemoryMax=192M');
    const openClawResources = read('infra/systemd/service-overrides/openclaw-gateway-resources.conf');
    expect(openClawResources).toContain('MemoryHigh=320M');
    expect(openClawResources).toContain('MemoryMax=400M');
    expect(read('infra/systemd/timer-overrides/openclaw-night-stop.conf')).toContain('OnCalendar=*-*-* 03:00:00');
    expect(read('infra/systemd/timer-overrides/openclaw-night-stop.conf')).toContain('Persistent=false');
    expect(read('infra/systemd/timer-overrides/openclaw-morning-start.conf')).toContain('OnCalendar=*-*-* 07:00:00');
    expect(read('infra/systemd/timer-overrides/openclaw-morning-start.conf')).toContain('Persistent=false');
    expect(read('infra/systemd/timer-overrides/logrotate.conf')).toContain('OnCalendar=*-*-* 03:10:00');
    expect(read('infra/systemd/timer-overrides/dpkg-db-backup.conf')).toContain('OnCalendar=*-*-* 03:20:00');
    expect(read('infra/systemd/timer-overrides/apt-daily.conf')).toContain('OnCalendar=*-*-* 03:50:00');
    expect(read('infra/systemd/timer-overrides/apt-daily-upgrade.conf')).toContain('OnCalendar=*-*-* 04:20:00');
  });
});
