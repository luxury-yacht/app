/**
 * frontend/src/core/refresh/hooks/useRefreshHooks.test.tsx
 *
 * Test suite for useRefreshHooks.
 * Covers key behaviors and edge cases for useRefreshHooks.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { requireValue } from '@/test-utils/requireValue';
import type { RefreshCallback, RefresherState } from '../RefreshManager';
import type { RefresherName } from '../refresherTypes';
import { useRefreshWatcher } from './useRefreshWatcher';

type RefreshManagerLike = {
  triggerManualRefresh: (name: RefresherName) => Promise<void>;
  getState: (name: RefresherName) => RefresherState | null;
  subscribe: (name: RefresherName, callback: RefreshCallback) => () => void;
};

const subscriptions = new Map<RefresherName, RefreshCallback>();

const triggerManualRefreshMock = vi
  .fn<(name: RefresherName) => Promise<void>>()
  .mockResolvedValue(undefined);
const getStateMock = vi.fn<(name: RefresherName) => RefresherState | null>();
const subscribeMock = vi.fn<RefreshManagerLike['subscribe']>((name, callback) => {
  subscriptions.set(name, callback);
  return () => subscriptions.delete(name);
});

const mockManager: RefreshManagerLike = {
  triggerManualRefresh: triggerManualRefreshMock,
  getState: getStateMock,
  subscribe: subscribeMock,
};

const REFRESHER_NAME = 'unified-pods' as RefresherName;

vi.mock('../contexts/RefreshManagerContext', () => ({
  useRefreshManagerContext: () => ({ manager: mockManager }),
}));

const renderHook = async <TProps extends object, TResult>(
  hook: (props: TProps) => TResult,
  initialProps: TProps
) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const propsRef: { current: TProps } = { current: initialProps };
  const result: { current: TResult | null } = { current: null };

  const HookConsumer: React.FC<{ hookProps: TProps }> = ({ hookProps }) => {
    result.current = hook(hookProps);
    return null;
  };

  const render = async () => {
    await act(async () => {
      root.render(<HookConsumer hookProps={propsRef.current} />);
      await Promise.resolve();
    });
  };

  await render();

  return {
    get current(): TResult {
      if (!result.current) {
        throw new Error('Hook result not initialised');
      }
      return result.current;
    },
    async rerender(nextProps: TProps) {
      propsRef.current = nextProps;
      await render();
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('useRefreshWatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subscriptions.clear();
    getStateMock.mockReturnValue({
      status: 'idle',
      lastRefreshTime: null,
      nextRefreshTime: null,
      error: null,
      consecutiveErrors: 0,
    });
    triggerManualRefreshMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    subscriptions.clear();
  });

  it('subscribes and reacts to refresh events', async () => {
    const onRefresh = vi.fn();

    const hook = await renderHook(useRefreshWatcher, {
      refresherName: REFRESHER_NAME,
      onRefresh,
    });

    expect(subscribeMock).toHaveBeenCalledWith(REFRESHER_NAME, expect.any(Function));
    expect(hook.current.state?.status).toBe('idle');
    expect(hook.current.isRefreshing).toBe(false);

    const subscription = subscriptions.get(REFRESHER_NAME);
    expect(subscription).toBeTruthy();

    const abortController = new AbortController();
    await act(async () => {
      await requireValue(subscription, 'expected test value in useRefreshHooks.test.tsx')(
        false,
        abortController.signal
      );
    });

    expect(onRefresh).toHaveBeenCalledWith(false, abortController.signal);
    expect(hook.current.isRefreshing).toBe(false);

    await hook.current.triggerRefresh();
    expect(triggerManualRefreshMock).toHaveBeenCalledWith(REFRESHER_NAME);

    await hook.unmount();
  });

  it('updates state when refresher events fire', async () => {
    const hook = await renderHook(useRefreshWatcher, {
      refresherName: REFRESHER_NAME,
      onRefresh: vi.fn(),
    });

    const newState: RefresherState = {
      status: 'error',
      lastRefreshTime: new Date(123),
      nextRefreshTime: null,
      error: new Error('boom'),
      consecutiveErrors: 1,
    };

    await act(async () => {
      eventBus.emit('refresh:state-change', {
        name: REFRESHER_NAME,
        state: newState,
      });
      await Promise.resolve();
    });

    expect(hook.current.state?.status).toBe('error');

    await act(async () => {
      eventBus.emit('refresh:registered', { name: REFRESHER_NAME });
      await Promise.resolve();
    });

    expect(subscribeMock).toHaveBeenCalledTimes(2);

    await hook.unmount();
  });

  it('unsubscribes when disabled or refresher name missing', async () => {
    const hook = await renderHook(useRefreshWatcher, {
      refresherName: null,
      onRefresh: vi.fn(),
      enabled: false,
    });

    expect(subscribeMock).not.toHaveBeenCalled();
    expect(hook.current.state).toBeNull();

    await hook.unmount();
  });
});
