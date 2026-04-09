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
});
