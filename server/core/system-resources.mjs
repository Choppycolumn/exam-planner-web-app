import { readFileSync } from 'node:fs';
import { cpus, freemem, loadavg } from 'node:os';

export function availableMemoryBytes() {
  if (process.platform === 'linux') {
    try {
      const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(readFileSync('/proc/meminfo', 'utf8'));
      if (match) return Number(match[1]) * 1024;
    } catch {
      // Fall back to the portable OS value.
    }
  }
  return freemem();
}

export function readSystemResources() {
  return {
    availableMemoryBytes: availableMemoryBytes(),
    loadAverage: loadavg(),
    cpuCount: cpus().length,
  };
}
