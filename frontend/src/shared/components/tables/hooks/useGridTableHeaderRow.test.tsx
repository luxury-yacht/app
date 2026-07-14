/**
 * frontend/src/shared/components/tables/hooks/useGridTableHeaderRow.test.tsx
 *
 * Test suite for useGridTableHeaderRow.
 * Covers key behaviors and edge cases for useGridTableHeaderRow.
 */

import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';
import { useGridTableHeaderRow } from '@shared/components/tables/hooks/useGridTableHeaderRow';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderSortIndicator = vi.fn((key: string) => <span data-testid={`sort-${key}`} />);
const handleHeaderClick = vi.fn();
const handleHeaderContextMenu = vi.fn();
const handleResizeStart = vi.fn();
const handleResizeKeyDown = vi.fn();
const autoSizeColumn = vi.fn();

type Row = { name: string; age: string; role: string; kind?: string };

const columns: GridColumnDefinition<Row>[] = [
  {
    key: 'name',
    header: 'Name',
    sortable: true,
    className: 'col-name',
    render: (row) => row.name,
  },
  {
    key: 'age',
    header: 'Age',
    sortable: false,
    className: 'col-age',
    render: (row) => row.age,
  },
  {
    key: 'role',
    header: 'Role',
    className: 'col-role',
    render: (row) => row.role,
  },
];

const columnWidths = { name: 120, age: 80, role: 100 };

const HeaderHarness: React.FC<{
  enableResizing: boolean;
  fixedKeys?: string[];
  withContextMenu?: boolean;
  tableColumns?: GridColumnDefinition<Row>[];
}> = ({ enableResizing, fixedKeys = [], withContextMenu = false, tableColumns = columns }) => {
  const node = useGridTableHeaderRow({
    renderedColumns: tableColumns,
    enableColumnResizing: enableResizing,
    isFixedColumnKey: (key) => fixedKeys.includes(key),
    handleHeaderContextMenu: withContextMenu ? handleHeaderContextMenu : undefined,
    columnWidths,
    handleHeaderClick,
    renderSortIndicator,
    handleResizeStart,
    handleResizeKeyDown,
    getColumnMinWidth: () => 40,
    getColumnMaxWidth: () => 400,
    autoSizeColumn,
  });
  return <>{node}</>;
};

describe('useGridTableHeaderRow', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    handleHeaderClick.mockClear();
    handleHeaderContextMenu.mockClear();
    handleResizeStart.mockClear();
    handleResizeKeyDown.mockClear();
    autoSizeColumn.mockClear();
    renderSortIndicator.mockClear();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('renders headers, invokes sort handler, and shows resize handles for eligible columns', async () => {
    await act(async () => {
      root.render(<HeaderHarness enableResizing />);
    });

    const headerCells = Array.from(container.querySelectorAll('.grid-cell-header'));
    expect(headerCells).toHaveLength(3);
    expect(renderSortIndicator).toHaveBeenCalledWith('name');
    expect(renderSortIndicator).toHaveBeenCalledWith('role');

    const nameHeader = headerCells[0].querySelector('button') as HTMLButtonElement;
    await act(async () => {
      nameHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(handleHeaderClick).toHaveBeenCalledWith(columns[0]);

    const resizeHandles = container.querySelectorAll('.resize-handle');
    expect(resizeHandles).toHaveLength(2);
    expect(resizeHandles[0]?.tagName).toBe('HR');
    expect(resizeHandles[0]?.getAttribute('tabindex')).toBe('0');
    expect(resizeHandles[0]?.getAttribute('aria-valuenow')).toBe('120');

    await act(async () => {
      resizeHandles[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await Promise.resolve();
    });
    expect(handleResizeStart).toHaveBeenCalled();
    const resizeArgs = handleResizeStart.mock.calls[0];
    expect(resizeArgs[1]).toBe('name');
    expect(resizeArgs[2]).toBe('age');

    await act(async () => {
      resizeHandles[0].dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
      await Promise.resolve();
    });
    expect(handleResizeKeyDown).toHaveBeenCalled();
    expect(handleResizeKeyDown.mock.calls[0][1]).toBe('name');

    await act(async () => {
      resizeHandles[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await Promise.resolve();
    });
    expect(autoSizeColumn).toHaveBeenCalledWith('name');
  });

  it('aligns headers independently and defaults omitted alignment to left', async () => {
    const alignedColumns: GridColumnDefinition<Row>[] = [
      {
        key: 'name',
        header: 'Name',
        alignData: 'right',
        render: (row) => row.name,
      },
      {
        key: 'age',
        header: 'Age',
        alignHeader: 'center',
        render: (row) => row.age,
      },
      {
        key: 'role',
        header: 'Role',
        alignHeader: 'right',
        render: (row) => row.role,
      },
    ];

    await act(async () => {
      root.render(<HeaderHarness enableResizing={false} tableColumns={alignedColumns} />);
    });

    expect(container.querySelector('[data-column="name"]')?.getAttribute('data-align')).toBe(
      'left'
    );
    expect(container.querySelector('[data-column="age"]')?.getAttribute('data-align')).toBe(
      'center'
    );
    expect(container.querySelector('[data-column="role"]')?.getAttribute('data-align')).toBe(
      'right'
    );
  });

  it('hides resize handles when columns are fixed or resizing disabled', async () => {
    await act(async () => {
      root.render(<HeaderHarness enableResizing={false} />);
    });
    expect(container.querySelectorAll('.resize-handle')).toHaveLength(0);

    await act(async () => {
      root.render(<HeaderHarness enableResizing fixedKeys={['age', 'role']} />);
    });
    expect(container.querySelectorAll('.resize-handle')).toHaveLength(0);

    const roleHeader = container.querySelector('[data-column="role"] button') as HTMLElement;
    await act(async () => {
      roleHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    // sortable column should still trigger click even without resize handles
    expect(handleHeaderClick).toHaveBeenCalledWith(columns[2]);
  });

  it('renders a passive separator after the Kind column when it is fixed', async () => {
    const kindColumns: GridColumnDefinition<Row>[] = [
      { key: 'kind', header: 'Kind', sortable: true, render: (row) => row.kind ?? null },
      { key: 'name', header: 'Name', sortable: true, render: (row) => row.name },
    ];

    const KindHarness: React.FC = () => {
      const node = useGridTableHeaderRow({
        renderedColumns: kindColumns,
        enableColumnResizing: true,
        isFixedColumnKey: (key) => key === 'kind',
        handleHeaderContextMenu: undefined,
        columnWidths: { kind: 120, name: 180 },
        handleHeaderClick,
        renderSortIndicator,
        handleResizeStart,
        handleResizeKeyDown,
        getColumnMinWidth: () => 40,
        getColumnMaxWidth: () => 400,
        autoSizeColumn,
      });
      return <>{node}</>;
    };

    await act(async () => {
      root.render(<KindHarness />);
    });

    expect(container.querySelectorAll('.resize-handle')).toHaveLength(0);
    expect(container.querySelectorAll('.column-separator')).toHaveLength(1);
  });

  it('uses a native button for sortable-header activation', async () => {
    await act(async () => {
      root.render(<HeaderHarness enableResizing={false} />);
    });

    const sortableButton = container.querySelector(
      '[data-column="name"] button[aria-label="Sort by Name"]'
    ) as HTMLButtonElement;
    expect(sortableButton).not.toBeNull();
    expect(sortableButton.tabIndex).toBe(0);

    await act(async () => {
      sortableButton.click();
      await Promise.resolve();
    });
    expect(handleHeaderClick).toHaveBeenCalledTimes(1);
    expect(handleHeaderClick).toHaveBeenCalledWith(columns[0]);
  });

  it('fires handleHeaderContextMenu with column key on right-click', async () => {
    await act(async () => {
      root.render(<HeaderHarness enableResizing={false} withContextMenu />);
    });

    const nameCell = container.querySelector('[data-column="name"]') as HTMLElement;
    await act(async () => {
      nameCell.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 200 })
      );
      await Promise.resolve();
    });

    expect(handleHeaderContextMenu).toHaveBeenCalledTimes(1);
    expect(handleHeaderContextMenu.mock.calls[0][1]).toBe('name');
  });

  it('does not fire context menu handler when not provided', async () => {
    await act(async () => {
      root.render(<HeaderHarness enableResizing={false} />);
    });

    const nameCell = container.querySelector('[data-column="name"]') as HTMLElement;
    await act(async () => {
      nameCell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
      await Promise.resolve();
    });

    expect(handleHeaderContextMenu).not.toHaveBeenCalled();
  });

  it('does not add keyboard/button semantics to non-sortable headers', async () => {
    await act(async () => {
      root.render(<HeaderHarness enableResizing={false} />);
    });

    // "Age" column is not sortable.
    const ageSpan = container.querySelector('[data-column="age"] span > span') as HTMLElement;
    expect(ageSpan).not.toBeNull();
    expect(ageSpan.hasAttribute('role')).toBe(false);
    expect(ageSpan.hasAttribute('tabindex')).toBe(false);
  });
});
