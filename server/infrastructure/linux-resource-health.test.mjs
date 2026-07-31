import { describe, expect, it } from 'vitest';
import {
  calculateIowaitPercent,
  createLinuxResourceHealth,
  parseCpuStat,
  parseIoPressure,
  parseProcState,
} from './linux-resource-health.mjs';

describe('linux resource health', () => {
  it('parses CPU, PSI and process state data', () => {
    expect(parseCpuStat('cpu  100 2 30 800 68 0 0 0 0 0\n')).toEqual({ total: 1000, iowait: 68 });
    expect(parseIoPressure('some avg10=12.50 avg60=4.20 avg300=1.00 total=10\n')).toEqual({
      avg10: 12.5,
      avg60: 4.2,
      avg300: 1,
    });
    expect(parseProcState('123 (backup worker) D 1 2 3')).toBe('D');
  });

  it('calculates iowait from deltas instead of cumulative boot counters', () => {
    expect(calculateIowaitPercent(
      { total: 1000, iowait: 50 },
      { total: 1200, iowait: 90 },
    )).toBe(20);
  });

  it('marks blocked I/O as an actionable degradation without leaking commands', () => {
    let cpuRead = 0;
    const files = {
      '/proc/pressure/io': 'some avg10=9.00 avg60=3.00 avg300=1.00 total=10\n',
      '/proc/101/stat': '101 (hbr client) D 1 2 3',
    };
    const monitor = createLinuxResourceHealth({
      platform: 'linux',
      readFile: (path) => path === '/proc/stat'
        ? (cpuRead++ ? 'cpu  120 0 30 820 30 0 0 0\n' : 'cpu  100 0 20 760 20 0 0 0\n')
        : files[path],
      readDirectory: () => [{ name: '101', isDirectory: () => true }],
      readLoadAverage: () => [0.5, 0.4, 0.3],
      cpuCount: () => 2,
    });
    monitor.snapshot();
    const result = monitor.snapshot();
    expect(result.status).toBe('degraded');
    expect(result.blockedProcessCount).toBe(1);
    expect(result.action).toContain('重 I/O');
  });
});
