/**
 * frontend/src/ui/favorites/FavToggle.test.tsx
 *
 * Tests for the useFavToggle hook.
 * Covers: outline/filled heart states, popover choices for add/update/remove.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import React from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Favorite } from '@/core/persistence/favorites';

// ---------------------------------------------------------------------------
// Mocks — declared before importing the hook under test.
// ---------------------------------------------------------------------------

let mockCurrentFavoriteMatch: Favorite | null = null;
const mockAddFavorite = vi.fn().mockResolvedValue({ id: 'new-fav' });
const mockUpdateFavorite = vi.fn().mockResolvedValue(undefined);
const mockDeleteFavorite = vi.fn().mockResolvedValue(undefined);

vi.mock('@core/contexts/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: [],
    currentFavoriteMatch: mockCurrentFavoriteMatch,
    addFavorite: mockAddFavorite,
    updateFavorite: mockUpdateFavorite,
    deleteFavorite: mockDeleteFavorite,
    reorderFavorites: vi.fn().mockResolvedValue(undefined),
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
    setSelectedKubeconfig: vi.fn().mockResolvedValue(undefined),
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
    namespaces: [],
    selectedNamespace: 'default',
    namespaceLoading: false,
    namespaceRefreshing: false,
    setSelectedNamespace: vi.fn(),
    loadNamespaces: vi.fn().mockResolvedValue(undefined),
    refreshNamespaces: vi.fn().mockResolvedValue(undefined),
    getClusterNamespace: vi.fn(),
  }),
}));

// Import after mocks
import { useFavToggle } from './FavToggle';

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
  filters: null,
  tableState: null,
  order: 0,
  ...overrides,
});

/**
 * Wrapper component that calls useFavToggle() and renders the returned
 * IconBarItem as a button with the icon inside — mirroring how IconBar renders it.
 */
const HookWrapper: React.FC = () => {
  const item = useFavToggle({
    filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
    sortColumn: null,
    sortDirection: 'asc',
    columnVisibility: {},
  });

  if (item.type === 'toggle') {
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
      </div>
    );
  }

  return null;
};

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
    expect(btn).toBeTruthy();
    await act(async () => {
      btn!.click();
      await Promise.resolve();
    });
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    mockCurrentFavoriteMatch = null;
    mockAddFavorite.mockClear();
    mockUpdateFavorite.mockClear();
    mockDeleteFavorite.mockClear();

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

  it('returns outline heart when not favorited', async () => {
    mockCurrentFavoriteMatch = null;

    await renderHook();

    const btn = container.querySelector<HTMLButtonElement>('[data-testid="fav-toggle-button"]');
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute('data-active')).toBe('false');
    expect(btn!.title).toBe('Save as favorite');
  });

  // -------------------------------------------------------------------------
  // 2. Returns filled heart when favorited
  // -------------------------------------------------------------------------

  it('returns filled heart when favorited', async () => {
    mockCurrentFavoriteMatch = makeFavorite();

    await renderHook();

    const btn = container.querySelector<HTMLButtonElement>('[data-testid="fav-toggle-button"]');
    expect(btn).toBeTruthy();
    expect(btn!.getAttribute('data-active')).toBe('true');
    expect(btn!.title).toBe('Update or remove favorite');
  });

  // -------------------------------------------------------------------------
  // 3. Click when not favorited shows add popover choices
  // -------------------------------------------------------------------------

  it('click when not favorited shows add popover choices', async () => {
    mockCurrentFavoriteMatch = null;

    await renderHook();
    await clickToggle();

    // Popover is rendered via portal to document.body.
    const popover = document.querySelector('[data-testid="fav-toggle-popover"]');
    expect(popover).toBeTruthy();

    const items = document.querySelectorAll('[data-testid="fav-toggle-popover-item"]');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('Save for any cluster');
    expect(items[1].textContent).toBe('Save for this cluster');
  });

  // -------------------------------------------------------------------------
  // 4. Click when favorited shows update/remove choices
  // -------------------------------------------------------------------------

  it('click when favorited shows update/remove choices', async () => {
    mockCurrentFavoriteMatch = makeFavorite();

    await renderHook();
    await clickToggle();

    const popover = document.querySelector('[data-testid="fav-toggle-popover"]');
    expect(popover).toBeTruthy();

    const items = document.querySelectorAll('[data-testid="fav-toggle-popover-item"]');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe('Update');
    expect(items[1].textContent).toBe('Remove');
  });

  // -------------------------------------------------------------------------
  // 5. "Save for any cluster" calls addFavorite with empty clusterSelection
  // -------------------------------------------------------------------------

  it('save for any cluster calls addFavorite with empty clusterSelection', async () => {
    mockCurrentFavoriteMatch = null;

    await renderHook();
    await clickToggle();

    const items = document.querySelectorAll<HTMLElement>('[data-testid="fav-toggle-popover-item"]');
    await act(async () => {
      items[0].click();
      await Promise.resolve();
    });

    expect(mockAddFavorite).toHaveBeenCalledTimes(1);
    const arg = mockAddFavorite.mock.calls[0][0];
    expect(arg.clusterSelection).toBe('');
    expect(arg.name).toBe('default / Pods');
  });

  // -------------------------------------------------------------------------
  // 6. "Save for this cluster" calls addFavorite with selectedKubeconfig
  // -------------------------------------------------------------------------

  it('save for this cluster calls addFavorite with selectedKubeconfig', async () => {
    mockCurrentFavoriteMatch = null;

    await renderHook();
    await clickToggle();

    const items = document.querySelectorAll<HTMLElement>('[data-testid="fav-toggle-popover-item"]');
    await act(async () => {
      items[1].click();
      await Promise.resolve();
    });

    expect(mockAddFavorite).toHaveBeenCalledTimes(1);
    const arg = mockAddFavorite.mock.calls[0][0];
    expect(arg.clusterSelection).toBe('/home/user/.kube/config:production');
    expect(arg.name).toBe('production / default / Pods');
  });

  // -------------------------------------------------------------------------
  // 7. "Remove" calls deleteFavorite
  // -------------------------------------------------------------------------

  it('remove calls deleteFavorite', async () => {
    mockCurrentFavoriteMatch = makeFavorite({ id: 'fav-42' });

    await renderHook();
    await clickToggle();

    const items = document.querySelectorAll<HTMLElement>('[data-testid="fav-toggle-popover-item"]');
    await act(async () => {
      items[1].click(); // "Remove"
      await Promise.resolve();
    });

    expect(mockDeleteFavorite).toHaveBeenCalledWith('fav-42');
  });

  // -------------------------------------------------------------------------
  // 8. "Update" calls updateFavorite
  // -------------------------------------------------------------------------

  it('update calls updateFavorite', async () => {
    mockCurrentFavoriteMatch = makeFavorite({ id: 'fav-42' });

    await renderHook();
    await clickToggle();

    const items = document.querySelectorAll<HTMLElement>('[data-testid="fav-toggle-popover-item"]');
    await act(async () => {
      items[0].click(); // "Update"
      await Promise.resolve();
    });

    expect(mockUpdateFavorite).toHaveBeenCalledTimes(1);
    expect(mockUpdateFavorite.mock.calls[0][0].id).toBe('fav-42');
  });

  // -------------------------------------------------------------------------
  // 9. Popover closes after action
  // -------------------------------------------------------------------------

  it('popover closes after clicking an action', async () => {
    mockCurrentFavoriteMatch = null;

    await renderHook();
    await clickToggle();

    expect(document.querySelector('[data-testid="fav-toggle-popover"]')).toBeTruthy();

    const items = document.querySelectorAll<HTMLElement>('[data-testid="fav-toggle-popover-item"]');
    await act(async () => {
      items[0].click();
      // Flush the mock promise and any resulting state updates.
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(document.querySelector('[data-testid="fav-toggle-popover"]')).toBeNull();
  });
});
