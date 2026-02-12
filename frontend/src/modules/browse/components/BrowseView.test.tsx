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

const gridTablePropsRef: { current: any } = { current: null };

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

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({ onNamespaceSelect: vi.fn(), setActiveNamespaceTab: vi.fn() }),
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
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
    fetchScopedDomain: vi.fn(),
  },
  catalogDomain: {
    status: 'idle' as any,
    data: null as any,
    scope: undefined as string | undefined,
  },
}));

vi.mock('@/core/refresh', () => ({
  refreshManager: refreshMocks.manager,
  refreshOrchestrator: refreshMocks.orchestrator,
  useRefreshScopedDomain: () => refreshMocks.catalogDomain,
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: { key: 'kind', direction: 'asc' },
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [] },
    setFilters: vi.fn(),
    resetState: vi.fn(),
    hydrated: true,
    storageKey: 'gridtable:v1:test',
  }),
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => ({
  useNamespaceGridTablePersistence: () => ({
    sortConfig: { key: 'kind', direction: 'asc' },
    onSortChange: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [] },
    setFilters: vi.fn(),
    isNamespaceScoped: true,
    resetState: vi.fn(),
  }),
}));

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
    refreshMocks.orchestrator.fetchScopedDomain.mockReset();
    refreshMocks.manager.disable.mockReset();
    refreshMocks.catalogDomain.status = 'idle';
    refreshMocks.catalogDomain.data = null;
    refreshMocks.catalogDomain.scope = undefined;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  describe('Cluster scope (namespace=undefined)', () => {
    it('sets the catalog scope and triggers a manual refresh on mount', async () => {
      await act(async () => {
        root.render(<BrowseView />);
        await Promise.resolve();
      });

      expect(refreshMocks.orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
        'catalog',
        'cluster-1|limit=200&namespace=cluster',
        true
      );
      expect(refreshMocks.orchestrator.fetchScopedDomain).toHaveBeenCalledWith(
        'catalog',
        'cluster-1|limit=200&namespace=cluster',
        expect.objectContaining({ isManual: true })
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

    it('hides namespace filtering for cluster scope (cluster-scoped objects only)', async () => {
      await act(async () => {
        root.render(<BrowseView namespace={undefined} />);
        await Promise.resolve();
      });

      // Cluster scope only shows cluster-scoped objects, so namespace dropdown is hidden
      expect(gridTablePropsRef.current?.filters?.options?.showNamespaceDropdown).toBe(false);
    });
  });

  describe('Namespace scope (namespace=specific)', () => {
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
        'cluster-1|limit=200&namespace=kube-system',
        true
      );
    });
  });

  describe('All Namespaces scope', () => {
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

    it('enables namespace filtering for all-namespaces scope', async () => {
      await act(async () => {
        root.render(<BrowseView namespace={ALL_NAMESPACES_SCOPE} />);
        await Promise.resolve();
      });

      expect(gridTablePropsRef.current?.filters?.options?.showNamespaceDropdown).toBe(true);
    });
  });

  describe('Pagination', () => {
    it('appends items when requesting more pages', async () => {
      await act(async () => {
        root.render(<BrowseView namespace={undefined} />);
        await Promise.resolve();
      });

      // Use cluster-scoped items since cluster scope filters to only cluster-scoped objects
      refreshMocks.catalogDomain.scope = 'cluster-1|limit=200&namespace=cluster';
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
      };
      refreshMocks.catalogDomain.status = 'ready';

      await act(async () => {
        root.render(<BrowseView namespace={undefined} />);
        await Promise.resolve();
      });

      expect(gridTablePropsRef.current.data).toHaveLength(1);

      await act(async () => {
        const customActions = gridTablePropsRef.current.filters.options.customActions;
        customActions.props.onClick();
        await Promise.resolve();
      });

      expect(refreshMocks.orchestrator.setScopedDomainEnabled).toHaveBeenCalledWith(
        'catalog',
        'cluster-1|limit=200&namespace=cluster&continue=200',
        true
      );
      expect(refreshMocks.orchestrator.fetchScopedDomain).toHaveBeenCalledWith(
        'catalog',
        'cluster-1|limit=200&namespace=cluster&continue=200',
        expect.objectContaining({ isManual: true })
      );

      refreshMocks.catalogDomain.scope = 'cluster-1|limit=200&namespace=cluster&continue=200';
      refreshMocks.catalogDomain.data = {
        items: [
          {
            uid: '2',
            kind: 'PersistentVolume',
            name: 'pv-a',
            namespace: null,
            scope: 'Cluster',
            resource: 'persistentvolumes',
            group: '',
            version: 'v1',
            resourceVersion: '1',
            creationTimestamp: new Date().toISOString(),
            clusterId: 'cluster-1',
          },
        ],
        continue: '',
        batchSize: 200,
      };

      await act(async () => {
        root.render(<BrowseView namespace={undefined} />);
        await Promise.resolve();
      });

      expect(gridTablePropsRef.current.data).toHaveLength(2);
    });
  });
});
