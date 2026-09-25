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
  openIdentity: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedClusterId: state.clusterId }),
}));
vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: state.open, openWithIdentity: state.openIdentity }),
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
    state.openIdentity.mockClear();
    state.navigate.mockClear();
    state.clusterId = 'cluster-a';
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
    ];
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('opens User and Group identity targets from badges and names without object actions', async () => {
    state.rows[0].name = ' alice ';
    state.rows[0].clusterId = 'cluster-b';
    await act(async () =>
      root.render(
        <KeyboardProvider>
          <ClusterResourcesViews activeTab="identities" />
        </KeyboardProvider>
      )
    );
    const user = host.querySelector<HTMLButtonElement>('button[data-kind-value="User"]');
    expect(user).not.toBeNull();
    act(() => user?.click());
    expect(state.openIdentity).toHaveBeenLastCalledWith({
      targetType: 'identity',
      clusterId: 'cluster-b',
      kind: 'User',
      name: ' alice ',
    });
    const group = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'developers'
    );
    expect(group).toBeDefined();
    act(() => group?.click());
    expect(state.openIdentity).toHaveBeenLastCalledWith({
      targetType: 'identity',
      clusterId: 'cluster-a',
      kind: 'Group',
      name: 'developers',
    });
    expect(state.open).not.toHaveBeenCalled();
  });

  it('opens source bindings with their complete object identity', async () => {
    await act(async () =>
      root.render(
        <KeyboardProvider>
          <ClusterResourcesViews activeTab="identities" />
        </KeyboardProvider>
      )
    );
    expect(host.textContent).toContain('alice');
    expect(host.textContent).toContain('developers');
    expect(state.open).not.toHaveBeenCalled();
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
