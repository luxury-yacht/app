/**
 * frontend/src/modules/cluster/components/ClusterViewCustom.test.tsx
 *
 * Test suite for ClusterViewCustom.
 * Covers key behaviors and edge cases for ClusterViewCustom.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ClusterViewCustom from '@modules/cluster/components/ClusterViewCustom';

vi.mock('@core/contexts/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: [],

    addFavorite: vi.fn(),
    updateFavorite: vi.fn(),
    deleteFavorite: vi.fn(),
    reorderFavorites: vi.fn(),
  }),
  FavoritesProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@ui/favorites/FavToggle', () => ({
  useFavToggle: () => ({
    type: 'toggle',
    id: 'favorite',
    icon: null,
    active: false,
    onClick: () => {},
    title: 'Save as favorite',
  }),
}));

const gridTablePropsRef: { current: any } = { current: null };
const openWithObjectMock = vi.fn();
const deleteResourceByGVKMock = vi.fn();
const modalProps: { current: any } = { current: null };

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: any) => {
      gridTablePropsRef.current = props;
      return <div data-testid="grid-table" />;
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context' }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: unknown[]) => ({
    sortedData: data,
    sortConfig: { key: 'name', direction: 'asc' },
    handleSort: vi.fn(),
  }),
}));

const setFiltersMock = vi.fn();

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: { key: 'name', direction: 'asc' },
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
    setFilters: setFiltersMock,
    resetState: vi.fn(),
    hydrated: true,
    storageKey: 'gridtable:v1:test',
  }),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  DeleteResourceByGVK: (...args: unknown[]) => deleteResourceByGVKMock(...args),
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: (props: any) => {
    modalProps.current = props;
    return <div data-testid="confirmation-modal" />;
  },
}));

vi.mock('@/core/capabilities', () => ({
  useUserPermissions: () =>
    new Map([
      ['Widget:delete', { allowed: true, pending: false }],
      ['DBCluster:delete', { allowed: true, pending: false }],
    ]),
  getPermissionKey: (kind: string, action: string) => `${kind}:${action}`,
  queryKindPermissions: vi.fn(),
}));

// queryKindPermissions calls window.go.backend.App.QueryPermissions directly.
(globalThis as unknown as Record<string, unknown>).window = {
  ...((globalThis as unknown as Record<string, unknown>).window as Record<string, unknown>),
  go: {
    backend: {
      App: { QueryPermissions: vi.fn().mockResolvedValue({ results: [], diagnostics: [] }) },
    },
  },
};

const baseCustom = {
  kind: 'Widget',
  name: 'gizmo',
  apiGroup: 'example.com',
  age: '1d',
  clusterId: 'alpha:ctx',
  clusterName: 'alpha',
  labels: { env: 'prod' },
  annotations: { owner: 'custom-team' },
};

describe('ClusterViewCustom', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
    modalProps.current = null;
    openWithObjectMock.mockReset();
    deleteResourceByGVKMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('passes metadata to the object panel when opening a resource', async () => {
    await act(async () => {
      root.render(<ClusterViewCustom data={[baseCustom]} loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();

    props.getCustomContextMenuItems(baseCustom, 'kind')[0].onClick();
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Widget',
        name: 'gizmo',
        age: '1d',
        labels: { env: 'prod' },
        annotations: { owner: 'custom-team' },
        clusterId: 'alpha:ctx',
      })
    );
  });

  // Regression test mirroring NsViewCustom's colliding-CRD guardrail. See
  // docs/plans/kind-only-objects.md. The cluster-scoped custom view has
  // the same bug potential: if handleResourceClick drops apiGroup/apiVersion,
  // a cluster-scoped custom resource whose Kind collides with another CRD
  // group would open against the wrong GVR.
  it('forwards apiGroup and apiVersion into openWithObject for colliding CRDs', async () => {
    const clusterScopedCR = {
      kind: 'DBCluster',
      name: 'shared-pg',
      apiGroup: 'postgresql.cnpg.io',
      apiVersion: 'v1',
      age: '3d',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
      labels: {},
      annotations: {},
    };

    await act(async () => {
      root.render(<ClusterViewCustom data={[clusterScopedCR]} loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();

    props.getCustomContextMenuItems(clusterScopedCR, 'kind')[0].onClick();

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'DBCluster',
        name: 'shared-pg',
        clusterId: 'alpha:ctx',
        group: 'postgresql.cnpg.io',
        version: 'v1',
      })
    );

    const callArg = openWithObjectMock.mock.calls.find(
      ([arg]) => (arg as { name?: string }).name === 'shared-pg'
    )?.[0] as Record<string, unknown>;
    expect(callArg).toBeDefined();
    expect(callArg.group).toBe('postgresql.cnpg.io');
    expect(callArg.version).toBe('v1');
  });

  // Regression test for the delete-path leg of the kind-only-objects bug
  // (docs/plans/kind-only-objects.md "I Should Have Done This Without Having
  // To Be Asked" item 2). Mirrors NsViewCustom's delete guardrail for the
  // cluster-scoped custom view.
  it('routes delete through DeleteResourceByGVK when apiGroup/apiVersion are present', async () => {
    deleteResourceByGVKMock.mockResolvedValue(undefined);

    const clusterScopedCR = {
      kind: 'DBCluster',
      name: 'shared-pg',
      apiGroup: 'postgresql.cnpg.io',
      apiVersion: 'v1',
      age: '3d',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
      labels: {},
      annotations: {},
    };

    await act(async () => {
      root.render(<ClusterViewCustom data={[clusterScopedCR]} loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();

    // The Delete context menu item is at index 2 (Open, View YAML, Delete).
    const contextItems = props.getCustomContextMenuItems(clusterScopedCR, 'kind');
    await act(async () => {
      contextItems[2].onClick();
      await Promise.resolve();
    });
    expect(modalProps.current?.isOpen).toBe(true);

    await act(async () => {
      await modalProps.current.onConfirm();
    });

    expect(deleteResourceByGVKMock).toHaveBeenCalledWith(
      'alpha:ctx',
      'postgresql.cnpg.io/v1',
      'DBCluster',
      '',
      'shared-pg'
    );
  });
});
