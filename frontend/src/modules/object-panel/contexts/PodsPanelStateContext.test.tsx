/**
 * frontend/src/modules/object-panel/contexts/PodsPanelStateContext.test.tsx
 *
 * Per-cluster state for the Pods dock tab.
 */

import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeResourceRef } from '@/test-utils/makeResourceRef';
import { requireValue } from '@/test-utils/requireValue';
import {
  PodsPanelStateProvider,
  type PodsPanelStateValue,
  useOptionalPodsPanelState,
} from './PodsPanelStateContext';

const kubeconfig = vi.hoisted(() => ({
  selectedClusterId: 'cluster-a',
  managedClusterIds: ['cluster-a', 'cluster-b'],
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => kubeconfig,
}));

const deployment = (clusterId: string, name: string) =>
  buildRequiredObjectReference(
    makeResourceRef({
      clusterId,
      group: 'apps',
      kind: 'Deployment',
      resource: 'deployments',
      namespace: 'team-a',
      name,
    })
  );

const node = (clusterId: string, name: string) =>
  buildRequiredObjectReference(
    makeResourceRef({ clusterId, group: '', kind: 'Node', resource: 'nodes', name })
  );

describe('PodsPanelStateContext', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const stateRef: { current: PodsPanelStateValue | null } = { current: null };

  const Probe: React.FC = () => {
    stateRef.current = useOptionalPodsPanelState();
    return null;
  };
  const render = () =>
    act(() => {
      root.render(
        <PodsPanelStateProvider>
          <Probe />
        </PodsPanelStateProvider>
      );
    });
  const state = () => requireValue(stateRef.current, 'expected Pods tab state');

  beforeEach(() => {
    kubeconfig.selectedClusterId = 'cluster-a';
    kubeconfig.managedClusterIds = ['cluster-a', 'cluster-b'];
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('is absent outside the main window provider', () => {
    act(() => root.render(<Probe />));
    expect(stateRef.current).toBeNull();
  });

  it('keeps one target per cluster and exposes the selected cluster’s', () => {
    render();
    expect(state().target).toBeNull();

    act(() => state().show(deployment('cluster-a', 'api'), 'workloads'));
    act(() => state().show(node('cluster-b', 'worker-1'), 'nodes'));
    expect(state().target).toMatchObject({
      object: { clusterId: 'cluster-a', name: 'api' },
      source: 'workloads',
    });

    // Showing another object replaces the cluster's target.
    act(() => state().show(deployment('cluster-a', 'web'), 'workloads'));
    expect(state().target?.object.name).toBe('web');

    kubeconfig.selectedClusterId = 'cluster-b';
    render();
    expect(state().target).toMatchObject({ object: { name: 'worker-1' }, source: 'nodes' });
  });

  it('counts every request, so showing the same object again is a new request', () => {
    render();
    act(() => state().show(deployment('cluster-a', 'api'), 'workloads'));
    const first = requireValue(state().target, 'expected a target').request;

    act(() => state().show(deployment('cluster-a', 'api'), 'workloads'));

    expect(state().target?.request).toBeGreaterThan(first);
  });

  it('closes one cluster’s tab, or every tab a table opened', () => {
    render();
    act(() => state().show(deployment('cluster-a', 'api'), 'workloads'));
    act(() => state().close('cluster-a'));
    expect(state().target).toBeNull();

    act(() => state().show(deployment('cluster-a', 'api'), 'workloads'));
    act(() => state().show(node('cluster-b', 'worker-1'), 'nodes'));
    act(() => state().closeSource('workloads'));
    expect(state().target).toBeNull();

    kubeconfig.selectedClusterId = 'cluster-b';
    render();
    expect(state().target?.object.name).toBe('worker-1');
  });

  it('drops the tabs of closed clusters', () => {
    render();
    act(() => state().show(node('cluster-b', 'worker-1'), 'nodes'));

    kubeconfig.managedClusterIds = ['cluster-a'];
    render();
    kubeconfig.selectedClusterId = 'cluster-b';
    kubeconfig.managedClusterIds = ['cluster-a', 'cluster-b'];
    render();

    expect(state().target).toBeNull();
  });
});
