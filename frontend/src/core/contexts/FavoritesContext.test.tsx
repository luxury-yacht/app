/**
 * frontend/src/core/contexts/FavoritesContext.test.tsx
 *
 * Test suite for FavoritesContext.
 * Validates provider hydration, hook guard, and currentFavoriteMatch logic.
 */
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Favorite } from '@/core/persistence/favorites';

// ---------- Mocks ----------

// Mock the persistence module before any imports that reference it.
const persistenceMocks = vi.hoisted(() => ({
  hydrateFavorites: vi.fn().mockResolvedValue([]),
  subscribeFavorites: vi.fn().mockReturnValue(() => {}),
  addFavorite: vi.fn(),
  updateFavorite: vi.fn(),
  deleteFavorite: vi.fn(),
  setFavoriteOrder: vi.fn(),
}));

vi.mock('@/core/persistence/favorites', () => ({
  hydrateFavorites: (...args: unknown[]) => persistenceMocks.hydrateFavorites(...args),
  subscribeFavorites: (...args: unknown[]) => persistenceMocks.subscribeFavorites(...args),
  addFavorite: (...args: unknown[]) => persistenceMocks.addFavorite(...args),
  updateFavorite: (...args: unknown[]) => persistenceMocks.updateFavorite(...args),
  deleteFavorite: (...args: unknown[]) => persistenceMocks.deleteFavorite(...args),
  setFavoriteOrder: (...args: unknown[]) => persistenceMocks.setFavoriteOrder(...args),
}));

// Mutable mock values for the context hooks so tests can adjust them per-case.
let mockSelectedKubeconfig = '/path/to/kubeconfig:my-context';
let mockViewType = 'namespace';
let mockActiveNamespaceTab = 'workloads';
let mockActiveClusterTab: string | null = null;
let mockSelectedNamespace: string | undefined = 'default';

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfig: mockSelectedKubeconfig,
  }),
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({
    viewType: mockViewType,
    activeNamespaceTab: mockActiveNamespaceTab,
    activeClusterTab: mockActiveClusterTab,
  }),
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({
    selectedNamespace: mockSelectedNamespace,
  }),
}));

// ---------- Import under test (after mocks) ----------

import { FavoritesProvider, useFavorites } from './FavoritesContext';

// ---------- Helpers ----------

function makeFavorite(overrides: Partial<Favorite> = {}): Favorite {
  return {
    id: 'fav-1',
    name: 'My Favorite',
    clusterSelection: '/path/to/kubeconfig:my-context',
    viewType: 'namespace',
    view: 'workloads',
    namespace: 'default',
    filters: null,
    tableState: null,
    order: 0,
    ...overrides,
  };
}

// ---------- Tests ----------

describe('FavoritesContext', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const stateRef: { current: ReturnType<typeof useFavorites> | null } = { current: null };

  const Harness = () => {
    stateRef.current = useFavorites();
    return null;
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    stateRef.current = null;

    // Reset mutable mock values to defaults
    mockSelectedKubeconfig = '/path/to/kubeconfig:my-context';
    mockViewType = 'namespace';
    mockActiveNamespaceTab = 'workloads';
    mockActiveClusterTab = null;
    mockSelectedNamespace = 'default';

    // Reset persistence mocks
    persistenceMocks.hydrateFavorites.mockResolvedValue([]);
    persistenceMocks.subscribeFavorites.mockReturnValue(() => {});
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderProvider = async () => {
    await act(async () => {
      root.render(
        <FavoritesProvider>
          <Harness />
        </FavoritesProvider>
      );
      await Promise.resolve();
    });
  };

  it('throws when useFavorites is used outside of FavoritesProvider', () => {
    // Suppress React error boundary noise in test output.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => {
      const TestComponent = () => {
        useFavorites();
        return null;
      };
      const testContainer = document.createElement('div');
      document.body.appendChild(testContainer);
      const testRoot = ReactDOM.createRoot(testContainer);
      // renderSync triggers the throw synchronously in React 18
      act(() => {
        testRoot.render(<TestComponent />);
      });
    }).toThrow('useFavorites must be used within FavoritesProvider');
    spy.mockRestore();
  });

  it('hydrates favorites on mount', async () => {
    const favorites = [
      makeFavorite({ id: 'fav-1' }),
      makeFavorite({ id: 'fav-2', name: 'Second' }),
    ];
    persistenceMocks.hydrateFavorites.mockResolvedValue(favorites);

    await renderProvider();

    expect(persistenceMocks.hydrateFavorites).toHaveBeenCalled();
    expect(stateRef.current?.favorites).toEqual(favorites);
  });

  it('returns null for currentFavoriteMatch when no favorite matches', async () => {
    const favorites = [
      makeFavorite({
        id: 'fav-1',
        clusterSelection: '/other/kubeconfig:other-context',
        viewType: 'namespace',
        view: 'workloads',
        namespace: 'default',
      }),
    ];
    persistenceMocks.hydrateFavorites.mockResolvedValue(favorites);

    await renderProvider();

    // The favorite has a different clusterSelection than the mock kubeconfig
    expect(stateRef.current?.currentFavoriteMatch).toBeNull();
  });

  it('returns matching favorite for a cluster-specific favorite', async () => {
    const matchingFav = makeFavorite({
      id: 'fav-match',
      clusterSelection: '/path/to/kubeconfig:my-context',
      viewType: 'namespace',
      view: 'workloads',
      namespace: 'default',
    });
    persistenceMocks.hydrateFavorites.mockResolvedValue([matchingFav]);

    await renderProvider();

    expect(stateRef.current?.currentFavoriteMatch).toEqual(matchingFav);
  });

  it('returns matching favorite for a generic favorite (empty clusterSelection)', async () => {
    // A generic favorite should match any cluster.
    const genericFav = makeFavorite({
      id: 'fav-generic',
      clusterSelection: '',
      viewType: 'namespace',
      view: 'workloads',
      namespace: 'default',
    });
    persistenceMocks.hydrateFavorites.mockResolvedValue([genericFav]);

    await renderProvider();

    expect(stateRef.current?.currentFavoriteMatch).toEqual(genericFav);
  });

  it('matches cluster-view favorites using activeClusterTab', async () => {
    mockViewType = 'cluster';
    mockActiveClusterTab = 'nodes';

    const clusterFav = makeFavorite({
      id: 'fav-cluster',
      clusterSelection: '/path/to/kubeconfig:my-context',
      viewType: 'cluster',
      view: 'nodes',
      namespace: '',
    });
    persistenceMocks.hydrateFavorites.mockResolvedValue([clusterFav]);

    await renderProvider();

    expect(stateRef.current?.currentFavoriteMatch).toEqual(clusterFav);
  });
});
