/**
 * frontend/src/shared/components/tables/hooks/useGridTableHeaderRow.test.tsx
 *
 * Test suite for useGridTableHeaderRow.
 * Covers key behaviors and edge cases for useGridTableHeaderRow.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGridTableHeaderRow } from '@shared/components/tables/hooks/useGridTableHeaderRow';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

const renderSortIndicator = vi.fn((key: string) => <span data-testid={`sort-${key}`} />);
const handleHeaderClick = vi.fn();
const handleResizeStart = vi.fn();
const autoSizeColumn = vi.fn();

const columns: GridColumnDefinition<any>[] = [
  {
    key: 'name',
    header: 'Name',
    sortable: true,
    className: 'col-name',
    render: (row: any) => row?.name ?? null,
  },
  {
    key: 'age',
    header: 'Age',
    sortable: false,
    className: 'col-age',
    render: (row: any) => row?.age ?? null,
  },
  {
    key: 'role',
    header: 'Role',
    sortable: true,
    className: 'col-role',
    render: (row: any) => row?.role ?? null,
  },
];

const columnWidths = { name: 120, age: 80, role: 100 };

const HeaderHarness: React.FC<{
  enableResizing: boolean;
  fixedKeys?: string[];
}> = ({ enableResizing, fixedKeys = [] }) => {
  const node = useGridTableHeaderRow({
    renderedColumns: columns,
    enableColumnResizing: enableResizing,
    isFixedColumnKey: (key) => fixedKeys.includes(key),
    columnWidths,
    handleHeaderClick,
    renderSortIndicator,
    handleResizeStart,
    autoSizeColumn,
  });
  return <>{node}</>;
};

describe('useGridTableHeaderRow', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    handleHeaderClick.mockClear();
    handleResizeStart.mockClear();
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

    const nameHeader = headerCells[0].querySelector('span > span') as HTMLSpanElement;
    await act(async () => {
      nameHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    expect(handleHeaderClick).toHaveBeenCalledWith(columns[0]);

    const resizeHandles = container.querySelectorAll('.resize-handle');
    expect(resizeHandles).toHaveLength(2);

    await act(async () => {
      resizeHandles[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      await Promise.resolve();
    });
    expect(handleResizeStart).toHaveBeenCalled();
    const resizeArgs = handleResizeStart.mock.calls[0];
    expect(resizeArgs[1]).toBe('name');
    expect(resizeArgs[2]).toBe('age');

    await act(async () => {
      resizeHandles[0].dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await Promise.resolve();
    });
    expect(autoSizeColumn).toHaveBeenCalledWith('name');
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

    const roleHeader = container.querySelector('[data-column="role"] span > span') as HTMLElement;
    await act(async () => {
      roleHeader.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });
    // sortable column should still trigger click even without resize handles
    expect(handleHeaderClick).toHaveBeenCalledWith(columns[2]);
  });

  it('activates sort via Enter and Space keys on sortable headers', async () => {
    await act(async () => {
      root.render(<HeaderHarness enableResizing={false} />);
    });

    const sortableSpan = container.querySelector(
      '[data-column="name"] span > span[role="button"]'
    ) as HTMLElement;
    expect(sortableSpan).not.toBeNull();
    expect(sortableSpan.tabIndex).toBe(0);
    expect(sortableSpan.getAttribute('aria-label')).toBe('Sort by Name');

    // Enter triggers sort.
    await act(async () => {
      sortableSpan.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
      await Promise.resolve();
    });
    expect(handleHeaderClick).toHaveBeenCalledTimes(1);
    expect(handleHeaderClick).toHaveBeenCalledWith(columns[0]);

    handleHeaderClick.mockClear();

    // Space triggers sort.
    await act(async () => {
      sortableSpan.dispatchEvent(
        new KeyboardEvent('keydown', { key: ' ', bubbles: true })
      );
      await Promise.resolve();
    });
    expect(handleHeaderClick).toHaveBeenCalledTimes(1);
    expect(handleHeaderClick).toHaveBeenCalledWith(columns[0]);
  });

  it('does not add keyboard/button semantics to non-sortable headers', async () => {
    await act(async () => {
      root.render(<HeaderHarness enableResizing={false} />);
    });

    // "Age" column is not sortable.
    const ageSpan = container.querySelector(
      '[data-column="age"] span > span'
    ) as HTMLElement;
    expect(ageSpan).not.toBeNull();
    expect(ageSpan.hasAttribute('role')).toBe(false);
    expect(ageSpan.hasAttribute('tabindex')).toBe(false);
  });
});
