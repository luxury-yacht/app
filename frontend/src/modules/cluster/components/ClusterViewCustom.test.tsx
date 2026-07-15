/**
 * frontend/src/modules/cluster/components/ClusterViewCustom.test.tsx
 *
 * Test suite for ClusterViewCustom.
 * Covers key behaviors and edge cases for ClusterViewCustom.
 */

import {
  type CatalogBackedCustomResourceRow,
  catalogItemToFallbackCustomRow,
} from '@modules/browse/hooks/customCatalogRowAdapter';
import ClusterViewCustom from '@modules/cluster/components/ClusterViewCustom';
import { resetResourceInventoryRowCache } from '@modules/resource-grid/useResourceInventoryTable';
import type ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CatalogItem } from '@/core/refresh/types';
import { requireReactElement } from '@/test-utils/requireReactElement';
import { requireValue } from '@/test-utils/requireValue';

type BaseGridTableProps = GridTableProps<CatalogBackedCustomResourceRow>;
type CapturedGridTableProps = BaseGridTableProps & {
  getCustomContextMenuItems: NonNullable<BaseGridTableProps['getCustomContextMenuItems']>;
  filters: NonNullable<BaseGridTableProps['filters']> & {
    options: NonNullable<NonNullable<BaseGridTableProps['filters']>['options']>;
  };
};
type ConfirmationProps = React.ComponentProps<typeof ConfirmationModal>;

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
    onClick: () => undefined,
    title: 'Save as favorite',
  }),
}));

const gridTablePropsRef: { current: CapturedGridTableProps } = {
  current: null as unknown as CapturedGridTableProps,
};
const openWithObjectMock = vi.fn();
const runObjectActionMock = vi.fn();
const useBrowseCatalogMock = vi.hoisted(() => vi.fn());
const useHydratedCustomCatalogRowsMock = vi.hoisted(() => vi.fn());
const modalProps: { current: ConfirmationProps } = {
  current: null as unknown as ConfirmationProps,
};

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: CapturedGridTableProps) => {
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
  useTableSort: (data: CatalogBackedCustomResourceRow[]) => ({
    sortedData: data,
    sortConfig: { key: 'name', direction: 'asc' },
    handleSort: vi.fn(),
  }),
}));

const setFiltersMock = vi.fn();

// The persisted sort starts as null in production (nothing persisted yet);
// tests can set this ref to simulate a stored user sort.
const persistedSortRef = vi.hoisted(() => ({
  current: null as { key: string; direction: 'asc' | 'desc' | null } | null,
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: persistedSortRef.current,
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

vi.mock('@modules/browse/hooks/useBrowseCatalog', () => ({
  useBrowseCatalog: (...args: unknown[]) => useBrowseCatalogMock(...args),
}));

vi.mock('@modules/browse/hooks/useHydratedCustomCatalogRows', () => ({
  useHydratedCustomCatalogRows: (...args: unknown[]) => useHydratedCustomCatalogRowsMock(...args),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  RunObjectAction: (...args: unknown[]) => runObjectActionMock(...args),
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: (props: ConfirmationProps) => {
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
  namespace: '',
  group: 'example.com',
  version: 'v1',
  age: '1d',
  clusterId: 'alpha:ctx',
  clusterName: 'alpha',
  labels: { env: 'prod' },
  annotations: { owner: 'custom-team' },
};

const browseCatalogResult = (items: CatalogItem[] = []) => ({
  items,
  loading: false,
  hasLoadedOnce: true,
  filterOptions: {
    kinds: [],
    namespaces: [],
  },
  totalCount: items.length,
  totalIsExact: true,
  queryDescriptor: {
    clusterId: 'cluster-a',
    namespaces: ['cluster'],
    hasUserNamespaceScope: false,
    kinds: [],
    search: '',
    sortField: 'name',
    sortDirection: 'asc',
    scope: 'cluster-a|customOnly=true&limit=1000&namespace=cluster&sort=name&sortDirection=asc',
    customOnly: true,
  },
  queryPending: false,
  pagination: {
    pageIndex: 1,
    pageLimit: 50,
    pageLimitOptions: [25, 50, 100, 250, 500, 1000],
    setPageLimit: () => undefined,
    totalCount: items.length,
    totalIsExact: true,
    previousToken: null,
    continueToken: null,
    queryPending: false,
    hasMore: false,
    hasPrevious: false,
    isRequestingMore: false,
    onRequestMore: () => undefined,
    onRequestPrevious: () => undefined,
  },
});

const catalogItemFromCustom = (
  resource: {
    kind: string;
    name: string;
    group?: string;
    version?: string;
    age?: string;
    clusterId: string;
    clusterName?: string;
    status?: string;
  },
  overrides: Partial<CatalogItem> = {}
): CatalogItem => {
  const creationTimestamp =
    resource.age === '1d'
      ? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      : (resource.age ?? '');
  return {
    kind: resource.kind,
    group: resource.group ?? '',
    version: resource.version ?? '',
    resource: 'widgets',
    name: resource.name,
    uid: `${resource.name}-uid`,
    resourceVersion: '1',
    creationTimestamp,
    scope: 'Cluster',
    clusterId: resource.clusterId,
    clusterName: resource.clusterName ?? '',
    actionFacts: resource.status ? { status: resource.status } : undefined,
    ...overrides,
  };
};

const catalogItemToClusterCustomData = (item: CatalogItem) => catalogItemToFallbackCustomRow(item);

describe('ClusterViewCustom', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null as unknown as CapturedGridTableProps;
    modalProps.current = null as unknown as ConfirmationProps;
    persistedSortRef.current = null;
    resetResourceInventoryRowCache();
    openWithObjectMock.mockReset();
    runObjectActionMock.mockReset();
    useBrowseCatalogMock.mockReset();
    useBrowseCatalogMock.mockReturnValue(browseCatalogResult());
    useHydratedCustomCatalogRowsMock.mockReset();
    useHydratedCustomCatalogRowsMock.mockImplementation(
      (_clusterId: string, items: CatalogItem[]) => items.map(catalogItemToClusterCustomData)
    );
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders the errored empty state for a catalog error (details report via toasts)', async () => {
    useBrowseCatalogMock.mockReturnValue({
      ...browseCatalogResult(),
      hasLoadedOnce: false,
      error: 'catalog list forbidden',
    });

    await act(async () => {
      root.render(<ClusterViewCustom />);
      await Promise.resolve();
    });

    // No in-table banner exists. A permission-classified catalog error reads
    // as the designed permission state; non-permission errors keep the
    // "Unable to load data" treatment (covered by the inventory-table tests).
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(gridTablePropsRef.current?.emptyMessage).toBe('Insufficient permissions');
  });

  it('passes the unfiltered total through to the filter options', async () => {
    useBrowseCatalogMock.mockReturnValue({
      ...browseCatalogResult([catalogItemFromCustom(baseCustom)]),
      totalCount: 1,
      unfilteredTotal: 25,
    });

    await act(async () => {
      root.render(<ClusterViewCustom loaded={true} />);
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current?.filters?.options?.unfilteredTotal).toBe(25);
  });

  it('replays the last rows on revisit instead of a cold spinner', async () => {
    useBrowseCatalogMock.mockReturnValue(browseCatalogResult([catalogItemFromCustom(baseCustom)]));

    await act(async () => {
      root.render(<ClusterViewCustom loaded={true} />);
      await Promise.resolve();
    });
    expect(gridTablePropsRef.current?.data).toHaveLength(1);

    act(() => {
      root.unmount();
    });
    root = ReactDOM.createRoot(container);

    // Revisit: the catalog restarts cold (no rows, loading). The controller
    // must replay the previous rows instead of blanking to a spinner.
    useBrowseCatalogMock.mockReturnValue({
      ...browseCatalogResult([]),
      loading: true,
      hasLoadedOnce: false,
    });
    await act(async () => {
      root.render(<ClusterViewCustom />);
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current?.data).toHaveLength(1);
  });

  it('queries the catalog with the displayed default sort when no sort is persisted', async () => {
    // The header arrow shows name-ascending by default; the catalog query must
    // sort the same way or the rows render in backend kind-grouped order under
    // a lying indicator.
    await act(async () => {
      root.render(<ClusterViewCustom loaded={true} />);
      await Promise.resolve();
    });

    expect(useBrowseCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ sort: { key: 'name', direction: 'asc' } })
    );
  });

  it('queries the catalog with the persisted user sort when one exists', async () => {
    persistedSortRef.current = { key: 'age', direction: 'desc' };

    await act(async () => {
      root.render(<ClusterViewCustom loaded={true} />);
      await Promise.resolve();
    });

    expect(useBrowseCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({ sort: { key: 'age', direction: 'desc' } })
    );
  });

  it('passes metadata to the object panel when opening a resource', async () => {
    useBrowseCatalogMock.mockReturnValue(browseCatalogResult([catalogItemFromCustom(baseCustom)]));

    await act(async () => {
      root.render(<ClusterViewCustom loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();
    expect(props.data).toEqual([
      expect.objectContaining({
        kind: 'Widget',
        name: 'gizmo',
        clusterId: 'alpha:ctx',
        group: 'example.com',
        version: 'v1',
        crdName: 'widgets.example.com',
        ageTimestamp: expect.any(Number),
      }),
    ]);
    expect(props.data[0].age).toBeUndefined();

    requireValue(
      props.getCustomContextMenuItems(props.data[0], 'kind')[0]?.onClick,
      'expected the cluster custom-resource details action'
    )();
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'Widget',
        name: 'gizmo',
        ageTimestamp: props.data[0].ageTimestamp,
        clusterId: 'alpha:ctx',
        group: 'example.com',
        version: 'v1',
      })
    );
  });

  it('uses the catalog query current page on first render', async () => {
    const queryItem = catalogItemFromCustom({
      ...baseCustom,
      name: 'query-widget',
      clusterId: 'cluster-a',
      clusterName: 'Cluster A',
    });
    useBrowseCatalogMock.mockReturnValue(browseCatalogResult([queryItem]));

    await act(async () => {
      root.render(<ClusterViewCustom loaded={true} />);
      await Promise.resolve();
    });

    expect(useHydratedCustomCatalogRowsMock).toHaveBeenCalledWith('cluster-a', [queryItem]);
    expect(gridTablePropsRef.current?.data).toEqual([
      expect.objectContaining({
        kind: 'Widget',
        name: 'query-widget',
        clusterId: 'cluster-a',
        group: 'example.com',
        version: 'v1',
        crdName: 'widgets.example.com',
      }),
    ]);
    expect(gridTablePropsRef.current?.data).not.toEqual([
      expect.objectContaining({ name: 'stale-local-widget' }),
    ]);
  });

  it('shows the kind dropdown for custom resources', async () => {
    await act(async () => {
      root.render(<ClusterViewCustom loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props?.filters?.options?.showKindDropdown).toBe(true);
    // Export is now the unified frontend fetcher (the GridTable filter bar wires the Copy/Export
    // cluster from it), not a server-side per-action catalog export.
    expect(typeof props?.fetchAllRows).toBe('function');
    expect(
      (props?.filters?.options?.postActions ?? []).some(
        (item) => 'id' in item && item.id === 'copy-cluster-custom-query-csv'
      )
    ).toBe(false);
  });

  it('uses catalog facet metadata instead of deriving kinds from loaded rows', async () => {
    useBrowseCatalogMock.mockReturnValue({
      ...browseCatalogResult(),
      filterOptions: {
        kinds: ['DBCluster', 'Widget'],
        namespaces: [],
        partialDataLabel: 'Catalog health: Catalog data may be stale.',
      },
    });

    await act(async () => {
      root.render(<ClusterViewCustom loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props?.filters?.options?.kinds).toEqual(['DBCluster', 'Widget']);
    expect(props?.filters?.options?.partialDataLabel).toContain('Catalog health');
  });

  it('renders hydrated custom-resource status and metadata for the current page', async () => {
    useBrowseCatalogMock.mockReturnValue(browseCatalogResult([catalogItemFromCustom(baseCustom)]));
    useHydratedCustomCatalogRowsMock.mockReturnValue([
      {
        ...baseCustom,
        crdName: 'widgets.example.com',
        status: 'Ready',
        statusState: 'Ready',
        statusPresentation: 'ready',
      },
    ]);

    await act(async () => {
      root.render(<ClusterViewCustom loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props?.data?.[0]).toEqual(
      expect.objectContaining({
        status: 'Ready',
        statusPresentation: 'ready',
        labels: { env: 'prod' },
        annotations: { owner: 'custom-team' },
      })
    );
  });

  // Regression test mirroring NsViewCustom's colliding-CRD guardrail.
  // The cluster-scoped custom view has
  // the same bug potential: if handleResourceClick drops group/version,
  // a cluster-scoped custom resource whose Kind collides with another CRD
  // group would open against the wrong GVR.
  it('forwards group and version into openWithObject for colliding CRDs', async () => {
    const clusterScopedCR = {
      kind: 'DBCluster',
      name: 'shared-pg',
      namespace: '',
      group: 'postgresql.cnpg.io',
      version: 'v1',
      age: '3d',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
      labels: {},
      annotations: {},
    };

    await act(async () => {
      root.render(<ClusterViewCustom loaded={true} />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();

    requireValue(
      props.getCustomContextMenuItems(clusterScopedCR, 'kind')[0]?.onClick,
      'expected the cluster custom-resource details action'
    )();

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
  it('routes delete through RunObjectAction when group/version are present', async () => {
    runObjectActionMock.mockResolvedValue(undefined);

    const clusterScopedCR = {
      kind: 'DBCluster',
      name: 'shared-pg',
      namespace: '',
      group: 'postgresql.cnpg.io',
      version: 'v1',
      age: '3d',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
      labels: {},
      annotations: {},
    };

    await act(async () => {
      root.render(<ClusterViewCustom loaded={true} />);
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

    expect(runObjectActionMock).toHaveBeenCalledWith({
      action: 'delete',
      target: {
        clusterId: 'alpha:ctx',
        group: 'postgresql.cnpg.io',
        version: 'v1',
        kind: 'DBCluster',
        namespace: '',
        name: 'shared-pg',
      },
    });
  });

  // CRD column: each row gets a clickable cell that opens the owning
  // CustomResourceDefinition in the object panel. Replaces the previous
  // "API Group" column — `<plural>.<group>` is a strict superset of the
  // group alone, and the click-through adds a navigation path the old
  // column lacked. Mirrors NsViewCustom's CRD column tests.
  describe('CRD column', () => {
    const findColumn = (props: CapturedGridTableProps, key: string) =>
      props.columns.find((column) => column.key === key);
    const requireColumn = (props: CapturedGridTableProps, key: string) =>
      requireValue(findColumn(props, key), `expected the cluster custom-resource ${key} column`);

    const resourceWithCRD = {
      ...baseCustom,
      kind: 'DBCluster',
      name: 'shared-pg',
      group: 'postgresql.cnpg.io',
      version: 'v1',
      crdName: 'dbclusters.postgresql.cnpg.io',
    };

    const renderWith = async (rows: CatalogBackedCustomResourceRow[]) => {
      useBrowseCatalogMock.mockReturnValue(
        browseCatalogResult(rows.map((row) => catalogItemFromCustom(row)))
      );
      await act(async () => {
        root.render(<ClusterViewCustom loaded={true} />);
        await Promise.resolve();
      });
    };

    it('replaces the API Group column with a CRD column', async () => {
      await renderWith([resourceWithCRD]);

      const props = gridTablePropsRef.current;
      // Old column is gone…
      expect(findColumn(props, 'apiGroup')).toBeUndefined();
      // …replaced with the new CRD column.
      const crdCol = requireColumn(props, 'crd');
      expect(crdCol).toBeTruthy();
      expect(crdCol.header).toBe('CRD');
    });

    it('renders the CRD cell with the row crdName as a clickable link', async () => {
      await renderWith([resourceWithCRD]);

      const props = gridTablePropsRef.current;
      const crdCol = requireColumn(props, 'crd');
      const rendered = requireReactElement<{
        role?: string;
        children?: React.ReactNode;
        title?: string;
      }>(crdCol.render(resourceWithCRD), 'expected the cluster CRD link element');

      expect(rendered.type).toBe('button');
      expect(rendered.props.role).toBeUndefined();
      expect(rendered.props.children).toBe('dbclusters.postgresql.cnpg.io');
      expect(rendered.props.title).toBe('Open dbclusters.postgresql.cnpg.io');
    });

    it('opens the CRD in the object panel when the CRD cell is clicked', async () => {
      await renderWith([resourceWithCRD]);

      const props = gridTablePropsRef.current;
      const crdCol = requireColumn(props, 'crd');
      const rendered = requireReactElement<{
        onClick?: (event: {
          altKey: boolean;
          preventDefault: () => void;
          stopPropagation: () => void;
        }) => void;
      }>(crdCol.render(resourceWithCRD), 'expected the cluster CRD link element');

      openWithObjectMock.mockClear();
      const onClick = requireValue(
        rendered.props.onClick,
        'expected the cluster CRD click handler'
      );
      onClick({ altKey: false, preventDefault: () => undefined, stopPropagation: () => undefined });

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

    it('does not expose hydrated custom-resource fields as query-backed sort keys', async () => {
      // Custom-resource rows are page-selected by the object catalog before
      // CRD/status are hydrated. Those fields cannot be globally sorted by
      // the query backend, so the columns must not advertise sorting.
      await renderWith([resourceWithCRD]);

      const props = gridTablePropsRef.current;
      const crdCol = requireColumn(props, 'crd');
      const statusCol = requireColumn(props, 'status');
      expect(crdCol.sortable).toBe(false);
      expect(statusCol.sortable).toBe(false);

      // Keep the local extractor intact for defensive consumers, but do not
      // make this a query-backed sortable column.
      expect(crdCol.sortValue).toBeTypeOf('function');
      const sortValue = requireValue(crdCol.sortValue, 'expected the cluster CRD sort accessor');
      expect(sortValue(resourceWithCRD)).toBe('dbclusters.postgresql.cnpg.io');

      const noCRD = { ...baseCustom };
      expect(sortValue(noCRD)).toBe('');
    });

    it('publishes only catalog-backed sortable keys', async () => {
      await renderWith([resourceWithCRD]);

      const props = gridTablePropsRef.current;
      const sortableKeys = props.columns
        .filter((column) => column.sortable !== false)
        .map((column) => column.key)
        .sort((left: string, right: string) => left.localeCompare(right));

      expect(sortableKeys).toEqual(['age', 'kind', 'name']);
    });

    it('renders the CRD cell as inert text when crdName is missing', async () => {
      // Defensive: a row from a legacy snapshot that pre-dates the
      // CRDName field. Cell should render the bare "-" placeholder
      // with no click handler and no openWithObject call.
      const noCRD = { ...baseCustom };
      await renderWith([noCRD]);

      const props = gridTablePropsRef.current;
      const crdCol = requireColumn(props, 'crd');
      const rendered = crdCol.render(noCRD);
      expect(rendered).toBe('-');
    });

    it('uses backend statusPresentation for custom-resource status styling', async () => {
      const resource = {
        ...resourceWithCRD,
        status: 'Ready',
        statusState: 'true',
        statusPresentation: 'ready',
      };
      await renderWith([resource]);

      const props = gridTablePropsRef.current;
      const statusCol = requireColumn(props, 'status');
      const rendered = requireReactElement<{
        children?: React.ReactNode;
        className?: string;
      }>(statusCol.render(resource), 'expected the cluster custom-resource status element');

      expect(rendered.props.children).toBe('Ready');
      expect(rendered.props.className).toBe('status-text ready');
    });
  });
});
