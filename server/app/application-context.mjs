export function createApplicationContext() {
  const runtime = Object.create(null);
  const domainCapabilities = new Map();

  function exposeRuntime(readers, writers = {}) {
    const descriptors = Object.fromEntries(Object.entries(readers).map(([name, read]) => [name, {
      configurable: true,
      enumerable: true,
      get: read,
      set: writers[name],
    }]));
    Object.defineProperties(runtime, descriptors);
  }

  function createDomainContext(domainName, installer) {
    const source = Function.prototype.toString.call(installer);
    const allowed = new Set(Array.from(source.matchAll(/\bruntime\.([A-Za-z_$][\w$]*)/g), (match) => match[1]));
    for (const dependency of installer.dependencies || []) allowed.add(dependency);
    domainCapabilities.set(domainName, [...allowed].sort());
    return new Proxy(Object.create(null), {
      get(_target, property) {
        if (typeof property === 'symbol') return undefined;
        if (!allowed.has(property)) throw new Error(`${domainName} attempted to read undeclared runtime capability: ${property}`);
        return runtime[property];
      },
      set(_target, property, value) {
        if (!allowed.has(property)) throw new Error(`${domainName} attempted to write undeclared runtime capability: ${property}`);
        runtime[property] = value;
        return true;
      },
      has(_target, property) {
        return typeof property === 'string' && allowed.has(property);
      },
      ownKeys() {
        return [...allowed];
      },
      getOwnPropertyDescriptor(_target, property) {
        return allowed.has(property) ? { enumerable: true, configurable: true } : undefined;
      },
    });
  }

  function installDomain(domainName, installer) {
    return installer(createDomainContext(domainName, installer), exposeRuntime);
  }

  exposeRuntime({ domainCapabilities: () => Object.fromEntries(domainCapabilities) });
  return { runtime, exposeRuntime, installDomain };
}
