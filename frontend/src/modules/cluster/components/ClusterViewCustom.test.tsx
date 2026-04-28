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
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context', selectedClusterId: 'cluster-a' }),
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
  apiVersion: 'v1',
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

  it('enables searchable kind dropdown bulk actions for custom resources', async () => {
    await act(async () => {
      root.render(
        <ClusterViewCustom
          data={[baseCustom]}
          availableKinds={['DBCluster', 'Widget']}
          loaded={true}
        />
      );
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props?.filters?.options?.showKindDropdown).toBe(true);
    expect(props?.filters?.options?.kindDropdownSearchable).toBe(true);
    expect(props?.filters?.options?.kindDropdownBulkActions).toBe(true);
  });

  it('uses the provided kind metadata instead of deriving kinds from loaded rows', async () => {
    await act(async () => {
      root.render(
        <ClusterViewCustom
          data={[baseCustom]}
          availableKinds={['DBCluster', 'Widget']}
          loaded={true}
        />
      );
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props?.filters?.options?.kinds).toEqual(['DBCluster', 'Widget']);
  });

  // Regression test mirroring NsViewCustom's colliding-CRD guardrail.
  // The cluster-scoped custom view has
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
  // ( "I Should Have Done This Without Having
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

    const contextItems = props.getCustomContextMenuItems(clusterScopedCR, 'kind');
    const deleteItem = contextItems.find(
      (item: { label?: string; onClick?: () => void }) => item.label === 'Delete'
    );
    await act(async () => {
      deleteItem?.onClick?.();
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

  // CRD column: each row gets a clickable cell that opens the owning
  // CustomResourceDefinition in the object panel. Replaces the previous
  // "API Group" column — `<plural>.<group>` is a strict superset of the
  // group alone, and the click-through adds a navigation path the old
  // column lacked. Mirrors NsViewCustom's CRD column tests.
  describe('CRD column', () => {
    const findColumn = (props: any, key: string) =>
      props.columns.find((col: any) => col.key === key);

    const resourceWithCRD = {
      ...baseCustom,
      kind: 'DBCluster',
      name: 'shared-pg',
      apiGroup: 'postgresql.cnpg.io',
      apiVersion: 'v1',
      crdName: 'dbclusters.postgresql.cnpg.io',
    };

    const renderWith = async (rows: any[]) => {
      await act(async () => {
        root.render(<ClusterViewCustom data={rows} loaded={true} />);
        await Promise.resolve();
      });
    };

    it('replaces the API Group column with a CRD column', async () => {
      await renderWith([resourceWithCRD]);

      const props = gridTablePropsRef.current;
      // Old column is gone…
      expect(findColumn(props, 'apiGroup')).toBeUndefined();
      // …replaced with the new CRD column.
      const crdCol = findColumn(props, 'crd');
      expect(crdCol).toBeTruthy();
      expect(crdCol.header).toBe('CRD');
    });

    it('renders the CRD cell with the row crdName as a clickable link', async () => {
      await renderWith([resourceWithCRD]);

      const props = gridTablePropsRef.current;
      const crdCol = findColumn(props, 'crd');
      const rendered = crdCol.render(resourceWithCRD) as React.ReactElement<any>;

      expect((rendered as any).type).toBe('span');
      expect((rendered as any).props.role).toBe('button');
      expect((rendered as any).props.children).toBe('dbclusters.postgresql.cnpg.io');
      expect((rendered as any).props.title).toBe('Open dbclusters.postgresql.cnpg.io');
    });

    it('opens the CRD in the object panel when the CRD cell is clicked', async () => {
      await renderWith([resourceWithCRD]);

      const props = gridTablePropsRef.current;
      const crdCol = findColumn(props, 'crd');
      const rendered = crdCol.render(resourceWithCRD) as React.ReactElement<any>;

      openWithObjectMock.mockClear();
      const onClick = (rendered as any).props.onClick as (e: any) => void;
      onClick({ altKey: false, preventDefault: () => {}, stopPropagation: () => {} });

      expect(openWithObjectMock).toHaveBeenCalledTimes(1);
      const callArg = openWithObjectMock.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.kind).toBe('CustomResourceDefinition');
      expect(callArg.name).toBe('dbclusters.postgresql.cnpg.io');
      // The CRD is a built-in — apiextensions.k8s.io/v1.
      expect(callArg.group).toBe('apiextensions.k8s.io');
      expect(callArg.version).toBe('v1');
      // CRDs are cluster-scoped — no namespace on the ref.
      expect(callArg.namespace).toBeUndefined();
      expect(callArg.clusterId).toBe('alpha:ctx');
      expect(callArg.clusterName).toBe('alpha');
    });

    it('exposes a sortValue extractor so the column sorts by crdName', async () => {
      // Regression guard: column key "crd" vs field "crdName" mismatch
      // would silently break sorting without an explicit sortValue. See
      // useTableSort.ts:124.
      await renderWith([resourceWithCRD]);

      const props = gridTablePropsRef.current;
      const crdCol = findColumn(props, 'crd');
      expect(crdCol.sortValue).toBeTypeOf('function');
      expect(crdCol.sortValue(resourceWithCRD)).toBe('dbclusters.postgresql.cnpg.io');

      const noCRD = { ...baseCustom };
      expect(crdCol.sortValue(noCRD)).toBe('');
    });

    it('renders the CRD cell as inert text when crdName is missing', async () => {
      // Defensive: a row from a legacy snapshot that pre-dates the
      // CRDName field. Cell should render the bare "-" placeholder
      // with no click handler and no openWithObject call.
      const noCRD = { ...baseCustom };
      await renderWith([noCRD]);

      const props = gridTablePropsRef.current;
      const crdCol = findColumn(props, 'crd');
      const rendered = crdCol.render(noCRD);
      expect(rendered).toBe('-');
    });
  });
});
