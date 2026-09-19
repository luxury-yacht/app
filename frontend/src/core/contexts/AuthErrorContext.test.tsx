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
import type { DesktopEventHandler, DesktopEventName } from '@/core/desktop-runtime';
import {
  createWailsRuntimeHarness,
  type WailsRuntimeHarness,
} from '@/test-utils/wailsRuntimeHarness';

const runtimeHarnessRef = vi.hoisted(() => ({
  current: null as WailsRuntimeHarness | null,
}));

vi.mock('@/core/desktop-runtime', () => ({
  onEvent: <E extends DesktopEventName>(eventName: E, handler: DesktopEventHandler<E>) =>
    runtimeHarnessRef.current?.onEvent(eventName, handler) ?? (() => undefined),
}));

import { AuthErrorProvider, useAuthError } from './AuthErrorContext';

// Mock @core/backend-api — provider calls these on mount
vi.mock('@core/backend-api', () => ({
  RetryClusterAuth: vi.fn(),
  GetClusterWorkspaceStateForWindow: vi.fn().mockResolvedValue({
    selectedKubeconfigs: [],
    visibleClusterId: '',
    clusters: {},
  }),
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

  const Harness = () => {
    stateRef.current = useAuthError();
    return null;
  };

  beforeEach(() => {
    runtimeHarness = createWailsRuntimeHarness();
    runtimeHarnessRef.current = runtimeHarness;

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
    runtimeHarnessRef.current = null;
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

  it('calls per-listener disposers on unmount', async () => {
    await renderProvider();

    // One workspace subscription owns all cluster-state event listeners.
    expect(runtimeHarness.listenerCount('cluster:auth:failed')).toBe(1);
    expect(runtimeHarness.listenerCount('cluster:auth:recovering')).toBe(1);
    expect(runtimeHarness.listenerCount('cluster:auth:recovered')).toBe(1);
    expect(runtimeHarness.listenerCount('cluster:auth:progress')).toBe(1);

    // Unmount disposes the workspace subscription.
    act(() => {
      root.unmount();
    });

    expect(runtimeHarness.disposerCalls).toHaveLength(9);
    expect(runtimeHarness.disposerCalls).toContain('cluster:permissions:changed');
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
