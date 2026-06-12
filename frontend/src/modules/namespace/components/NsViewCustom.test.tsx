/**
 * frontend/src/modules/namespace/components/NsViewCustom.test.tsx
 *
 * Test suite for NsViewCustom.
 * Covers key behaviors and edge cases for NsViewCustom.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type { CatalogItem } from '@/core/refresh/types';

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => ({
    onClick: vi.fn(),
    getClassName: () => 'object-panel-link',
    isInteractive: () => true,
  }),
}));

import NsViewCustom, { type CustomResourceData } from '@modules/namespace/components/NsViewCustom';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const errorHandlerMock = vi.hoisted(() => ({ handle: vi.fn() }));

const gridTableMock = vi.fn();
const modalProps: { current: any } = { current: null };
const openWithObjectMock = vi.fn();
const sortHandlerMock = vi.fn();
const useTableSortMock = vi.fn();
const useShortNamesMock = vi.fn();
const runObjectActionMock = vi.fn();
const useBrowseCatalogMock = vi.hoisted(() => vi.fn());
const useHydratedCustomCatalogRowsMock = vi.hoisted(() => vi.fn());

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

vi.mock('@shared/components/tables/GridTable', () => ({
  __esModule: true,
  default: (props: any) => {
    gridTableMock(props);
    return <div data-testid="grid-table" />;
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: { enabled: true },
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: (props: any) => {
    modalProps.current = props;
    return <div data-testid="confirmation-modal" />;
  },
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context', selectedClusterId: 'cluster-a' }),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (...args: unknown[]) => useTableSortMock(...args),
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => ({
  useNamespaceGridTablePersistence: () => {
    const persistence = {
      sortConfig: { key: 'name', direction: 'asc' },
      setSortConfig: vi.fn(),
      columnWidths: null,
      setColumnWidths: vi.fn(),
      columnVisibility: null,
      setColumnVisibility: vi.fn(),
      filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
      setFilters: vi.fn(),
      pageSize: null,
      setPageSize: vi.fn(),
      resetState: vi.fn(),
      hydrated: true,
    };
    return {
      ...persistence,
      onSortChange: vi.fn(),
      isNamespaceScoped: true,
      persistence,
    };
  },
}));

vi.mock('@modules/browse/hooks/useBrowseCatalog', () => ({
  useBrowseCatalog: (...args: unknown[]) => useBrowseCatalogMock(...args),
}));

vi.mock('@modules/browse/hooks/useHydratedCustomCatalogRows', () => ({
  useHydratedCustomCatalogRows: (...args: unknown[]) => useHydratedCustomCatalogRowsMock(...args),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => useShortNamesMock(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  RunObjectAction: (...args: unknown[]) => runObjectActionMock(...args),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

vi.mock('@/core/capabilities', () => ({
  useUserPermissions: () =>
    new Map([
      ['CronJob:delete', { allowed: true, pending: false }],
      ['CustomResource:delete', { allowed: true, pending: false }],
      ['DBInstance:delete', { allowed: true, pending: false }],
    ]),
  getPermissionKey: (kind: string, action: string) => `${kind}:${action}`,
  // Stubbed for CRDs not covered by the static permission map; the real
  // function lazy-loads delete permissions on first context-menu open.
  queryKindPermissions: vi.fn(),
}));

const baseResource: CustomResourceData = {
  kind: 'CronJob',
  name: 'nightly-cleanup',
  namespace: 'ops',
  clusterId: 'alpha:ctx',
  clusterName: 'alpha',
  apiGroup: 'batch',
  apiVersion: 'v1',
  age: '10m',
  labels: { team: 'platform' },
  annotations: { owner: 'ops' },
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
    namespaces: ['team-a'],
    hasUserNamespaceScope: true,
    kinds: [],
    search: '',
    sortField: 'name',
    sortDirection: 'asc',
    scope: 'cluster-a|customOnly=true&limit=1000&namespace=team-a&sort=name&sortDirection=asc',
    customOnly: true,
  },
  queryPending: false,
  pagination: {
    pageIndex: 1,
    pageLimit: 50,
    pageLimitOptions: [25, 50, 100, 250, 500, 1000],
    setPageLimit: () => {},
    totalCount: items.length,
    totalIsExact: true,
    previousToken: null,
    continueToken: null,
    queryPending: false,
    hasMore: false,
    hasPrevious: false,
    isRequestingMore: false,
    onRequestMore: () => {},
    onRequestPrevious: () => {},
  },
});

const catalogItemFromResource = (
  resource: CustomResourceData,
  overrides: Partial<CatalogItem> = {}
): CatalogItem => ({
  kind: resource.kind || resource.kindAlias || 'CustomResource',
  group: resource.apiGroup ?? '',
  version: resource.apiVersion ?? '',
  resource: 'cronjobs',
  namespace: resource.namespace,
  name: resource.name,
  uid: `${resource.name}-uid`,
  resourceVersion: '1',
  creationTimestamp: resource.age ?? '',
  scope: 'Namespace',
  clusterId: resource.clusterId,
  clusterName: resource.clusterName,
  actionFacts: resource.status ? { status: resource.status } : undefined,
  ...overrides,
});

const catalogItemToCustomResourceData = (item: CatalogItem): CustomResourceData => ({
  kind: item.kind,
  kindAlias: item.kind,
  name: item.name,
  namespace: item.namespace ?? '',
  clusterId: item.clusterId,
  clusterName: item.clusterName,
  apiGroup: item.group,
  apiVersion: item.version,
  group: item.group,
  version: item.version,
  resource: item.resource,
  crdName: item.group ? `${item.resource}.${item.group}` : item.resource,
  status: item.actionFacts?.status,
  statusPresentation: item.actionFacts?.status,
  age: item.creationTimestamp,
});

const getLastGridProps = () => gridTableMock.mock.calls[gridTableMock.mock.calls.length - 1]?.[0];

describe('NsViewCustom', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    gridTableMock.mockReset();
    openWithObjectMock.mockReset();
    sortHandlerMock.mockReset();
    runObjectActionMock.mockReset();
    useBrowseCatalogMock.mockReset();
    useHydratedCustomCatalogRowsMock.mockReset();
    modalProps.current = null;
    useTableSortMock.mockImplementation((data: CustomResourceData[]) => ({
      sortedData: data,
      sortConfig: { key: 'name', direction: 'asc' },
      handleSort: sortHandlerMock,
    }));
    useShortNamesMock.mockReturnValue(false);
    useBrowseCatalogMock.mockReturnValue(browseCatalogResult());
    useHydratedCustomCatalogRowsMock.mockImplementation(
      (_clusterId: string, items: CatalogItem[]) => items.map(catalogItemToCustomResourceData)
    );
    errorHandlerMock.handle.mockClear();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  type NsViewCustomProps = React.ComponentProps<typeof NsViewCustom>;

  const renderComponent = async (props: Partial<NsViewCustomProps> = {}) => {
    const mergedProps: NsViewCustomProps = {
      namespace: 'team-a',
      loading: false,
      loaded: false,
      showNamespaceColumn: false,
      ...props,
    };

    await act(async () => {
      root.render(<NsViewCustom {...mergedProps} />);
      await Promise.resolve();
    });
  };

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('renders GridTable with context menu actions and opens the object panel', async () => {
    useBrowseCatalogMock.mockReturnValue(
      browseCatalogResult([catalogItemFromResource(baseResource)])
    );

    await renderComponent({ loaded: true, showNamespaceColumn: true });

    expect(gridTableMock).toHaveBeenCalled();

    const gridProps = gridTableMock.mock.calls[0][0];
    expect(gridProps.data).toEqual([
      expect.objectContaining({
        kind: 'CronJob',
        name: 'nightly-cleanup',
        namespace: 'ops',
        clusterId: 'alpha:ctx',
        apiGroup: 'batch',
        apiVersion: 'v1',
        crdName: 'cronjobs.batch',
      }),
    ]);
    const row = gridProps.data[0];
    expect(gridProps.keyExtractor(row)).toBe('alpha:ctx|batch/v1/CronJob/ops/nightly-cleanup');
    gridProps.onSort?.('name');
    expect(sortHandlerMock).toHaveBeenCalledWith('name');

    const contextItems = gridProps.getCustomContextMenuItems(row, 'kind');
    expect(contextItems[0].actionId).toBe(OBJECT_ACTION_IDS.viewDetails);
    contextItems[0].onClick();
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CronJob',
        name: 'nightly-cleanup',
        namespace: 'ops',
        clusterId: 'alpha:ctx',
        group: 'batch',
        version: 'v1',
      })
    );
  });

  it('uses the catalog query current page on first render for a single namespace', async () => {
    const queryResource: CustomResourceData = {
      ...baseResource,
      name: 'query-custom',
      namespace: 'team-a',
      clusterId: 'cluster-a',
      clusterName: 'Cluster A',
    };
    const queryItem = catalogItemFromResource(queryResource);
    useBrowseCatalogMock.mockReturnValue(browseCatalogResult([queryItem]));

    await renderComponent({
      namespace: 'team-a',
      loaded: true,
      showNamespaceColumn: false,
    });

    expect(useBrowseCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        pinnedNamespaces: ['team-a'],
        customOnly: true,
      })
    );
    expect(useHydratedCustomCatalogRowsMock).toHaveBeenCalledWith('cluster-a', [queryItem]);
    expect(getLastGridProps()?.data).toEqual([
      expect.objectContaining({
        kind: 'CronJob',
        name: 'query-custom',
        namespace: 'team-a',
        clusterId: 'cluster-a',
        apiGroup: 'batch',
        apiVersion: 'v1',
        crdName: 'cronjobs.batch',
      }),
    ]);
    expect(getLastGridProps()?.data).not.toEqual([
      expect.objectContaining({ name: 'stale-local-custom' }),
    ]);
  });

  it('uses the catalog query current page on first render for all namespaces', async () => {
    const queryResource: CustomResourceData = {
      ...baseResource,
      name: 'query-all-custom',
      namespace: 'team-b',
      clusterId: 'cluster-a',
      clusterName: 'Cluster A',
    };
    const queryItem = catalogItemFromResource(queryResource);
    useBrowseCatalogMock.mockReturnValue(browseCatalogResult([queryItem]));

    await renderComponent({
      namespace: ALL_NAMESPACES_SCOPE,
      loaded: true,
      showNamespaceColumn: true,
    });

    expect(useBrowseCatalogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'cluster-a',
        pinnedNamespaces: [],
        customOnly: true,
      })
    );
    expect(useHydratedCustomCatalogRowsMock).toHaveBeenCalledWith('cluster-a', [queryItem]);
    expect(getLastGridProps()?.data).toEqual([
      expect.objectContaining({
        kind: 'CronJob',
        name: 'query-all-custom',
        namespace: 'team-b',
        clusterId: 'cluster-a',
        apiGroup: 'batch',
        apiVersion: 'v1',
        crdName: 'cronjobs.batch',
      }),
    ]);
    expect(getLastGridProps()?.data).not.toEqual([
      expect.objectContaining({ name: 'stale-local-custom' }),
    ]);
  });

  it('enables searchable kind dropdown bulk actions in all-namespaces custom view', async () => {
    await renderComponent({
      namespace: ALL_NAMESPACES_SCOPE,
      loaded: true,
      showNamespaceColumn: true,
    });

    const gridProps = gridTableMock.mock.calls[0][0];
    expect(gridProps.filters.options.showKindDropdown).toBe(true);
    expect(gridProps.filters.options.kindDropdownSearchable).toBe(true);
    expect(gridProps.filters.options.kindDropdownBulkActions).toBe(true);
    // Export is now the unified frontend fetcher, not a server-side per-action catalog export.
    expect(typeof gridProps.fetchAllRows).toBe('function');
    expect(
      (gridProps.filters.options.postActions ?? []).some(
        (item: any) => item.id === 'copy-namespace-custom-query-csv'
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

    await renderComponent({
      loaded: true,
    });

    const gridProps = getLastGridProps();
    expect(gridProps?.filters?.options?.kinds).toEqual(['DBCluster', 'Widget']);
    expect(gridProps?.filters?.options?.partialDataLabel).toContain('Catalog health');
  });

  it('renders hydrated custom-resource status and metadata for the current page', async () => {
    useBrowseCatalogMock.mockReturnValue(
      browseCatalogResult([catalogItemFromResource(baseResource)])
    );
    useHydratedCustomCatalogRowsMock.mockReturnValue([
      {
        ...baseResource,
        crdName: 'cronjobs.batch',
        status: 'Ready',
        statusState: 'Ready',
        statusPresentation: 'ready',
      },
    ]);

    await renderComponent({ loaded: true });

    const gridProps = getLastGridProps();
    expect(gridProps?.data?.[0]).toEqual(
      expect.objectContaining({
        status: 'Ready',
        statusPresentation: 'ready',
        labels: { team: 'platform' },
        annotations: { owner: 'ops' },
      })
    );
  });

  it('preserves the column definitions across rerenders with unchanged inputs', async () => {
    await renderComponent({
      namespace: 'team-a',
      loaded: true,
      showNamespaceColumn: true,
    });

    const firstColumnsRef = getLastGridProps()?.columns;

    await renderComponent({
      namespace: 'team-a',
      loaded: true,
      showNamespaceColumn: true,
    });

    expect(getLastGridProps()?.columns).toBe(firstColumnsRef);
  });

  it('preserves the filters config across rerenders with unchanged inputs', async () => {
    await renderComponent({
      namespace: 'team-a',
      loaded: true,
      showNamespaceColumn: true,
    });

    const firstFiltersRef = getLastGridProps()?.filters;

    await renderComponent({
      namespace: 'team-a',
      loaded: true,
      showNamespaceColumn: true,
    });

    expect(getLastGridProps()?.filters).toBe(firstFiltersRef);
  });

  // Regression test for the kind-only-objects bug. When the user clicks a custom
  // resource whose Kind collides with another CRD from a different API
  // group (e.g. DBInstance from rds.services.k8s.aws vs DBInstance from
  // documentdb.services.k8s.aws), handleResourceClick MUST forward both
  // apiGroup and apiVersion into openWithObject. Without them, the panel
  // state has no group/version to emit in the refresh-domain scope, the
  // backend falls back to first-match-wins kind-only GVR resolution, and
  // the user sees the wrong DBInstance's YAML.
  //
  // Before the fix at NsViewCustom.tsx handleResourceClick, this test
  // would have failed with:
  //   Expected: objectContaining({ group: 'documentdb.services.k8s.aws', version: 'v1alpha1' })
  //   Received: { kind: 'DBInstance', name: 'db-dc-test-1-v4', ... } // no group/version
  //
  // Keeping this as a permanent regression guardrail so we don't
  // silently drop these fields again in a future refactor.
  it('forwards apiGroup and apiVersion into openWithObject for colliding CRDs', async () => {
    const dbInstance: CustomResourceData = {
      kind: 'DBInstance',
      name: 'db-dc-test-1-v4',
      namespace: 'team-a',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
      apiGroup: 'documentdb.services.k8s.aws',
      apiVersion: 'v1alpha1',
      age: '2h',
      labels: {},
      annotations: {},
    };

    await renderComponent({ loaded: true, showNamespaceColumn: true });

    const gridProps = gridTableMock.mock.calls[0][0];
    const contextItems = gridProps.getCustomContextMenuItems(dbInstance, 'kind');
    expect(contextItems[0].actionId).toBe(OBJECT_ACTION_IDS.viewDetails);
    contextItems[0].onClick();

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'DBInstance',
        name: 'db-dc-test-1-v4',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
        group: 'documentdb.services.k8s.aws',
        version: 'v1alpha1',
      })
    );

    // Also assert the openWithObject payload that downstream code receives
    // has group/version as actual OWN properties of the object (not lost
    // through a spread), since any spread-loss would defeat the purpose.
    const callArg = openWithObjectMock.mock.calls.find(
      ([arg]) => (arg as { name?: string }).name === 'db-dc-test-1-v4'
    )?.[0] as Record<string, unknown>;
    expect(callArg).toBeDefined();
    expect(callArg.group).toBe('documentdb.services.k8s.aws');
    expect(callArg.version).toBe('v1alpha1');
  });

  it('confirms deletion with a full object action target', async () => {
    runObjectActionMock.mockResolvedValue(undefined);

    // Every custom resource row the backend catalog produces carries
    // apiGroup/apiVersion — the delete path is GVK-only after the
    // kind-only-objects fix.
    const resourceWithGVK: CustomResourceData = {
      ...baseResource,
      apiGroup: 'batch',
      apiVersion: 'v1',
    };

    await renderComponent({
      loaded: true,
      showNamespaceColumn: true,
    });

    const gridProps = gridTableMock.mock.calls[0][0];
    const contextItems = gridProps.getCustomContextMenuItems(resourceWithGVK, 'kind');
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
        group: 'batch',
        version: 'v1',
        kind: 'CronJob',
        namespace: 'ops',
        name: 'nightly-cleanup',
      },
    });
    await flush();
    expect(modalProps.current?.isOpen).toBe(false);
  });

  // Regression test for the delete-path leg of the kind-only-objects bug.
  // When the user confirms deletion of a custom
  // resource whose Kind collides with another CRD from a different API
  // group (e.g. two DBInstance CRDs), handleDeleteConfirm must carry the
  // strict GVK through the action boundary so the backend targets the exact object.
  it('routes delete through RunObjectAction when apiGroup/apiVersion are present', async () => {
    runObjectActionMock.mockResolvedValue(undefined);

    const dbInstance: CustomResourceData = {
      kind: 'DBInstance',
      name: 'db-dc-test-1-v4',
      namespace: 'team-a',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
      apiGroup: 'documentdb.services.k8s.aws',
      apiVersion: 'v1alpha1',
      age: '2h',
      labels: {},
      annotations: {},
    };

    await renderComponent({ loaded: true, showNamespaceColumn: true });

    const gridProps = gridTableMock.mock.calls[0][0];
    const contextItems = gridProps.getCustomContextMenuItems(dbInstance, 'kind');
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
        group: 'documentdb.services.k8s.aws',
        version: 'v1alpha1',
        kind: 'DBInstance',
        namespace: 'team-a',
        name: 'db-dc-test-1-v4',
      },
    });
    // The legacy kind-only path has been retired entirely. This assertion
    // used to check that it wasn't hit; now it's gone from the app surface.

    await flush();
    expect(modalProps.current?.isOpen).toBe(false);
  });

  // Characterization of the post-fix contract: after the kind-only-objects
  // cleanup, CustomResourceData is required to carry apiGroup/apiVersion.
  // A row that's missing apiVersion is a programming bug, and handleDelete
  // must fail loud rather than silently fall back to first-match-wins
  // discovery. The errorHandler should see the thrown error.
  it('throws instead of falling back when apiGroup/apiVersion are missing', async () => {
    const missingGVK: CustomResourceData = {
      ...baseResource,
      apiGroup: undefined,
      apiVersion: undefined,
    };

    await renderComponent({ loaded: true, showNamespaceColumn: true });

    const gridProps = gridTableMock.mock.calls[0][0];
    const contextItems = gridProps.getCustomContextMenuItems(missingGVK, 'kind');
    const deleteItem = contextItems.find(
      (item: { label?: string; onClick?: () => void }) => item.label === 'Delete'
    );
    await act(async () => {
      deleteItem?.onClick?.();
      await Promise.resolve();
    });

    await act(async () => {
      await modalProps.current.onConfirm();
    });

    expect(runObjectActionMock).not.toHaveBeenCalled();
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('apiVersion missing') }),
      { action: 'delete', kind: 'CronJob', name: 'nightly-cleanup' }
    );

    await flush();
    expect(modalProps.current?.isOpen).toBe(false);
  });

  it('handles delete failure with errorHandler and reverts modal state', async () => {
    runObjectActionMock.mockRejectedValue(new Error('failure'));

    const resourceWithGVK: CustomResourceData = {
      ...baseResource,
      apiGroup: 'batch',
      apiVersion: 'v1',
    };

    await renderComponent({
      loaded: true,
      showNamespaceColumn: true,
    });

    const gridProps = gridTableMock.mock.calls[0][0];
    const deleteItem = gridProps
      .getCustomContextMenuItems(resourceWithGVK, 'kind')
      .find((item: { label?: string; onClick?: () => void }) => item.label === 'Delete');
    await act(async () => {
      deleteItem?.onClick?.();
      await Promise.resolve();
    });

    await act(async () => {
      await modalProps.current.onConfirm();
    });

    expect(runObjectActionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'delete',
        target: expect.objectContaining({
          clusterId: 'alpha:ctx',
          group: 'batch',
          version: 'v1',
          kind: 'CronJob',
          namespace: 'ops',
          name: 'nightly-cleanup',
        }),
      })
    );
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'delete',
      kind: 'CronJob',
      name: 'nightly-cleanup',
    });

    await flush();
    expect(modalProps.current?.isOpen).toBe(false);
  });

  it('adjusts column sizing when short names are enabled', async () => {
    useShortNamesMock.mockReturnValue(true);

    await renderComponent({
      loaded: true,
      showNamespaceColumn: true,
    });

    const gridProps = gridTableMock.mock.calls[0][0];

    const generatedKey = gridProps.keyExtractor({
      kind: 'CronJob',
      name: 'svc',
      namespace: 'tools',
      kindAlias: 'CR',
      clusterId: 'alpha:ctx',
      apiGroup: 'batch',
      apiVersion: 'v1',
    } as CustomResourceData);
    expect(generatedKey).toBe('alpha:ctx|batch/v1/CronJob/tools/svc');
  });

  // CRD column: each row gets a clickable cell that opens the owning
  // CustomResourceDefinition in the object panel. The CRD itself is a
  // built-in (apiextensions.k8s.io/v1) so its GVK comes from the
  // built-in lookup table, not from the row data.
  //
  // The column factory bakes the click handler into the rendered React
  // element rather than exposing it on the column object, so these
  // tests drive the behavior by inspecting / calling the rendered
  // element's `onClick` prop directly.
  describe('CRD column', () => {
    const findColumn = (props: any, key: string) =>
      props.columns.find((col: any) => col.key === key);

    it('adds a CRD column that renders the row crdName', async () => {
      const resource: CustomResourceData = {
        ...baseResource,
        apiGroup: 'rds.services.k8s.aws',
        apiVersion: 'v1alpha1',
        kind: 'DBInstance',
        crdName: 'dbinstances.rds.services.k8s.aws',
      };

      await renderComponent({ loaded: true });

      const gridProps = gridTableMock.mock.calls[0][0];
      const crdCol = findColumn(gridProps, 'crd');
      expect(crdCol).toBeTruthy();
      expect(crdCol.header).toBe('CRD');

      // Interactive cells render as a `<span role="button">` with the
      // CRD name as their child text.
      const rendered = crdCol.render(resource) as React.ReactElement<any>;
      expect(rendered).toBeTruthy();
      expect((rendered as any).type).toBe('span');
      expect((rendered as any).props.role).toBe('button');
      expect((rendered as any).props.children).toBe('dbinstances.rds.services.k8s.aws');
      expect((rendered as any).props.title).toBe('Open dbinstances.rds.services.k8s.aws');
    });

    it('opens the CRD in the object panel when the CRD cell is clicked', async () => {
      const resource: CustomResourceData = {
        ...baseResource,
        apiGroup: 'rds.services.k8s.aws',
        apiVersion: 'v1alpha1',
        kind: 'DBInstance',
        crdName: 'dbinstances.rds.services.k8s.aws',
      };

      await renderComponent({ loaded: true });

      const gridProps = gridTableMock.mock.calls[0][0];
      const crdCol = findColumn(gridProps, 'crd');
      const rendered = crdCol.render(resource) as React.ReactElement<any>;

      // The rendered span carries the click handler. Drive it directly
      // with a synthetic event that doesn't have altKey set (so the
      // primary onClick fires, not onAltClick).
      openWithObjectMock.mockClear();
      const onClick = (rendered as any).props.onClick as (e: any) => void;
      expect(onClick).toBeTypeOf('function');
      onClick({ altKey: false, preventDefault: () => {}, stopPropagation: () => {} });

      expect(openWithObjectMock).toHaveBeenCalledTimes(1);
      const callArg = openWithObjectMock.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.kind).toBe('CustomResourceDefinition');
      expect(callArg.name).toBe('dbinstances.rds.services.k8s.aws');
      // The CRD is a built-in — its GVK comes from resolveBuiltinGroupVersion,
      // which returns apiextensions.k8s.io/v1.
      expect(callArg.group).toBe('apiextensions.k8s.io');
      expect(callArg.version).toBe('v1');
      // CRDs are cluster-scoped — namespace must NOT be set on the ref.
      expect(callArg.namespace).toBeUndefined();
      // ClusterId/clusterName threaded through for multi-cluster routing.
      expect(callArg.clusterId).toBe('alpha:ctx');
      expect(callArg.clusterName).toBe('alpha');
    });

    it('does not expose hydrated custom-resource fields as query-backed sort keys', async () => {
      // Custom-resource rows are page-selected by the object catalog before
      // CRD/status are hydrated. Those fields cannot be globally sorted by
      // the query backend, so the columns must not advertise sorting.
      const resource: CustomResourceData = {
        ...baseResource,
        crdName: 'dbinstances.rds.services.k8s.aws',
      };

      await renderComponent({ loaded: true });

      const gridProps = gridTableMock.mock.calls[0][0];
      const crdCol = findColumn(gridProps, 'crd');
      const statusCol = findColumn(gridProps, 'status');
      expect(crdCol.sortable).toBe(false);
      expect(statusCol.sortable).toBe(false);

      // Keep the local extractor intact for defensive consumers, but do not
      // make this a query-backed sortable column.
      expect(crdCol.sortValue).toBeTypeOf('function');

      expect(crdCol.sortValue(resource)).toBe('dbinstances.rds.services.k8s.aws');

      const noCRD: CustomResourceData = { ...baseResource };
      expect(crdCol.sortValue(noCRD)).toBe('');
    });

    it('publishes only catalog-backed sortable keys', async () => {
      await renderComponent({ loaded: true, showNamespaceColumn: true });

      const gridProps = gridTableMock.mock.calls[0][0];
      const sortableKeys = gridProps.columns
        .filter((column: any) => column.sortable !== false)
        .map((column: any) => column.key)
        .sort((left: string, right: string) => left.localeCompare(right));

      expect(sortableKeys).toEqual(['age', 'kind', 'name', 'namespace']);
    });

    it('renders the CRD cell as inert text when crdName is missing', async () => {
      // Defensive: a row from a legacy snapshot or a synthetic source
      // might not carry crdName. The cell should not be clickable, must
      // not throw, and must not call openWithObject. The column factory
      // returns the placeholder string '-' for accessor === undefined
      // when the cell is non-interactive.
      const resource: CustomResourceData = {
        ...baseResource,
        apiGroup: 'batch',
        apiVersion: 'v1',
        kind: 'CronJob',
        // crdName intentionally omitted
      };

      await renderComponent({ loaded: true });

      const gridProps = gridTableMock.mock.calls[0][0];
      const crdCol = findColumn(gridProps, 'crd');
      const rendered = crdCol.render(resource);

      // Non-interactive accessor-undefined path returns the string '-'
      // directly (no wrapping span, no role="button", no onClick).
      expect(rendered).toBe('-');
    });

    it('uses backend statusPresentation for custom-resource status styling', async () => {
      const resource: CustomResourceData = {
        ...baseResource,
        apiGroup: 'rds.services.k8s.aws',
        apiVersion: 'v1alpha1',
        kind: 'DBInstance',
        status: 'Not Ready',
        statusState: 'false',
        statusPresentation: 'warning',
      };

      await renderComponent({ loaded: true });

      const gridProps = gridTableMock.mock.calls[0][0];
      const statusCol = findColumn(gridProps, 'status');
      const rendered = statusCol.render(resource) as React.ReactElement<any>;

      expect((rendered as any).props.children).toBe('Not Ready');
      expect((rendered as any).props.className).toBe('status-text warning');
    });
  });
});
