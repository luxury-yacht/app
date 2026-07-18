/**
 * frontend/src/ui/favorites/FavToggle.test.tsx
 *
 * Tests for the useFavToggle hook.
 * Covers: outline/filled heart states, popover choices for add/update/remove.
 */

import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Favorite } from '@/core/persistence/favorites';
import { requireValue } from '@/test-utils/requireValue';
import type { FavSaveModalProps } from './FavSaveModal';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the hook under test.
// ---------------------------------------------------------------------------

let mockFavorites: Favorite[] = [];
let mockPendingFavorite: Favorite | null = null;
const mockSetPendingFavorite = vi.fn();
const mockAddFavorite = vi.fn().mockResolvedValue({ id: 'new-fav' });
const mockUpdateFavorite = vi.fn().mockResolvedValue(undefined);
const mockDeleteFavorite = vi.fn().mockResolvedValue(undefined);
const favSaveModalPropsRef: { current: FavSaveModalProps | null } = { current: null };

vi.mock('@core/contexts/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: mockFavorites,
    addFavorite: mockAddFavorite,
    updateFavorite: mockUpdateFavorite,
    deleteFavorite: mockDeleteFavorite,
    reorderFavorites: vi.fn().mockResolvedValue(undefined),
    pendingFavorite: mockPendingFavorite,
    setPendingFavorite: mockSetPendingFavorite,
  }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfigs: ['/home/user/.kube/config:production'],
    selectedKubeconfig: '/home/user/.kube/config:production',
    selectedClusterId: '/home/user/.kube/config:production',
    selectedClusterName: 'production',
    selectedClusterIds: ['/home/user/.kube/config:production'],
    kubeconfigsLoading: false,
    setSelectedKubeconfigs: vi.fn().mockResolvedValue(undefined),
    setActiveKubeconfig: vi.fn(),
    getClusterMeta: vi.fn(() => ({ id: '', name: '' })),
    kubeconfigs: [],
    loadKubeconfigs: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({
    viewType: 'namespace',
    previousView: 'overview',
    activeNamespaceTab: 'pods',
    activeClusterTab: null,
    setViewType: vi.fn(),
    setPreviousView: vi.fn(),
    setActiveNamespaceTab: vi.fn(),
    setActiveClusterView: vi.fn(),
    navigateToClusterView: vi.fn(),
    navigateToNamespace: vi.fn(),
    onNamespaceSelect: vi.fn(),
    onClusterObjectsClick: vi.fn(),
    getClusterNavigationState: vi.fn(),
    isSidebarVisible: true,
    sidebarWidth: 250,
    isResizing: false,
    sidebarSelection: null,
    toggleSidebar: vi.fn(),
    setSidebarWidth: vi.fn(),
    setIsResizing: vi.fn(),
    setSidebarSelection: vi.fn(),
    showObjectPanel: false,
    objectPanelState: null,
    toggleObjectPanel: vi.fn(),
    openObjectPanel: vi.fn(),
    closeObjectPanel: vi.fn(),
    navigationHistory: [],
    navigateBack: vi.fn(),
    navigateForward: vi.fn(),
    canNavigateBack: false,
    canNavigateForward: false,
    isSettingsOpen: false,
    setIsSettingsOpen: vi.fn(),
    isAboutOpen: false,
    setIsAboutOpen: vi.fn(),
  }),
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({
    namespaces: { mode: 'all' },
    selectedNamespace: 'default',
    namespaceLoading: false,
    namespaceRefreshing: false,
    setSelectedNamespace: vi.fn(),
    loadNamespaces: vi.fn().mockResolvedValue(undefined),
    refreshNamespaces: vi.fn().mockResolvedValue(undefined),
    getClusterNamespace: vi.fn(),
  }),
}));

vi.mock('./FavSaveModal', () => ({
  default: (props: FavSaveModalProps) => {
    favSaveModalPropsRef.current = props;
    const { isOpen, onClose, onSave, onDelete, existingFavorite } = props;
    if (!isOpen) {
      return null;
    }
    return (
      <div data-testid="fav-save-modal">
        <button
          type="button"
          data-testid="modal-save"
          onClick={() => {
            onSave({
              id: existingFavorite?.id ?? '',
              name: 'Test',
              clusterSelection: '',
              viewType: 'namespace',
              view: 'pods',
              namespace: 'default',
              panes: {},
              order: 0,
            });
            onClose();
          }}
        >
          Save
        </button>
        <button type="button" data-testid="modal-cancel" onClick={onClose}>
          Cancel
        </button>
        {!!existingFavorite && (
          <button
            type="button"
            data-testid="modal-delete"
            onClick={() => {
              onDelete(existingFavorite.id);
              onClose();
            }}
          >
            Delete
          </button>
        )}
      </div>
    );
  },
}));

// Import after mocks
import { FavoritePaneGroup, useFavToggle } from './FavToggle';

// ---------------------------------------------------------------------------
// Helpers — wrapper component that renders the hook result into the DOM.
// ---------------------------------------------------------------------------

const makeFavorite = (overrides: Partial<Favorite> = {}): Favorite => ({
  id: 'fav-1',
  name: 'default / Pods',
  clusterSelection: '',
  viewType: 'namespace',
  view: 'pods',
  namespace: 'default',
  panes: {
    main: {
      filters: {
        search: '',
        kinds: { mode: 'all' },
        namespaces: { mode: 'all' },
        clusters: { mode: 'all' },
        caseSensitive: false,
        includeMetadata: false,
      },
      tableState: { sortColumn: '', sortDirection: 'asc', columnVisibility: {} },
    },
  },
  order: 0,
  ...overrides,
});

/**
 * Wrapper component that calls useFavToggle() and renders the returned
 * IconBarItem as a button with the icon inside — mirroring how IconBar renders it.
 */
const HookWrapper: React.FC<{
  clusters?: { mode: 'all' } | { mode: 'some'; values: string[] };
}> = ({ clusters = { mode: 'all' } }) => {
  const { item, modal } = useFavToggle({
    filters: {
      search: '',
      kinds: { mode: 'all' },
      namespaces: { mode: 'all' },
      clusters,
      caseSensitive: false,
      includeMetadata: false,
    },
    sortColumn: null,
    sortDirection: 'asc',
    columnVisibility: {},
  });

  if (item?.type === 'toggle') {
    return (
      <div data-testid="fav-toggle-wrapper">
        <button
          type="button"
          data-testid="fav-toggle-button"
          data-active={String(item.active)}
          title={item.title}
          onClick={item.onClick}
        >
          {item.icon}
        </button>
        {modal}
      </div>
    );
  }

  return null;
};

const WORKLOAD_PANES = ['workloads', 'pods'] as const;
const paneSetters = {
  workloads: { filters: vi.fn(), sort: vi.fn(), visibility: vi.fn() },
  pods: { filters: vi.fn(), sort: vi.fn(), visibility: vi.fn() },
};

const GroupedPane: React.FC<{ pane: 'workloads' | 'pods' }> = ({ pane }) => {
  const { item, modal } = useFavToggle({
    paneId: pane,
    paneLabel: pane === 'workloads' ? 'Workloads' : 'Pods',
    filters: {
      search: pane === 'workloads' ? 'api' : '',
      kinds: { mode: 'all' },
      namespaces: { mode: 'all' },
      clusters: { mode: 'all' },
      queryFacets: pane === 'pods' ? { owners: { mode: 'none' } } : undefined,
      caseSensitive: false,
      includeMetadata: false,
    },
    sortColumn: 'name',
    sortDirection: 'asc',
    columnVisibility: {},
    hydrated: true,
    setFilters: paneSetters[pane].filters,
    setSortConfig: paneSetters[pane].sort,
    setColumnVisibility: paneSetters[pane].visibility,
    filterOptions: {},
  });
  return (
    <>
      {item?.type === 'toggle' ? (
        <button type="button" data-testid={`group-toggle-${pane}`} />
      ) : null}
      {modal}
    </>
  );
};

const GroupedWrapper: React.FC = () => (
  <FavoritePaneGroup primaryPaneId="workloads" expectedPaneIds={WORKLOAD_PANES}>
    <GroupedPane pane="workloads" />
    <GroupedPane pane="pods" />
  </FavoritePaneGroup>
);

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFavToggle', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderHook = async () => {
    await act(async () => {
      root.render(<HookWrapper />);
      await Promise.resolve();
    });
  };

  const clickToggle = async () => {
    const btn = container.querySelector<HTMLButtonElement>('[data-testid="fav-toggle-button"]');
    await act(async () => {
      requireValue(btn, 'expected test value in FavToggle.test.tsx').click();
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    mockFavorites = [];
    mockPendingFavorite = null;
    mockSetPendingFavorite.mockClear();
    mockAddFavorite.mockClear();
    mockUpdateFavorite.mockClear();
    mockDeleteFavorite.mockClear();
    favSaveModalPropsRef.current = null;
    Object.values(paneSetters).forEach((setters) => {
      setters.filters.mockClear();
      setters.sort.mockClear();
      setters.visibility.mockClear();
    });

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

  // -------------------------------------------------------------------------
  // 1. Returns outline heart when not favorited
  // -------------------------------------------------------------------------

  it('preserves case-distinct cluster IDs in a favorite snapshot', async () => {
    await act(async () => {
      root.render(<HookWrapper clusters={{ mode: 'some', values: ['Cluster-A', 'cluster-a'] }} />);
      await Promise.resolve();
    });
    await clickToggle();

    expect(favSaveModalPropsRef.current?.filters.clusters).toEqual({
      mode: 'some',
      values: ['Cluster-A', 'cluster-a'],
    });
  });

  it('returns outline heart when not favorited', async () => {
    mockFavorites = [];

    await renderHook();

    const btn = container.querySelector<HTMLButtonElement>('[data-testid="fav-toggle-button"]');
    expect(btn).toBeTruthy();
    expect(
      requireValue(btn, 'expected test value in FavToggle.test.tsx').getAttribute('data-active')
    ).toBe('false');
    expect(requireValue(btn, 'expected test value in FavToggle.test.tsx').title).toBe(
      'Save as favorite'
    );
  });

  // -------------------------------------------------------------------------
  // 2. Returns filled heart when favorited
  // -------------------------------------------------------------------------

  it('returns filled heart when favorited', async () => {
    mockFavorites = [makeFavorite()];

    await renderHook();

    const btn = container.querySelector<HTMLButtonElement>('[data-testid="fav-toggle-button"]');
    expect(btn).toBeTruthy();
    expect(
      requireValue(btn, 'expected test value in FavToggle.test.tsx').getAttribute('data-active')
    ).toBe('true');
    expect(requireValue(btn, 'expected test value in FavToggle.test.tsx').title).toBe(
      'Edit favorite'
    );
  });

  it('matches cluster-specific favorites by clusterId when present', async () => {
    mockFavorites = [
      makeFavorite({
        clusterSelection: '/different/path:production',
        clusterId: '/home/user/.kube/config:production',
      }),
    ];

    await renderHook();

    const btn = container.querySelector<HTMLButtonElement>('[data-testid="fav-toggle-button"]');
    expect(btn).toBeTruthy();
    expect(
      requireValue(btn, 'expected test value in FavToggle.test.tsx').getAttribute('data-active')
    ).toBe('true');
  });

  // -------------------------------------------------------------------------
  // 3. Click opens modal
  // -------------------------------------------------------------------------

  it('click opens the save modal', async () => {
    mockFavorites = [];

    await renderHook();
    await clickToggle();

    const modal = document.querySelector('[data-testid="fav-save-modal"]');
    expect(modal).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 4. Click when favorited opens modal with delete button
  // -------------------------------------------------------------------------

  it('click when favorited shows modal with delete option', async () => {
    mockFavorites = [makeFavorite()];

    await renderHook();
    await clickToggle();

    const modal = document.querySelector('[data-testid="fav-save-modal"]');
    expect(modal).toBeTruthy();

    const deleteBtn = document.querySelector('[data-testid="modal-delete"]');
    expect(deleteBtn).toBeTruthy();
  });

  // -------------------------------------------------------------------------
  // 5. Save via modal calls addFavorite
  // -------------------------------------------------------------------------

  it('save via modal calls addFavorite', async () => {
    mockFavorites = [];

    await renderHook();
    await clickToggle();

    const saveBtn = document.querySelector<HTMLElement>('[data-testid="modal-save"]');
    await act(async () => {
      requireValue(saveBtn, 'expected test value in FavToggle.test.tsx').click();
      await Promise.resolve();
    });

    expect(mockAddFavorite).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // 6. Delete via modal calls deleteFavorite
  // -------------------------------------------------------------------------

  it('delete via modal calls deleteFavorite', async () => {
    mockFavorites = [makeFavorite({ id: 'fav-42' })];

    await renderHook();
    await clickToggle();

    const deleteBtn = document.querySelector<HTMLElement>('[data-testid="modal-delete"]');
    await act(async () => {
      requireValue(deleteBtn, 'expected test value in FavToggle.test.tsx').click();
      await Promise.resolve();
    });

    expect(mockDeleteFavorite).toHaveBeenCalledWith('fav-42');
  });

  // -------------------------------------------------------------------------
  // 7. Modal closes after save
  // -------------------------------------------------------------------------

  it('modal closes after save', async () => {
    mockFavorites = [];

    await renderHook();
    await clickToggle();

    expect(document.querySelector('[data-testid="fav-save-modal"]')).toBeTruthy();

    const saveBtn = document.querySelector<HTMLElement>('[data-testid="modal-save"]');
    await act(async () => {
      requireValue(saveBtn, 'expected test value in FavToggle.test.tsx').click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(document.querySelector('[data-testid="fav-save-modal"]')).toBeNull();
  });

  // -------------------------------------------------------------------------
  // 8. Cancel closes modal without saving
  // -------------------------------------------------------------------------

  it('cancel closes modal without saving', async () => {
    mockFavorites = [];

    await renderHook();
    await clickToggle();

    const cancelBtn = document.querySelector<HTMLElement>('[data-testid="modal-cancel"]');
    await act(async () => {
      requireValue(cancelBtn, 'expected test value in FavToggle.test.tsx').click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(document.querySelector('[data-testid="fav-save-modal"]')).toBeNull();
    expect(mockAddFavorite).not.toHaveBeenCalled();
  });

  it('exposes one favorite action for a grouped two-pane view', async () => {
    await act(async () => {
      root.render(<GroupedWrapper />);
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="group-toggle-workloads"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="group-toggle-pods"]')).toBeNull();
  });

  it('restores both hydrated panes before consuming a grouped favorite', async () => {
    mockPendingFavorite = makeFavorite({
      panes: {
        workloads: {
          filters: {
            search: 'saved workloads',
            kinds: { mode: 'all' },
            namespaces: { mode: 'all' },
            clusters: { mode: 'all' },
            caseSensitive: false,
            includeMetadata: false,
          },
          tableState: { sortColumn: 'kind', sortDirection: 'desc', columnVisibility: {} },
        },
        pods: {
          filters: {
            search: 'saved pods',
            kinds: { mode: 'all' },
            namespaces: { mode: 'all' },
            clusters: { mode: 'all' },
            queryFacets: { owners: { mode: 'none' } },
            caseSensitive: false,
            includeMetadata: false,
          },
          tableState: {
            sortColumn: 'node',
            sortDirection: 'asc',
            columnVisibility: { cpu: false },
          },
        },
      },
    });

    await act(async () => {
      root.render(<GroupedWrapper />);
      await Promise.resolve();
    });

    expect(paneSetters.workloads.filters).toHaveBeenCalledWith(
      mockPendingFavorite.panes.workloads.filters
    );
    expect(paneSetters.pods.filters).toHaveBeenCalledWith(mockPendingFavorite.panes.pods.filters);
    expect(paneSetters.pods.sort).toHaveBeenCalledWith({ key: 'node', direction: 'asc' });
    expect(paneSetters.pods.visibility).toHaveBeenCalledWith({ cpu: false });
    expect(mockSetPendingFavorite).toHaveBeenCalledWith(null);
  });

  it('clears a pending grouped favorite that is missing a required saved pane', async () => {
    mockPendingFavorite = makeFavorite({
      panes: {
        workloads: {
          filters: {
            search: '',
            kinds: { mode: 'all' },
            namespaces: { mode: 'all' },
            clusters: { mode: 'all' },
            caseSensitive: false,
            includeMetadata: false,
          },
          tableState: { sortColumn: 'name', sortDirection: 'asc', columnVisibility: {} },
        },
      },
    });

    await act(async () => {
      root.render(<GroupedWrapper />);
      await Promise.resolve();
    });

    expect(mockSetPendingFavorite).toHaveBeenCalledWith(null);
    expect(paneSetters.workloads.filters).not.toHaveBeenCalled();
    expect(paneSetters.pods.filters).not.toHaveBeenCalled();
  });

  it('restores an explicitly unsorted pane', async () => {
    mockPendingFavorite = makeFavorite({
      panes: {
        workloads: {
          filters: {
            search: '',
            kinds: { mode: 'all' },
            namespaces: { mode: 'all' },
            clusters: { mode: 'all' },
            caseSensitive: false,
            includeMetadata: false,
          },
          tableState: { sortColumn: '', sortDirection: 'asc', columnVisibility: {} },
        },
        pods: {
          filters: {
            search: '',
            kinds: { mode: 'all' },
            namespaces: { mode: 'all' },
            clusters: { mode: 'all' },
            caseSensitive: false,
            includeMetadata: false,
          },
          tableState: { sortColumn: '', sortDirection: 'asc', columnVisibility: {} },
        },
      },
    });

    await act(async () => {
      root.render(<GroupedWrapper />);
      await Promise.resolve();
    });

    expect(paneSetters.workloads.sort).toHaveBeenCalledWith(null);
    expect(paneSetters.pods.sort).toHaveBeenCalledWith(null);
  });
});
