/**
 * frontend/src/core/contexts/ObjectPanelStateContext.test.tsx
 *
 * Test suite for ObjectPanelStateContext.
 * Ensures object panel state is scoped per cluster tab.
 */
import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ObjectPanelStateProvider, useObjectPanelState } from './ObjectPanelStateContext';

const clearPanelStateMock = vi.fn();
const handoffLayoutBeforeCloseMock = vi.fn();

let mockClusterId = 'cluster-a';
let mockClusterName = 'Cluster A';
let mockClusterIds = ['cluster-a', 'cluster-b'];

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedClusterId: mockClusterId,
    selectedClusterName: mockClusterName,
    selectedClusterIds: mockClusterIds,
  }),
}));

const resetScopedDomainMock = vi.fn();
vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: {
    resetScopedDomain: (...args: unknown[]) => resetScopedDomainMock(...args),
  },
}));

vi.mock('@ui/dockable/useDockablePanelState', () => ({
  clearPanelState: (...args: unknown[]) => clearPanelStateMock(...args),
  handoffLayoutBeforeClose: (...args: unknown[]) => handoffLayoutBeforeCloseMock(...args),
}));

const stateRef: { current: ReturnType<typeof useObjectPanelState> | null } = { current: null };

const Harness: React.FC = () => {
  stateRef.current = useObjectPanelState();
  return null;
};

describe('ObjectPanelStateContext', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mockClusterId = 'cluster-a';
    mockClusterName = 'Cluster A';
    mockClusterIds = ['cluster-a', 'cluster-b'];
    stateRef.current = null;
    resetScopedDomainMock.mockClear();
    clearPanelStateMock.mockClear();
    handoffLayoutBeforeCloseMock.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderProvider = async () => {
    await act(async () => {
      root.render(
        <ObjectPanelStateProvider>
          <Harness />
        </ObjectPanelStateProvider>
      );
    });
  };

  it('keeps object panel state isolated per cluster tab', async () => {
    await renderProvider();

    // Open a panel in cluster-a.
    act(() => {
      stateRef.current?.onRowClick({ kind: 'Pod', name: 'api', namespace: 'default' });
    });
    expect(stateRef.current?.showObjectPanel).toBe(true);
    expect(stateRef.current?.openPanels.size).toBeGreaterThan(0);

    // The opened panel should contain the object we clicked on.
    const panelEntries = Array.from(stateRef.current?.openPanels.values() ?? []);
    expect(panelEntries[0]?.name).toBe('api');

    // Switch to cluster-b. Its state should be empty and independent.
    mockClusterId = 'cluster-b';
    mockClusterName = 'Cluster B';
    await renderProvider();
    expect(stateRef.current?.showObjectPanel).toBe(false);
    expect(stateRef.current?.openPanels.size).toBe(0);

    // Open a different panel in cluster-b.
    act(() => {
      stateRef.current?.onRowClick({ kind: 'Deployment', name: 'web', namespace: 'default' });
    });
    expect(stateRef.current?.openPanels.size).toBeGreaterThan(0);
    const clusterBEntries = Array.from(stateRef.current?.openPanels.values() ?? []);
    expect(clusterBEntries[0]?.name).toBe('web');

    // Switch back to cluster-a. Its original state should still be intact.
    mockClusterId = 'cluster-a';
    mockClusterName = 'Cluster A';
    await renderProvider();
    expect(stateRef.current?.showObjectPanel).toBe(true);
    const clusterAEntries = Array.from(stateRef.current?.openPanels.values() ?? []);
    expect(clusterAEntries[0]?.name).toBe('api');
  });

  it('persists active sub-tab per cluster slice and isolates across switches', async () => {
    await renderProvider();

    // Open a panel in cluster-a and persist its active tab.
    let panelId = '';
    act(() => {
      panelId =
        stateRef.current?.onRowClick({ kind: 'Pod', name: 'api', namespace: 'default' }) ?? '';
    });
    act(() => {
      stateRef.current?.setObjectPanelActiveTab(panelId, 'logs');
    });
    expect(stateRef.current?.getObjectPanelActiveTab(panelId)).toBe('logs');

    // Switch to cluster-b. The cluster-a tab persistence must not leak.
    mockClusterId = 'cluster-b';
    mockClusterName = 'Cluster B';
    await renderProvider();
    expect(stateRef.current?.getObjectPanelActiveTab(panelId)).toBeUndefined();

    // Open the same identity in cluster-b and store a different sub-tab.
    act(() => {
      stateRef.current?.onRowClick({
        kind: 'Pod',
        name: 'api',
        namespace: 'default',
        clusterId: 'cluster-b',
      });
    });
    act(() => {
      stateRef.current?.setObjectPanelActiveTab(panelId, 'yaml');
    });
    expect(stateRef.current?.getObjectPanelActiveTab(panelId)).toBe('yaml');

    // Switching back to cluster-a should restore that slice's tab, untouched.
    mockClusterId = 'cluster-a';
    mockClusterName = 'Cluster A';
    await renderProvider();
    expect(stateRef.current?.getObjectPanelActiveTab(panelId)).toBe('logs');
  });

  it('clears the active sub-tab entry when a panel is closed', async () => {
    await renderProvider();

    let panelId = '';
    act(() => {
      panelId =
        stateRef.current?.onRowClick({ kind: 'Pod', name: 'api', namespace: 'default' }) ?? '';
    });
    act(() => {
      stateRef.current?.setObjectPanelActiveTab(panelId, 'events');
    });
    expect(stateRef.current?.getObjectPanelActiveTab(panelId)).toBe('events');

    act(() => {
      stateRef.current?.closePanel(panelId);
    });
    expect(stateRef.current?.openPanels.has(panelId)).toBe(false);
    expect(stateRef.current?.getObjectPanelActiveTab(panelId)).toBeUndefined();
    expect(handoffLayoutBeforeCloseMock).toHaveBeenCalledWith(panelId);
    expect(clearPanelStateMock).toHaveBeenCalledWith(panelId);
  });

  it('clears object panel state when a tab is closed', async () => {
    // Start on cluster-b and open a panel.
    mockClusterId = 'cluster-b';
    mockClusterName = 'Cluster B';
    await renderProvider();

    act(() => {
      stateRef.current?.onRowClick({ kind: 'Pod', name: 'job', namespace: 'default' });
    });
    expect(stateRef.current?.showObjectPanel).toBe(true);

    // Remove cluster-b from the active tabs (simulates closing the tab).
    mockClusterIds = ['cluster-a'];
    mockClusterId = 'cluster-a';
    mockClusterName = 'Cluster A';
    await renderProvider();

    // Re-add cluster-b. Its state should have been cleaned up.
    mockClusterIds = ['cluster-a', 'cluster-b'];
    mockClusterId = 'cluster-b';
    mockClusterName = 'Cluster B';
    await renderProvider();

    expect(stateRef.current?.showObjectPanel).toBe(false);
    expect(stateRef.current?.openPanels.size).toBe(0);
  });

  // --- Tier 1 responsiveness: scope eviction tied to actual close ---
  //
  // The unmount destructors in ObjectPanelContent / useObjectPanelRefresh
  // intentionally preserve cached scoped-domain entries so that a
  // transient unmount (caused by a cluster switch) renders instantly from
  // cache on the way back. The ONLY places that should free those entries
  // are the explicit close paths exercised below.

  it('does not evict scopes when a panel is opened then a different cluster is activated', async () => {
    await renderProvider();
    act(() => {
      stateRef.current?.onRowClick({
        kind: 'Pod',
        name: 'api',
        namespace: 'default',
        clusterId: 'cluster-a',
      });
    });
    expect(resetScopedDomainMock).not.toHaveBeenCalled();

    // Switching clusters does NOT evict — the panel still belongs to a
    // live cluster slice, so its cached log/event/yaml entries must stay
    // put for the eventual switch-back.
    mockClusterId = 'cluster-b';
    mockClusterName = 'Cluster B';
    await renderProvider();
    expect(resetScopedDomainMock).not.toHaveBeenCalled();
  });

  it('evicts every scoped-domain entry for a panel when closePanel runs', async () => {
    await renderProvider();
    let panelId = '';
    act(() => {
      panelId =
        stateRef.current?.onRowClick({
          kind: 'Pod',
          name: 'api',
          namespace: 'team-a',
          clusterId: 'cluster-a',
        }) ?? '';
    });
    resetScopedDomainMock.mockClear();

    act(() => {
      stateRef.current?.closePanel(panelId);
    });

    // Pod has 4 scopes that need eviction: details, yaml (both
    // detailScope), events, logs. helmScope is null for non-Helm kinds.
    const calls = resetScopedDomainMock.mock.calls.map(([domain]) => domain);
    expect(calls).toEqual(
      expect.arrayContaining(['object-details', 'object-yaml', 'object-events', 'object-logs'])
    );
    // Helm-only domains must NOT be evicted for a Pod (helmScope is null).
    expect(calls).not.toContain('object-helm-manifest');
    expect(calls).not.toContain('object-helm-values');
  });

  it('evicts helm scopes when closePanel runs on a HelmRelease panel', async () => {
    await renderProvider();
    let panelId = '';
    act(() => {
      panelId =
        stateRef.current?.onRowClick({
          kind: 'HelmRelease',
          name: 'my-app',
          namespace: 'team-a',
          clusterId: 'cluster-a',
        }) ?? '';
    });
    resetScopedDomainMock.mockClear();

    act(() => {
      stateRef.current?.closePanel(panelId);
    });

    const calls = resetScopedDomainMock.mock.calls.map(([domain]) => domain);
    expect(calls).toEqual(expect.arrayContaining(['object-helm-manifest', 'object-helm-values']));
  });

  it('evicts every panel in a cluster slice when that cluster tab is closed', async () => {
    await renderProvider();
    act(() => {
      stateRef.current?.onRowClick({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        clusterId: 'cluster-a',
      });
    });

    // Switch to cluster-b and open another panel there.
    mockClusterId = 'cluster-b';
    mockClusterName = 'Cluster B';
    await renderProvider();
    act(() => {
      stateRef.current?.onRowClick({
        kind: 'Pod',
        name: 'web',
        namespace: 'team-b',
        clusterId: 'cluster-b',
      });
    });
    resetScopedDomainMock.mockClear();

    // Drop cluster-b from the active tabs (close the cluster tab).
    mockClusterIds = ['cluster-a'];
    mockClusterId = 'cluster-a';
    mockClusterName = 'Cluster A';
    await renderProvider();

    // Cluster-b's panel scopes must be evicted; cluster-a's panel scopes
    // must NOT be (it's still alive).
    const calls = resetScopedDomainMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const evictedScopes = calls.map(([, scope]) => scope as string);
    // Every eviction call should target a cluster-b scope.
    evictedScopes.forEach((scope) => {
      expect(scope).toContain('cluster-b');
    });
    evictedScopes.forEach((scope) => {
      expect(scope).not.toContain('cluster-a');
    });
  });

  it('evicts every active-cluster panel when onCloseObjectPanel runs', async () => {
    await renderProvider();
    act(() => {
      stateRef.current?.onRowClick({
        kind: 'Pod',
        name: 'api',
        namespace: 'team-a',
        clusterId: 'cluster-a',
      });
    });
    act(() => {
      stateRef.current?.onRowClick({
        kind: 'Deployment',
        name: 'web',
        namespace: 'team-a',
        clusterId: 'cluster-a',
      });
    });
    resetScopedDomainMock.mockClear();

    act(() => {
      stateRef.current?.onCloseObjectPanel();
    });

    // Two panels × at least one scope each → at least 2 eviction calls.
    expect(resetScopedDomainMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
