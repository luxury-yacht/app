/**
 * frontend/src/core/contexts/FavoritesContext.test.tsx
 *
 * Test suite for FavoritesContext.
 * Validates provider hydration, hook guard, and currentFavoriteMatch logic.
 */
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Favorite } from '@/core/persistence/favorites';

// ---------- Mocks ----------

// Mock the persistence module before any imports that reference it.
const persistenceMocks = vi.hoisted(() => ({
  hydrateFavorites: vi.fn().mockResolvedValue([]),
  subscribeFavorites: vi.fn().mockReturnValue(() => undefined),
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
let mockSelectedClusterId = 'cluster-1';
let mockViewType = 'namespace';
let mockActiveNamespaceTab = 'workloads';
let mockActiveClusterTab: string | null = null;
let mockSelectedNamespace: string | undefined = 'default';
let mockNamespaceReady = true;
let mockClusterLifecycleState = 'ready';
const mockSetViewType = vi.fn();
const mockSetActiveNamespaceTab = vi.fn();
const mockSetActiveClusterView = vi.fn();
const mockNavigateToGlobal = vi.fn();
const mockSetSidebarSelection = vi.fn();
const mockOnNamespaceSelect = vi.fn();
const mockSetSelectedNamespace = vi.fn();

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfig: mockSelectedKubeconfig,
    selectedClusterId: mockSelectedClusterId,
  }),
}));

vi.mock('@core/contexts/ClusterLifecycleContext', () => ({
  useClusterLifecycle: () => ({
    getClusterState: () => mockClusterLifecycleState,
    isClusterReady: () => mockClusterLifecycleState === 'ready',
  }),
  ClusterLifecycleProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({
    viewType: mockViewType,
    activeNamespaceTab: mockActiveNamespaceTab,
    activeClusterTab: mockActiveClusterTab,
    setViewType: mockSetViewType,
    setActiveNamespaceTab: mockSetActiveNamespaceTab,
    setActiveClusterView: mockSetActiveClusterView,
    navigateToGlobal: mockNavigateToGlobal,
    setSidebarSelection: mockSetSidebarSelection,
    onNamespaceSelect: mockOnNamespaceSelect,
  }),
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({
    selectedNamespace: mockSelectedNamespace,
    namespaceReady: mockNamespaceReady,
    setSelectedNamespace: mockSetSelectedNamespace,
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
    panes: {},
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

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    stateRef.current = null;

    // Reset mutable mock values to defaults
    mockSelectedKubeconfig = '/path/to/kubeconfig:my-context';
    mockSelectedClusterId = 'cluster-1';
    mockViewType = 'namespace';
    mockActiveNamespaceTab = 'workloads';
    mockActiveClusterTab = null;
    mockSelectedNamespace = 'default';
    mockNamespaceReady = true;
    mockClusterLifecycleState = 'ready';
    mockSetViewType.mockReset();
    mockSetActiveNamespaceTab.mockReset();
    mockSetActiveClusterView.mockReset();
    mockNavigateToGlobal.mockReset();
    mockSetSidebarSelection.mockReset();
    mockOnNamespaceSelect.mockReset();
    mockSetSelectedNamespace.mockReset();

    // Reset persistence mocks
    persistenceMocks.hydrateFavorites.mockResolvedValue([]);
    persistenceMocks.subscribeFavorites.mockReturnValue(() => undefined);
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
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
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

  it('does not apply an unrecognized persisted view as a tab', async () => {
    // Favorites are persisted strings: a favorite saved before a tab rename
    // (or corrupted) must not blind-cast into the view unions and set a bogus
    // tab. Navigation still happens; the tab falls back to the default that
    // onNamespaceSelect / setActiveClusterView(null) provide.
    await renderProvider();

    act(() => {
      stateRef.current?.setPendingFavorite(makeFavorite({ view: 'wrokloads' }));
    });

    expect(mockSetViewType).toHaveBeenCalledWith('namespace');
    expect(mockOnNamespaceSelect).toHaveBeenCalledWith('default');
    expect(mockSetActiveNamespaceTab).not.toHaveBeenCalled();

    mockSetViewType.mockReset();
    mockSetActiveClusterView.mockReset();
    act(() => {
      // Clear first: the apply-once guard only resets when the pending
      // favorite goes null.
      stateRef.current?.setPendingFavorite(null);
    });
    act(() => {
      stateRef.current?.setPendingFavorite(
        makeFavorite({ id: 'fav-2', viewType: 'cluster', view: 'nodess', namespace: '' })
      );
    });

    expect(mockSetViewType).toHaveBeenCalledWith('cluster');
    expect(mockSetActiveClusterView).toHaveBeenCalledWith(null);
  });

  it('waits for namespaces before applying namespace favorite navigation', async () => {
    mockNamespaceReady = false;
    await renderProvider();

    act(() => {
      stateRef.current?.setPendingFavorite(makeFavorite());
    });

    expect(mockSetViewType).not.toHaveBeenCalled();
    expect(mockSetSelectedNamespace).not.toHaveBeenCalled();

    mockNamespaceReady = true;
    await act(async () => {
      root.render(
        <FavoritesProvider>
          <Harness />
        </FavoritesProvider>
      );
      await Promise.resolve();
    });

    expect(mockSetViewType).toHaveBeenCalledWith('namespace');
    expect(mockSetSelectedNamespace).toHaveBeenCalledWith('default');
    expect(mockOnNamespaceSelect).toHaveBeenCalledWith('default');
    expect(mockSetActiveNamespaceTab).toHaveBeenCalledWith('workloads');
    expect(mockSetSidebarSelection).toHaveBeenCalledWith({
      type: 'namespace',
      value: 'default',
    });
  });

  it('does not block cluster favorites on namespace readiness', async () => {
    mockNamespaceReady = false;
    await renderProvider();

    act(() => {
      stateRef.current?.setPendingFavorite(
        makeFavorite({
          viewType: 'cluster',
          view: 'nodes',
          namespace: '',
        })
      );
    });

    expect(mockSetViewType).toHaveBeenCalledWith('cluster');
    expect(mockSetActiveClusterView).toHaveBeenCalledWith('nodes');
    expect(mockSetSidebarSelection).toHaveBeenCalledWith({
      type: 'cluster',
      value: 'cluster',
    });
  });

  it('applies each newly activated favorite without requiring an intermediate clear', async () => {
    await renderProvider();

    act(() => stateRef.current?.setPendingFavorite(makeFavorite({ id: 'first' })));
    expect(mockSetActiveNamespaceTab).toHaveBeenCalledTimes(1);

    act(() =>
      stateRef.current?.setPendingFavorite(
        makeFavorite({ id: 'second', viewType: 'cluster', view: 'nodes', namespace: '' })
      )
    );
    expect(mockSetViewType).toHaveBeenLastCalledWith('cluster');
    expect(mockSetActiveClusterView).toHaveBeenCalledWith('nodes');
  });

  it('opens new and legacy Global favorites without applying cluster navigation', async () => {
    await renderProvider();

    act(() => {
      stateRef.current?.setPendingFavorite(
        makeFavorite({
          viewType: 'cluster',
          view: 'global-namespaces',
          namespace: '',
        })
      );
    });

    expect(mockNavigateToGlobal).toHaveBeenCalledWith('global-namespaces');
    expect(mockSetViewType).not.toHaveBeenCalled();
    expect(mockSetActiveClusterView).not.toHaveBeenCalled();

    act(() => stateRef.current?.setPendingFavorite(null));
    act(() => {
      stateRef.current?.setPendingFavorite(
        makeFavorite({
          id: 'fav-global',
          clusterSelection: '',
          clusterId: '',
          viewType: 'global',
          view: 'fleet',
          namespace: '',
        })
      );
    });

    expect(mockNavigateToGlobal).toHaveBeenLastCalledWith('fleet');
  });

  it('waits for the favorite clusterId before applying cluster-specific navigation', async () => {
    mockSelectedKubeconfig = '/path/to/kubeconfig:other-context';
    mockSelectedClusterId = 'cluster-other';
    await renderProvider();

    act(() => {
      stateRef.current?.setPendingFavorite(
        makeFavorite({
          clusterSelection: '/path/to/kubeconfig:my-context',
          clusterId: 'cluster-1',
          viewType: 'cluster',
          view: 'nodes',
          namespace: '',
        })
      );
    });

    expect(mockSetViewType).not.toHaveBeenCalled();

    mockSelectedClusterId = 'cluster-1';
    await act(async () => {
      root.render(
        <FavoritesProvider>
          <Harness />
        </FavoritesProvider>
      );
      await Promise.resolve();
    });

    expect(mockSetViewType).toHaveBeenCalledWith('cluster');
    expect(mockSetActiveClusterView).toHaveBeenCalledWith('nodes');
  });

  it('expires a pending favorite only after 15 seconds without lifecycle progress', async () => {
    vi.useFakeTimers();
    mockClusterLifecycleState = 'connecting';
    try {
      await renderProvider();

      act(() => stateRef.current?.setPendingFavorite(makeFavorite()));
      act(() => vi.advanceTimersByTime(14_000));

      mockClusterLifecycleState = 'connected';
      await act(async () => {
        root.render(
          <FavoritesProvider>
            <Harness />
          </FavoritesProvider>
        );
      });
      act(() => vi.advanceTimersByTime(2_000));
      expect(stateRef.current?.pendingFavorite?.id).toBe('fav-1');

      act(() => vi.advanceTimersByTime(13_000));
      expect(stateRef.current?.pendingFavorite).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Note: currentFavoriteMatch was moved from FavoritesContext to useFavToggle
  // so that filter state can be included in the match. Tests for matching
  // logic are in FavToggle.test.tsx.
});
