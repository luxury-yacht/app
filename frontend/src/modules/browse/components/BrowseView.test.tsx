import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import BrowseView from '@/modules/browse/components/BrowseView';
import { eventBus } from '@/core/events';
import { BROWSE_NAMESPACE_FILTER_STORAGE_KEY } from '@modules/browse/browseFilterSignals';

const gridTablePropsRef: { current: any } = { current: null };
const gridTablePersistenceMocks = vi.hoisted(() => ({
  setFilters: vi.fn(),
}));

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
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context' }),
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
    setDomainScope: vi.fn(),
    triggerManualRefresh: vi.fn(),
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
  useRefreshDomain: () => refreshMocks.catalogDomain,
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
    setFilters: gridTablePersistenceMocks.setFilters,
    resetState: vi.fn(),
    hydrated: true,
    storageKey: 'gridtable:v1:test',
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
    gridTablePersistenceMocks.setFilters.mockReset();
    refreshMocks.orchestrator.setDomainScope.mockReset();
    refreshMocks.orchestrator.setDomainEnabled.mockReset();
    refreshMocks.orchestrator.triggerManualRefresh.mockReset();
    refreshMocks.manager.disable.mockReset();
    refreshMocks.catalogDomain.status = 'idle';
    refreshMocks.catalogDomain.data = null;
    refreshMocks.catalogDomain.scope = undefined;
    try {
      window.sessionStorage.removeItem(BROWSE_NAMESPACE_FILTER_STORAGE_KEY);
    } catch {
      // Ignore sessionStorage failures.
    }
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('sets the catalog scope and triggers a manual refresh on mount', async () => {
    await act(async () => {
      root.render(<BrowseView />);
      await Promise.resolve();
    });

    expect(refreshMocks.orchestrator.setDomainEnabled).toHaveBeenCalledWith('catalog', true);
    expect(refreshMocks.manager.disable).toHaveBeenCalledWith('catalog');
    expect(refreshMocks.orchestrator.setDomainScope).toHaveBeenCalledWith('catalog', 'limit=200');
    expect(refreshMocks.orchestrator.triggerManualRefresh).toHaveBeenCalledWith('catalog', {
      suppressSpinner: true,
    });
  });

  it('appends items when requesting more pages', async () => {
    await act(async () => {
      root.render(<BrowseView />);
      await Promise.resolve();
    });

    refreshMocks.catalogDomain.scope = 'limit=200';
    refreshMocks.catalogDomain.data = {
      items: [
        {
          uid: '1',
          kind: 'Pod',
          name: 'pod-a',
          namespace: 'team-a',
          scope: 'Namespace',
          resource: 'pods',
          group: '',
          version: 'v1',
          resourceVersion: '1',
          creationTimestamp: new Date().toISOString(),
        },
      ],
      continue: '200',
      batchSize: 200,
    };
    refreshMocks.catalogDomain.status = 'ready';

    await act(async () => {
      root.render(<BrowseView />);
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.data).toHaveLength(1);

    await act(async () => {
      const customActions = gridTablePropsRef.current.filters.options.customActions;
      customActions.props.onClick();
      await Promise.resolve();
    });

    expect(refreshMocks.orchestrator.setDomainScope).toHaveBeenCalledWith(
      'catalog',
      'limit=200&continue=200'
    );
    expect(refreshMocks.orchestrator.triggerManualRefresh).toHaveBeenCalledWith('catalog', {
      suppressSpinner: true,
    });

    refreshMocks.catalogDomain.scope = 'limit=200&continue=200';
    refreshMocks.catalogDomain.data = {
      items: [
        {
          uid: '2',
          kind: 'Service',
          name: 'svc-a',
          namespace: 'team-a',
          scope: 'Namespace',
          resource: 'services',
          group: '',
          version: 'v1',
          resourceVersion: '1',
          creationTimestamp: new Date().toISOString(),
        },
      ],
      continue: '',
      batchSize: 200,
    };

    await act(async () => {
      root.render(<BrowseView />);
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current.data).toHaveLength(2);
  });

  it('applies a pending namespace filter from session storage', async () => {
    window.sessionStorage.setItem(BROWSE_NAMESPACE_FILTER_STORAGE_KEY, 'team-a');

    await act(async () => {
      root.render(<BrowseView />);
      await Promise.resolve();
    });

    expect(gridTablePersistenceMocks.setFilters).toHaveBeenCalledWith({
      search: '',
      kinds: [],
      namespaces: ['team-a'],
    });
    expect(window.sessionStorage.getItem(BROWSE_NAMESPACE_FILTER_STORAGE_KEY)).toBeNull();
  });

  it('applies namespace filter requests via the event bus', async () => {
    await act(async () => {
      root.render(<BrowseView />);
      await Promise.resolve();
    });

    act(() => {
      eventBus.emit('browse:namespace-filter', { namespace: 'team-b' });
    });

    expect(gridTablePersistenceMocks.setFilters).toHaveBeenCalledWith({
      search: '',
      kinds: [],
      namespaces: ['team-b'],
    });
  });
});
