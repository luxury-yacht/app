/**
 * frontend/src/core/refresh/hooks/useRefreshHooks.test.tsx
 *
 * Test suite for useRefreshHooks.
 * Covers key behaviors and edge cases for useRefreshHooks.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RefreshCallback, RefreshContext, RefresherState, Refresher } from '../RefreshManager';
import type { RefresherName } from '../refresherTypes';
import { useRefreshContext } from './useRefreshContext';
import { useRefreshManager } from './useRefreshManager';
import { useRefreshWatcher } from './useRefreshWatcher';
import { eventBus } from '@/core/events';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

type RefreshManagerLike = {
  register: (refresher: Refresher) => void;
  unregister: (name: RefresherName) => void;
  triggerManualRefresh: (name: RefresherName) => Promise<void>;
  triggerManualRefreshForContext: (context?: RefreshContext) => Promise<void>;
  pause: (name?: RefresherName) => void;
  resume: (name?: RefresherName) => void;
  getState: (name: RefresherName) => RefresherState | null;
  subscribe: (name: RefresherName, callback: RefreshCallback) => () => void;
};

const subscriptions = new Map<RefresherName, RefreshCallback>();

const registerMock = vi.fn<(refresher: Refresher) => void>();
const unregisterMock = vi.fn<(name: RefresherName) => void>();
const triggerManualRefreshMock = vi
  .fn<(name: RefresherName) => Promise<void>>()
  .mockResolvedValue(undefined);
const triggerManualRefreshForContextMock = vi
  .fn<(context?: RefreshContext) => Promise<void>>()
  .mockResolvedValue(undefined);
const pauseMock = vi.fn<(name?: RefresherName) => void>();
const resumeMock = vi.fn<(name?: RefresherName) => void>();
const getStateMock = vi.fn<(name: RefresherName) => RefresherState | null>();
const subscribeMock = vi.fn<RefreshManagerLike['subscribe']>((name, callback) => {
  subscriptions.set(name, callback);
  return () => subscriptions.delete(name);
});

const mockManager: RefreshManagerLike = {
  register: registerMock,
  unregister: unregisterMock,
  triggerManualRefresh: triggerManualRefreshMock,
  triggerManualRefreshForContext: triggerManualRefreshForContextMock,
  pause: pauseMock,
  resume: resumeMock,
  getState: getStateMock,
  subscribe: subscribeMock,
};

const updateContextMock = vi.fn();
const REFRESHER_NAME = 'unified-pods' as RefresherName;

vi.mock('../contexts/RefreshManagerContext', () => ({
  useRefreshManagerContext: () => ({ manager: mockManager }),
}));

vi.mock('../orchestrator', () => ({
  refreshOrchestrator: {
    updateContext: (...args: unknown[]) => updateContextMock(...args),
  },
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

describe('useRefreshContext', () => {
  beforeEach(() => {
    updateContextMock.mockReset();
  });

  it('delegates to refresh orchestrator', () => {
    const context: Partial<RefreshContext> = {
      currentView: 'namespace',
      selectedNamespace: 'test',
      objectPanel: {
        isOpen: true,
        objectKind: 'Pod',
        objectName: 'pod-1',
        objectNamespace: 'test',
      },
    };

    const TestComponent: React.FC = () => {
      const { updateContext } = useRefreshContext();
      updateContext(context);
      return null;
    };

    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    act(() => {
      root.render(<TestComponent />);
    });

    expect(updateContextMock).toHaveBeenCalledWith(context);

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});

describe('useRefreshManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    triggerManualRefreshMock.mockResolvedValue(undefined);
    triggerManualRefreshForContextMock.mockResolvedValue(undefined);
  });

  it('exposes manager operations', async () => {
    const hook = await renderHook(() => useRefreshManager(), {});

    const state: RefresherState = {
      status: 'idle',
      lastRefreshTime: null,
      nextRefreshTime: null,
      error: null,
      consecutiveErrors: 0,
    };

    getStateMock.mockReturnValue(state);

    const refresher: Refresher = {
      name: REFRESHER_NAME,
      interval: 1000,
      cooldown: 250,
      timeout: 5,
      enabled: true,
    };

    hook.current.register(refresher);
    expect(registerMock).toHaveBeenCalledWith(refresher);

    hook.current.unregister(REFRESHER_NAME);
    expect(unregisterMock).toHaveBeenCalledWith(REFRESHER_NAME);

    await hook.current.triggerManualRefresh(REFRESHER_NAME);
    expect(triggerManualRefreshMock).toHaveBeenCalledWith(REFRESHER_NAME);

    const refreshContext: RefreshContext = {
      currentView: 'namespace',
      objectPanel: { isOpen: false },
    };
    await hook.current.triggerManualRefreshForContext(refreshContext);
    expect(triggerManualRefreshForContextMock).toHaveBeenCalledWith(refreshContext);

    hook.current.pause(REFRESHER_NAME);
    expect(pauseMock).toHaveBeenCalledWith(REFRESHER_NAME);

    hook.current.resume();
    expect(resumeMock).toHaveBeenCalledWith(undefined);

    const returnedState = hook.current.getState(REFRESHER_NAME);
    expect(returnedState).toBe(state);

    await hook.unmount();
  });
});

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
      await subscription!(false, abortController.signal);
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
