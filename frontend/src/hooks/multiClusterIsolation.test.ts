/**
 * frontend/src/hooks/multiClusterIsolation.test.ts
 *
 * Tests for multi-cluster isolation in frontend hooks.
 * Verifies that auth errors, health status, and filter state are tracked
 * independently per cluster without leaking between clusters.
 */

import ReactDOM from 'react-dom/client';
import React, { act } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { getPodsUnhealthyStorageKey } from '@modules/namespace/components/podsFilterSignals';
import { useAuthErrorHandler, ClusterAuthState } from './useAuthErrorHandler';
import { useClusterHealthListener, ClusterHealthStatus } from './useWailsRuntimeEvents';

/**
 * Type for capturing hook results for testing.
 */
interface AuthHookResult {
  clusterAuthErrors: Map<string, ClusterAuthState>;
  getClusterAuthState: (clusterId: string) => ClusterAuthState;
  getActiveClusterAuthState: () => ClusterAuthState;
  handleRetry: (clusterId: string) => Promise<void>;
}

interface HealthHookResult {
  clusterHealth: Map<string, ClusterHealthStatus>;
  getClusterHealth: (clusterId: string) => ClusterHealthStatus;
  getActiveClusterHealth: () => ClusterHealthStatus;
}

/**
 * Type for event handlers registered via window.runtime.EventsOn.
 */
type EventHandler = (...args: unknown[]) => void;

/**
 * Mock runtime interface matching Wails runtime structure.
 */
interface MockRuntime {
  EventsOn: ReturnType<typeof vi.fn>;
  EventsOff: ReturnType<typeof vi.fn>;
  handlers: Map<string, EventHandler>;
  emit: (event: string, payload: unknown) => void;
}

/**
 * Create a mock Wails runtime that captures event handlers.
 * Allows tests to emit events and verify hook behavior.
 */
function createMockRuntime(): MockRuntime {
  const handlers = new Map<string, EventHandler>();

  return {
    handlers,
    EventsOn: vi.fn((event: string, handler: EventHandler) => {
      handlers.set(event, handler);
    }),
    EventsOff: vi.fn((event: string) => {
      handlers.delete(event);
    }),
    emit: (event: string, payload: unknown) => {
      const handler = handlers.get(event);
      if (handler) {
        handler(payload);
      }
    },
  };
}

// Tests for pods filter isolation
describe('Pods Filter Isolation', () => {
  it('generates cluster-specific storage keys', () => {
    const keyA = getPodsUnhealthyStorageKey('cluster-a');
    const keyB = getPodsUnhealthyStorageKey('cluster-b');

    // Keys should include the cluster ID
    expect(keyA).toContain('cluster-a');
    expect(keyB).toContain('cluster-b');

    // Keys should be different for different clusters
    expect(keyA).not.toBe(keyB);
  });

  it('generates consistent keys for the same cluster', () => {
    const key1 = getPodsUnhealthyStorageKey('my-cluster');
    const key2 = getPodsUnhealthyStorageKey('my-cluster');

    expect(key1).toBe(key2);
  });
});

// Tests for auth error tracking per cluster
describe('Auth Error Handler Isolation', () => {
  let mockRuntime: MockRuntime;
  let originalRuntime: unknown;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mockRuntime = createMockRuntime();
    originalRuntime = (window as any).runtime;
    (window as any).runtime = mockRuntime;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (window as any).runtime = originalRuntime;
    // Clear document body using textContent (safe DOM method)
    document.body.textContent = '';
  });

  /**
   * Helper to render the useAuthErrorHandler hook and capture its result.
   */
  const renderAuthHook = async (
    activeClusterId: string = ''
  ): Promise<{
    getResult: () => AuthHookResult;
    unmount: () => void;
  }> => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    let hookResult: AuthHookResult | null = null;

    const HookHost = () => {
      const result = useAuthErrorHandler(activeClusterId);
      hookResult = result;
      return null;
    };

    await act(async () => {
      root.render(React.createElement(HookHost));
      await Promise.resolve();
    });

    return {
      getResult: () => hookResult!,
      unmount: () =>
        act(() => {
          root.unmount();
          container.remove();
        }),
    };
  };

  it('tracks auth errors per cluster independently', async () => {
    const { getResult, unmount } = await renderAuthHook();

    // Simulate auth failure for cluster-a
    await act(async () => {
      mockRuntime.emit('cluster:auth:failed', {
        clusterId: 'cluster-a',
        clusterName: 'Cluster A',
        reason: 'Token expired',
      });
      await Promise.resolve();
    });

    const result = getResult();

    // cluster-a should have an error
    const stateA = result.getClusterAuthState('cluster-a');
    expect(stateA.hasError).toBe(true);
    expect(stateA.reason).toBe('Token expired');
    expect(stateA.clusterName).toBe('Cluster A');

    // cluster-b should NOT have an error
    const stateB = result.getClusterAuthState('cluster-b');
    expect(stateB.hasError).toBe(false);
    expect(stateB.reason).toBe('');

    unmount();
  });

  it('clears auth error only for recovered cluster', async () => {
    const { getResult, unmount } = await renderAuthHook();

    // Simulate auth failure for both clusters
    await act(async () => {
      mockRuntime.emit('cluster:auth:failed', {
        clusterId: 'cluster-a',
        clusterName: 'Cluster A',
        reason: 'Token expired',
      });
      mockRuntime.emit('cluster:auth:failed', {
        clusterId: 'cluster-b',
        clusterName: 'Cluster B',
        reason: 'Certificate invalid',
      });
      await Promise.resolve();
    });

    // Both should have errors
    let result = getResult();
    expect(result.getClusterAuthState('cluster-a').hasError).toBe(true);
    expect(result.getClusterAuthState('cluster-b').hasError).toBe(true);

    // Simulate recovery for cluster-a only
    await act(async () => {
      mockRuntime.emit('cluster:auth:recovered', {
        clusterId: 'cluster-a',
      });
      await Promise.resolve();
    });

    result = getResult();

    // cluster-a should be cleared
    expect(result.getClusterAuthState('cluster-a').hasError).toBe(false);

    // cluster-b should still have an error
    expect(result.getClusterAuthState('cluster-b').hasError).toBe(true);
    expect(result.getClusterAuthState('cluster-b').reason).toBe('Certificate invalid');

    unmount();
  });

  it('getActiveClusterAuthState returns state for active cluster only', async () => {
    const { getResult, unmount } = await renderAuthHook('cluster-a');

    // Simulate auth failure for both clusters
    await act(async () => {
      mockRuntime.emit('cluster:auth:failed', {
        clusterId: 'cluster-a',
        clusterName: 'Cluster A',
        reason: 'Token expired for A',
      });
      mockRuntime.emit('cluster:auth:failed', {
        clusterId: 'cluster-b',
        clusterName: 'Cluster B',
        reason: 'Token expired for B',
      });
      await Promise.resolve();
    });

    const result = getResult();

    // getActiveClusterAuthState should return cluster-a's state
    const activeState = result.getActiveClusterAuthState();
    expect(activeState.hasError).toBe(true);
    expect(activeState.reason).toBe('Token expired for A');
    expect(activeState.clusterName).toBe('Cluster A');

    unmount();
  });

  it('tracks recovering state per cluster', async () => {
    const { getResult, unmount } = await renderAuthHook();

    // Simulate auth failure for cluster-a
    await act(async () => {
      mockRuntime.emit('cluster:auth:failed', {
        clusterId: 'cluster-a',
        clusterName: 'Cluster A',
        reason: 'Token expired',
      });
      await Promise.resolve();
    });

    // Simulate recovering state for cluster-a
    await act(async () => {
      mockRuntime.emit('cluster:auth:recovering', {
        clusterId: 'cluster-a',
        clusterName: 'Cluster A',
      });
      await Promise.resolve();
    });

    const result = getResult();

    // cluster-a should be recovering
    const stateA = result.getClusterAuthState('cluster-a');
    expect(stateA.hasError).toBe(true);
    expect(stateA.isRecovering).toBe(true);

    // cluster-b should not be affected
    const stateB = result.getClusterAuthState('cluster-b');
    expect(stateB.hasError).toBe(false);
    expect(stateB.isRecovering).toBe(false);

    unmount();
  });

  it('returns default state when no active cluster is set', async () => {
    const { getResult, unmount } = await renderAuthHook('');

    // Simulate auth failure for cluster-a
    await act(async () => {
      mockRuntime.emit('cluster:auth:failed', {
        clusterId: 'cluster-a',
        clusterName: 'Cluster A',
        reason: 'Token expired',
      });
      await Promise.resolve();
    });

    const result = getResult();

    // getActiveClusterAuthState should return default state when no active cluster
    const activeState = result.getActiveClusterAuthState();
    expect(activeState.hasError).toBe(false);
    expect(activeState.reason).toBe('');

    unmount();
  });
});

// Tests for cluster health tracking
describe('Cluster Health Listener Isolation', () => {
  let mockRuntime: MockRuntime;
  let originalRuntime: unknown;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mockRuntime = createMockRuntime();
    originalRuntime = (window as any).runtime;
    (window as any).runtime = mockRuntime;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (window as any).runtime = originalRuntime;
    // Clear document body using textContent (safe DOM method)
    document.body.textContent = '';
  });

  /**
   * Helper to render the useClusterHealthListener hook and capture its result.
   */
  const renderHealthHook = async (
    activeClusterId: string = ''
  ): Promise<{
    getResult: () => HealthHookResult;
    unmount: () => void;
  }> => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = ReactDOM.createRoot(container);

    let hookResult: HealthHookResult | null = null;

    const HookHost = () => {
      const result = useClusterHealthListener(activeClusterId);
      hookResult = result;
      return null;
    };

    await act(async () => {
      root.render(React.createElement(HookHost));
      await Promise.resolve();
    });

    return {
      getResult: () => hookResult!,
      unmount: () =>
        act(() => {
          root.unmount();
          container.remove();
        }),
    };
  };

  it('tracks health status per cluster independently', async () => {
    const { getResult, unmount } = await renderHealthHook();

    // Simulate healthy status for cluster-a
    await act(async () => {
      mockRuntime.emit('cluster:health:healthy', {
        clusterId: 'cluster-a',
      });
      await Promise.resolve();
    });

    // Simulate degraded status for cluster-b
    await act(async () => {
      mockRuntime.emit('cluster:health:degraded', {
        clusterId: 'cluster-b',
      });
      await Promise.resolve();
    });

    const result = getResult();

    // cluster-a should be healthy
    expect(result.getClusterHealth('cluster-a')).toBe('healthy');

    // cluster-b should be degraded
    expect(result.getClusterHealth('cluster-b')).toBe('degraded');

    unmount();
  });

  it('getActiveClusterHealth returns health for active cluster only', async () => {
    const { getResult, unmount } = await renderHealthHook('cluster-a');

    // Set different health for each cluster
    await act(async () => {
      mockRuntime.emit('cluster:health:healthy', {
        clusterId: 'cluster-a',
      });
      mockRuntime.emit('cluster:health:degraded', {
        clusterId: 'cluster-b',
      });
      await Promise.resolve();
    });

    const result = getResult();

    // getActiveClusterHealth should return cluster-a's health
    expect(result.getActiveClusterHealth()).toBe('healthy');

    unmount();
  });

  it('returns unknown for clusters not yet tracked', async () => {
    const { getResult, unmount } = await renderHealthHook();

    const result = getResult();

    // Unknown cluster should return 'unknown'
    expect(result.getClusterHealth('nonexistent-cluster')).toBe('unknown');

    unmount();
  });

  it('returns unknown when no active cluster is set', async () => {
    const { getResult, unmount } = await renderHealthHook('');

    // Set health for cluster-a
    await act(async () => {
      mockRuntime.emit('cluster:health:healthy', {
        clusterId: 'cluster-a',
      });
      await Promise.resolve();
    });

    const result = getResult();

    // getActiveClusterHealth should return 'unknown' when no active cluster
    expect(result.getActiveClusterHealth()).toBe('unknown');

    unmount();
  });

  it('updates health status when cluster transitions between states', async () => {
    const { getResult, unmount } = await renderHealthHook();

    // Initially set cluster-a as healthy
    await act(async () => {
      mockRuntime.emit('cluster:health:healthy', {
        clusterId: 'cluster-a',
      });
      await Promise.resolve();
    });

    let result = getResult();
    expect(result.getClusterHealth('cluster-a')).toBe('healthy');

    // Transition cluster-a to degraded
    await act(async () => {
      mockRuntime.emit('cluster:health:degraded', {
        clusterId: 'cluster-a',
      });
      await Promise.resolve();
    });

    result = getResult();
    expect(result.getClusterHealth('cluster-a')).toBe('degraded');

    // Transition cluster-a back to healthy
    await act(async () => {
      mockRuntime.emit('cluster:health:healthy', {
        clusterId: 'cluster-a',
      });
      await Promise.resolve();
    });

    result = getResult();
    expect(result.getClusterHealth('cluster-a')).toBe('healthy');

    unmount();
  });

  it('handles multiple clusters with different health states', async () => {
    const { getResult, unmount } = await renderHealthHook();

    // Set up three clusters with different states
    await act(async () => {
      mockRuntime.emit('cluster:health:healthy', { clusterId: 'cluster-1' });
      mockRuntime.emit('cluster:health:degraded', { clusterId: 'cluster-2' });
      mockRuntime.emit('cluster:health:healthy', { clusterId: 'cluster-3' });
      await Promise.resolve();
    });

    const result = getResult();

    expect(result.getClusterHealth('cluster-1')).toBe('healthy');
    expect(result.getClusterHealth('cluster-2')).toBe('degraded');
    expect(result.getClusterHealth('cluster-3')).toBe('healthy');

    // Verify the map contains exactly three entries
    expect(result.clusterHealth.size).toBe(3);

    unmount();
  });
});
