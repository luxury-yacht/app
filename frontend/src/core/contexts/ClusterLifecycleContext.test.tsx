/**
 * frontend/src/core/contexts/ClusterLifecycleContext.test.tsx
 *
 * Test suite for ClusterLifecycleContext.
 * Validates hydration from backend RPC, Wails event subscription,
 * cleanup of stale cluster entries, and accessor behavior.
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { eventBus } from '@/core/events';
import {
  createWailsRuntimeHarness,
  type WailsRuntimeHarness,
} from '@/test-utils/wailsRuntimeHarness';
import { installWindowProperty } from '@/test-utils/windowProperty';
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

  let runtimeHarness: WailsRuntimeHarness;
  let restoreRuntime: () => void;
  let restoreGo: () => void;

  // Mock for the Go backend RPC
  let mockGetAllStates: ReturnType<typeof vi.fn>;

  const Harness = () => {
    stateRef.current = useClusterLifecycle();
    return null;
  };

  beforeEach(() => {
    eventBus.clear();
    mockSelectedClusterIds.current = ['cluster-a', 'cluster-b'];
    mockGetAllStates = vi.fn().mockResolvedValue(null);

    runtimeHarness = createWailsRuntimeHarness();
    restoreRuntime = installWindowProperty('runtime', runtimeHarness.runtime);

    // Mock window.go.backend.App.GetAllClusterLifecycleStates
    restoreGo = installWindowProperty('go', {
      backend: {
        App: {
          GetAllClusterLifecycleStates: mockGetAllStates,
        },
      },
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    stateRef.current = null;
  });

  afterEach(() => {
    eventBus.clear();
    act(() => {
      root.unmount();
    });
    container.remove();
    restoreRuntime();
    restoreGo();
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
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => {
      const renderRoot = ReactDOM.createRoot(document.createElement('div'));
      // Synchronous render — the hook throws immediately.
      act(() => {
        renderRoot.render(<Harness />);
      });
    }).toThrow('useClusterLifecycle must be used within ClusterLifecycleProvider');
    spy.mockRestore();
  });

  it('getClusterState() returns undefined for unknown cluster — absence is not a state', async () => {
    await renderProvider();

    expect(stateRef.current?.getClusterState('nonexistent')).toBeUndefined();
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

  it('hydrated states reach eventBus consumers — the refresh layer must share the UI truth', async () => {
    // Field failure class: the Wails relay can miss events (mount gaps), and
    // hydration used to backfill ONLY the React map. eventBus consumers —
    // clusterReadiness (which re-dispatches HELD fetches on serviceable
    // edges), capability hooks, permissionStore — stayed split-brained
    // forever: the UI showed "loading" while the refresh layer still thought
    // the cluster was unserviceable (or unknown), and readiness wedged.
    mockGetAllStates.mockResolvedValue({
      'cluster-a': 'loading',
    });
    const received: Array<{ clusterId: string; state: string }> = [];
    eventBus.on('cluster:lifecycle', (payload) => {
      received.push({ clusterId: payload.clusterId, state: payload.state });
    });

    await renderProvider();

    expect(received).toContainEqual({ clusterId: 'cluster-a', state: 'loading' });
  });

  it('hydration does not re-emit states the event relay already delivered', async () => {
    // The relay is the primary source; hydration only backfills gaps. A
    // cluster whose event already arrived must not get a duplicate synthetic
    // emission (consumers tolerate duplicates, but the edge semantics of
    // clusterReadiness are cleaner without them).
    mockGetAllStates.mockResolvedValue({
      'cluster-a': 'connecting',
    });
    const received: string[] = [];
    eventBus.on('cluster:lifecycle', (payload) => {
      received.push(`${payload.clusterId}:${payload.state}`);
    });

    // Deliver a LIVE event before hydration resolves.
    let resolveHydration: (value: unknown) => void = () => undefined;
    mockGetAllStates.mockReturnValue(
      new Promise((resolve) => {
        resolveHydration = resolve;
      })
    );

    await renderProvider();
    await act(async () => {
      runtimeHarness.emit('cluster:lifecycle', {
        clusterId: 'cluster-a',
        state: 'loading',
        previousState: 'connected',
      });
      await Promise.resolve();
    });
    await act(async () => {
      resolveHydration({ 'cluster-a': 'connecting' });
      await Promise.resolve();
    });

    expect(received).toEqual(['cluster-a:loading']);
    // Events win over the (older) hydrated value in the map too.
    expect(stateRef.current?.getClusterState('cluster-a')).toBe('loading');
  });

  it('keeps getClusterState identity stable when a lifecycle event repeats an unchanged state', async () => {
    // Consumers key derived scope lists on getClusterState identity; a new
    // identity per redundant event re-runs their reconciliation effects on
    // every heartbeat (observed live as periodic spinner/diagnostics flicker).
    await renderProvider();

    act(() => {
      runtimeHarness.emit('cluster:lifecycle', {
        clusterId: 'cluster-a',
        state: 'loading',
        previousState: 'connected',
      });
    });
    const firstIdentity = stateRef.current?.getClusterState;
    expect(firstIdentity).toBeTypeOf('function');

    // Same cluster, same state: a no-op event must not mint a new identity.
    act(() => {
      runtimeHarness.emit('cluster:lifecycle', {
        clusterId: 'cluster-a',
        state: 'loading',
        previousState: 'connected',
      });
    });
    expect(stateRef.current?.getClusterState).toBe(firstIdentity);

    // A REAL change still updates state (and may change identity).
    act(() => {
      runtimeHarness.emit('cluster:lifecycle', {
        clusterId: 'cluster-a',
        state: 'ready',
        previousState: 'loading',
      });
    });
    expect(stateRef.current?.getClusterState('cluster-a')).toBe('ready');
  });

  it('subscribes to cluster:lifecycle events and updates state', async () => {
    await renderProvider();

    expect(runtimeHarness.listenerCount('cluster:lifecycle')).toBe(1);

    // Simulate a lifecycle event from the backend
    act(() => {
      runtimeHarness.emit('cluster:lifecycle', {
        clusterId: 'cluster-a',
        state: 'loading',
        previousState: 'connected',
      });
    });

    expect(stateRef.current?.getClusterState('cluster-a')).toBe('loading');
  });

  it('bridges backend lifecycle events onto the frontend event bus', async () => {
    const frontendListener = vi.fn();
    const unsubscribe = eventBus.on('cluster:lifecycle', frontendListener);

    await renderProvider();

    act(() => {
      runtimeHarness.emit('cluster:lifecycle', {
        clusterId: 'cluster-a',
        state: 'ready',
        previousState: 'loading',
      });
    });

    expect(frontendListener).toHaveBeenCalledWith({
      clusterId: 'cluster-a',
      state: 'ready',
    });

    unsubscribe();
  });

  it('calls disposer on unmount', async () => {
    await renderProvider();

    expect(runtimeHarness.listenerCount('cluster:lifecycle')).toBe(1);

    act(() => {
      root.unmount();
    });

    expect(runtimeHarness.disposerCalls).toContain('cluster:lifecycle');
    expect(runtimeHarness.listenerCount('cluster:lifecycle')).toBe(0);

    // Re-create root so afterEach unmount doesn't fail
    root = ReactDOM.createRoot(container);
  });

  it('ignores lifecycle events with missing payload fields', async () => {
    await renderProvider();

    // No clusterId
    act(() => {
      runtimeHarness.emit('cluster:lifecycle', { state: 'ready' });
    });
    expect(stateRef.current?.getClusterState('')).toBeUndefined();

    // No state
    act(() => {
      runtimeHarness.emit('cluster:lifecycle', { clusterId: 'cluster-a' });
    });
    expect(stateRef.current?.getClusterState('cluster-a')).toBeUndefined();
  });

  it('drops live events carrying an unknown state instead of relaying them', async () => {
    // The union is closed at the ingestion boundary: an unrecognized state
    // (backend/frontend version skew) must not reach the map or the eventBus
    // consumers — gates comparing against known literals would silently hold
    // dispatch forever. Dropping keeps the previous state, matching the
    // documented fail-open handling of unknown clusters in clusterReadiness.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const frontendListener = vi.fn();
    const unsubscribe = eventBus.on('cluster:lifecycle', frontendListener);

    await renderProvider();

    act(() => {
      runtimeHarness.emit('cluster:lifecycle', {
        clusterId: 'cluster-a',
        state: 'context-test-bogus-live',
        previousState: 'loading',
      });
    });

    expect(stateRef.current?.getClusterState('cluster-a')).toBeUndefined();
    expect(frontendListener).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);

    unsubscribe();
    warn.mockRestore();
  });

  it('drops unknown states during hydration but keeps the valid entries', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockGetAllStates.mockResolvedValue({
      'cluster-a': 'context-test-bogus-hydrate',
      'cluster-b': 'ready',
    });
    const received: Array<{ clusterId: string; state: string }> = [];
    eventBus.on('cluster:lifecycle', (payload) => {
      received.push({ clusterId: payload.clusterId, state: payload.state });
    });

    await renderProvider();

    expect(stateRef.current?.getClusterState('cluster-a')).toBeUndefined();
    expect(stateRef.current?.getClusterState('cluster-b')).toBe('ready');
    expect(received).toEqual([{ clusterId: 'cluster-b', state: 'ready' }]);

    warn.mockRestore();
  });
});
