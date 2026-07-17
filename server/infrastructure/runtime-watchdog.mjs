import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function defaultRunCommand(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeoutMs || 30_000,
    env: { ...process.env, ...(options.env || {}) },
  });
}

async function fetchWithTimeout(fetchImpl, url, options = {}, timeoutMs = 5_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function decideRecoveryAction({
  failureCount,
  restartThreshold = 2,
  rollbackThreshold = 3,
  rollbackEligible = false,
  rollbackAttempted = false,
  nowMs = Date.now(),
  lastActionAtMs = 0,
  actionCooldownMs = 10 * 60_000,
}) {
  if (rollbackEligible && !rollbackAttempted && failureCount >= rollbackThreshold) return 'rollback';
  const cooldownElapsed = !lastActionAtMs || nowMs - lastActionAtMs >= actionCooldownMs;
  if (failureCount >= restartThreshold && cooldownElapsed) return 'restart';
  return 'none';
}

export async function validateRuntime({
  appDir = '/opt/exam-planner',
  fetchImpl = fetch,
  runCommand = defaultRunCommand,
  resolveRelease = () => realpathSync(join(appDir, 'current')),
} = {}) {
  const checks = [];
  try {
    const release = resolveRelease();
    for (const service of ['exam-planner-privileged', 'exam-planner', 'exam-planner-worker', 'nginx']) {
      const result = runCommand('systemctl', ['is-active', '--quiet', service]);
      checks.push({ name: `service:${service}`, ok: result.status === 0 });
    }
    const readyResponse = await fetchWithTimeout(fetchImpl, 'http://127.0.0.1:8080/ready', {}, 5_000);
    const readyPayload = readyResponse.ok ? await readyResponse.json() : null;
    checks.push({ name: 'readiness', ok: Boolean(readyResponse.ok && readyPayload?.ok) });

    const index = readFileSync(join(release, 'dist', 'index.html'), 'utf8');
    const assetPath = index.match(/(?:src|href)="(\/assets\/[^"?]+\.js)(?:\?[^"?]*)?"/)?.[1] || '';
    if (!assetPath) throw new Error('active index does not reference a JavaScript asset');
    const expectedAsset = readFileSync(join(release, 'dist', assetPath));
    const assetResponse = await fetchWithTimeout(fetchImpl, `http://127.0.0.1:8088${assetPath}`, {}, 5_000);
    const contentType = String(assetResponse.headers.get('content-type') || '').toLowerCase();
    const actualAsset = assetResponse.ok ? Buffer.from(await assetResponse.arrayBuffer()) : Buffer.alloc(0);
    const assetMatches = assetResponse.ok
      && contentType.includes('javascript')
      && actualAsset.length === expectedAsset.length
      && hash(actualAsset) === hash(expectedAsset);
    checks.push({ name: 'nginx-active-asset', ok: assetMatches, assetPath });
    return { ok: checks.every((check) => check.ok), release, checks };
  } catch (error) {
    return {
      ok: false,
      release: '',
      checks,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(path, value) {
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o640 });
  renameSync(temporary, path);
}

async function waitForHealthy(options, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await validateRuntime(options);
    if (result.ok) return result;
    await sleep(1_000);
  }
  return validateRuntime(options);
}

export async function runRuntimeWatchdog({
  appDir = process.env.APP_DIR || '/opt/exam-planner',
  stateDir = process.env.WATCHDOG_STATE_DIR || '/opt/exam-planner/data/runtime-watchdog',
  now = () => Date.now(),
  runCommand = defaultRunCommand,
  fetchImpl = fetch,
  checkOnly = false,
  validateRuntimeImpl = validateRuntime,
  waitForHealthyImpl = waitForHealthy,
} = {}) {
  const validationOptions = { appDir, fetchImpl, runCommand };
  const validation = await validateRuntimeImpl(validationOptions);
  if (checkOnly) return { action: 'check-only', ...validation };

  mkdirSync(stateDir, { recursive: true, mode: 0o750 });
  const statePath = join(stateDir, 'watchdog-state.json');
  const deploymentPath = join(stateDir, 'deployment-state.json');
  const currentRelease = validation.release || (() => {
    try { return realpathSync(join(appDir, 'current')); } catch { return ''; }
  })();
  const previousState = readJson(statePath, {});
  const state = previousState.observedRelease === currentRelease ? previousState : {
    observedRelease: currentRelease,
    failureCount: 0,
    lastActionAtMs: 0,
    rollbackAttempted: false,
  };

  if (validation.ok) {
    state.failureCount = 0;
    state.lastHealthyAt = new Date(now()).toISOString();
    state.lastError = '';
    writeJson(statePath, state);
    return { action: 'healthy', ...validation };
  }

  state.failureCount = Number(state.failureCount || 0) + 1;
  state.lastFailureAt = new Date(now()).toISOString();
  state.lastError = validation.error || validation.checks.filter((check) => !check.ok).map((check) => check.name).join(',');
  const deployment = readJson(deploymentPath, {});
  const rollbackWindowMs = Math.max(60_000, Number(process.env.WATCHDOG_ROLLBACK_WINDOW_SECONDS || 21_600) * 1_000);
  const infrastructureHealthy = validation.checks
    .filter((check) => ['service:nginx', 'service:exam-planner-privileged'].includes(check.name))
    .every((check) => check.ok);
  const releaseCheckFailed = validation.checks
    .some((check) => ['service:exam-planner', 'service:exam-planner-worker', 'readiness', 'nginx-active-asset'].includes(check.name) && !check.ok);
  const rollbackEligible = deployment.release === currentRelease
    && Boolean(deployment.previousRelease)
    && now() - Number(deployment.activatedAtMs || 0) <= rollbackWindowMs
    && infrastructureHealthy
    && releaseCheckFailed;
  const action = decideRecoveryAction({
    failureCount: state.failureCount,
    restartThreshold: Number(process.env.WATCHDOG_RESTART_THRESHOLD || 2),
    rollbackThreshold: Number(process.env.WATCHDOG_ROLLBACK_THRESHOLD || 3),
    rollbackEligible,
    rollbackAttempted: Boolean(state.rollbackAttempted),
    nowMs: now(),
    lastActionAtMs: Number(state.lastActionAtMs || 0),
    actionCooldownMs: Number(process.env.WATCHDOG_ACTION_COOLDOWN_SECONDS || 600) * 1_000,
  });

  if (action === 'none') {
    writeJson(statePath, state);
    return { action, ...validation, failureCount: state.failureCount, rollbackEligible };
  }

  state.lastActionAtMs = now();
  if (action === 'rollback') {
    state.rollbackAttempted = true;
    writeJson(statePath, state);
    const rollback = runCommand('bash', [join(currentRelease, 'scripts', 'rollback-release.sh'), 'previous'], {
      timeoutMs: 180_000,
      env: { EXAM_PLANNER_LOCK_HELD: '1' },
    });
    const recovered = rollback.status === 0 ? await waitForHealthyImpl(validationOptions) : validation;
    if (recovered.ok) {
      writeJson(statePath, {
        observedRelease: recovered.release,
        failureCount: 0,
        rollbackAttempted: false,
        lastActionAtMs: now(),
        lastHealthyAt: new Date(now()).toISOString(),
        recoveredFromRelease: currentRelease,
      });
    }
    return { action, recovered: recovered.ok, rollbackStatus: rollback.status, ...recovered };
  }

  runCommand('systemctl', ['reset-failed', 'nginx', 'exam-planner-privileged', 'exam-planner', 'exam-planner-worker']);
  if (runCommand('systemctl', ['is-active', '--quiet', 'nginx']).status !== 0) {
    runCommand('systemctl', ['restart', 'nginx'], { timeoutMs: 60_000 });
  }
  if (runCommand('systemctl', ['is-active', '--quiet', 'exam-planner-privileged']).status !== 0) {
    runCommand('systemctl', ['restart', 'exam-planner-privileged'], { timeoutMs: 60_000 });
  }
  const webRestart = runCommand('systemctl', ['restart', 'exam-planner'], { timeoutMs: 60_000 });
  const workerRestart = runCommand('systemctl', ['restart', 'exam-planner-worker'], { timeoutMs: 60_000 });
  writeJson(statePath, state);
  const recovered = webRestart.status === 0 && workerRestart.status === 0
    ? await waitForHealthyImpl(validationOptions)
    : validation;
  if (recovered.ok) {
    state.failureCount = 0;
    state.lastHealthyAt = new Date(now()).toISOString();
    state.lastError = '';
    writeJson(statePath, state);
  }
  return { action, recovered: recovered.ok, ...recovered };
}

async function main() {
  const result = await runRuntimeWatchdog({ checkOnly: process.argv.includes('--check-only') });
  console.log(JSON.stringify({ event: 'runtime_watchdog', at: new Date().toISOString(), ...result }));
  if (!result.ok && process.argv.includes('--check-only')) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
