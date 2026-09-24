import type React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const telemetryMocks = vi.hoisted(() => ({
  setActiveViewContext: vi.fn(),
}));

const refreshMocks = vi.hoisted(() => ({
  updateContext: vi.fn(),
}));

const contextMocks = vi.hoisted(() => ({
  kubeconfig: {
    selectedClusterId: 'cluster-a',
    selectedClusterIds: ['cluster-a'],
    managedClusterIds: ['cluster-a'],
  },
  modal: {},
  objectPanel: { showObjectPanel: false },
  sidebar: { setSidebarSelection: vi.fn() },
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => contextMocks.kubeconfig,
}));

vi.mock('@modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  ObjectPanelStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useObjectPanelState: () => contextMocks.objectPanel,
}));

vi.mock('./SidebarStateContext', () => ({
  SidebarStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useSidebarState: () => contextMocks.sidebar,
}));

vi.mock('./ModalStateContext', () => ({
  ModalStateProvider: ({ children }: { children: React.ReactNode }) => children,
  useModalState: () => contextMocks.modal,
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: refreshMocks,
}));

vi.mock('@/core/telemetry/sentry', () => telemetryMocks);

import { useViewState, ViewStateProvider } from './ViewStateContext';

const NamespaceLinkHarness = () => {
  const { onNamespaceSelect } = useViewState();
  return (
    <button type="button" onClick={() => onNamespaceSelect('payments')}>
      Open namespace
    </button>
  );
};

describe('ViewStateProvider navigation synchronization', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    contextMocks.kubeconfig.selectedClusterIds = ['cluster-a'];
    contextMocks.kubeconfig.managedClusterIds = ['cluster-a'];
    contextMocks.kubeconfig.selectedClusterId = 'cluster-a';
    telemetryMocks.setActiveViewContext.mockReset();
    refreshMocks.updateContext.mockReset();
    contextMocks.sidebar.setSidebarSelection.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('publishes the active workspace from the navigation owner', () => {
    act(() => {
      root.render(
        <ViewStateProvider>
          <div>child</div>
        </ViewStateProvider>
      );
    });

    expect(telemetryMocks.setActiveViewContext).toHaveBeenCalledWith({
      view: 'overview',
      clusterId: 'cluster-a',
      objectPanelOpen: false,
    });
  });

  it.each([false, true])(
    'retains Global navigation until tab close is accepted (%s)',
    (accepted) => {
      let navigation!: ReturnType<typeof useViewState>;
      const Probe = () => {
        navigation = useViewState();
        return null;
      };
      const render = () =>
        act(() =>
          root.render(
            <ViewStateProvider>
              <Probe />
            </ViewStateProvider>
          )
        );
      contextMocks.kubeconfig.selectedClusterIds = ['cluster-a', 'cluster-b'];
      contextMocks.kubeconfig.managedClusterIds = ['cluster-a', 'cluster-b'];
      render();
      act(() => navigation.navigateToGlobal());
      expect(navigation.viewType).toBe('global');
      contextMocks.kubeconfig.selectedClusterIds = ['cluster-b'];
      render();
      expect(navigation.viewType).toBe('overview');
      if (accepted) {
        contextMocks.kubeconfig.managedClusterIds = ['cluster-b'];
        render();
      }
      contextMocks.kubeconfig.selectedClusterIds = ['cluster-a', 'cluster-b'];
      contextMocks.kubeconfig.managedClusterIds = ['cluster-a', 'cluster-b'];
      render();
      expect(navigation.viewType).toBe(accepted ? 'overview' : 'global');
    }
  );

  it('retains cluster navigation during close and disposes it only after acceptance', () => {
    let navigation!: ReturnType<typeof useViewState>;
    const Probe = () => {
      navigation = useViewState();
      return null;
    };
    const render = () =>
      act(() =>
        root.render(
          <ViewStateProvider>
            <Probe />
          </ViewStateProvider>
        )
      );
    contextMocks.kubeconfig.selectedClusterIds = ['cluster-a', 'cluster-b'];
    contextMocks.kubeconfig.managedClusterIds = ['cluster-a', 'cluster-b'];
    render();
    act(() =>
      navigation.restoreClusterNavigationState('cluster-a', {
        ...navigation.getClusterNavigationState('cluster-a'),
        viewType: 'cluster',
        activeClusterView: 'nodes',
      })
    );
    contextMocks.kubeconfig.selectedClusterId = 'cluster-b';
    contextMocks.kubeconfig.selectedClusterIds = ['cluster-b'];
    render();
    expect(navigation.getClusterNavigationState('cluster-a').activeClusterView).toBe('nodes');
    contextMocks.kubeconfig.selectedClusterIds = ['cluster-a', 'cluster-b'];
    contextMocks.kubeconfig.selectedClusterId = 'cluster-a';
    render();
    expect(navigation.activeClusterTab).toBe('nodes');
    contextMocks.kubeconfig.selectedClusterIds = [];
    contextMocks.kubeconfig.managedClusterIds = [];
    contextMocks.kubeconfig.selectedClusterId = '';
    render();
    contextMocks.kubeconfig.selectedClusterIds = ['cluster-a'];
    contextMocks.kubeconfig.managedClusterIds = ['cluster-a'];
    contextMocks.kubeconfig.selectedClusterId = 'cluster-a';
    render();
    expect(navigation.viewType).toBe('overview');
    expect(navigation.activeClusterTab).toBeNull();
  });

  it('opens Workloads when a namespace is selected outside the namespace view', () => {
    act(() => {
      root.render(
        <ViewStateProvider>
          <NamespaceLinkHarness />
        </ViewStateProvider>
      );
    });

    act(() => {
      container.querySelector('button')?.click();
    });

    expect(contextMocks.sidebar.setSidebarSelection).toHaveBeenCalledWith({
      type: 'namespace',
      value: 'payments',
    });
    expect(telemetryMocks.setActiveViewContext).toHaveBeenLastCalledWith({
      view: 'namespace',
      tab: 'workloads',
      clusterId: 'cluster-a',
      objectPanelOpen: false,
    });
  });
});
