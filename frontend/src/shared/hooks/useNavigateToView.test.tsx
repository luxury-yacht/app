/**
 * frontend/src/shared/hooks/useNavigateToView.test.tsx
 *
 * Alt+click navigation to the view that lists an object: the workspace opens
 * the kind's view (its resource family's view first), selects the object's
 * namespace in its cluster with the sidebar following, and leaves a focus
 * request aimed only at the destination table. A custom resource without an
 * API version navigates nowhere. Runs the hook inside the production shell
 * with the real kubeconfig, view-state, sidebar, and namespace owners over a
 * faked backend (test-utils/appState). How the destination table consumes the
 * request is covered by modules/resource-grid/useAnchorOnUnmatchedFocusRequest.test.tsx.
 */

import { peekPendingFocusRequest } from '@shared/components/tables/hooks/useGridTableExternalFocus';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import type { KubernetesObjectReference } from '@/types/view-state';
import { type NavigateToViewResult, useNavigateToView } from './useNavigateToView';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;
let navigation: NavigateToViewResult | undefined;

function Probe() {
  navigation = useNavigateToView();
  return null;
}

const start = async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['apps', 'team-b']);
  view = await app.render(null);
  await view.show(<Probe />);
};

const navigate = async (ref: KubernetesObjectReference) => {
  await act(async () => {
    requireValue(navigation, 'mounted navigation hook').navigateToView(ref);
  });
  await app.settle();
};

const workspace = () => {
  const { namespace, viewState } = view.owners();
  return {
    view: viewState?.viewType,
    namespaceTab: viewState?.activeNamespaceTab,
    clusterTab: viewState?.activeClusterTab,
    sidebar: viewState?.sidebarSelection,
    namespace: namespace.selectedNamespace,
  };
};

describe('useNavigateToView', () => {
  it('opens a cluster-scoped family object’s cluster view and aims focus at its table', async () => {
    await start();
    const before = view.owners().namespace.selectedNamespace;

    await navigate({
      clusterId: dev.clusterId,
      group: 'karpenter.sh',
      version: 'v1beta1',
      kind: 'NodePool',
      namespace: '',
      name: 'pool',
    });

    expect(workspace()).toMatchObject({
      view: 'cluster',
      clusterTab: 'karpenter',
      sidebar: { type: 'cluster', value: 'cluster' },
      namespace: before,
    });
    expect(peekPendingFocusRequest()).toMatchObject({
      clusterId: dev.clusterId,
      group: 'karpenter.sh',
      version: 'v1beta1',
      kind: 'NodePool',
      name: 'pool',
      rowKey: `${dev.clusterId}|karpenter.sh/v1beta1/NodePool//pool`,
      destinationViewId: 'cluster-karpenter',
    });
  });

  it('selects a namespaced family object’s namespace and aims focus only at its family table', async () => {
    await start();

    await navigate({
      clusterId: dev.clusterId,
      group: 'argoproj.io',
      version: 'v1alpha1',
      kind: 'Application',
      namespace: 'team-b',
      name: 'shop',
    });

    expect(workspace()).toMatchObject({
      view: 'namespace',
      namespaceTab: 'argocd',
      sidebar: { type: 'namespace', value: 'team-b' },
      namespace: 'team-b',
    });
    expect(view.owners().namespace.selectedNamespaceClusterId).toBe(dev.clusterId);
    expect(peekPendingFocusRequest()).toMatchObject({
      clusterId: dev.clusterId,
      namespace: 'team-b',
      rowKey: `${dev.clusterId}|argoproj.io/v1alpha1/Application/team-b/shop`,
      destinationViewId: 'namespace-argocd',
    });
  });

  it('opens a built-in object’s namespace view with its namespace selected', async () => {
    await start();

    await navigate({
      clusterId: dev.clusterId,
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      namespace: 'apps',
      name: 'web',
    });

    expect(workspace()).toMatchObject({
      view: 'namespace',
      namespaceTab: 'workloads',
      sidebar: { type: 'namespace', value: 'apps' },
      namespace: 'apps',
    });
    expect(peekPendingFocusRequest()).toMatchObject({
      rowKey: `${dev.clusterId}|apps/v1/Deployment/apps/web`,
      destinationViewId: 'namespace-workloads',
    });
  });

  // The Namespaces table keys rows by the same canonical key (see
  // ClusterViewNamespaces.test), so this request focuses the namespace's row.
  it('opens the cluster Namespaces view for a Namespace and aims focus at its row', async () => {
    await start();
    const before = view.owners().namespace.selectedNamespace;

    await navigate({
      clusterId: dev.clusterId,
      group: '',
      version: 'v1',
      kind: 'Namespace',
      name: 'payments',
    });

    expect(workspace()).toMatchObject({
      view: 'cluster',
      clusterTab: 'namespaces',
      sidebar: { type: 'cluster', value: 'cluster' },
      namespace: before,
    });
    expect(peekPendingFocusRequest()).toMatchObject({
      clusterId: dev.clusterId,
      rowKey: `${dev.clusterId}|/v1/Namespace//payments`,
      destinationViewId: 'cluster-namespaces',
    });
  });

  it('navigates nowhere for a custom resource row without an API version', async () => {
    await start();
    const before = workspace();

    await navigate({
      clusterId: dev.clusterId,
      group: 'karpenter.sh',
      kind: 'NodePool',
      name: 'pool',
    });

    expect(workspace()).toEqual(before);
    expect(peekPendingFocusRequest()).toBeNull();
  });
});
