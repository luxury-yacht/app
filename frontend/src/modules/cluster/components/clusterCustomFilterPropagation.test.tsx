/**
 * Reproduction: selecting a Kind on Cluster Custom must re-query.
 *
 * Renders the REAL ClusterViewCustom (real useGridTablePersistence + real
 * useQueryResourceGridTable filter bar), mocking only useBrowseCatalog so we can
 * capture the `filters` it is called with. Driving the filter bar's onChange must
 * propagate the new kind into the catalog query.
 */

import ClusterViewCustom from '@modules/cluster/components/ClusterViewCustom';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

type CustomRow = Record<string, unknown>;

const gridTablePropsRef: { current: GridTableProps<CustomRow> | null } = { current: null };
const useBrowseCatalogMock = vi.hoisted(() => vi.fn());

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
  useFavToggle: () => ({ item: null, modal: null }),
}));

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: GridTableProps<CustomRow>) => {
      gridTablePropsRef.current = props;
      return <div data-testid="grid-table" />;
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context', selectedClusterId: 'cluster-a' }),
}));

vi.mock('@/hooks/useShortNames', () => ({ useShortNames: () => false }));

vi.mock('@modules/browse/hooks/useBrowseCatalog', () => ({
  useBrowseCatalog: (...args: unknown[]) => useBrowseCatalogMock(...args),
}));

vi.mock('@modules/browse/hooks/useHydratedCustomCatalogRows', () => ({
  useHydratedCustomCatalogRows: () => [],
  hydrateCustomCatalogRows: async () => [],
}));

const emptyBrowseResult = () => ({
  items: [],
  loading: false,
  hasLoadedOnce: true,
  error: null,
  filterOptions: {
    kinds: ['Widget', 'DBCluster'],
    namespaces: { mode: 'all' },
    isNamespaceScoped: false,
  },
  totalCount: 0,
  unfilteredTotal: 0,
  totalIsExact: true,
  pagination: {
    pageIndex: 1,
    pageLimit: 50,
    pageLimitOptions: [25, 50],
    setPageLimit: vi.fn(),
    totalCount: 0,
    totalIsExact: true,
    previousToken: null,
    continueToken: null,
    queryPending: false,
    hasMore: false,
    hasPrevious: false,
    isRequestingMore: false,
    onRequestMore: vi.fn(),
    onRequestPrevious: vi.fn(),
  },
  fetchAllRows: async () => [],
});

describe('ClusterViewCustom kind filter propagation', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
    useBrowseCatalogMock.mockReset();
    useBrowseCatalogMock.mockImplementation(() => emptyBrowseResult());
    localStorage.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('propagates a selected Kind into the catalog query filters', async () => {
    await act(async () => {
      root.render(<ClusterViewCustom />);
      await Promise.resolve();
    });
    // Let persistence hydrate (async storage-key + hash) and settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await Promise.resolve();
    });

    const lastQueryKinds = (): string[] => {
      const calls = useBrowseCatalogMock.mock.calls;
      return calls[calls.length - 1]?.[0]?.filters?.kinds ?? [];
    };

    // Baseline: the catalog query sees no kind filter.
    expect(lastQueryKinds()).toEqual([]);

    // Simulate the user picking a Kind in the filter bar dropdown.
    const onChange = requireValue(gridTablePropsRef.current, 'expected GridTable props').filters
      ?.onChange;
    expect(typeof onChange).toBe('function');
    await act(async () => {
      requireValue(
        onChange,
        'expected filter change handler'
      )({
        search: '',
        kinds: { mode: 'some', values: ['Widget'] },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        caseSensitive: false,
        includeMetadata: false,
      });
      await Promise.resolve();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(lastQueryKinds()).toEqual(['Widget']);
  });
});
