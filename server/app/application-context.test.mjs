import { describe, expect, it } from 'vitest';
import { createApplicationContext } from './application-context.mjs';

describe('application context', () => {
  it('gives each domain only the capabilities referenced by its installer', () => {
    const { exposeRuntime, installDomain, runtime } = createApplicationContext();
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
    const { exposeRuntime, installDomain } = createApplicationContext();
    exposeRuntime({ allowed: () => 42, secret: () => 'hidden' });
    function installExample(runtime) {
      const property = ['sec', 'ret'].join('');
      return runtime[property];
    }
    expect(() => installDomain('example', installExample)).toThrow(/undeclared runtime capability/);
  });
});
