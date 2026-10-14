import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KubernetesObjectReference } from '@/types/view-state';
import { type NavigateToViewResult, useNavigateToView } from './useNavigateToView';

const mocks = vi.hoisted(() => ({
  view: { setViewType: vi.fn(), setActiveNamespaceTab: vi.fn(), setActiveClusterView: vi.fn() },
  sidebar: { setSidebarSelection: vi.fn() },
  setNamespace: vi.fn(),
  pending: vi.fn(),
  emit: vi.fn(),
}));
vi.mock('@/core/contexts/ViewStateContext', () => ({ useOptionalViewState: () => mocks.view }));
vi.mock('@/core/contexts/SidebarStateContext', () => ({
  useOptionalSidebarState: () => mocks.sidebar,
}));
vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({ setSelectedNamespace: mocks.setNamespace }),
}));
vi.mock('@shared/components/tables/hooks/useGridTableExternalFocus', () => ({
  setPendingFocusRequest: mocks.pending,
}));
vi.mock('@/core/events', () => ({ eventBus: { emit: mocks.emit } }));

const navigate = (ref: KubernetesObjectReference) => {
  const container = document.createElement('div');
  const root = createRoot(container);
  let result: NavigateToViewResult | undefined;
  function Test() {
    result = useNavigateToView();
    return null;
  }
  act(() => root.render(<Test />));
  act(() => result?.navigateToView(ref));
  act(() => root.unmount());
};
afterEach(() => vi.clearAllMocks());
describe('resource view navigation', () => {
  it('routes discovered Karpenter identity and focus to its cluster table', () => {
    navigate({
      clusterId: 'a',
      group: 'karpenter.sh',
      version: 'v1beta1',
      kind: 'NodePool',
      namespace: '',
      name: 'pool',
    });
    expect(mocks.view.setActiveClusterView).toHaveBeenCalledWith('karpenter');
    expect(mocks.emit).toHaveBeenCalledWith(
      'gridtable:focus-request',
      expect.objectContaining({
        clusterId: 'a',
        group: 'karpenter.sh',
        version: 'v1beta1',
        rowKey: 'a|karpenter.sh/v1beta1/NodePool//pool',
        destinationViewId: 'cluster-karpenter',
      })
    );
    expect(mocks.setNamespace).not.toHaveBeenCalled();
  });
  it('selects the Argo CD object namespace and focuses only its family table', () => {
    navigate({
      clusterId: 'b',
      group: 'argoproj.io',
      version: 'v1alpha1',
      kind: 'Application',
      namespace: 'team-b',
      name: 'shop',
    });
    expect(mocks.view.setActiveNamespaceTab).toHaveBeenCalledWith('argocd');
    expect(mocks.setNamespace).toHaveBeenCalledWith('team-b', 'b');
    expect(mocks.emit).toHaveBeenCalledWith(
      'gridtable:focus-request',
      expect.objectContaining({
        clusterId: 'b',
        namespace: 'team-b',
        destinationViewId: 'namespace-argocd',
        rowKey: 'b|argoproj.io/v1alpha1/Application/team-b/shop',
      })
    );
  });
  it('preserves namespace selection and focus for built-in resources', () => {
    navigate({
      clusterId: 'b',
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      namespace: 'apps',
      name: 'web',
    });
    expect(mocks.view.setActiveNamespaceTab).toHaveBeenCalledWith('workloads');
    expect(mocks.setNamespace).toHaveBeenCalledWith('apps', 'b');
    expect(mocks.sidebar.setSidebarSelection).toHaveBeenCalledWith({
      type: 'namespace',
      value: 'apps',
    });
  });
  // The Namespaces table keys rows by the same canonical key (see
  // ClusterViewNamespaces.test), so this request focuses the namespace's row.
  it('routes a Namespace to the cluster Namespaces table and focuses its row', () => {
    navigate({
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Namespace',
      name: 'payments',
    });
    expect(mocks.view.setViewType).toHaveBeenCalledWith('cluster');
    expect(mocks.view.setActiveClusterView).toHaveBeenCalledWith('namespaces');
    expect(mocks.sidebar.setSidebarSelection).toHaveBeenCalledWith({
      type: 'cluster',
      value: 'cluster',
    });
    expect(mocks.emit).toHaveBeenCalledWith(
      'gridtable:focus-request',
      expect.objectContaining({
        clusterId: 'cluster-a',
        rowKey: 'cluster-a|/v1/Namespace//payments',
        destinationViewId: 'cluster-namespaces',
      })
    );
    expect(mocks.setNamespace).not.toHaveBeenCalled();
  });
  it('rejects custom resource navigation without an API version', () => {
    navigate({ clusterId: 'a', group: 'karpenter.sh', kind: 'NodePool', name: 'pool' });
    expect(mocks.view.setViewType).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
  it('rejects incomplete cluster identity before changing navigation', () => {
    navigate({ group: 'karpenter.sh', version: 'v1', kind: 'NodePool', name: 'pool' });
    expect(mocks.view.setViewType).not.toHaveBeenCalled();
    expect(mocks.emit).not.toHaveBeenCalled();
  });
});
