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

  it('installs locked production dependencies before replacing the running service', () => {
    const deployScript = readFileSync(resolve(root, 'scripts/remote-deploy.sh'), 'utf8');
    expect(deployScript).toContain('ci --omit=dev --ignore-scripts --no-audit --no-fund');
    expect(deployScript).toContain('mv "$STAGE_DIR/node_modules" "$APP_DIR/node_modules"');
  });
});
