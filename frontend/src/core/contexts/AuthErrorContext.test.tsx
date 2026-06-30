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

import {
  AuthErrorProvider,
  applyAuthFailedEvent,
  applyAuthProgressEvent,
  applyAuthRecoveringEvent,
  isConfirmedAuthFailure,
  useAuthError,
  type ClusterAuthState,
} from './AuthErrorContext';

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
      failedHandlers[0]({
        clusterId: 'cluster-1',
        clusterName: 'test-cluster',
        reason: 'token expired',
      });
    });

    const state = stateRef.current?.getClusterAuthState('cluster-1');
    expect(state?.hasError).toBe(true);
    expect(state?.reason).toBe('token expired');
    expect(state?.clusterName).toBe('test-cluster');
  });

  it('does not log auth event payloads', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await renderProvider();

    act(() => {
      listeners.get('cluster:auth:failed')![0]({
        clusterId: 'cluster-1',
        clusterName: 'test-cluster',
        reason: 'token expired',
      });
      listeners.get('cluster:auth:failed')![0]({
        reason: 'sensitive auth provider details',
      });
    });

    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[AuthErrorContext] Received auth:failed without clusterId'
    );

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});

/**
 * The per-cluster error class (verdict) must be sticky — set by terminal
 * failures and probe results, never cleared by a recovering transition alone —
 * so the failure surface stays stable across automatic retries.
 */
describe('auth error state transitions', () => {
  const empty = () => new Map<string, ClusterAuthState>();

  it('marks a terminal failure as a confirmed auth verdict', () => {
    const next = applyAuthFailedEvent(empty(), {
      clusterId: 'c1',
      clusterName: 'alpha',
      reason: 'token expired',
    });

    const state = next.get('c1')!;
    expect(state.hasError).toBe(true);
    expect(state.errorClass).toBe('auth');
    expect(isConfirmedAuthFailure(state)).toBe(true);
  });

  it('does not confirm a fresh recovering cluster before any probe verdict', () => {
    const next = applyAuthRecoveringEvent(empty(), {
      clusterId: 'c1',
      clusterName: 'alpha',
      reason: '401 Unauthorized',
    });

    const state = next.get('c1')!;
    expect(state.hasError).toBe(true);
    expect(state.isRecovering).toBe(true);
    expect(state.errorClass).toBe('');
    expect(isConfirmedAuthFailure(state)).toBe(false);
  });

  it('keeps a connectivity verdict unconfirmed (cluster unreachable, waiting)', () => {
    let map = applyAuthRecoveringEvent(empty(), { clusterId: 'c1', reason: '401' });
    map = applyAuthProgressEvent(map, {
      clusterId: 'c1',
      secondsUntilRetry: 15,
      errorClass: 'connectivity',
    });

    const state = map.get('c1')!;
    expect(state.errorClass).toBe('connectivity');
    expect(isConfirmedAuthFailure(state)).toBe(false);
  });

  it('confirms an auth verdict reported by a probe', () => {
    let map = applyAuthRecoveringEvent(empty(), { clusterId: 'c1', reason: '401' });
    map = applyAuthProgressEvent(map, {
      clusterId: 'c1',
      secondsUntilRetry: 5,
      errorClass: 'auth',
    });

    expect(isConfirmedAuthFailure(map.get('c1')!)).toBe(true);
  });

  it('carries the exec command, kind, and summary from a failed event', () => {
    const next = applyAuthFailedEvent(empty(), {
      clusterId: 'c1',
      reason: 'exec: executable gke-gcloud-auth-plugin not found',
      kind: 'missing-helper',
      summary: "The kubeconfig's credential helper could not be found.",
      execCommand: 'gke-gcloud-auth-plugin',
    });

    const state = next.get('c1')!;
    expect(state.execCommand).toBe('gke-gcloud-auth-plugin');
    expect(state.diagnosticKind).toBe('missing-helper');
    expect(state.diagnosticSummary).toBe("The kubeconfig's credential helper could not be found.");
  });

  it('carries the exec command from a recovering event', () => {
    const next = applyAuthRecoveringEvent(empty(), {
      clusterId: 'c1',
      reason: 'exec: executable aws not found',
      execCommand: 'aws',
    });

    expect(next.get('c1')!.execCommand).toBe('aws');
  });

  it('keeps the exec command sticky across a progress event without one', () => {
    let map = applyAuthRecoveringEvent(empty(), {
      clusterId: 'c1',
      reason: 'missing helper',
      execCommand: 'gke-gcloud-auth-plugin',
    });
    map = applyAuthProgressEvent(map, { clusterId: 'c1', secondsUntilRetry: 5 });

    expect(map.get('c1')!.execCommand).toBe('gke-gcloud-auth-plugin');
  });

  it('adopts the exec command from a progress event that carries one', () => {
    let map = applyAuthRecoveringEvent(empty(), { clusterId: 'c1', reason: 'x' });
    map = applyAuthProgressEvent(map, {
      clusterId: 'c1',
      secondsUntilRetry: 5,
      execCommand: 'aws',
    });

    expect(map.get('c1')!.execCommand).toBe('aws');
  });

  it('keeps the previous verdict when a progress event has no verdict yet', () => {
    let map = applyAuthFailedEvent(empty(), { clusterId: 'c1', reason: 'expired' });
    map = applyAuthRecoveringEvent(map, { clusterId: 'c1' });
    map = applyAuthProgressEvent(map, {
      clusterId: 'c1',
      secondsUntilRetry: 0,
      errorClass: '',
    });

    const state = map.get('c1')!;
    expect(state.errorClass).toBe('auth');
    expect(isConfirmedAuthFailure(state)).toBe(true);
  });

  it('keeps the auth verdict across an automatic retry (no overlay flicker)', () => {
    let map = applyAuthFailedEvent(empty(), { clusterId: 'c1', reason: 'expired' });
    map = applyAuthRecoveringEvent(map, { clusterId: 'c1', reason: 'expired' });

    const state = map.get('c1')!;
    expect(state.isRecovering).toBe(true);
    expect(state.errorClass).toBe('auth');
    expect(isConfirmedAuthFailure(state)).toBe(true);
  });

  it('lets a connectivity probe verdict supersede an auth verdict', () => {
    // Credentials were bad, then the cluster became unreachable before they
    // were fixed: unreachable is a waiting state, not a confirmed failure.
    let map = applyAuthFailedEvent(empty(), { clusterId: 'c1', reason: 'expired' });
    map = applyAuthRecoveringEvent(map, { clusterId: 'c1' });
    map = applyAuthProgressEvent(map, {
      clusterId: 'c1',
      secondsUntilRetry: 15,
      errorClass: 'connectivity',
    });

    expect(isConfirmedAuthFailure(map.get('c1')!)).toBe(false);
  });

  it('ignores progress for clusters without an active error', () => {
    const map = applyAuthProgressEvent(empty(), {
      clusterId: 'c1',
      secondsUntilRetry: 0,
      errorClass: 'auth',
    });

    expect(map.size).toBe(0);
  });
});
