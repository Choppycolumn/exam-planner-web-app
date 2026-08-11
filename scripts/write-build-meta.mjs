import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const git = (...args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};
const outputFile = resolve(root, 'public/build-meta.json');
const metadata = {
  name: packageJson.name,
  version: packageJson.version,
  commit: process.env.GITHUB_SHA || git('rev-parse', 'HEAD') || 'unknown',
  branch: process.env.GITHUB_REF_NAME || git('branch', '--show-current') || 'unknown',
  builtAt: process.env.BUILD_TIMESTAMP || new Date().toISOString(),
  dirty: Boolean(git('status', '--short')),
  node: process.version,
};

mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(outputFile, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
console.log(`build_meta version=${metadata.version} commit=${metadata.commit.slice(0, 12)} dirty=${metadata.dirty}`);
