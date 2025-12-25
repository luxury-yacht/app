/**
 * frontend/src/core/refresh/fallbacks/objectLogFallbackManager.test.ts
 *
 * Test suite for objectLogFallbackManager.
 * Covers key behaviors and edge cases for objectLogFallbackManager.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const setup = async () => {
  vi.resetModules();

  const enable = vi.fn();
  const disable = vi.fn();
  const unsubscribe = vi.fn();
  let subscriptionHandler: (() => Promise<void> | void) | null = null;

  vi.doMock('../RefreshManager', () => ({
    refreshManager: {
      enable,
      disable,
      subscribe: vi.fn((_refresher: string, handler: () => Promise<void> | void) => {
        subscriptionHandler = handler;
        return unsubscribe;
      }),
    },
  }));

  const mod = await import('./objectLogFallbackManager');
  const manager = mod.objectLogFallbackManager;

  return {
    manager,
    enable,
    disable,
    unsubscribe,
    triggerRefresh: async () => {
      if (subscriptionHandler) {
        await subscriptionHandler();
      }
    },
  };
};

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('objectLogFallbackManager', () => {
  it('registers fetchers and enables auto refresh', async () => {
    const { manager, enable, triggerRefresh } = await setup();
    const fetcher = vi.fn();

    manager.register(' demo ', fetcher, true);

    expect(enable).toHaveBeenCalled();

    await triggerRefresh();
    expect(fetcher).toHaveBeenCalledWith(false);
  });

  it('updates existing entries and disables when auto refresh turns off', async () => {
    const { manager, enable, disable } = await setup();
    const fetcher = vi.fn();

    manager.register('demo', fetcher, true);
    expect(enable).toHaveBeenCalledTimes(1);

    manager.update('demo', { autoRefresh: false });
    expect(disable).toHaveBeenCalled();

    const replacement = vi.fn();
    manager.update('demo', { fetcher: replacement });
    await manager.refreshNow('demo');
    expect(replacement).toHaveBeenCalledWith(true);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('skips refresh when already in flight', async () => {
    const { manager } = await setup();
    const fetcher = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    manager.register('demo', fetcher, true);

    const first = manager.refreshNow('demo');
    const second = manager.refreshNow('demo');

    await first;
    await second;

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('unregisters entries and tears down subscription', async () => {
    const { manager, disable, unsubscribe } = await setup();
    const fetcher = vi.fn();

    manager.register('demo', fetcher, false);
    manager.unregister('demo');

    expect(disable).toHaveBeenCalled();
    expect(unsubscribe).toHaveBeenCalled();
  });

  it('ignores blank scopes', async () => {
    const { manager, enable } = await setup();
    manager.register('   ', vi.fn(), true);
    expect(enable).not.toHaveBeenCalled();
  });
});
