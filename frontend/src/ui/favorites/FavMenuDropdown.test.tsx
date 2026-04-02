/**
 * frontend/src/ui/favorites/FavMenuDropdown.test.tsx
 *
 * Tests for the FavMenuDropdown component.
 * Covers: render, dropdown toggle, empty state, navigation on click,
 * and hover action visibility.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Favorite } from '@/core/persistence/favorites';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the component under test.
// ---------------------------------------------------------------------------

const mockFavorites: Favorite[] = [];
const mockCurrentFavoriteMatch: Favorite | null = null;
const mockUpdateFavorite = vi.fn().mockResolvedValue(undefined);
const mockDeleteFavorite = vi.fn().mockResolvedValue(undefined);
const mockReorderFavorites = vi.fn().mockResolvedValue(undefined);
const mockAddFavorite = vi.fn().mockResolvedValue(undefined);

vi.mock('@core/contexts/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: mockFavorites,
    currentFavoriteMatch: mockCurrentFavoriteMatch,
    addFavorite: mockAddFavorite,
    updateFavorite: mockUpdateFavorite,
    deleteFavorite: mockDeleteFavorite,
    reorderFavorites: mockReorderFavorites,
    pendingFavorite: null,
    setPendingFavorite: vi.fn(),
  }),
}));

const mockSetSelectedKubeconfigs = vi.fn().mockResolvedValue(undefined);
const mockSetActiveKubeconfig = vi.fn();

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfigs: ['cluster-a:ctx'],
    selectedKubeconfig: 'cluster-a:ctx',
    selectedClusterId: 'cluster-a:ctx',
    selectedClusterName: 'cluster-a',
    selectedClusterIds: ['cluster-a:ctx'],
    kubeconfigsLoading: false,
    setSelectedKubeconfigs: mockSetSelectedKubeconfigs,
    setActiveKubeconfig: mockSetActiveKubeconfig,
    setSelectedKubeconfig: vi.fn().mockResolvedValue(undefined),
    getClusterMeta: vi.fn(() => ({ id: '', name: '' })),
    kubeconfigs: [],
    loadKubeconfigs: vi.fn().mockResolvedValue(undefined),
  }),
}));

const mockSetViewType = vi.fn();
const mockSetActiveClusterView = vi.fn();
const mockSetActiveNamespaceTab = vi.fn();
const mockOnNamespaceSelect = vi.fn();
const mockSetSidebarSelection = vi.fn();

vi.mock('@core/contexts/ViewStateContext', () => ({
  useViewState: () => ({
    viewType: 'namespace',
    previousView: 'overview',
    activeNamespaceTab: 'workloads',
    activeClusterTab: null,
    setViewType: mockSetViewType,
    setPreviousView: vi.fn(),
    setActiveNamespaceTab: mockSetActiveNamespaceTab,
    setActiveClusterView: mockSetActiveClusterView,
    navigateToClusterView: vi.fn(),
    navigateToNamespace: vi.fn(),
    onNamespaceSelect: mockOnNamespaceSelect,
    onClusterObjectsClick: vi.fn(),
    getClusterNavigationState: vi.fn(),
    // sidebar state
    isSidebarVisible: true,
    sidebarWidth: 250,
    isResizing: false,
    sidebarSelection: null,
    toggleSidebar: vi.fn(),
    setSidebarWidth: vi.fn(),
    setIsResizing: vi.fn(),
    setSidebarSelection: mockSetSidebarSelection,
    // object panel state
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
    // modal state
    isSettingsOpen: false,
    setIsSettingsOpen: vi.fn(),
    isAboutOpen: false,
    setIsAboutOpen: vi.fn(),
  }),
}));

const mockSetSelectedNamespace = vi.fn();

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({
    namespaces: [
      { name: 'default', scope: '', status: 'Active', details: '', age: '', hasWorkloads: true, workloadsUnknown: false, resourceVersion: '1' },
      { name: 'kube-system', scope: '', status: 'Active', details: '', age: '', hasWorkloads: true, workloadsUnknown: false, resourceVersion: '1' },
    ],
    selectedNamespace: 'default',
    namespaceLoading: false,
    namespaceRefreshing: false,
    setSelectedNamespace: mockSetSelectedNamespace,
    loadNamespaces: vi.fn().mockResolvedValue(undefined),
    refreshNamespaces: vi.fn().mockResolvedValue(undefined),
    getClusterNamespace: vi.fn(),
  }),
}));

vi.mock('@/core/refresh', () => ({
  refreshOrchestrator: { updateContext: vi.fn(), triggerManualRefreshForContext: vi.fn() },
}));

// Import the component after all mocks are established.
import FavMenuDropdown from './FavMenuDropdown';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const makeFavorite = (overrides: Partial<Favorite> = {}): Favorite => ({
  id: 'fav-1',
  name: 'My Pods',
  clusterSelection: '',
  viewType: 'namespace',
  view: 'pods',
  namespace: 'default',
  filters: null,
  tableState: null,
  order: 0,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FavMenuDropdown', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async () => {
    await act(async () => {
      root.render(<FavMenuDropdown />);
      await Promise.resolve();
    });
  };

  const clickButton = async () => {
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="Favorites"]');
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
    // Reset favorites to empty by default; individual tests override via splice.
    mockFavorites.length = 0;
    mockUpdateFavorite.mockClear();
    mockDeleteFavorite.mockClear();
    mockReorderFavorites.mockClear();
    mockSetViewType.mockClear();
    mockSetActiveClusterView.mockClear();
    mockSetActiveNamespaceTab.mockClear();
    mockOnNamespaceSelect.mockClear();
    mockSetSidebarSelection.mockClear();
    mockSetSelectedNamespace.mockClear();
    mockSetSelectedKubeconfigs.mockClear();
    mockSetActiveKubeconfig.mockClear();

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

  // -----------------------------------------------------------------------
  // 1. Renders the heart button
  // -----------------------------------------------------------------------

  it('renders the heart button', async () => {
    await renderComponent();
    const btn = container.querySelector<HTMLButtonElement>('button[aria-label="Favorites"]');
    expect(btn).toBeTruthy();
    expect(btn!.className).toContain('settings-button');
  });

  // -----------------------------------------------------------------------
  // 2. Shows dropdown with favorites on click
  // -----------------------------------------------------------------------

  it('shows dropdown with favorites on click', async () => {
    mockFavorites.push(
      makeFavorite({ id: 'fav-1', name: 'My Pods' }),
      makeFavorite({ id: 'fav-2', name: 'Kube System Events', view: 'events', namespace: 'kube-system' })
    );

    await renderComponent();

    // Dropdown not visible before click.
    expect(container.querySelector('.fav-dropdown-panel')).toBeNull();

    await clickButton();

    const panel = container.querySelector('.fav-dropdown-panel');
    expect(panel).toBeTruthy();

    const rows = container.querySelectorAll('.fav-dropdown-row');
    expect(rows.length).toBe(2);

    const names = Array.from(container.querySelectorAll('.fav-dropdown-name'));
    expect(names.map((n) => n.textContent)).toEqual(['My Pods', 'Kube System Events']);
  });

  // -----------------------------------------------------------------------
  // 3. Shows empty state when no favorites
  // -----------------------------------------------------------------------

  it('shows empty state when no favorites', async () => {
    await renderComponent();
    await clickButton();

    const empty = container.querySelector('.fav-dropdown-empty');
    expect(empty).toBeTruthy();
    expect(empty!.textContent).toContain('No favorites yet');
  });

  // -----------------------------------------------------------------------
  // 4. Clicking a favorite triggers navigation
  // -----------------------------------------------------------------------

  it('clicking a favorite triggers navigation', async () => {
    mockFavorites.push(
      makeFavorite({ id: 'fav-1', name: 'My Pods', viewType: 'namespace', view: 'pods', namespace: 'default' })
    );

    await renderComponent();
    await clickButton();

    const row = container.querySelector<HTMLDivElement>('.fav-dropdown-row');
    expect(row).toBeTruthy();

    await act(async () => {
      row!.click();
      await Promise.resolve();
    });

    // Navigation utility should have been invoked, which calls setViewType.
    expect(mockSetViewType).toHaveBeenCalledWith('namespace');
    expect(mockSetActiveNamespaceTab).toHaveBeenCalledWith('pods');
    expect(mockSetSelectedNamespace).toHaveBeenCalledWith('default');
    expect(mockOnNamespaceSelect).toHaveBeenCalledWith('default');
    expect(mockSetSidebarSelection).toHaveBeenCalledWith({
      type: 'namespace',
      value: 'default',
    });

    // Dropdown should close after navigation.
    expect(container.querySelector('.fav-dropdown-panel')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 5. Hover actions appear on mouse enter
  // -----------------------------------------------------------------------

  it('hover actions appear on mouse enter', async () => {
    mockFavorites.push(makeFavorite({ id: 'fav-1', name: 'My Pods' }));

    await renderComponent();
    await clickButton();

    const row = container.querySelector<HTMLDivElement>('.fav-dropdown-row');
    expect(row).toBeTruthy();

    // The CSS class fav-dropdown-hover-actions is present in the DOM — visibility
    // is controlled by the CSS rule `.fav-dropdown-row:hover .fav-dropdown-hover-actions`.
    // We verify the hover actions element exists and contains the expected buttons.
    const actions = row!.querySelector('.fav-dropdown-hover-actions');
    expect(actions).toBeTruthy();

    const buttons = actions!.querySelectorAll('button');
    // 4 action buttons: up, down, rename, delete
    expect(buttons.length).toBe(4);
    expect(buttons[0].title).toBe('Move up');
    expect(buttons[1].title).toBe('Move down');
    expect(buttons[2].title).toBe('Rename');
    expect(buttons[3].title).toBe('Delete');
  });

  // -----------------------------------------------------------------------
  // 6. Footer legend is rendered
  // -----------------------------------------------------------------------

  it('renders the footer legend', async () => {
    await renderComponent();
    await clickButton();

    const footer = container.querySelector('.fav-dropdown-footer');
    expect(footer).toBeTruthy();
    expect(footer!.textContent).toContain('any cluster');
    expect(footer!.textContent).toContain('pinned to cluster');
  });

  // -----------------------------------------------------------------------
  // 7. Delete action calls deleteFavorite
  // -----------------------------------------------------------------------

  it('delete action calls deleteFavorite', async () => {
    mockFavorites.push(makeFavorite({ id: 'fav-1', name: 'My Pods' }));

    await renderComponent();
    await clickButton();

    const actions = container.querySelector('.fav-dropdown-hover-actions');
    const deleteBtn = actions!.querySelector<HTMLButtonElement>('button[title="Delete"]');
    expect(deleteBtn).toBeTruthy();

    await act(async () => {
      deleteBtn!.click();
      await Promise.resolve();
    });

    expect(mockDeleteFavorite).toHaveBeenCalledWith('fav-1');
  });

  // -----------------------------------------------------------------------
  // 8. Toggle closes the dropdown on second click
  // -----------------------------------------------------------------------

  it('closes the dropdown on second button click', async () => {
    await renderComponent();

    await clickButton();
    expect(container.querySelector('.fav-dropdown-panel')).toBeTruthy();

    await clickButton();
    expect(container.querySelector('.fav-dropdown-panel')).toBeNull();
  });
});
