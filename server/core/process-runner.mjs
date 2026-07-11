import { spawn } from 'node:child_process';

export function runProcess(command, args = [], {
  timeoutMs = 15_000,
  maxBuffer = 4 * 1024 * 1024,
  input = '',
  env = process.env,
  detached = process.platform !== 'win32',
} = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { env, detached, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout, stderr });
    };
    const append = (current, chunk) => `${current}${chunk.toString('utf8')}`.slice(-maxBuffer);
    child.stdout.on('data', (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on('data', (chunk) => { stderr = append(stderr, chunk); });
    child.on('error', (error) => finish({ ok: false, code: -1, error }));
    child.on('close', (code) => finish({ ok: code === 0, code: code ?? -1, error: null }));
    const timer = setTimeout(() => {
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL');
        else child.kill('SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
      finish({ ok: false, code: -1, error: new Error(`${command} timed out after ${timeoutMs}ms`) });
    }, timeoutMs);
    timer.unref?.();
    child.stdin.end(input);
  });
}
