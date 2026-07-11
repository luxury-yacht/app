/**
 * frontend/src/core/contexts/AuthErrorContext.test.tsx
 *
 * Test suite for AuthErrorContext.
 * Validates that Wails event listeners use per-listener disposers for cleanup,
 * preventing duplicate handlers on StrictMode remount.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import {
  createWailsRuntimeHarness,
  type WailsRuntimeHarness,
} from '@/test-utils/wailsRuntimeHarness';
import { installWindowProperty } from '@/test-utils/windowProperty';

import {
  AuthErrorProvider,
  applyAuthFailedEvent,
  applyAuthProgressEvent,
  applyAuthRecoveringEvent,
  type ClusterAuthState,
  isConfirmedAuthFailure,
  useAuthError,
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

  let runtimeHarness: WailsRuntimeHarness;
  let restoreRuntime: () => void;

  const Harness = () => {
    stateRef.current = useAuthError();
    return null;
  };

  beforeEach(() => {
    runtimeHarness = createWailsRuntimeHarness();
    restoreRuntime = installWindowProperty('runtime', runtimeHarness.runtime);

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
    restoreRuntime();
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
    expect(runtimeHarness.listenerCount('cluster:auth:failed')).toBe(1);
    expect(runtimeHarness.listenerCount('cluster:auth:recovering')).toBe(1);
    expect(runtimeHarness.listenerCount('cluster:auth:recovered')).toBe(1);
    expect(runtimeHarness.listenerCount('cluster:auth:progress')).toBe(1);

    // Unmount — should call all 4 disposers
    act(() => {
      root.unmount();
    });

    expect(runtimeHarness.disposerCalls).toHaveLength(4);
    expect(runtimeHarness.disposerCalls).toContain('cluster:auth:failed');
    expect(runtimeHarness.disposerCalls).toContain('cluster:auth:recovering');
    expect(runtimeHarness.disposerCalls).toContain('cluster:auth:recovered');
    expect(runtimeHarness.disposerCalls).toContain('cluster:auth:progress');

    // All listeners should be removed
    expect(runtimeHarness.listenerCount('cluster:auth:failed')).toBe(0);
    expect(runtimeHarness.listenerCount('cluster:auth:recovering')).toBe(0);
    expect(runtimeHarness.listenerCount('cluster:auth:recovered')).toBe(0);
    expect(runtimeHarness.listenerCount('cluster:auth:progress')).toBe(0);

    // Re-create root so afterEach unmount doesn't fail
    root = ReactDOM.createRoot(container);
  });

  it('does not accumulate duplicate listeners across mount/unmount cycles', async () => {
    // First mount
    await renderProvider();
    expect(runtimeHarness.listenerCount('cluster:auth:failed')).toBe(1);

    // Unmount
    act(() => {
      root.unmount();
    });
    expect(runtimeHarness.listenerCount('cluster:auth:failed')).toBe(0);

    // Second mount — should have exactly 1 listener, not 2
    root = ReactDOM.createRoot(container);
    await renderProvider();
    expect(runtimeHarness.listenerCount('cluster:auth:failed')).toBe(1);
    expect(runtimeHarness.listenerCount('cluster:auth:recovering')).toBe(1);
    expect(runtimeHarness.listenerCount('cluster:auth:recovered')).toBe(1);
    expect(runtimeHarness.listenerCount('cluster:auth:progress')).toBe(1);
  });

  it('handles auth:failed event and updates cluster state', async () => {
    await renderProvider();

    // Simulate a backend auth:failed event
    act(() => {
      runtimeHarness.emit('cluster:auth:failed', {
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
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await renderProvider();

    act(() => {
      runtimeHarness.emit('cluster:auth:failed', {
        clusterId: 'cluster-1',
        clusterName: 'test-cluster',
        reason: 'token expired',
      });
      runtimeHarness.emit('cluster:auth:failed', {
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
  const requireClusterState = (states: Map<string, ClusterAuthState>): ClusterAuthState =>
    requireValue(states.get('c1'), 'Expected auth state for cluster c1');

  it('marks a terminal failure as a confirmed auth verdict', () => {
    const next = applyAuthFailedEvent(empty(), {
      clusterId: 'c1',
      clusterName: 'alpha',
      reason: 'token expired',
    });

    const state = requireClusterState(next);
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

    const state = requireClusterState(next);
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

    const state = requireClusterState(map);
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

    expect(isConfirmedAuthFailure(requireClusterState(map))).toBe(true);
  });

  it('carries the exec command, kind, and summary from a failed event', () => {
    const next = applyAuthFailedEvent(empty(), {
      clusterId: 'c1',
      reason: 'exec: executable gke-gcloud-auth-plugin not found',
      kind: 'missing-helper',
      summary: "The kubeconfig's credential helper could not be found.",
      execCommand: 'gke-gcloud-auth-plugin',
    });

    const state = requireClusterState(next);
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

    expect(requireClusterState(next).execCommand).toBe('aws');
  });

  it('keeps the exec command sticky across a progress event without one', () => {
    let map = applyAuthRecoveringEvent(empty(), {
      clusterId: 'c1',
      reason: 'missing helper',
      execCommand: 'gke-gcloud-auth-plugin',
    });
    map = applyAuthProgressEvent(map, { clusterId: 'c1', secondsUntilRetry: 5 });

    expect(requireClusterState(map).execCommand).toBe('gke-gcloud-auth-plugin');
  });

  it('adopts the exec command from a progress event that carries one', () => {
    let map = applyAuthRecoveringEvent(empty(), { clusterId: 'c1', reason: 'x' });
    map = applyAuthProgressEvent(map, {
      clusterId: 'c1',
      secondsUntilRetry: 5,
      execCommand: 'aws',
    });

    expect(requireClusterState(map).execCommand).toBe('aws');
  });

  it('keeps the previous verdict when a progress event has no verdict yet', () => {
    let map = applyAuthFailedEvent(empty(), { clusterId: 'c1', reason: 'expired' });
    map = applyAuthRecoveringEvent(map, { clusterId: 'c1' });
    map = applyAuthProgressEvent(map, {
      clusterId: 'c1',
      secondsUntilRetry: 0,
      errorClass: '',
    });

    const state = requireClusterState(map);
    expect(state.errorClass).toBe('auth');
    expect(isConfirmedAuthFailure(state)).toBe(true);
  });

  it('keeps the auth verdict across an automatic retry (no overlay flicker)', () => {
    let map = applyAuthFailedEvent(empty(), { clusterId: 'c1', reason: 'expired' });
    map = applyAuthRecoveringEvent(map, { clusterId: 'c1', reason: 'expired' });

    const state = requireClusterState(map);
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

    expect(isConfirmedAuthFailure(requireClusterState(map))).toBe(false);
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
