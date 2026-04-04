/**
 * frontend/src/shared/components/tables/hooks/useGridTableHeaderContextMenu.test.tsx
 *
 * Integration tests for the header context menu items builder.
 * Renders a full GridTable with four column types, then right-clicks each
 * header to verify the menu items match the column's capabilities:
 *   - sortable + hideable
 *   - sortable + locked (non-hideable)
 *   - non-sortable + locked (neither sortable nor hideable)
 *   - non-sortable + hideable
 */

import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import GridTable, { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { KeyboardProvider } from '@ui/shortcuts';
import { ZoomProvider } from '@core/contexts/ZoomContext';

// ---------------------------------------------------------------------------
// Mocks required by ContextMenu / GridTable internals
// ---------------------------------------------------------------------------

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));

// Mock useKeyboardContext to return no-op functions.
// This avoids shortcut registration overhead that causes act() to hang in jsdom.
vi.mock('@ui/shortcuts', async (importOriginal) => {
  const original = await importOriginal<typeof import('@ui/shortcuts')>();
  return {
    ...original,
    useKeyboardContext: () => ({
      registerShortcut: () => 'mock-id',
      unregisterShortcut: () => {},
      currentContext: { view: 'global', priority: 0 },
      setContext: () => {},
      pushContext: () => {},
      popContext: () => {},
      getAvailableShortcuts: () => [],
      isShortcutAvailable: () => false,
      setEnabled: () => {},
      isEnabled: true,
    }),
  };
});

// ---------------------------------------------------------------------------
// Row & column definitions
// ---------------------------------------------------------------------------

interface TestRow {
  id: string;
  status: string;
  name: string;
  kind: string;
  namespace: string;
}

const testRows: TestRow[] = [
  { id: 'r1', status: 'Running', name: 'pod-a', kind: 'Pod', namespace: 'default' },
  { id: 'r2', status: 'Pending', name: 'pod-b', kind: 'Pod', namespace: 'kube-system' },
];

// Four columns covering all capability combinations:
//   status    - sortable + hideable (not in locked set)
//   name      - sortable + locked   (non-hideable by default)
//   kind      - non-sortable + locked (neither sortable nor hideable)
//   namespace - non-sortable + hideable
const testColumns: GridColumnDefinition<TestRow>[] = [
  { key: 'status', header: 'Status', sortable: true, render: (row) => row.status },
  { key: 'name', header: 'Name', sortable: true, render: (row) => row.name },
  { key: 'kind', header: 'Kind', sortable: false, render: (row) => row.kind },
  { key: 'namespace', header: 'Namespace', sortable: false, render: (row) => row.namespace },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush React's async scheduler. */
const flushAsync = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

/** Close the open context menu by dispatching Escape on the menu element. */
const closeMenu = async () => {
  const menu = document.body.querySelector<HTMLDivElement>('.context-menu');
  if (menu) {
    await act(async () => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });
    await flushAsync();
  }
};

/** Right-click a column header and flush React updates. */
const rightClickHeader = async (container: HTMLElement, columnKey: string) => {
  const header = container.querySelector<HTMLDivElement>(
    `.grid-cell-header[data-column="${columnKey}"]`
  );
  if (!header) {
    throw new Error(`Header for column "${columnKey}" not found`);
  }
  await act(async () => {
    header.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, clientX: 50, clientY: 50 })
    );
    await Promise.resolve();
  });
  await flushAsync();
};

/** Return the currently-rendered context menu items from the portal. */
const getMenuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLDivElement>('[role="menuitem"]'));

/** Extract the label text of a menu item (from the .context-menu-label span). */
const getItemLabel = (el: HTMLElement): string =>
  el.querySelector('.context-menu-label')?.textContent?.trim() ?? '';

/** Extract all menu item labels. */
const getMenuLabels = () => getMenuItems().map(getItemLabel);

/** Return the currently-rendered dividers from the portal. */
const getMenuDividers = () =>
  Array.from(document.body.querySelectorAll<HTMLDivElement>('.context-menu-divider'));

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

interface RenderOptions {
  onSort?: (key: string, targetDirection?: 'asc' | 'desc' | null) => void;
  sortConfig?: { key: string; direction: 'asc' | 'desc' | null };
  onColumnVisibilityChange?: (visibility: Record<string, boolean>) => void;
}

function renderGridTable(options: RenderOptions = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const props = {
    data: testRows,
    columns: testColumns,
    keyExtractor: (item: TestRow) => `cluster-a|${item.id}`,
    virtualization: { enabled: false } as const,
    enableContextMenu: true,
    enableColumnVisibilityMenu: true,
    onSort: options.onSort ?? vi.fn(),
    sortConfig: options.sortConfig,
    onColumnVisibilityChange: options.onColumnVisibilityChange,
    // nonHideableColumns intentionally omitted - the default locked set
    // (kind, type, name) is applied by useColumnVisibilityController.
  };

  act(() => {
    root.render(
      <ZoomProvider>
        <KeyboardProvider>
          <GridTable<TestRow> {...props} />
        </KeyboardProvider>
      </ZoomProvider>
    );
  });

  const rerender = (nextOptions: RenderOptions) => {
    const nextProps = {
      ...props,
      onSort: nextOptions.onSort ?? props.onSort,
      sortConfig: nextOptions.sortConfig ?? props.sortConfig,
      onColumnVisibilityChange:
        nextOptions.onColumnVisibilityChange ?? props.onColumnVisibilityChange,
    };
    act(() => {
      root.render(
        <ZoomProvider>
          <KeyboardProvider>
            <GridTable<TestRow> {...nextProps} />
          </KeyboardProvider>
        </ZoomProvider>
      );
    });
  };

  const cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };

  return { container, rerender, cleanup };
}

// ---------------------------------------------------------------------------
// Test cleanup helper - removes all child nodes from body safely
// ---------------------------------------------------------------------------
const cleanBody = () => {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('header context menu integration', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(async () => {
    // Clean up any remaining React work and portal remnants.
    await act(async () => {
      await Promise.resolve();
    });
    cleanBody();
    runtimeMocks.eventsOn.mockReset();
    runtimeMocks.eventsOff.mockReset();
  });

  // 1. Sortable + hideable column (status)
  it('shows sort items, divider, and Hide Column for a sortable+hideable column', async () => {
    const { container, cleanup } = renderGridTable();
    await flushAsync();

    await rightClickHeader(container, 'status');

    const dividers = getMenuDividers();
    const labels = getMenuLabels();

    // Should have: Sort Ascending, Sort Descending, Clear Sort, Hide Column
    expect(labels).toContain('Sort Ascending');
    expect(labels).toContain('Sort Descending');
    expect(labels).toContain('Clear Sort');
    expect(labels).toContain('Hide Column');

    // There should be a divider between sort items and Hide Column
    expect(dividers.length).toBeGreaterThanOrEqual(1);

    await closeMenu();
    cleanup();
  });

  // 2. Locked sortable column (name) - sort items but no Hide Column
  it('shows sort items but NOT Hide Column for a locked sortable column', async () => {
    const { container, cleanup } = renderGridTable();
    await flushAsync();

    await rightClickHeader(container, 'name');

    const labels = getMenuLabels();

    expect(labels).toContain('Sort Ascending');
    expect(labels).toContain('Sort Descending');
    expect(labels).toContain('Clear Sort');
    expect(labels).not.toContain('Hide Column');

    await closeMenu();
    cleanup();
  });

  // 3. Locked non-sortable column (kind) - single disabled "No Actions"
  it('shows a single disabled "No Actions" item for a locked non-sortable column', async () => {
    const { container, cleanup } = renderGridTable();
    await flushAsync();

    await rightClickHeader(container, 'kind');

    const items = getMenuItems();
    expect(items).toHaveLength(1);
    expect(getItemLabel(items[0])).toBe('No Actions');
    expect(items[0].classList.contains('disabled')).toBe(true);

    await closeMenu();
    cleanup();
  });

  // 4. Non-sortable hideable column (namespace) - only Hide Column
  it('shows only Hide Column for a non-sortable hideable column', async () => {
    const { container, cleanup } = renderGridTable();
    await flushAsync();

    await rightClickHeader(container, 'namespace');

    const labels = getMenuLabels();

    expect(labels).toEqual(['Hide Column']);
    // No sort items present
    expect(labels).not.toContain('Sort Ascending');
    expect(labels).not.toContain('Sort Descending');
    expect(labels).not.toContain('Clear Sort');

    await closeMenu();
    cleanup();
  });

  // 5. Disabled states based on current sort
  it('disables Sort Ascending when already sorted asc, and Clear Sort when not sorted', async () => {
    // Render with status sorted ascending
    const { container, cleanup } = renderGridTable({
      sortConfig: { key: 'status', direction: 'asc' },
    });
    await flushAsync();

    await rightClickHeader(container, 'status');

    const items = getMenuItems();
    const sortAsc = items.find((el) => getItemLabel(el) === 'Sort Ascending');
    const sortDesc = items.find((el) => getItemLabel(el) === 'Sort Descending');
    const clearSort = items.find((el) => getItemLabel(el) === 'Clear Sort');

    // Sort Ascending should be disabled since we are already sorted asc
    expect(sortAsc).toBeDefined();
    expect(sortAsc!.classList.contains('disabled')).toBe(true);

    // Sort Descending should be enabled
    expect(sortDesc).toBeDefined();
    expect(sortDesc!.classList.contains('disabled')).toBe(false);

    // Clear Sort should be enabled since column IS sorted
    expect(clearSort).toBeDefined();
    expect(clearSort!.classList.contains('disabled')).toBe(false);

    await closeMenu();

    // Now check a column that is NOT currently sorted (name)
    await rightClickHeader(container, 'name');

    const nameItems = getMenuItems();
    const nameClearSort = nameItems.find((el) => getItemLabel(el) === 'Clear Sort');

    // Clear Sort should be disabled since name is not the sorted column
    expect(nameClearSort).toBeDefined();
    expect(nameClearSort!.classList.contains('disabled')).toBe(true);

    await closeMenu();
    cleanup();
  });

  // 6. Click handlers fire correctly
  it('calls onSort with correct args when Sort Ascending is clicked', async () => {
    const onSort = vi.fn();
    const { container, cleanup } = renderGridTable({ onSort });
    await flushAsync();

    await rightClickHeader(container, 'status');

    const items = getMenuItems();
    const sortAsc = items.find((el) => getItemLabel(el) === 'Sort Ascending');
    expect(sortAsc).toBeDefined();

    await act(async () => {
      sortAsc!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(onSort).toHaveBeenCalledWith('status', 'asc');

    await closeMenu();
    cleanup();
  });

  it('calls onColumnVisibilityChange when Hide Column is clicked', async () => {
    const onColumnVisibilityChange = vi.fn();
    const { container, cleanup } = renderGridTable({ onColumnVisibilityChange });
    await flushAsync();

    await rightClickHeader(container, 'status');

    const items = getMenuItems();
    const hideColumn = items.find((el) => getItemLabel(el) === 'Hide Column');
    expect(hideColumn).toBeDefined();

    await act(async () => {
      hideColumn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    await flushAsync();

    // The visibility controller should call onColumnVisibilityChange with
    // status set to false.
    expect(onColumnVisibilityChange).toHaveBeenCalled();
    const visibilityArg = onColumnVisibilityChange.mock.calls[0][0];
    expect(visibilityArg.status).toBe(false);

    await closeMenu();
    cleanup();
  });
});
