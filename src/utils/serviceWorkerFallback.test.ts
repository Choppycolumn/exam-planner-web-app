/// <reference types="node" />

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('PWA navigation fallback', () => {
  const source = readFileSync(resolve(process.cwd(), 'public/service-worker.js'), 'utf8');

  it('keeps the latest valid application shell for transient server outages', () => {
    expect(source).toContain("await cache.put('/', response.clone())");
    expect(source).toContain("const cached = await caches.match('/')");
  });

  it('uses a localized auto-reconnecting fallback instead of the old dead-end page', () => {
    expect(source).toContain('网站暂时无法连接');
    expect(source).toContain("fetch('/health'");
    expect(source).not.toContain('Reconnect and refresh this page.');
  });
});
