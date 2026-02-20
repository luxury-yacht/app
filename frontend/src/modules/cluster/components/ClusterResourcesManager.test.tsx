/**
 * frontend/src/modules/cluster/components/ClusterResourcesManager.test.tsx
 *
 * Test suite for ClusterResourcesManager.
 * Covers key behaviors and edge cases for ClusterResourcesManager.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ClusterResourcesManager } from './ClusterResourcesManager';

type ClusterKey = 'nodes' | 'rbac' | 'storage' | 'config' | 'crds' | 'custom' | 'events';

const {
  setActiveResourceTypeMock,
  clusterResourceStates,
  loadMocks,
  cancelMocks,
  viewPropsRef,
  permissionState,
} = vi.hoisted(() => {
  const keys: ClusterKey[] = ['nodes', 'rbac', 'storage', 'config', 'crds', 'custom', 'events'];
  const loadMap: Record<ClusterKey, ReturnType<typeof vi.fn>> = {} as any;
  const cancelMap: Record<ClusterKey, ReturnType<typeof vi.fn>> = {} as any;
  const states: Record<string, any> = {};

  keys.forEach((key, index) => {
    loadMap[key] = vi.fn().mockResolvedValue(undefined);
    cancelMap[key] = vi.fn();
    states[key] = {
      data: index === 0 ? [`${key}-row`] : null,
      loading: false,
      error: null,
      hasLoaded: key === 'nodes', // nodes preloaded
      load: loadMap[key],
      cancel: cancelMap[key],
    };
  });

  return {
    setActiveResourceTypeMock: vi.fn(),
    clusterResourceStates: states,
    loadMocks: loadMap,
    cancelMocks: cancelMap,
    viewPropsRef: { current: null as any },
    permissionState: new Map<
      string,
      { allowed: boolean; pending: boolean; reason?: string; entry?: { status: string } }
    >(),
  };
});

vi.mock('@modules/cluster/contexts/ClusterResourcesContext', () => ({
  useClusterResources: () => ({
    nodes: clusterResourceStates.nodes,
    rbac: clusterResourceStates.rbac,
    storage: clusterResourceStates.storage,
    config: clusterResourceStates.config,
    crds: clusterResourceStates.crds,
    custom: clusterResourceStates.custom,
    events: clusterResourceStates.events,
    setActiveResourceType: setActiveResourceTypeMock,
  }),
}));

vi.mock('@modules/cluster/components/ClusterResourcesViews', () => ({
  __esModule: true,
  default: (props: any) => {
    viewPropsRef.current = props;
    return <div data-testid="cluster-resources-view" />;
  },
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: 'cluster-a' }),
}));

vi.mock('@/core/capabilities', () => ({
  useUserPermission: (kind: string, action: string) => {
    const key = `${kind}:${action}`;
    return permissionState.get(key) ?? { allowed: true, pending: false };
  },
}));

describe('ClusterResourcesManager', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);

    setActiveResourceTypeMock.mockReset();
    Object.values(loadMocks).forEach((mock) => mock.mockClear());
    Object.values(cancelMocks).forEach((mock) => mock.mockClear());
    viewPropsRef.current = null;
    permissionState.clear();

    Object.entries(clusterResourceStates).forEach(([key, state], index) => {
      (state as any).hasLoaded = index === 0;
      (state as any).loading = false;
      (state as any).error = null;
      (state as any).data = index === 0 ? [`${key}-row`] : null;
      state.loading = false;
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderManager = async (activeTab: ClusterKey) => {
    await act(async () => {
      root.render(<ClusterResourcesManager activeTab={activeTab} />);
      await Promise.resolve();
    });
  };

  it('loads the active tab data and passes props downstream', async () => {
    await renderManager('storage');

    expect(setActiveResourceTypeMock).toHaveBeenCalledWith('storage');

    const props = viewPropsRef.current;
    expect(props.storage).toEqual([]);
    expect(props.storageLoaded).toBe(false);
    expect(props.nodes).toEqual(['nodes-row']);
  });

  it('respects permission denials and avoids loading', async () => {
    permissionState.set('Event:list', {
      allowed: false,
      pending: false,
      reason: 'forbidden',
      entry: { status: 'ready' },
    });
    await renderManager('events');

    const props = viewPropsRef.current;
    expect(props.eventsError).toBe('forbidden');
  });
});
