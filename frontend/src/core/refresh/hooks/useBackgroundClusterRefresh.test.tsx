import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NavigationTabState } from '@/core/contexts/ViewStateContext';
import { useBackgroundClusterRefresh } from './useBackgroundClusterRefresh';

const mocks = vi.hoisted(() => ({
  enabled: true,
  selectedClusterId: 'cluster-a',
  selectedClusterIds: ['cluster-a', 'cluster-b'],
  fetch: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({ useKubeconfig: () => mocks }));
vi.mock('./useBackgroundRefresh', () => ({ useBackgroundRefresh: () => mocks }));
vi.mock('../orchestrator', () => ({ refreshOrchestrator: { fetchDomainForCluster: mocks.fetch } }));

describe('background refresh hook ownership', () => {
  const navigation: NavigationTabState = {
    viewType: 'namespace',
    previousView: 'overview',
    activeNamespaceView: 'network',
    activeClusterView: 'nodes',
  };
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;
  const Harness = ({ namespace }: { namespace: string }) => {
    useBackgroundClusterRefresh({
      getClusterNavigationState: () => navigation,
      getClusterNamespace: () => namespace,
    });
    return null;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.enabled = true;
    mocks.selectedClusterId = 'cluster-a';
    mocks.selectedClusterIds = ['cluster-a', 'cluster-b'];
    mocks.fetch.mockClear();
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
  });
  it('uses current callbacks, scopes ticks to background clusters and stops when disabled', async () => {
    act(() => root.render(<Harness namespace="old" />));
    act(() => root.render(<Harness namespace="current" />));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(mocks.fetch.mock.calls).toEqual([
      ['namespaces', 'cluster-b'],
      ['namespace-network', 'cluster-b', 'namespace:current'],
    ]);
    mocks.selectedClusterId = 'cluster-b';
    act(() => root.render(<Harness namespace="team-a" />));
    mocks.fetch.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(mocks.fetch.mock.calls).toEqual([
      ['namespaces', 'cluster-a'],
      ['namespace-network', 'cluster-a', 'namespace:team-a'],
    ]);
    mocks.enabled = false;
    act(() => root.render(<Harness namespace="team-a" />));
    mocks.fetch.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
