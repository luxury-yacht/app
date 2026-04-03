/**
 * frontend/src/core/contexts/ClusterLifecycleContext.test.tsx
 *
 * Test suite for ClusterLifecycleContext.
 * Validates hydration from backend RPC, Wails event subscription,
 * cleanup of stale cluster entries, and accessor behavior.
 */
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClusterLifecycleProvider, useClusterLifecycle } from './ClusterLifecycleContext';

// Mock useKubeconfig — tests control selectedClusterIds via this ref.
const mockSelectedClusterIds = { current: ['cluster-a', 'cluster-b'] };

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterIds: mockSelectedClusterIds.current,
  }),
}));

describe('ClusterLifecycleContext', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const stateRef: { current: ReturnType<typeof useClusterLifecycle> | null } = { current: null };

  // Track registered listeners and their disposers
  let listeners: Map<string, Array<(...args: unknown[]) => void>>;
  let disposerCalls: string[];

  // Mock for the Go backend RPC
  let mockGetAllStates: ReturnType<typeof vi.fn>;

  const Harness = () => {
    stateRef.current = useClusterLifecycle();
    return null;
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    listeners = new Map();
    disposerCalls = [];
    mockSelectedClusterIds.current = ['cluster-a', 'cluster-b'];
    mockGetAllStates = vi.fn().mockResolvedValue(null);

    // Mock window.runtime with EventsOn that tracks registrations.
    (window as any).runtime = {
      EventsOn: vi.fn((eventName: string, callback: (...args: unknown[]) => void) => {
        if (!listeners.has(eventName)) {
          listeners.set(eventName, []);
        }
        listeners.get(eventName)!.push(callback);

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

    // Mock window.go.backend.App.GetAllClusterLifecycleStates
    (window as any).go = {
      backend: {
        App: {
          GetAllClusterLifecycleStates: mockGetAllStates,
        },
      },
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
    delete (window as any).go;
  });

  const renderProvider = async () => {
    await act(async () => {
      root.render(
        <ClusterLifecycleProvider>
          <Harness />
        </ClusterLifecycleProvider>
      );
      // Let the hydration promise resolve.
      await Promise.resolve();
    });
  };

  it('useClusterLifecycle() throws outside provider', () => {
    // Suppress React error boundary logging for the expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      const root = ReactDOM.createRoot(document.createElement('div'));
      // Synchronous render — the hook throws immediately.
      act(() => {
        root.render(<Harness />);
      });
    }).toThrow('useClusterLifecycle must be used within ClusterLifecycleProvider');
    spy.mockRestore();
  });

  it('getClusterState() returns empty string for unknown cluster', async () => {
    await renderProvider();

    expect(stateRef.current?.getClusterState('nonexistent')).toBe('');
  });

  it('isClusterReady() returns true when state is ready', async () => {
    mockGetAllStates.mockResolvedValue({ 'cluster-a': 'ready' });

    await renderProvider();

    expect(stateRef.current?.isClusterReady('cluster-a')).toBe(true);
    expect(stateRef.current?.isClusterReady('cluster-b')).toBe(false);
  });

  it('hydrates from GetAllClusterLifecycleStates on mount', async () => {
    mockGetAllStates.mockResolvedValue({
      'cluster-a': 'connecting',
      'cluster-b': 'ready',
    });

    await renderProvider();

    expect(mockGetAllStates).toHaveBeenCalledOnce();
    expect(stateRef.current?.getClusterState('cluster-a')).toBe('connecting');
    expect(stateRef.current?.getClusterState('cluster-b')).toBe('ready');
  });

  it('subscribes to cluster:lifecycle events and updates state', async () => {
    await renderProvider();

    expect(listeners.get('cluster:lifecycle')?.length).toBe(1);

    // Simulate a lifecycle event from the backend
    act(() => {
      listeners.get('cluster:lifecycle')![0]({
        clusterId: 'cluster-a',
        state: 'loading',
        previousState: 'connected',
      });
    });

    expect(stateRef.current?.getClusterState('cluster-a')).toBe('loading');
  });

  it('calls disposer on unmount', async () => {
    await renderProvider();

    expect(listeners.get('cluster:lifecycle')?.length).toBe(1);

    act(() => {
      root.unmount();
    });

    expect(disposerCalls).toContain('cluster:lifecycle');
    expect(listeners.get('cluster:lifecycle')?.length).toBe(0);

    // Re-create root so afterEach unmount doesn't fail
    root = ReactDOM.createRoot(container);
  });

  it('ignores lifecycle events with missing payload fields', async () => {
    await renderProvider();

    // No clusterId
    act(() => {
      listeners.get('cluster:lifecycle')![0]({ state: 'ready' });
    });
    expect(stateRef.current?.getClusterState('')).toBe('');

    // No state
    act(() => {
      listeners.get('cluster:lifecycle')![0]({ clusterId: 'cluster-a' });
    });
    expect(stateRef.current?.getClusterState('cluster-a')).toBe('');
  });
});
