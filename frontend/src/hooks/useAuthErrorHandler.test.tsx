/**
 * frontend/src/hooks/useAuthErrorHandler.test.tsx
 *
 * Test suite for useAuthErrorHandler.
 * Covers payload parsing and per-cluster auth state tracking.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthErrorHandler, ClusterAuthState } from './useAuthErrorHandler';

// Mock the error handler module
vi.mock('@utils/errorHandler', () => ({
  errorHandler: {
    handle: vi.fn(),
  },
}));

// Mock the Wails backend App module for RetryClusterAuth
const mockRetryClusterAuth = vi.fn();
vi.mock('../../wailsjs/go/backend/App', () => ({
  RetryClusterAuth: mockRetryClusterAuth,
}));

// Type for the event handler callbacks registered via EventsOn
type EventHandler = (...args: unknown[]) => void;

// Mock window.runtime for Wails event subscriptions
const mockEventHandlers: Map<string, EventHandler> = new Map();

const mockRuntime = {
  EventsOn: vi.fn((eventName: string, handler: EventHandler) => {
    mockEventHandlers.set(eventName, handler);
  }),
  EventsOff: vi.fn((eventName: string) => {
    mockEventHandlers.delete(eventName);
  }),
};

/**
 * Simulate emitting an event from the backend to the frontend.
 */
const emitEvent = (eventName: string, payload: unknown) => {
  const handler = mockEventHandlers.get(eventName);
  if (handler) {
    handler(payload);
  }
};

// Test harness component that exposes the hook's return values for assertions.
interface HarnessProps {
  activeClusterId?: string;
}

interface HookResult {
  clusterAuthErrors: Map<string, ClusterAuthState>;
  getClusterAuthState: (clusterId: string) => ClusterAuthState;
  getActiveClusterAuthState: () => ClusterAuthState;
  handleRetry: (clusterId: string) => Promise<void>;
}

let lastHookResult: HookResult | null = null;

const TestHarness = ({ activeClusterId = '' }: HarnessProps) => {
  const result = useAuthErrorHandler(activeClusterId);
  lastHookResult = result;

  // Render cluster auth errors as data attributes for assertions
  const errorData = Array.from(result.clusterAuthErrors.entries())
    .map(([id, state]) => `${id}:${state.hasError}:${state.isRecovering}`)
    .join(',');

  return (
    <div data-testid="hook-host" data-errors={errorData}>
      <span data-testid="error-count">{result.clusterAuthErrors.size}</span>
    </div>
  );
};

describe('useAuthErrorHandler', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    // Reset mocks and state before each test
    mockEventHandlers.clear();
    lastHookResult = null;
    vi.clearAllMocks();
    mockRetryClusterAuth.mockReset();

    // Set up mock window.runtime
    (window as any).runtime = mockRuntime;

    // Create DOM container
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    delete (window as any).runtime;
  });

  const renderHarness = async (activeClusterId = '') => {
    await act(async () => {
      root.render(<TestHarness activeClusterId={activeClusterId} />);
      await Promise.resolve();
    });
  };

  const rerenderWithClusterId = async (activeClusterId: string) => {
    await act(async () => {
      root.render(<TestHarness activeClusterId={activeClusterId} />);
      await Promise.resolve();
    });
  };

  const getErrorCount = () =>
    parseInt(container.querySelector('[data-testid="error-count"]')?.textContent || '0', 10);

  describe('event subscription', () => {
    it('subscribes to cluster auth events on mount', async () => {
      await renderHarness();

      expect(mockRuntime.EventsOn).toHaveBeenCalledWith(
        'cluster:auth:failed',
        expect.any(Function)
      );
      expect(mockRuntime.EventsOn).toHaveBeenCalledWith(
        'cluster:auth:recovering',
        expect.any(Function)
      );
      expect(mockRuntime.EventsOn).toHaveBeenCalledWith(
        'cluster:auth:recovered',
        expect.any(Function)
      );
    });

    it('unsubscribes from events on unmount', async () => {
      await renderHarness();

      act(() => {
        root.unmount();
      });

      expect(mockRuntime.EventsOff).toHaveBeenCalledWith('cluster:auth:failed');
      expect(mockRuntime.EventsOff).toHaveBeenCalledWith('cluster:auth:recovering');
      expect(mockRuntime.EventsOff).toHaveBeenCalledWith('cluster:auth:recovered');
    });
  });

  describe('payload parsing', () => {
    it('parses cluster auth failed payload correctly', async () => {
      await renderHarness();

      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Token expired',
        });
      });

      expect(lastHookResult).not.toBeNull();
      const state = lastHookResult!.getClusterAuthState('cluster-a');
      expect(state.hasError).toBe(true);
      expect(state.reason).toBe('Token expired');
      expect(state.clusterName).toBe('Cluster A');
      expect(state.isRecovering).toBe(false);
    });

    it('handles payload without clusterId gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await renderHarness();

      act(() => {
        emitEvent('cluster:auth:failed', { reason: 'Some error' });
      });

      expect(getErrorCount()).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        '[AuthErrorHandler] Received auth:failed without clusterId',
        expect.anything()
      );

      consoleSpy.mockRestore();
    });

    it('handles undefined payload gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await renderHarness();

      act(() => {
        emitEvent('cluster:auth:failed', undefined);
      });

      expect(getErrorCount()).toBe(0);

      consoleSpy.mockRestore();
    });

    it('uses default values for missing optional fields', async () => {
      await renderHarness();

      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-b',
          // clusterName and reason are missing
        });
      });

      const state = lastHookResult!.getClusterAuthState('cluster-b');
      expect(state.hasError).toBe(true);
      expect(state.reason).toBe('Authentication failed');
      expect(state.clusterName).toBe('cluster-b'); // Falls back to clusterId
    });
  });

  describe('per-cluster tracking', () => {
    it('tracks auth errors independently per cluster', async () => {
      await renderHarness();

      // Cluster A fails
      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Token expired',
        });
      });

      expect(getErrorCount()).toBe(1);

      // Cluster B fails
      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-b',
          clusterName: 'Cluster B',
          reason: 'Unauthorized',
        });
      });

      expect(getErrorCount()).toBe(2);

      // Verify each cluster has its own state
      const stateA = lastHookResult!.getClusterAuthState('cluster-a');
      const stateB = lastHookResult!.getClusterAuthState('cluster-b');

      expect(stateA.hasError).toBe(true);
      expect(stateA.reason).toBe('Token expired');

      expect(stateB.hasError).toBe(true);
      expect(stateB.reason).toBe('Unauthorized');
    });

    it('cluster A failure does not affect cluster B state', async () => {
      await renderHarness();

      // Cluster A fails
      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Token expired',
        });
      });

      // Cluster B should show healthy (no error)
      const stateB = lastHookResult!.getClusterAuthState('cluster-b');
      expect(stateB.hasError).toBe(false);
      expect(stateB.reason).toBe('');
    });

    it('updates existing cluster state on repeated failures', async () => {
      await renderHarness();

      // First failure
      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Token expired',
        });
      });

      // Second failure with different reason
      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Certificate invalid',
        });
      });

      // Should still only have one entry, but with updated reason
      expect(getErrorCount()).toBe(1);
      const state = lastHookResult!.getClusterAuthState('cluster-a');
      expect(state.reason).toBe('Certificate invalid');
    });
  });

  describe('auth recovering state', () => {
    it('sets isRecovering flag on cluster:auth:recovering event', async () => {
      await renderHarness();

      // First, trigger a failure
      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Token expired',
        });
      });

      // Then trigger recovering
      act(() => {
        emitEvent('cluster:auth:recovering', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Retrying auth',
        });
      });

      const state = lastHookResult!.getClusterAuthState('cluster-a');
      expect(state.hasError).toBe(true);
      expect(state.isRecovering).toBe(true);
    });

    it('handles recovering event for cluster without prior failure', async () => {
      await renderHarness();

      act(() => {
        emitEvent('cluster:auth:recovering', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Retrying auth',
        });
      });

      const state = lastHookResult!.getClusterAuthState('cluster-a');
      // Should create an entry with hasError true and isRecovering true
      expect(state.hasError).toBe(true);
      expect(state.isRecovering).toBe(true);
    });
  });

  describe('auth recovered state', () => {
    it('clears cluster auth error on cluster:auth:recovered event', async () => {
      await renderHarness();

      // First, trigger a failure
      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Token expired',
        });
      });

      expect(lastHookResult!.getClusterAuthState('cluster-a').hasError).toBe(true);

      // Then trigger recovery
      act(() => {
        emitEvent('cluster:auth:recovered', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
        });
      });

      // Cluster A should be removed from errors map
      expect(getErrorCount()).toBe(0);
      const state = lastHookResult!.getClusterAuthState('cluster-a');
      expect(state.hasError).toBe(false);
    });

    it('recovery of one cluster does not affect other clusters', async () => {
      await renderHarness();

      // Both clusters fail
      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Token expired',
        });
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-b',
          clusterName: 'Cluster B',
          reason: 'Unauthorized',
        });
      });

      expect(getErrorCount()).toBe(2);

      // Cluster A recovers
      act(() => {
        emitEvent('cluster:auth:recovered', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
        });
      });

      // Only cluster B should remain in error state
      expect(getErrorCount()).toBe(1);
      expect(lastHookResult!.getClusterAuthState('cluster-a').hasError).toBe(false);
      expect(lastHookResult!.getClusterAuthState('cluster-b').hasError).toBe(true);
    });
  });

  describe('getActiveClusterAuthState', () => {
    it('returns auth state for the active cluster', async () => {
      await renderHarness('cluster-a');

      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Token expired',
        });
      });

      const activeState = lastHookResult!.getActiveClusterAuthState();
      expect(activeState.hasError).toBe(true);
      expect(activeState.reason).toBe('Token expired');
    });

    it('returns default state when active cluster has no error', async () => {
      await renderHarness('cluster-a');

      // Cluster B has error, but active is cluster A
      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-b',
          clusterName: 'Cluster B',
          reason: 'Token expired',
        });
      });

      const activeState = lastHookResult!.getActiveClusterAuthState();
      expect(activeState.hasError).toBe(false);
    });

    it('returns default state when no active cluster is set', async () => {
      await renderHarness(''); // No active cluster

      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Token expired',
        });
      });

      const activeState = lastHookResult!.getActiveClusterAuthState();
      expect(activeState.hasError).toBe(false);
    });

    it('updates when active cluster changes', async () => {
      await renderHarness('cluster-a');

      // Both clusters fail
      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Token A expired',
        });
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-b',
          clusterName: 'Cluster B',
          reason: 'Token B expired',
        });
      });

      // Active is cluster-a
      expect(lastHookResult!.getActiveClusterAuthState().reason).toBe('Token A expired');

      // Switch active to cluster-b
      await rerenderWithClusterId('cluster-b');

      expect(lastHookResult!.getActiveClusterAuthState().reason).toBe('Token B expired');
    });
  });

  describe('getClusterAuthState', () => {
    it('returns default state for unknown cluster', async () => {
      await renderHarness();

      const state = lastHookResult!.getClusterAuthState('unknown-cluster');
      expect(state).toEqual({
        hasError: false,
        reason: '',
        clusterName: '',
        isRecovering: false,
      });
    });

    it('returns stored state for known cluster', async () => {
      await renderHarness();

      act(() => {
        emitEvent('cluster:auth:failed', {
          clusterId: 'cluster-a',
          clusterName: 'Cluster A',
          reason: 'Token expired',
        });
      });

      const state = lastHookResult!.getClusterAuthState('cluster-a');
      expect(state).toEqual({
        hasError: true,
        reason: 'Token expired',
        clusterName: 'Cluster A',
        isRecovering: false,
      });
    });
  });

  describe('handleRetry', () => {
    it('calls RetryClusterAuth with the provided clusterId', async () => {
      mockRetryClusterAuth.mockResolvedValue(undefined);
      await renderHarness();

      await act(async () => {
        await lastHookResult!.handleRetry('cluster-a');
      });

      expect(mockRetryClusterAuth).toHaveBeenCalledWith('cluster-a');
      expect(mockRetryClusterAuth).toHaveBeenCalledTimes(1);
    });

    it('warns and returns early when called without clusterId', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      await renderHarness();

      await act(async () => {
        await lastHookResult!.handleRetry('');
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[AuthErrorHandler] handleRetry called without clusterId'
      );
      expect(mockRetryClusterAuth).not.toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('logs error when RetryClusterAuth fails', async () => {
      const testError = new Error('Network error');
      mockRetryClusterAuth.mockRejectedValue(testError);
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await renderHarness();

      await act(async () => {
        await lastHookResult!.handleRetry('cluster-a');
      });

      expect(consoleSpy).toHaveBeenCalledWith(
        '[AuthErrorHandler] RetryClusterAuth failed for cluster-a:',
        testError
      );

      consoleSpy.mockRestore();
    });

    it('is included in the hook return value', async () => {
      await renderHarness();

      expect(lastHookResult).not.toBeNull();
      expect(typeof lastHookResult!.handleRetry).toBe('function');
    });
  });
});
