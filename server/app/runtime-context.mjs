export const runtime = Object.create(null);

export function exposeRuntime(readers, writers = {}) {
  const descriptors = Object.fromEntries(Object.entries(readers).map(([name, read]) => [name, {
    configurable: true,
    enumerable: true,
    get: read,
    set: writers[name],
  }]));
  Object.defineProperties(runtime, descriptors);
}
