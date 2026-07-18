/**
 * frontend/src/ui/favorites/FavSaveModal.test.tsx
 *
 * Tests for the FavSaveModal component.
 * Covers: render/hide, name pre-population, save, cancel, delete visibility,
 * save-disabled-when-unchanged, and view dropdown scope changes.
 */

import type { DropdownProps } from '@shared/components/dropdowns/Dropdown';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Favorite, FavoriteFilters, FavoriteTableState } from '@/core/persistence/favorites';
import { requireValue } from '@/test-utils/requireValue';

interface ConfirmationModalMockProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
}

// ---------------------------------------------------------------------------
// Mocks — must be declared before importing the component under test.
// ---------------------------------------------------------------------------

vi.mock('@ui/shortcuts', () => ({
  useShortcut: vi.fn(),
  useKeyboardContext: () => ({
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
    hasActiveBlockingSurface: vi.fn(() => false),
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
    getClusterMeta: vi.fn((selection: string) =>
      selection === '/home/user/.kube/config:prod-cluster'
        ? { id: 'config:prod-cluster', name: 'prod-cluster' }
        : { id: '', name: '' }
    ),
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
  Dropdown: ({
    options,
    value,
    onChange,
    placeholder,
    disabled,
    searchable,
    showBulkActions,
    displayValue,
  }: DropdownProps) => {
    const opts = options.filter((option) => !option.group);
    return (
      <>
        <select
          data-testid={`dropdown-${placeholder ?? 'select'}`}
          value={Array.isArray(value) ? value.join(',') : (value ?? '')}
          disabled={disabled}
          data-searchable={searchable ? 'true' : 'false'}
          data-bulk-actions={showBulkActions ? 'true' : 'false'}
          data-display-value={typeof displayValue === 'string' ? displayValue : undefined}
          onChange={(e) => onChange(e.target.value)}
        >
          {opts.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {showBulkActions ? (
          <button
            type="button"
            data-testid={`select-all-${placeholder ?? 'select'}`}
            onClick={() =>
              onChange(opts.filter((option) => !option.disabled).map((option) => option.value))
            }
          >
            Select all
          </button>
        ) : null}
      </>
    );
  },
}));

// Mock Tooltip to a simple span.
vi.mock('@shared/components/Tooltip', () => ({
  __esModule: true,
  default: () => <span data-testid="tooltip" />,
}));

// Mock ConfirmationModal to a simple div that captures props.
vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: (props: ConfirmationModalMockProps) => {
    if (!props.isOpen) {
      return null;
    }
    return (
      <div data-testid="confirmation-modal">
        <button type="button" data-testid="confirm-delete" onClick={props.onConfirm}>
          {props.confirmText}
        </button>
        <button type="button" data-testid="cancel-delete" onClick={props.onCancel}>
          {props.cancelText}
        </button>
      </div>
    );
  },
}));

// Mock createPortal so modal content renders into the test container.
vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-dom')>();
  return {
    ...actual,
    createPortal: (children: React.ReactNode) => children,
  };
});

import type { FavSaveModalProps } from './FavSaveModal';
// Import after all mocks are established.
import FavSaveModal from './FavSaveModal';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const defaultFilters: FavoriteFilters = {
  search: '',
  kinds: { mode: 'all' },
  namespaces: { mode: 'all' },
  clusters: { mode: 'all' },
  queryFacets: {
    apiGroups: { mode: 'some', values: ['apps'] },
    resourceScopes: { mode: 'some', values: ['Namespace'] },
  },
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
  panes: {
    main: { filters: { ...defaultFilters }, tableState: { ...defaultTableState } },
  },
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

  beforeEach(() => {
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

  it('renders and saves all declared filters for both Workloads panes', async () => {
    const onSave = vi.fn();
    await renderComponent(
      makeProps({
        onSave,
        panes: [
          {
            id: 'workloads',
            label: 'Workloads',
            filters: defaultFilters,
            tableState: defaultTableState,
            filterOptions: { showKindDropdown: true, kinds: ['Deployment'] },
          },
          {
            id: 'pods',
            label: 'Pods',
            filters: {
              ...defaultFilters,
              clusters: { mode: 'some', values: ['cluster-a'] },
              queryFacets: { owners: { mode: 'some', values: ['Deployment/api'] } },
            },
            tableState: { ...defaultTableState, sortColumn: 'node' },
            filterOptions: {
              showClusterDropdown: true,
              clusters: [{ value: 'cluster-a', label: 'Production' }],
              queryFacets: [
                {
                  key: 'owners',
                  label: 'Owners',
                  placeholder: 'All owners',
                  options: [
                    { value: 'Deployment/api', label: 'Deployment/api' },
                    { value: 'StatefulSet/db', label: 'StatefulSet/db' },
                  ],
                },
              ],
            },
          },
        ],
      })
    );

    expect(container.textContent).toContain('Workloads Filters');
    expect(container.textContent).toContain('Pods Filters');
    expect(container.textContent).toContain('Clusters');
    expect(container.textContent).toContain('Owners');

    await act(async () => {
      const owners = container.querySelector<HTMLSelectElement>(
        '[data-testid="dropdown-All owners"]'
      );
      requireValue(owners, 'expected Owners filter in FavSaveModal.test.tsx').value =
        'StatefulSet/db';
      requireValue(owners, 'expected Owners filter in FavSaveModal.test.tsx').dispatchEvent(
        new Event('change', { bubbles: true })
      );
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button.save')?.click();
      await Promise.resolve();
    });

    const saved = onSave.mock.calls[0]?.[0] as Favorite;
    expect(saved.panes.pods.filters.clusters).toEqual({
      mode: 'some',
      values: ['cluster-a'],
    });
    expect(saved.panes.pods.filters.queryFacets?.owners).toEqual({
      mode: 'some',
      values: ['StatefulSet/db'],
    });
    expect(saved.panes.pods.tableState.sortColumn).toBe('node');
  });

  it('saves Select all as a semantic all selection for provider facets', async () => {
    const onSave = vi.fn();
    await renderComponent(
      makeProps({
        onSave,
        panes: [
          {
            id: 'main',
            label: 'Pods',
            filters: {
              ...defaultFilters,
              queryFacets: { owners: { mode: 'some', values: ['Deployment/api'] } },
            },
            tableState: defaultTableState,
            filterOptions: {
              queryFacets: [
                {
                  key: 'owners',
                  label: 'Owners',
                  placeholder: 'All owners',
                  options: [
                    { value: 'Deployment/api', label: 'Deployment/api' },
                    { value: 'StatefulSet/db', label: 'StatefulSet/db' },
                  ],
                },
              ],
            },
          },
        ],
      })
    );

    const selectAll = container.querySelector<HTMLButtonElement>(
      '[data-testid="select-all-All owners"]'
    );
    expect(selectAll).toBeTruthy();
    await act(async () => {
      selectAll?.click();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button.save')?.click();
      await Promise.resolve();
    });

    const saved = onSave.mock.calls[0]?.[0] as Favorite;
    expect(saved.panes.main.filters.queryFacets?.owners).toEqual({ mode: 'all' });
  });

  it('enables search and bulk actions for the Kinds dropdown', async () => {
    await renderComponent(makeProps({ availableKinds: ['Pod', 'Deployment'] }));

    const kinds = container.querySelector('[data-testid="dropdown-All kinds"]');
    expect(kinds?.getAttribute('data-searchable')).toBe('true');
    expect(kinds?.getAttribute('data-bulk-actions')).toBe('true');
  });

  it('summarizes semantic all and none selections instead of listing option values', async () => {
    await renderComponent(
      makeProps({
        filters: {
          ...defaultFilters,
          namespaces: { mode: 'none' },
        },
        availableKinds: ['Pod', 'Deployment'],
        availableFilterNamespaces: ['default', 'kube-system'],
      })
    );

    const kinds = container.querySelector('[data-testid="dropdown-All kinds"]');
    const namespaces = container.querySelector('[data-testid="dropdown-All namespaces"]');
    expect(kinds?.getAttribute('data-display-value')).toBe('All');
    expect(namespaces?.getAttribute('data-display-value')).toBe('None');
  });

  it('summarizes explicit selections with their count', async () => {
    await renderComponent(
      makeProps({
        filters: {
          ...defaultFilters,
          kinds: { mode: 'some', values: ['Pod', 'Deployment'] },
        },
        availableKinds: ['Pod', 'Deployment', 'StatefulSet'],
      })
    );

    const kinds = container.querySelector('[data-testid="dropdown-All kinds"]');
    expect(kinds?.getAttribute('data-display-value')).toBe('2 selected');
  });

  it('does not close when overlay is clicked', async () => {
    const onClose = vi.fn();
    const props = makeProps({ isOpen: true, onClose });
    await renderComponent(props);

    const modal = container.querySelector('.fav-save-modal') as HTMLDivElement | null;
    const overlay = container.querySelector('.modal-overlay') as HTMLDivElement | null;
    expect(modal).toBeTruthy();
    expect(overlay).toBeTruthy();

    act(() => {
      modal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 3. Name input is pre-populated with defaultName
  // -----------------------------------------------------------------------

  it('name input is pre-populated with defaultName', async () => {
    const props = makeProps({ defaultName: 'Test Default Name' });
    await renderComponent(props);

    const input = container.querySelector<HTMLInputElement>('[id$="-fav-name"]');
    expect(input).toBeTruthy();
    expect(requireValue(input, 'expected test value in FavSaveModal.test.tsx').value).toBe(
      'Test Default Name'
    );
  });

  it('preserves an edited name when live pane props refresh while open', async () => {
    const pane = {
      id: 'main',
      label: 'Pods',
      filters: defaultFilters,
      tableState: defaultTableState,
      filterOptions: { showKindDropdown: true, kinds: ['Pod', 'Deployment'] },
    };
    const props = makeProps({ panes: [pane] });
    await renderComponent(props);

    const input = requireValue(
      container.querySelector<HTMLInputElement>('[id$="-fav-name"]'),
      'expected favorite name input in FavSaveModal.test.tsx'
    );
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set;
      setValue?.call(input, 'My custom favorite');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
    });

    await renderComponent({
      ...props,
      panes: [
        {
          ...pane,
          filterOptions: { ...pane.filterOptions, kinds: [...pane.filterOptions.kinds] },
        },
      ],
    });

    expect(input.value).toBe('My custom favorite');
  });

  it('starts a new draft from current props after the modal reopens', async () => {
    const props = makeProps({ defaultName: 'Initial name' });
    await renderComponent(props);
    await renderComponent({ ...props, isOpen: false, defaultName: 'Updated name' });
    await renderComponent({ ...props, isOpen: true, defaultName: 'Updated name' });

    const input = requireValue(
      container.querySelector<HTMLInputElement>('[id$="-fav-name"]'),
      'expected reopened favorite name input in FavSaveModal.test.tsx'
    );
    expect(input.value).toBe('Updated name');
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
      requireValue(saveBtn, 'expected test value in FavSaveModal.test.tsx').click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedFav = onSave.mock.calls[0][0] as Favorite;
    expect(savedFav.name).toBe('prod-cluster / default / Pods');
    expect(savedFav.viewType).toBe('namespace');
    expect(savedFav.view).toBe('pods');
    expect(savedFav.namespace).toBe('default');
    expect(savedFav.clusterSelection).toBe('/home/user/.kube/config:prod-cluster');
    expect(savedFav.clusterId).toBe('config:prod-cluster');
    expect(savedFav.clusterName).toBe('prod-cluster');
    expect(savedFav.panes.main.filters.queryFacets).toEqual(defaultFilters.queryFacets);
    expect(savedFav.id).toBe(''); // New favorite has empty id.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the modal open and reports a rejected save', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Favorites use a newer schema'));
    const onClose = vi.fn();
    await renderComponent(makeProps({ onSave, onClose }));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button.save')?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onClose).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      'Favorites use a newer schema'
    );
  });

  it('saves Event provider facet selections in favorites', async () => {
    const onSave = vi.fn();
    const filters: FavoriteFilters = {
      ...defaultFilters,
      queryFacets: {
        types: { mode: 'some', values: ['Warning'] },
        reasons: { mode: 'some', values: ['BackOff'] },
        sources: { mode: 'some', values: ['kubelet'] },
        statuses: { mode: 'some', values: ['Needs attention'] },
      },
    };
    await renderComponent(makeProps({ onSave, filters, viewLabel: 'Events' }));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button.save')?.click();
      await Promise.resolve();
    });

    const saved = onSave.mock.calls[0]?.[0] as Favorite;
    expect(saved.panes.main.filters.queryFacets).toEqual(filters.queryFacets);
    expect(saved.clusterId).toBe('config:prod-cluster');
  });

  it('preserves cluster filter selections in favorites', async () => {
    const onSave = vi.fn();
    const filters: FavoriteFilters = {
      ...defaultFilters,
      clusters: { mode: 'some', values: ['cluster-a', 'cluster-b'] },
    };
    await renderComponent(makeProps({ onSave, filters, viewLabel: 'Namespaces' }));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button.save')?.click();
      await Promise.resolve();
    });

    const saved = onSave.mock.calls[0]?.[0] as Favorite;
    expect(saved.panes.main.filters.clusters).toEqual({
      mode: 'some',
      values: ['cluster-a', 'cluster-b'],
    });
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
      requireValue(cancelBtn, 'expected test value in FavSaveModal.test.tsx').click();
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
    expect(
      requireValue(deleteBtn, 'expected test value in FavSaveModal.test.tsx').textContent
    ).toBe('Delete');
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
      filters: existingFav.panes.main.filters,
    });
    await renderComponent(props);

    const saveBtn = container.querySelector<HTMLButtonElement>('button.save');
    expect(saveBtn).toBeTruthy();
    expect(requireValue(saveBtn, 'expected test value in FavSaveModal.test.tsx').disabled).toBe(
      true
    );
  });

  // -----------------------------------------------------------------------
  // 8. View dropdown changes update the scope correctly
  // -----------------------------------------------------------------------

  it('does not allow retargeting saved pane state to a different view', async () => {
    const onSave = vi.fn();
    const props = makeProps({ onSave });
    await renderComponent(props);

    // Change the view dropdown to a cluster-scoped view.
    const viewSelect = container.querySelector<HTMLSelectElement>(
      'select[data-testid="dropdown-Select view..."]'
    );
    expect(viewSelect).toBeTruthy();
    expect(requireValue(viewSelect, 'expected test value in FavSaveModal.test.tsx').disabled).toBe(
      true
    );

    // Save and verify the scope changed to cluster.
    const saveBtn = container.querySelector<HTMLButtonElement>('button.save');
    await act(async () => {
      requireValue(saveBtn, 'expected test value in FavSaveModal.test.tsx').click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    const savedFav = onSave.mock.calls[0][0] as Favorite;
    expect(savedFav.viewType).toBe('namespace');
    expect(savedFav.view).toBe('pods');
    expect(savedFav.namespace).toBe('default');
    expect(savedFav.panes).toEqual({
      main: { filters: defaultFilters, tableState: defaultTableState },
    });
  });

  it('offers every registered global, cluster, and namespace view', async () => {
    await renderComponent(makeProps());

    const viewSelect = requireValue(
      container.querySelector<HTMLSelectElement>('select[data-testid="dropdown-Select view..."]'),
      'expected view dropdown in FavSaveModal.test.tsx'
    );

    expect(Array.from(viewSelect.options, (option) => option.value)).toEqual([
      'global:fleet',
      'global:global-namespaces',
      'cluster:attention',
      'cluster:namespaces',
      'cluster:browse',
      'cluster:events',
      'cluster:nodes',
      'cluster:config',
      'cluster:storage',
      'cluster:crds',
      'cluster:custom',
      'cluster:rbac',
      'namespace:browse',
      'namespace:map',
      'namespace:events',
      'namespace:workloads',
      'namespace:autoscaling',
      'namespace:helm',
      'namespace:config',
      'namespace:network',
      'namespace:storage',
      'namespace:custom',
      'namespace:quotas',
      'namespace:rbac',
    ]);
    expect(viewSelect.options[0]?.textContent).toBe('Clusters');
    expect(viewSelect.options[1]?.textContent).toBe('Namespaces');
  });

  it('saves Global favorites without an active-cluster binding', async () => {
    const onSave = vi.fn();
    await renderComponent(
      makeProps({
        onSave,
        viewType: 'global',
        viewLabel: 'Clusters',
        namespace: '',
      })
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button.save')?.click();
      await Promise.resolve();
    });

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterSelection: '',
        clusterId: '',
        clusterName: '',
        viewType: 'global',
        view: 'fleet',
        namespace: '',
      })
    );
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
