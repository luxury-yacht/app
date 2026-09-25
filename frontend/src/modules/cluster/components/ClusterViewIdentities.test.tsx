import { boundedRowsSource } from '@modules/resource-grid/boundedRowsSource';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterIdentity } from '@/core/refresh/types';
import ClusterResourcesViews from './ClusterResourcesViews';

const state = vi.hoisted(() => ({
  clusterId: 'cluster-a',
  rows: [] as ClusterIdentity[],
  open: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: state.clusterId }),
}));
vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: state.open }),
}));
vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ available: true, navigateToView: state.navigate }),
}));
vi.mock('@core/contexts/ZoomContext', () => ({ useZoom: () => ({ zoomLevel: 100 }) }));
vi.mock('@ui/shortcuts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui/shortcuts')>()),
  useKeyboardContext: () => ({
    registerShortcut: () => 'id',
    unregisterShortcut: () => undefined,
    getAvailableShortcuts: () => [],
    isShortcutAvailable: () => false,
    setEnabled: () => undefined,
    isEnabled: true,
    registerSurface: () => 'surface',
    unregisterSurface: () => undefined,
    dispatchNativeAction: () => false,
    hasActiveBlockingSurface: () => false,
  }),
}));

// Replace the query transport/lifecycle, but render the real table, columns,
// tooltip, and object links to exercise identity-specific operational decisions.
vi.mock('@modules/resource-grid/useQueryBackedResourceGridTable', () => ({
  useQueryBackedClusterResourceGridTable: (params: {
    keyExtractor: (row: ClusterIdentity) => string;
    columns: GridColumnDefinition<ClusterIdentity>[];
  }) => ({
    source: boundedRowsSource({ rows: state.rows }),
    favModal: null,
    gridTableProps: {
      data: state.rows,
      keyExtractor: params.keyExtractor,
      columns: params.columns,
      virtualization: { enabled: false },
      sortConfig: { key: 'name', direction: 'asc' },
      onSort: vi.fn(),
    },
  }),
}));

describe('ClusterViewIdentities', () => {
  let host: HTMLDivElement;
  let root: ReactDOM.Root;
  const binding = {
    clusterId: 'cluster-a',
    group: 'rbac.authorization.k8s.io',
    version: 'v1',
    kind: 'RoleBinding',
    resource: 'rolebindings',
    namespace: 'payments',
    name: 'readers',
  };
  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = ReactDOM.createRoot(host);
    state.open.mockClear();
    state.navigate.mockClear();
    state.rows = [
      {
        clusterId: 'cluster-a',
        kind: 'User',
        name: 'alice',
        namespace: '',
        bindings: [binding],
        grantScopes: ['payments'],
      },
      {
        clusterId: 'cluster-a',
        kind: 'Group',
        name: 'developers',
        namespace: '',
        bindings: [],
        grantScopes: [],
      },
      {
        clusterId: 'cluster-a',
        kind: 'ServiceAccount',
        name: 'builder',
        namespace: 'ci',
        bindings: [],
        grantScopes: [],
        serviceAccount: {
          clusterId: 'cluster-a',
          group: '',
          version: 'v1',
          kind: 'ServiceAccount',
          resource: 'serviceaccounts',
          namespace: 'ci',
          name: 'builder',
        },
      },
    ];
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('opens real service accounts and source bindings without offering user or group object actions', async () => {
    await act(async () =>
      root.render(
        <KeyboardProvider>
          <ClusterResourcesViews activeTab="identities" />
        </KeyboardProvider>
      )
    );
    expect(host.textContent).toContain('alice');
    expect(host.textContent).toContain('developers');
    expect(
      [...host.querySelectorAll('button')].find((el) => el.textContent === 'alice')
    ).toBeUndefined();
    expect(
      [...host.querySelectorAll('button')].find((el) => el.textContent === 'developers')
    ).toBeUndefined();
    const serviceAccount = [...host.querySelectorAll('button')].find(
      (el) => el.textContent === 'builder'
    );
    expect(serviceAccount).toBeDefined();
    act(() => serviceAccount?.click());
    expect(state.open).toHaveBeenCalledWith(state.rows[2].serviceAccount);

    const count = host.querySelector<HTMLElement>('[aria-label="Bindings for alice"]');
    expect(count).not.toBeNull();
    await act(async () => count?.click());
    const link = [...document.querySelectorAll('button')].find((el) =>
      el.textContent?.includes('payments/readers')
    );
    expect(link).toBeDefined();
    act(() => link?.click());
    expect(state.open).toHaveBeenLastCalledWith(binding);
  });
});
