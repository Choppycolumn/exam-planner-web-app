import { describe, expect, it, vi } from 'vitest';
import { createGracefulShutdown } from './graceful-shutdown.mjs';

describe('graceful shutdown', () => {
  it('closes idle connections and exits cleanly when the server drains', () => {
    let closed;
    const server = {
      close: vi.fn((callback) => { closed = callback; }),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
    };
    const exit = vi.fn();
    const closeResources = vi.fn();
    const controller = createGracefulShutdown({
      server,
      stopBackgroundWork: vi.fn(),
      closeResources,
      exit,
      scheduleTimeout: vi.fn(() => ({ unref: vi.fn() })),
    });

    controller.shutdown('SIGTERM');
    closed();

    expect(server.closeIdleConnections).toHaveBeenCalledOnce();
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(closeResources).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('force-closes lingering connections but still reports a controlled exit', () => {
    let timeout;
    const server = {
      close: vi.fn(),
      closeIdleConnections: vi.fn(),
      closeAllConnections: vi.fn(),
    };
    const exit = vi.fn();
    const log = vi.fn();
    const controller = createGracefulShutdown({
      server,
      exit,
      log,
      scheduleTimeout: (callback) => {
        timeout = callback;
        return { unref: vi.fn() };
      },
    });

    controller.shutdown('SIGTERM');
    timeout();

    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith('warn', 'server_shutdown_connections_closed', { signal: 'SIGTERM' });
    expect(exit).toHaveBeenCalledWith(0);
  });
});
