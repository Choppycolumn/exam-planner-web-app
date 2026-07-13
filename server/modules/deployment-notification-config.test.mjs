import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('production notification configuration', () => {
  it.each([
    'infra/systemd/exam-planner.service',
    'infra/systemd/exam-planner-worker.service',
  ])('loads the Bark environment in %s', (relativePath) => {
    const unit = readFileSync(resolve(root, relativePath), 'utf8');
    expect(unit).toContain('EnvironmentFile=-/etc/exam-planner/bark.env');
  });

  it('bundles the Telegram proxy dependency without installing packages on the server', () => {
    const deployScript = readFileSync(resolve(root, 'scripts/deploy-production.ps1'), 'utf8');
    expect(deployScript).toContain('$runtimeDependency = "node_modules/undici"');

    const remoteDeployScript = readFileSync(resolve(root, 'scripts/remote-deploy.sh'), 'utf8');
    expect(remoteDeployScript).toContain('bundled undici runtime dependency is missing');
    expect(remoteDeployScript).not.toContain('npm ci');
  });
});
