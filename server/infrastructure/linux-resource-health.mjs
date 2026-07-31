import { readFileSync, readdirSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';

export function parseCpuStat(text) {
  const line = String(text || '').split(/\r?\n/).find((item) => /^cpu\s/.test(item));
  if (!line) return null;
  const values = line.trim().split(/\s+/).slice(1).map(Number);
  if (values.length < 5 || values.some((value) => !Number.isFinite(value))) return null;
  return {
    total: values.reduce((sum, value) => sum + value, 0),
    iowait: values[4] || 0,
  };
}

export function calculateIowaitPercent(previous, current) {
  if (!previous || !current) return null;
  const totalDelta = current.total - previous.total;
  const iowaitDelta = current.iowait - previous.iowait;
  if (totalDelta <= 0 || iowaitDelta < 0) return null;
  return Math.round((iowaitDelta / totalDelta) * 10_000) / 100;
}

export function parseIoPressure(text) {
  const line = String(text || '').split(/\r?\n/).find((item) => item.startsWith('some '));
  if (!line) return null;
  const values = Object.fromEntries(
    line.split(/\s+/).slice(1).map((field) => field.split('=', 2)),
  );
  const avg10 = Number(values.avg10);
  const avg60 = Number(values.avg60);
  const avg300 = Number(values.avg300);
  return [avg10, avg60, avg300].every(Number.isFinite) ? { avg10, avg60, avg300 } : null;
}

export function parseProcState(text) {
  const match = /^\d+\s+\(.+\)\s+([A-Z])\s/.exec(String(text || '').trim());
  return match?.[1] || '';
}

function healthLevel({ iowaitPercent, ioPressure, blockedProcessCount, loadPerCpu }) {
  if (
    (iowaitPercent !== null && iowaitPercent >= 60)
    || Number(ioPressure?.avg10 || 0) >= 35
    || blockedProcessCount >= 3
    || loadPerCpu >= 4
  ) return 'failed';
  if (
    (iowaitPercent !== null && iowaitPercent >= 20)
    || Number(ioPressure?.avg10 || 0) >= 8
    || blockedProcessCount > 0
    || loadPerCpu >= 1.75
  ) return 'degraded';
  return 'normal';
}

export function createLinuxResourceHealth({
  platform = process.platform,
  procRoot = '/proc',
  readFile = (path) => readFileSync(path, 'utf8'),
  readDirectory = (path) => readdirSync(path, { withFileTypes: true }),
  readLoadAverage = loadavg,
  cpuCount = () => cpus().length,
} = {}) {
  let previousCpu = null;

  function snapshot() {
    if (platform !== 'linux') {
      return {
        available: false,
        status: 'normal',
        iowaitPercent: null,
        ioPressure: null,
        blockedProcessCount: 0,
        blockedProcessIds: [],
        loadPerCpu: 0,
        action: '',
      };
    }

    let currentCpu = null;
    let ioPressure = null;
    const blockedProcessIds = [];
    try { currentCpu = parseCpuStat(readFile(`${procRoot}/stat`)); } catch { /* optional */ }
    try { ioPressure = parseIoPressure(readFile(`${procRoot}/pressure/io`)); } catch { /* optional */ }
    try {
      for (const entry of readDirectory(procRoot)) {
        if (!/^\d+$/.test(entry.name) || (typeof entry.isDirectory === 'function' && !entry.isDirectory())) continue;
        try {
          if (parseProcState(readFile(`${procRoot}/${entry.name}/stat`)) === 'D') {
            blockedProcessIds.push(Number(entry.name));
            if (blockedProcessIds.length >= 20) break;
          }
        } catch {
          // Processes may disappear while /proc is being inspected.
        }
      }
    } catch {
      // Keep the remaining resource checks available on restricted systems.
    }

    const iowaitPercent = calculateIowaitPercent(previousCpu, currentCpu);
    if (currentCpu) previousCpu = currentCpu;
    const cores = Math.max(1, Number(cpuCount()) || 1);
    const loadPerCpu = Math.round((Number(readLoadAverage()?.[0] || 0) / cores) * 100) / 100;
    const status = healthLevel({
      iowaitPercent,
      ioPressure,
      blockedProcessCount: blockedProcessIds.length,
      loadPerCpu,
    });

    return {
      available: true,
      status,
      iowaitPercent,
      ioPressure,
      blockedProcessCount: blockedProcessIds.length,
      blockedProcessIds,
      loadPerCpu,
      action: status === 'normal'
        ? ''
        : '暂停 HBR 等重 I/O 任务，确认磁盘等待和 D 状态进程恢复后再继续。',
    };
  }

  return { snapshot };
}
