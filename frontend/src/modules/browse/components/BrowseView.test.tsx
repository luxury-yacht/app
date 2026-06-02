/**
 * frontend/src/modules/browse/components/BrowseView.test.tsx
 *
 * Test suite for the BrowseView component.
 * Covers cluster scope, namespace scope, and all-namespaces scope scenarios.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import BrowseView from '@/modules/browse/components/BrowseView';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';

const exportCatalogQueryCSVFileMock = vi.hoisted(() => vi.fn());
const runCatalogQueryBulkActionMock = vi.hoisted(() => vi.fn());

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
const persistenceArgsRef: { cluster: any | null; namespace: any | null } = {
  cluster: null,
  namespace: null,
};
const persistenceFiltersRef: {
  current: { search: string; kinds: string[]; namespaces: string[]; caseSensitive: boolean };
} = {
  current: { search: '', kinds: [], namespaces: [], caseSensitive: false },
};

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

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfig: 'path:context',
    selectedClusterId: 'cluster-1',
    selectedClusterIds: ['cluster-1'],
  }),
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({ setSelectedNamespace: vi.fn() }),
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => true,
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({ onNamespaceSelect: vi.fn(), setActiveNamespaceTab: vi.fn() }),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  ExportCatalogSelectionCSVFile: (...args: unknown[]) => exportCatalogQueryCSVFileMock(...args),
  RunCatalogQueryBulkAction: (...args: unknown[]) => runCatalogQueryBulkActionMock(...args),
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: (
    kind: string,
    verb: string,
    namespace?: string | null,
    subresource?: string | null,
    clusterId?: string | null,
    group?: string | null,
    version?: string | null
  ) =>
    [
      clusterId ?? '',
      group ?? '',
      version ?? '',
      kind,
      namespace ?? '',
      verb,
      subresource ?? '',
    ].join('|'),
  queryKindPermissions: vi.fn(),
  useUserPermissions: () => {
    const permissions = new Map();
    permissions.get = () => ({ allowed: true, pending: false });
    return permissions;
  },
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

const refreshMocks = vi.hoisted(() => ({
  manager: {
    disable: vi.fn(),
  },
  orchestrator: {
    setDomainEnabled: vi.fn(),
    setScopedDomainEnabled: vi.fn(),
    fetchScopedDomain: vi.fn().mockResolvedValue(undefined),
  },
  useRefreshScopedDomain: vi.fn(),
  catalogDomain: {
    status: 'idle' as any,
    data: null as any,
    scope: undefined as string | undefined,
  },
  scopedDomains: new Map<string, any>(),
}));

vi.mock('@/core/refresh', () => ({
  refreshManager: refreshMocks.manager,
  refreshOrchestrator: refreshMocks.orchestrator,
  useRefreshScopedDomain: (...args: unknown[]) => refreshMocks.useRefreshScopedDomain(...args),
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: (params: any) => {
    persistenceArgsRef.cluster = params;
    return {
      sortConfig: { key: 'kind', direction: 'asc' },
      setSortConfig: vi.fn(),
      columnWidths: null,
      setColumnWidths: vi.fn(),
      columnVisibility: null,
      setColumnVisibility: vi.fn(),
      filters: persistenceFiltersRef.current,
      setFilters: vi.fn(),
      resetState: vi.fn(),
      hydrated: true,
      storageKey: 'gridtable:v1:test',
    };
  },
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => ({
  useNamespaceGridTablePersistence: (params: any) => {
    persistenceArgsRef.namespace = params;
    return {
      sortConfig: { key: 'kind', direction: 'asc' },
      onSortChange: vi.fn(),
      columnWidths: null,
      setColumnWidths: vi.fn(),
      columnVisibility: null,
      setColumnVisibility: vi.fn(),
      filters: persistenceFiltersRef.current,
      setFilters: vi.fn(),
      isNamespaceScoped: true,
      resetState: vi.fn(),
    };
  },
}));

const catalogItem = (overrides: Partial<CatalogItem>): CatalogItem => ({
  clusterId: 'cluster-1',
  clusterName: 'Cluster 1',
  kind: 'Pod',
  group: '',
  version: 'v1',
  resource: 'pods',
  namespace: 'default',
  name: 'pod-a',
  uid: 'pod-a',
  resourceVersion: '1',
  creationTimestamp: '2026-01-01T00:00:00Z',
  scope: 'Namespace',
  ...overrides,
});

const sortableKeys = (): string[] =>
  (gridTablePropsRef.current?.columns ?? [])
    .filter((column: any) => column.sortable !== false)
    .map((column: any) => column.key)
    .sort((left: string, right: string) => left.localeCompare(right));

const catalogPayload = (
  items: CatalogItem[],
  overrides: Partial<CatalogSnapshotPayload> = {}
): CatalogSnapshotPayload => ({
  clusterId: 'cluster-1',
  clusterName: 'Cluster 1',
  items,
  continue: '',
  total: items.length,
  totalIsExact: true,
  resourceCount: items.length,
  kinds: [
    { kind: 'Node', namespaced: false },
    { kind: 'Pod', namespaced: true },
  ],
  namespaces: Array.from(
    new Set(
      items
        .map((item) => item.namespace)
        .filter((namespace): namespace is string => Boolean(namespace))
    )
  ),
  facetsExact: true,
  batchIndex: 0,
  batchSize: items.length,
  totalBatches: 1,
  isFinal: true,
  ...overrides,
});

describe('BrowseView', () => {
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
    refreshMocks.orchestrator.setDomainEnabled.mockReset();
    refreshMocks.orchestrator.setScopedDomainEnabled.mockReset();
    refreshMocks.orchestrator.fetchScopedDomain.mockReset().mockResolvedValue(undefined);
    refreshMocks.manager.disable.mockReset();
    refreshMocks.useRefreshScopedDomain.mockReset();
    refreshMocks.catalogDomain.status = 'idle';
    refreshMocks.catalogDomain.data = null;
    refreshMocks.catalogDomain.scope = undefined;
    refreshMocks.scopedDomains.clear();
    refreshMocks.useRefreshScopedDomain.mockImplementation((domain: string, scope: string) => {
      void domain;
      return refreshMocks.scopedDomains.get(scope) ?? refreshMocks.catalogDomain;
    });
    persistenceArgsRef.cluster = null;
    persistenceArgsRef.namespace = null;
    persistenceFiltersRef.current = { search: '', kinds: [], namespaces: [], caseSensitive: false };
    exportCatalogQueryCSVFileMock
      .mockReset()
      .mockResolvedValue({ path: '/tmp/catalog.csv', bytes: 29 });
    runCatalogQueryBulkActionMock.mockReset().mockResolvedValue({
      processed: 1,
      succeeded: 1,
      failed: 0,
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  describe('Cluster scope (namespace=undefined)', () => {
    it('renders the first cluster-scoped page directly from the catalog query payload', async () => {
      const node = catalogItem({
        kind: 'Node',
        resource: 'nodes',
        namespace: undefined,
        name: 'query-node',
        uid: 'node-1',
        scope: 'Cluster',
      });
      refreshMocks.catalogDomain.status = 'ready';
      refreshMocks.catalogDomain.scope = 'cluster-1|limit=50&namespace=cluster';
      refreshMocks.catalogDomain.data = catalogPayload([node], {
        kinds: [
          { kind: 'Node', namespaced: false },
          { kind: 'Pod', namespaced: true },
        ],
      });

      await act(async () => {
        root.render(<BrowseView namespace={undefined} />);
        await Promise.resolve();
      });

      expect(gridTablePropsRef.current?.data).toEqual([
        expect.objectContaining({
          name: 'query-node',
          scope: 'Cluster',
          item: expect.objectContaining({
            clusterId: 'cluster-1',
            group: '',
            version: 'v1',
            kind: 'Node',
            name: 'query-node',
          }),
        }),
      ]);
    });

    it('sets the catalog scope and triggers a manual refresh on mount', async () => {
      await act(async () => {
        root.render(<BrowseView />);
        await Promise.resolve();
      });

      expect(refreshMocks.orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
        'catalog',
        'cluster-1|limit=50&namespace=cluster',
        true
      );
      expect(refreshMocks.orchestrator.fetchScopedDomain).toHaveBeenCalledWith(
        'catalog',
        'cluster-1|limit=50&namespace=cluster',
        expect.objectContaining({ isManual: false })
      );
    });

    it('hides namespace column for cluster scope (cluster-scoped objects only)', async () => {
      await act(async () => {
        root.render(<BrowseView namespace={undefined} />);
        await Promise.resolve();
      });

      // Cluster scope only shows cluster-scoped objects, so namespace column is hidden
      const columns = gridTablePropsRef.current?.columns ?? [];
      const hasNamespaceColumn = columns.some((col: any) => col.key === 'namespace');
      expect(hasNamespaceColumn).toBe(false);
    });

    it('publishes only catalog-backed sortable keys for cluster scope', async () => {
      await act(async () => {
        root.render(<BrowseView namespace={undefined} />);
        await Promise.resolve();
      });

      expect(sortableKeys()).toEqual(['age', 'kind', 'name']);
    });

    it('hides namespace filtering for cluster scope (cluster-scoped objects only)', async () => {
      await act(async () => {
        root.render(<BrowseView namespace={undefined} />);
        await Promise.resolve();
      });

      // Cluster scope only shows cluster-scoped objects, so namespace dropdown is hidden
      expect(gridTablePropsRef.current?.filters?.options?.showNamespaceDropdown).toBe(false);
    });

    it('enables kind dropdown bulk actions for browse filters', async () => {
      await act(async () => {
        root.render(<BrowseView namespace={undefined} />);
        await Promise.resolve();
      });

      expect(gridTablePropsRef.current?.filters?.options?.kindDropdownBulkActions).toBe(true);
    });

    it('uses the cluster browse persistence id', async () => {
      await act(async () => {
        root.render(<BrowseView namespace={undefined} />);
        await Promise.resolve();
      });

      expect(persistenceArgsRef.cluster?.viewId).toBe('browse');
    });
  });

  describe('Namespace scope (namespace=specific)', () => {
    it('renders the first namespace page directly from the catalog query payload', async () => {
      refreshMocks.catalogDomain.status = 'ready';
      refreshMocks.catalogDomain.scope = 'cluster-1|limit=50&namespace=team-a';
      refreshMocks.catalogDomain.data = catalogPayload([
        catalogItem({
          namespace: 'team-a',
          name: 'query-pod',
          uid: 'pod-1',
        }),
      ]);

      await act(async () => {
        root.render(<BrowseView namespace="team-a" />);
        await Promise.resolve();
      });

      expect(gridTablePropsRef.current?.data).toEqual([
        expect.objectContaining({
          name: 'query-pod',
          namespaceDisplay: 'team-a',
          item: expect.objectContaining({
            clusterId: 'cluster-1',
            group: '',
            version: 'v1',
            kind: 'Pod',
            namespace: 'team-a',
            name: 'query-pod',
          }),
        }),
      ]);
    });

    it('hides namespace column for namespace scope', async () => {
      await act(async () => {
        root.render(<BrowseView namespace="default" />);
        await Promise.resolve();
      });

      // Check that columns do not include namespace column
      const columns = gridTablePropsRef.current?.columns ?? [];
      const hasNamespaceColumn = columns.some((col: any) => col.key === 'namespace');
      expect(hasNamespaceColumn).toBe(false);
    });

    it('disables namespace filtering for namespace scope', async () => {
      await act(async () => {
        root.render(<BrowseView namespace="default" />);
        await Promise.resolve();
      });

      expect(gridTablePropsRef.current?.filters?.options?.showNamespaceDropdown).toBe(false);
    });

    it('pins to the specified namespace', async () => {
      await act(async () => {
        root.render(<BrowseView namespace="kube-system" />);
        await Promise.resolve();
      });

      // The scope should include the pinned namespace
      expect(refreshMocks.orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
        'catalog',
        'cluster-1|limit=50&namespace=kube-system',
        true
      );
    });
  });

  describe('All Namespaces scope', () => {
    it('renders the first all-namespaces page directly from the catalog query payload', async () => {
      refreshMocks.catalogDomain.status = 'ready';
      refreshMocks.catalogDomain.scope = 'cluster-1|limit=50';
      refreshMocks.catalogDomain.data = catalogPayload([
        catalogItem({
          namespace: 'team-b',
          name: 'query-all-pod',
          uid: 'pod-all-1',
        }),
      ]);

      await act(async () => {
        root.render(<BrowseView namespace={ALL_NAMESPACES_SCOPE} />);
        await Promise.resolve();
      });

      expect(gridTablePropsRef.current?.data).toEqual([
        expect.objectContaining({
          name: 'query-all-pod',
          namespaceDisplay: 'team-b',
          item: expect.objectContaining({
            clusterId: 'cluster-1',
            group: '',
            version: 'v1',
            kind: 'Pod',
            namespace: 'team-b',
            name: 'query-all-pod',
          }),
        }),
      ]);
    });

    it('uses a distinct persistence id from cluster browse', async () => {
      await act(async () => {
        root.render(<BrowseView namespace={ALL_NAMESPACES_SCOPE} />);
        await Promise.resolve();
      });

      expect(persistenceArgsRef.cluster?.viewId).toBe('all-namespaces-browse');
    });

    it('shows namespace column for all-namespaces scope', async () => {
      await act(async () => {
        root.render(<BrowseView namespace={ALL_NAMESPACES_SCOPE} />);
        await Promise.resolve();
      });

      // Check that columns include namespace column
      const columns = gridTablePropsRef.current?.columns ?? [];
      const hasNamespaceColumn = columns.some((col: any) => col.key === 'namespace');
      expect(hasNamespaceColumn).toBe(true);
    });

    it('publishes only catalog-backed sortable keys for all-namespaces scope', async () => {
      await act(async () => {
        root.render(<BrowseView namespace={ALL_NAMESPACES_SCOPE} />);
        await Promise.resolve();
      });

      expect(sortableKeys()).toEqual(['age', 'kind', 'name', 'namespace']);
    });

    it('enables namespace filtering for all-namespaces scope', async () => {
      await act(async () => {
        root.render(<BrowseView namespace={ALL_NAMESPACES_SCOPE} />);
        await Promise.resolve();
      });

      expect(gridTablePropsRef.current?.filters?.options?.showNamespaceDropdown).toBe(true);
    });

    it('keeps kind and namespace filter options stable while active browse filters change', async () => {
      persistenceFiltersRef.current = {
        search: 'api',
        kinds: ['Pod'],
        namespaces: ['default'],
        caseSensitive: false,
      };
      refreshMocks.scopedDomains.set('cluster-1|limit=50&search=api&kind=Pod&namespace=default', {
        status: 'ready',
        data: {
          items: [],
          kinds: [{ kind: 'Pod', namespaced: true }],
          namespaces: ['default'],
        },
        scope: 'cluster-1|limit=50&search=api&kind=Pod&namespace=default',
      });
      refreshMocks.scopedDomains.set('cluster-1|limit=1', {
        status: 'ready',
        data: {
          items: [],
          kinds: [
            { kind: 'Deployment', namespaced: true },
            { kind: 'Pod', namespaced: true },
          ],
          namespaces: ['default', 'kube-system'],
        },
        scope: 'cluster-1|limit=1',
      });

      await act(async () => {
        root.render(<BrowseView namespace={ALL_NAMESPACES_SCOPE} />);
        await Promise.resolve();
      });

      expect(gridTablePropsRef.current?.filters?.options?.kinds).toEqual(['Deployment', 'Pod']);
      expect(gridTablePropsRef.current?.filters?.options?.namespaces).toEqual([
        'default',
        'kube-system',
      ]);
    });
  });

  describe('Row cap UI', () => {
    it('renders query pagination in the table footer and suppresses split top counts', async () => {
      refreshMocks.catalogDomain.scope = 'cluster-1|limit=50&namespace=cluster';
      refreshMocks.catalogDomain.data = {
        items: [
          {
            uid: '1',
            kind: 'Node',
            name: 'node-a',
            namespace: null,
            scope: 'Cluster',
            resource: 'nodes',
            group: '',
            version: 'v1',
            resourceVersion: '1',
            creationTimestamp: new Date().toISOString(),
            clusterId: 'cluster-1',
          },
        ],
        continue: '200',
        batchSize: 200,
        total: 1200,
      };
      refreshMocks.catalogDomain.status = 'ready';

      await act(async () => {
        root.render(<BrowseView namespace={undefined} />);
        await Promise.resolve();
      });

      expect(gridTablePropsRef.current.data).toHaveLength(1);
      expect(
        (gridTablePropsRef.current.filters.options.postActions ?? []).some(
          (item: any) => item.title === 'Load more'
        )
      ).toBe(false);
      expect(gridTablePropsRef.current.showLoadMoreButton).toBe(false);
      expect(gridTablePropsRef.current.showPaginationStatus).toBe(false);
      expect(gridTablePropsRef.current.filters.options.customActions).toBeUndefined();
      expect(gridTablePropsRef.current.filters.options.showResultCount).toBe(false);
      expect(gridTablePropsRef.current.paginationControls?.props).toMatchObject({
        pageIndex: 1,
        pageSize: 50,
        totalCount: 1200,
        totalIsExact: true,
        hasPrevious: false,
        hasNext: true,
      });
      expect(refreshMocks.orchestrator.fetchScopedDomain).toHaveBeenCalledTimes(2);
      expect(refreshMocks.orchestrator.fetchScopedDomain).toHaveBeenNthCalledWith(
        1,
        'catalog',
        'cluster-1|limit=50&namespace=cluster',
        expect.objectContaining({ isManual: false })
      );
      expect(refreshMocks.orchestrator.fetchScopedDomain).toHaveBeenNthCalledWith(
        2,
        'catalog',
        'cluster-1|limit=1&namespace=cluster',
        expect.objectContaining({ isManual: false })
      );
    });

    it('surfaces catalog degraded reasons in table filter state', async () => {
      refreshMocks.catalogDomain.scope = 'cluster-1|limit=50&namespace=cluster';
      refreshMocks.catalogDomain.data = {
        items: [],
        batchSize: 0,
        total: 150000,
        totalIsExact: false,
        facetsExact: false,
        issues: [
          {
            kind: 'Catalog health',
            message: 'Catalog data may be stale because one resource sync failed.',
          },
        ],
      };
      refreshMocks.catalogDomain.status = 'ready';

      await act(async () => {
        root.render(<BrowseView namespace={undefined} />);
        await Promise.resolve();
      });

      const label = gridTablePropsRef.current.filters.options.partialDataLabel;
      expect(label).toContain('Catalog health');
      expect(label).toContain('Facet options are approximate');
      expect(label).toContain('total result count is approximate');
    });
  });

  describe('Action facts', () => {
    it('threads catalog action facts into shared context-menu actions', async () => {
      refreshMocks.scopedDomains.set('cluster-1|limit=50&namespace=default', {
        status: 'ready',
        data: {
          items: [
            {
              uid: 'deploy-1',
              kind: 'Deployment',
              name: 'web',
              namespace: 'default',
              scope: 'Namespace',
              resource: 'deployments',
              group: 'apps',
              version: 'v1',
              resourceVersion: '1',
              creationTimestamp: new Date().toISOString(),
              clusterId: 'cluster-1',
              actionFacts: { hpaManaged: true, desiredReplicas: 3 },
            },
            {
              uid: 'cron-1',
              kind: 'CronJob',
              name: 'nightly',
              namespace: 'default',
              scope: 'Namespace',
              resource: 'cronjobs',
              group: 'batch',
              version: 'v1',
              resourceVersion: '1',
              creationTimestamp: new Date().toISOString(),
              clusterId: 'cluster-1',
              actionFacts: { status: 'Suspended' },
            },
          ],
          kinds: [
            { kind: 'Deployment', namespaced: true },
            { kind: 'CronJob', namespaced: true },
          ],
          namespaces: ['default'],
        },
        scope: 'cluster-1|limit=50&namespace=default',
      });

      await act(async () => {
        root.render(<BrowseView namespace="default" />);
        await Promise.resolve();
      });

      const rows = gridTablePropsRef.current?.data ?? [];
      const byKind = new Map(rows.map((row: any) => [row.item.kind, row]));

      const deploymentMenu = gridTablePropsRef.current.getCustomContextMenuItems(
        byKind.get('Deployment')
      );
      expect(
        deploymentMenu.some((item: any) => item.actionId === OBJECT_ACTION_IDS.scaleToZero)
      ).toBe(true);
      expect(deploymentMenu.some((item: any) => item.actionId === OBJECT_ACTION_IDS.scale)).toBe(
        false
      );

      const cronMenu = gridTablePropsRef.current.getCustomContextMenuItems(byKind.get('CronJob'));
      expect(cronMenu.some((item: any) => item.actionId === OBJECT_ACTION_IDS.resume)).toBe(true);
      const trigger = cronMenu.find((item: any) => item.actionId === OBJECT_ACTION_IDS.triggerNow);
      expect(trigger?.disabled).toBe(true);
    });
  });

  describe('Query-wide CSV export', () => {
    it('disables all-matching actions while search debounce is pending', async () => {
      persistenceFiltersRef.current = {
        search: 'api',
        kinds: [],
        namespaces: [],
        caseSensitive: false,
      };
      refreshMocks.scopedDomains.set('cluster-1|limit=50&namespace=default', {
        status: 'ready',
        data: {
          items: [],
          kinds: [{ kind: 'Pod', namespaced: true }],
          namespaces: ['default'],
          total: 1,
        },
        scope: 'cluster-1|limit=50&namespace=default',
      });

      await act(async () => {
        root.render(<BrowseView namespace="default" />);
        await Promise.resolve();
      });

      const postActions = gridTablePropsRef.current?.filters?.options?.postActions ?? [];
      expect(postActions.find((item: any) => item.id === 'copy-browse-query-csv')?.disabled).toBe(
        true
      );
      expect(postActions.find((item: any) => item.id === 'delete-browse-query')?.disabled).toBe(
        true
      );
    });

    it('copies all backend-matching rows with the Browse query scope', async () => {
      refreshMocks.scopedDomains.set('cluster-1|limit=50&namespace=default', {
        status: 'ready',
        data: {
          items: [
            {
              uid: 'pod-1',
              kind: 'Pod',
              name: 'api',
              namespace: 'default',
              scope: 'Namespace',
              resource: 'pods',
              group: '',
              version: 'v1',
              resourceVersion: '1',
              creationTimestamp: new Date().toISOString(),
              clusterId: 'cluster-1',
            },
          ],
          kinds: [{ kind: 'Pod', namespaced: true }],
          namespaces: ['default'],
          total: 1,
        },
        scope: 'cluster-1|limit=50&namespace=default',
      });

      await act(async () => {
        root.render(<BrowseView namespace="default" />);
        await Promise.resolve();
      });

      const copyAllAction = gridTablePropsRef.current?.filters?.options?.postActions?.find(
        (item: any) => item.id === 'copy-browse-query-csv'
      );
      expect(copyAllAction).toBeTruthy();

      await act(async () => {
        copyAllAction.onClick();
        await Promise.resolve();
      });

      expect(exportCatalogQueryCSVFileMock).toHaveBeenCalledWith({
        clusterId: 'cluster-1',
        table: 'browse',
        namespaces: ['default'],
        kinds: [],
        search: '',
        sortField: '',
        sortDirection: '',
        customOnly: false,
      });
    });
  });

  describe('Query-wide bulk actions', () => {
    it('confirms and runs delete against the backend Browse query descriptor', async () => {
      refreshMocks.scopedDomains.set('cluster-1|limit=50&namespace=default', {
        status: 'ready',
        data: {
          items: [
            {
              uid: 'pod-1',
              kind: 'Pod',
              name: 'api',
              namespace: 'default',
              scope: 'Namespace',
              resource: 'pods',
              group: '',
              version: 'v1',
              resourceVersion: '1',
              creationTimestamp: new Date().toISOString(),
              clusterId: 'cluster-1',
            },
          ],
          kinds: [{ kind: 'Pod', namespaced: true }],
          namespaces: ['default'],
          total: 1,
        },
        scope: 'cluster-1|limit=50&namespace=default',
      });

      await act(async () => {
        root.render(<BrowseView namespace="default" />);
        await Promise.resolve();
      });

      const deleteAllAction = gridTablePropsRef.current?.filters?.options?.postActions?.find(
        (item: any) => item.id === 'delete-browse-query'
      );
      expect(deleteAllAction).toBeTruthy();

      await act(async () => {
        deleteAllAction.onClick();
        await Promise.resolve();
      });

      expect(document.querySelector('.confirmation-modal')).not.toBeNull();
      const confirm = document.querySelector<HTMLButtonElement>(
        '.confirmation-modal-footer .button.danger'
      );

      await act(async () => {
        confirm?.click();
        await Promise.resolve();
      });

      expect(runCatalogQueryBulkActionMock).toHaveBeenCalledWith(
        expect.objectContaining({
          selection: expect.objectContaining({
            clusterId: 'cluster-1',
            table: 'browse',
            namespaces: ['default'],
            kinds: [],
            search: '',
            sortField: '',
            sortDirection: '',
            customOnly: false,
          }),
          action: 'delete',
          confirmed: true,
          limit: 100,
          continue: undefined,
        })
      );
    });

    it('surfaces query-wide delete partial failures after completion', async () => {
      runCatalogQueryBulkActionMock.mockResolvedValueOnce({
        processed: 1,
        succeeded: 0,
        failed: 1,
        failures: [
          {
            ref: {
              clusterId: 'cluster-1',
              group: '',
              version: 'v1',
              kind: 'Pod',
              resource: 'pods',
              namespace: 'default',
              name: 'api',
            },
            message: 'pods "api" is forbidden',
          },
        ],
      });
      refreshMocks.scopedDomains.set('cluster-1|limit=50&namespace=default', {
        status: 'ready',
        data: {
          items: [
            {
              uid: 'pod-1',
              kind: 'Pod',
              name: 'api',
              namespace: 'default',
              scope: 'Namespace',
              resource: 'pods',
              group: '',
              version: 'v1',
              resourceVersion: '1',
              creationTimestamp: new Date().toISOString(),
              clusterId: 'cluster-1',
            },
          ],
          kinds: [{ kind: 'Pod', namespaced: true }],
          namespaces: ['default'],
          total: 1,
        },
        scope: 'cluster-1|limit=50&namespace=default',
      });

      await act(async () => {
        root.render(<BrowseView namespace="default" />);
        await Promise.resolve();
      });

      const deleteAllAction = gridTablePropsRef.current?.filters?.options?.postActions?.find(
        (item: any) => item.id === 'delete-browse-query'
      );
      expect(deleteAllAction).toBeTruthy();

      await act(async () => {
        deleteAllAction.onClick();
        await Promise.resolve();
      });

      const confirm = document.querySelector<HTMLButtonElement>(
        '.confirmation-modal-footer .button.danger'
      );

      await act(async () => {
        confirm?.click();
        await Promise.resolve();
      });

      expect(document.body.textContent).toContain('Delete completed with failures');
      expect(document.body.textContent).toContain(
        'Processed 1 matching objects. Deleted 0. Failed 1.'
      );
      expect(document.body.textContent).toContain('Pod default/api: pods "api" is forbidden');
    });
  });
});
