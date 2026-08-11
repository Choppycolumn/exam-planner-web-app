import { describe, expect, it } from 'vitest';
import { createApplicationContext } from './application-context.mjs';

describe('application context', () => {
  it('does not inspect installer source code at runtime', () => {
    expect(createApplicationContext.toString()).not.toContain('Function.prototype.toString');
    expect(createApplicationContext.toString()).not.toContain('matchAll');
  });

  it('gives each domain only its explicitly declared capabilities', () => {
    const { exposeRuntime, installDomain, runtime } = createApplicationContext({
      domainDependencies: { example: ['allowed'] },
    });
    exposeRuntime({ allowed: () => 42, secret: () => 'hidden' });
    let received;
    function installExample(runtime) {
      received = runtime.allowed;
    }
    installDomain('example', installExample);
    expect(received).toBe(42);
    expect(runtime.domainCapabilities.example).toEqual(['allowed']);
    expect(() => runtime.secret).not.toThrow();
  });

  it('rejects undeclared dynamic access', () => {
    const { exposeRuntime, installDomain } = createApplicationContext({
      domainDependencies: { example: ['allowed'] },
    });
    exposeRuntime({ allowed: () => 42, secret: () => 'hidden' });
    function installExample(runtime) {
      const property = ['sec', 'ret'].join('');
      return runtime[property];
    }
    expect(() => installDomain('example', installExample)).toThrow(/undeclared runtime capability/);
  });

  it('rejects domains without an explicit dependency manifest', () => {
    const { installDomain } = createApplicationContext();
    expect(() => installDomain('unknown', () => {})).toThrow(/Missing explicit dependency manifest/);
  });
});
