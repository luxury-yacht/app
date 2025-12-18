import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { NamespaceResourcesManager } from '@modules/namespace/components/NsResourcesManager';

type ResourceKey =
  | 'pods'
  | 'workloads'
  | 'config'
  | 'network'
  | 'rbac'
  | 'storage'
  | 'autoscaling'
  | 'quotas'
  | 'custom'
  | 'helm'
  | 'events';

const { setActiveResourceTypeMock, resourceStates, viewPropsRef, loadMocks, cancelMocks } =
  vi.hoisted(() => {
    const keys: ResourceKey[] = [
      'pods',
      'workloads',
      'config',
      'network',
      'rbac',
      'storage',
      'autoscaling',
      'quotas',
      'custom',
      'helm',
      'events',
    ];

    const loadMap: Record<ResourceKey, ReturnType<typeof vi.fn>> = {} as any;
    const cancelMap: Record<ResourceKey, ReturnType<typeof vi.fn>> = {} as any;
    const states: Record<string, any> = {};

    keys.forEach((key) => {
      loadMap[key] = vi.fn().mockResolvedValue(undefined);
      cancelMap[key] = vi.fn();
      states[key] = {
        data: [`${key}-row`],
        loading: false,
        error: null,
        hasLoaded: key === 'pods', // only pods preloaded
        load: loadMap[key],
        cancel: cancelMap[key],
      };
    });

    states.pods.metrics = { stale: false, lastError: null, collectedAt: Date.now() };

    return {
      setActiveResourceTypeMock: vi.fn(),
      resourceStates: states,
      viewPropsRef: { current: null as any },
      loadMocks: loadMap,
      cancelMocks: cancelMap,
    };
  });

vi.mock('@modules/namespace/contexts/NsResourcesContext', () => ({
  useNamespaceResources: () => ({
    setActiveResourceType: setActiveResourceTypeMock,
  }),
  useNamespaceResource: (key: ResourceKey) => resourceStates[key],
}));

vi.mock('@modules/namespace/components/NsResourcesViews', () => ({
  __esModule: true,
  default: (props: any) => {
    viewPropsRef.current = props;
    return <div data-testid="namespace-resources-view" />;
  },
}));

describe('NamespaceResourcesManager', () => {
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
    Object.values(resourceStates).forEach((state: any) => {
      state.hasLoaded = false;
      state.loading = false;
      state.error = null;
    });
    resourceStates.pods.hasLoaded = true;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderManager = async (activeTab: ResourceKey) => {
    await act(async () => {
      root.render(<NamespaceResourcesManager namespace="team-a" activeTab={activeTab} />);
      await Promise.resolve();
    });
  };

  it('passes resource data to view component and triggers manual load for active tab', async () => {
    await renderManager('network');
    expect(setActiveResourceTypeMock).toHaveBeenCalledWith('network');

    expect(loadMocks.network).toHaveBeenCalledTimes(1);
    expect(loadMocks.network).toHaveBeenCalledWith(true);

    const props = viewPropsRef.current;
    expect(props).toBeTruthy();
    expect(props.nsNetwork).toEqual(['network-row']);
    expect(props.nsNetworkLoaded).toBe(false);
    expect(props.nsPods).toEqual(['pods-row']);
    expect(props.nsPodsMetrics).toBe(resourceStates.pods.metrics);
  });

  it('cancels outstanding resource operations on unmount', async () => {
    await renderManager('storage');
    act(() => {
      root.unmount();
    });
    expect(cancelMocks.storage).toHaveBeenCalledTimes(1);
    expect(cancelMocks.pods).toHaveBeenCalledTimes(1);
  });

  it('does not reload when resource already loaded or errored', async () => {
    resourceStates.rbac.hasLoaded = true;
    resourceStates.storage.error = new Error('boom');
    await renderManager('rbac');
    await renderManager('storage');

    expect(loadMocks.rbac).not.toHaveBeenCalled();
    expect(loadMocks.storage).not.toHaveBeenCalled();
  });
});
