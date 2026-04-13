/**
 * frontend/src/ui/favorites/FavSaveModal.test.tsx
 *
 * Tests for the FavSaveModal component.
 * Covers: render/hide, name pre-population, save, cancel, delete visibility,
 * save-disabled-when-unchanged, and view dropdown scope changes.
 */

import ReactDOM from 'react-dom/client';
import React from 'react';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Favorite, FavoriteFilters, FavoriteTableState } from '@/core/persistence/favorites';

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the component under test.
// ---------------------------------------------------------------------------

vi.mock('@ui/shortcuts', () => ({
  useShortcut: vi.fn(),
  useKeyboardContext: () => ({
    currentContext: { view: 'global', priority: 0 },
    setContext: vi.fn(),
    registerShortcut: vi.fn(),
    unregisterShortcut: vi.fn(),
    getAvailableShortcuts: vi.fn(() => []),
    isShortcutAvailable: vi.fn(() => false),
    setEnabled: vi.fn(),
    isEnabled: true,
    registerSurface: vi.fn(),
    unregisterSurface: vi.fn(),
    updateSurface: vi.fn(),
    dispatchNativeAction: vi.fn(() => false),
  }),
  useShortcuts: vi.fn(),
  useSearchShortcutTarget: () => undefined,
}));

vi.mock('@shared/components/modals/useModalFocusTrap', () => ({
  useModalFocusTrap: vi.fn(),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({
    selectedKubeconfigs: ['/home/user/.kube/config:prod-cluster'],
    selectedKubeconfig: '/home/user/.kube/config:prod-cluster',
    selectedClusterId: '/home/user/.kube/config:prod-cluster',
    selectedClusterName: 'prod-cluster',
    selectedClusterIds: ['/home/user/.kube/config:prod-cluster'],
    kubeconfigsLoading: false,
    setSelectedKubeconfigs: vi.fn().mockResolvedValue(undefined),
    setActiveKubeconfig: vi.fn(),
    setSelectedKubeconfig: vi.fn().mockResolvedValue(undefined),
    getClusterMeta: vi.fn(() => ({ id: '', name: '' })),
    kubeconfigs: [
      {
        name: 'config',
        path: '/home/user/.kube/config',
        context: 'prod-cluster',
        isDefault: true,
        isCurrentContext: true,
      },
    ],
    loadKubeconfigs: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  useNamespace: () => ({
    namespaces: [
      {
        name: 'default',
        scope: 'default',
        status: 'Active',
        details: '',
        age: '',
        hasWorkloads: true,
        workloadsUnknown: false,
        resourceVersion: '1',
      },
      {
        name: 'kube-system',
        scope: 'kube-system',
        status: 'Active',
        details: '',
        age: '',
        hasWorkloads: true,
        workloadsUnknown: false,
        resourceVersion: '1',
      },
    ],
    selectedNamespace: 'default',
    namespaceLoading: false,
    namespaceRefreshing: false,
    setSelectedNamespace: vi.fn(),
    loadNamespaces: vi.fn().mockResolvedValue(undefined),
    refreshNamespaces: vi.fn().mockResolvedValue(undefined),
    getClusterNamespace: vi.fn(),
  }),
}));

// Mock Dropdown to render a simple <select> so we can drive view changes.
vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({ options, value, onChange, placeholder, disabled }: any) => {
    const opts = (options ?? []).filter((o: any) => !o.group);
    return (
      <select
        data-testid={`dropdown-${placeholder ?? 'select'}`}
        value={Array.isArray(value) ? value.join(',') : (value ?? '')}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {opts.map((o: any) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  },
}));

// Mock Tooltip to a simple span.
vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: () => <span data-testid="tooltip" />,
}));

// Mock ConfirmationModal to a simple div that captures props.
const confirmModalProps = { current: null as any };
vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: (props: any) => {
    confirmModalProps.current = props;
    if (!props.isOpen) return null;
    return (
      <div data-testid="confirmation-modal">
        <button data-testid="confirm-delete" onClick={props.onConfirm}>
          {props.confirmText}
        </button>
        <button data-testid="cancel-delete" onClick={props.onCancel}>
          {props.cancelText}
        </button>
      </div>
    );
  },
}));

// Mock createPortal so modal content renders into the test container.
vi.mock('react-dom', async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  };
});

// Import after all mocks are established.
import FavSaveModal from './FavSaveModal';
import type { FavSaveModalProps } from './FavSaveModal';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const defaultFilters: FavoriteFilters = {
  search: '',
  kinds: [],
  namespaces: [],
  caseSensitive: false,
  includeMetadata: false,
};

const defaultTableState: FavoriteTableState = {
  sortColumn: 'name',
  sortDirection: 'asc',
  columnVisibility: {},
};

const makeFavorite = (overrides: Partial<Favorite> = {}): Favorite => ({
  id: 'fav-1',
  name: 'My Pods',
  clusterSelection: '/home/user/.kube/config:prod-cluster',
  viewType: 'namespace',
  view: 'pods',
  namespace: 'default',
  filters: { ...defaultFilters },
  tableState: { ...defaultTableState },
  order: 0,
  ...overrides,
});

const makeProps = (overrides: Partial<FavSaveModalProps> = {}): FavSaveModalProps => ({
  isOpen: true,
  onClose: vi.fn(),
  existingFavorite: null,
  defaultName: 'prod-cluster / default / Pods',
  kubeconfigSelection: '/home/user/.kube/config:prod-cluster',
  viewType: 'namespace',
  viewLabel: 'Pods',
  namespace: 'default',
  filters: { ...defaultFilters },
  tableState: { ...defaultTableState },
  includeMetadata: false,
  onSave: vi.fn(),
  onDelete: vi.fn(),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FavSaveModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const renderComponent = async (props: FavSaveModalProps) => {
    await act(async () => {
      root.render(<FavSaveModal {...props} />);
      await Promise.resolve();
    });
  };

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    confirmModalProps.current = null;
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
  // 1. Does not render when isOpen is false
  // -----------------------------------------------------------------------

  it('does not render when isOpen is false', async () => {
    const props = makeProps({ isOpen: false });
    await renderComponent(props);

    expect(container.querySelector('.modal-overlay')).toBeNull();
    expect(container.querySelector('.fav-save-modal')).toBeNull();
  });

  // -----------------------------------------------------------------------
  // 2. Renders when isOpen is true
  // -----------------------------------------------------------------------

  it('renders when isOpen is true', async () => {
    const props = makeProps({ isOpen: true });
    await renderComponent(props);

    expect(container.querySelector('.modal-overlay')).toBeTruthy();
    expect(container.querySelector('.fav-save-modal')).toBeTruthy();
    expect(container.querySelector('.modal-header h2')?.textContent).toBe('Save Favorite');
  });

  // -----------------------------------------------------------------------
  // 3. Name input is pre-populated with defaultName
  // -----------------------------------------------------------------------

  it('name input is pre-populated with defaultName', async () => {
    const props = makeProps({ defaultName: 'Test Default Name' });
    await renderComponent(props);

    const input = container.querySelector<HTMLInputElement>('#fav-name');
    expect(input).toBeTruthy();
    expect(input!.value).toBe('Test Default Name');
  });

  // -----------------------------------------------------------------------
  // 4. Clicking Save calls onSave with correct favorite data
  // -----------------------------------------------------------------------

  it('clicking Save calls onSave with correct favorite data', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const props = makeProps({ onSave, onClose });
    await renderComponent(props);

    const saveBtn = container.querySelector<HTMLButtonElement>('button.save');
    expect(saveBtn).toBeTruthy();

    await act(async () => {
      saveBtn!.click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedFav = onSave.mock.calls[0][0] as Favorite;
    expect(savedFav.name).toBe('prod-cluster / default / Pods');
    expect(savedFav.viewType).toBe('namespace');
    expect(savedFav.view).toBe('pods');
    expect(savedFav.namespace).toBe('default');
    expect(savedFav.id).toBe(''); // New favorite has empty id.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // -----------------------------------------------------------------------
  // 5. Clicking Cancel calls onClose without calling onSave
  // -----------------------------------------------------------------------

  it('clicking Cancel calls onClose without calling onSave', async () => {
    const onSave = vi.fn();
    const onClose = vi.fn();
    const props = makeProps({ onSave, onClose });
    await renderComponent(props);

    const cancelBtn = container.querySelector<HTMLButtonElement>('button.cancel');
    expect(cancelBtn).toBeTruthy();

    await act(async () => {
      cancelBtn!.click();
      await Promise.resolve();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 6. Delete button only shows when editing (existingFavorite is non-null)
  // -----------------------------------------------------------------------

  it('delete button only shows when editing', async () => {
    // New favorite — no delete button.
    const propsNew = makeProps({ existingFavorite: null });
    await renderComponent(propsNew);

    expect(container.querySelector<HTMLButtonElement>('button.danger')).toBeNull();

    // Edit existing favorite — delete button is present.
    const existingFav = makeFavorite();
    const propsEdit = makeProps({ existingFavorite: existingFav });

    await act(async () => {
      root.render(<FavSaveModal {...propsEdit} />);
      await Promise.resolve();
    });

    const deleteBtn = container.querySelector<HTMLButtonElement>('button.danger');
    expect(deleteBtn).toBeTruthy();
    expect(deleteBtn!.textContent).toBe('Delete');
  });

  // -----------------------------------------------------------------------
  // 7. Save button is disabled when editing with no changes
  // -----------------------------------------------------------------------

  it('save button is disabled when editing with no changes', async () => {
    const existingFav = makeFavorite();
    const props = makeProps({
      existingFavorite: existingFav,
      defaultName: existingFav.name,
      kubeconfigSelection: existingFav.clusterSelection,
      viewType: existingFav.viewType,
      viewLabel: 'Pods',
      namespace: existingFav.namespace,
      filters: existingFav.filters!,
    });
    await renderComponent(props);

    const saveBtn = container.querySelector<HTMLButtonElement>('button.save');
    expect(saveBtn).toBeTruthy();
    expect(saveBtn!.disabled).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 8. View dropdown changes update the scope correctly
  // -----------------------------------------------------------------------

  it('view dropdown changes update the scope', async () => {
    const onSave = vi.fn();
    const props = makeProps({ onSave });
    await renderComponent(props);

    // Change the view dropdown to a cluster-scoped view.
    const viewSelect = container.querySelector<HTMLSelectElement>(
      'select[data-testid="dropdown-Select view..."]'
    );
    expect(viewSelect).toBeTruthy();

    await act(async () => {
      // Change to cluster:nodes
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLSelectElement.prototype,
        'value'
      )?.set;
      nativeInputValueSetter?.call(viewSelect!, 'cluster:nodes');
      viewSelect!.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

    // Save and verify the scope changed to cluster.
    const saveBtn = container.querySelector<HTMLButtonElement>('button.save');
    await act(async () => {
      saveBtn!.click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedFav = onSave.mock.calls[0][0] as Favorite;
    expect(savedFav.viewType).toBe('cluster');
    expect(savedFav.view).toBe('nodes');
    // Cluster views don't have a namespace.
    expect(savedFav.namespace).toBe('');
  });

  // -----------------------------------------------------------------------
  // 9. Header says "Edit Favorite" when editing
  // -----------------------------------------------------------------------

  it('shows "Edit Favorite" header when editing', async () => {
    const props = makeProps({ existingFavorite: makeFavorite() });
    await renderComponent(props);

    expect(container.querySelector('.modal-header h2')?.textContent).toBe('Edit Favorite');
  });
});
