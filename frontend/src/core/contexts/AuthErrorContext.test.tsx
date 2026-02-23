/**
 * frontend/src/core/contexts/AuthErrorContext.test.tsx
 *
 * Test suite for AuthErrorContext.
 * Validates that Wails event listeners use per-listener disposers for cleanup,
 * preventing duplicate handlers on StrictMode remount.
 */
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthErrorProvider, useAuthError } from './AuthErrorContext';

// Mock @wailsjs/go/backend/App — provider calls these on mount
vi.mock('@wailsjs/go/backend/App', () => ({
  RetryClusterAuth: vi.fn(),
  GetAllClusterAuthStates: vi.fn().mockResolvedValue(null),
}));

// Mock the eventBus so auth events don't propagate
vi.mock('@/core/events', () => ({
  eventBus: { emit: vi.fn() },
}));

describe('AuthErrorContext', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const stateRef: { current: ReturnType<typeof useAuthError> | null } = { current: null };

  // Track registered listeners and their disposers
  let listeners: Map<string, Array<(...args: unknown[]) => void>>;
  let disposerCalls: string[];

  const Harness = () => {
    stateRef.current = useAuthError();
    return null;
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    listeners = new Map();
    disposerCalls = [];

    // Mock window.runtime with an EventsOn that tracks registrations
    // and returns a disposer that removes the specific listener.
    (window as any).runtime = {
      EventsOn: vi.fn((eventName: string, callback: (...args: unknown[]) => void) => {
        if (!listeners.has(eventName)) {
          listeners.set(eventName, []);
        }
        listeners.get(eventName)!.push(callback);

        // Return a disposer that removes this specific callback
        return () => {
          disposerCalls.push(eventName);
          const cbs = listeners.get(eventName);
          if (cbs) {
            const idx = cbs.indexOf(callback);
            if (idx >= 0) cbs.splice(idx, 1);
          }
        };
      }),
    };

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    stateRef.current = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete (window as any).runtime;
  });

  const renderProvider = async () => {
    await act(async () => {
      root.render(
        <AuthErrorProvider>
          <Harness />
        </AuthErrorProvider>
      );
      await Promise.resolve();
    });
  };

  it('calls per-listener disposers on unmount instead of EventsOff', async () => {
    await renderProvider();

    // Verify 4 event listeners were registered
    expect(listeners.get('cluster:auth:failed')?.length).toBe(1);
    expect(listeners.get('cluster:auth:recovering')?.length).toBe(1);
    expect(listeners.get('cluster:auth:recovered')?.length).toBe(1);
    expect(listeners.get('cluster:auth:progress')?.length).toBe(1);

    // Unmount — should call all 4 disposers
    act(() => {
      root.unmount();
    });

    expect(disposerCalls).toHaveLength(4);
    expect(disposerCalls).toContain('cluster:auth:failed');
    expect(disposerCalls).toContain('cluster:auth:recovering');
    expect(disposerCalls).toContain('cluster:auth:recovered');
    expect(disposerCalls).toContain('cluster:auth:progress');

    // All listeners should be removed
    expect(listeners.get('cluster:auth:failed')?.length).toBe(0);
    expect(listeners.get('cluster:auth:recovering')?.length).toBe(0);
    expect(listeners.get('cluster:auth:recovered')?.length).toBe(0);
    expect(listeners.get('cluster:auth:progress')?.length).toBe(0);

    // Re-create root so afterEach unmount doesn't fail
    root = ReactDOM.createRoot(container);
  });

  it('does not accumulate duplicate listeners across mount/unmount cycles', async () => {
    // First mount
    await renderProvider();
    expect(listeners.get('cluster:auth:failed')?.length).toBe(1);

    // Unmount
    act(() => {
      root.unmount();
    });
    expect(listeners.get('cluster:auth:failed')?.length).toBe(0);

    // Second mount — should have exactly 1 listener, not 2
    root = ReactDOM.createRoot(container);
    await renderProvider();
    expect(listeners.get('cluster:auth:failed')?.length).toBe(1);
    expect(listeners.get('cluster:auth:recovering')?.length).toBe(1);
    expect(listeners.get('cluster:auth:recovered')?.length).toBe(1);
    expect(listeners.get('cluster:auth:progress')?.length).toBe(1);
  });

  it('handles auth:failed event and updates cluster state', async () => {
    await renderProvider();

    // Simulate a backend auth:failed event
    const failedHandlers = listeners.get('cluster:auth:failed')!;
    act(() => {
      failedHandlers[0]({ clusterId: 'cluster-1', clusterName: 'test-cluster', reason: 'token expired' });
    });

    const state = stateRef.current?.getClusterAuthState('cluster-1');
    expect(state?.hasError).toBe(true);
    expect(state?.reason).toBe('token expired');
    expect(state?.clusterName).toBe('test-cluster');
  });
});
