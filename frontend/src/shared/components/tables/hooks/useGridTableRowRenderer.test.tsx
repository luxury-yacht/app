/**
 * frontend/src/shared/components/tables/hooks/useGridTableRowRenderer.test.tsx
 *
 * Test suite for useGridTableRowRenderer.
 * Covers key behaviors and edge cases for useGridTableRowRenderer.
 */

import { useGridTableRowRenderer } from '@shared/components/tables/hooks/useGridTableRowRenderer';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

type Row = { name: string };
type RowRendererOptions = Parameters<typeof useGridTableRowRenderer<Row>>[0];

const renderHook = <T,>(hook: () => T) => {
  const result: { current: T | undefined } = { current: undefined };

  const TestComponent: React.FC = () => {
    result.current = hook();
    return null;
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  act(() => {
    root.render(<TestComponent />);
  });

  return {
    get: () =>
      requireValue(result.current, 'expected test value in useGridTableRowRenderer.test.tsx'),
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
};

describe('useGridTableRowRenderer', () => {
  const baseColumns: RowRendererOptions['columnRenderModelsWithOffsets'] = [
    {
      column: {
        key: 'name',
        header: 'Name',
        alignHeader: 'right',
        render: (row) => row.name,
      },
      key: 'name',
      className: 'name-col',
      cellStyle: { width: 100 },
      start: 0,
      end: 0,
      width: 100,
    },
    {
      column: {
        key: 'age',
        header: 'Age',
        alignData: 'center',
        render: (row) => row.name,
      },
      key: 'age',
      className: 'age-col',
      cellStyle: { width: 50 },
      start: 100,
      end: 150,
      width: 50,
    },
  ];

  it('renders rows with virtualization applied', () => {
    const measureRowRef = vi.fn();
    const handleRowClick = vi.fn();
    const renderers = renderHook(() =>
      useGridTableRowRenderer({
        keyExtractor: (_item, index) => `row-${index}`,
        getRowClassName: () => 'gridtable-row--selected',
        getRowStyle: () => ({ color: 'red' }),
        handleRowClick,
        handleRowMouseEnter: vi.fn(),
        handleRowMouseLeave: vi.fn(),
        columnRenderModelsWithOffsets: baseColumns,
        columnVirtualizationConfig: {
          enabled: true,
          overscanColumns: 0,
          stickyStart: 1,
          stickyEnd: 0,
        },
        columnWindowRange: { startIndex: 0, endIndex: 0 },
        handleContextMenu: vi.fn(),
        getCachedCellContent: (column, item) => ({
          content: `${column.key}-${item.name}`,
          text: item.name,
        }),
        measureRowRef,
      })
    );

    const renderRow = renderers.get();
    const rowElement = renderRow({ name: 'alpha' }, 0, true, 'row-alpha') as React.ReactElement;
    const rowProps = rowElement.props as {
      className: string;
      onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
      [key: string]: unknown;
    };
    expect(rowProps.className).toContain('gridtable-row');
    expect(rowProps['data-row-selected']).toBe('true');

    const fakeEvent = {
      stopPropagation: vi.fn(),
      target: document.createElement('div'),
    } as unknown as React.MouseEvent<HTMLDivElement>;
    rowProps.onClick(fakeEvent);
    expect(handleRowClick).toHaveBeenCalledOnce();
    expect(handleRowClick).toHaveBeenCalledWith({ name: 'alpha' }, 0, fakeEvent);

    const cells = (rowProps.children as React.ReactNode[]).filter(Boolean);
    expect(cells).toHaveLength(1); // virtualization trimmed non-sticky column

    expect(typeof rowProps.onClick).toBe('function');

    renderers.cleanup();
  });

  it('renders plain rows when virtualization disabled', () => {
    const measureRowRef = vi.fn();
    const handleRowClick = vi.fn();
    const renderers = renderHook(() =>
      useGridTableRowRenderer({
        keyExtractor: (_item, index) => `row-${index}`,
        getRowClassName: () => '',
        getRowStyle: undefined,
        handleRowClick,
        handleRowMouseEnter: vi.fn(),
        handleRowMouseLeave: vi.fn(),
        columnRenderModelsWithOffsets: baseColumns,
        columnVirtualizationConfig: {
          enabled: false,
          overscanColumns: 0,
          stickyStart: 0,
          stickyEnd: 0,
        },
        columnWindowRange: { startIndex: 0, endIndex: 1 },
        handleContextMenu: vi.fn(),
        getCachedCellContent: () => ({ content: 'cell', text: 'cell' }),
        measureRowRef,
      })
    );

    const renderRow = renderers.get();
    const rowElement = renderRow(
      { name: 'beta' },
      1,
      false,
      'row-beta',
      'slot-1'
    ) as React.ReactElement;
    const rowProps = rowElement.props as {
      className: string;
      children: React.ReactNode[];
      onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
      'data-grid-slot'?: string;
    };
    expect(rowProps['data-grid-slot']).toBe('slot-1');
    expect(rowProps.className).toContain('gridtable-row');
    expect(rowProps.children.length).toBe(2);
    const cells = rowProps.children as React.ReactElement<{ 'data-align'?: string }>[];
    expect(cells[0]?.props['data-align']).toBe('left');
    expect(cells[1]?.props['data-align']).toBe('center');
    const event = {
      stopPropagation: vi.fn(),
      target: document.createElement('div'),
    } as unknown as React.MouseEvent<HTMLDivElement>;
    rowProps.onClick(event);
    expect(handleRowClick).toHaveBeenCalledWith({ name: 'beta' }, 1, event);
    renderers.cleanup();
  });

  it('supports right-aligned data independently from header alignment', () => {
    const rightAlignedColumns: RowRendererOptions['columnRenderModelsWithOffsets'] = [
      {
        ...baseColumns[0],
        column: {
          ...baseColumns[0].column,
          alignHeader: 'center',
          alignData: 'right',
        },
      },
    ];
    const renderers = renderHook(() =>
      useGridTableRowRenderer({
        keyExtractor: (_item, index) => `row-${index}`,
        getRowClassName: () => '',
        getRowStyle: undefined,
        handleRowClick: vi.fn(),
        handleRowMouseEnter: vi.fn(),
        handleRowMouseLeave: vi.fn(),
        columnRenderModelsWithOffsets: rightAlignedColumns,
        columnVirtualizationConfig: {
          enabled: false,
          overscanColumns: 0,
          stickyStart: 0,
          stickyEnd: 0,
        },
        columnWindowRange: { startIndex: 0, endIndex: 0 },
        handleContextMenu: vi.fn(),
        getCachedCellContent: () => ({ content: 'cell', text: 'cell' }),
        measureRowRef: vi.fn(),
      })
    );

    const renderRow = renderers.get();
    const rowElement = renderRow({ name: 'gamma' }, 0, false, 'row-gamma') as React.ReactElement;
    const rowProps = rowElement.props as { children: React.ReactNode[] };
    const cells = rowProps.children.filter(Boolean) as React.ReactElement<{
      'data-align'?: string;
    }>[];

    expect(cells[0]?.props['data-align']).toBe('right');

    renderers.cleanup();
  });

  it('does not assign native title tooltips to grid cells', () => {
    const renderers = renderHook(() =>
      useGridTableRowRenderer({
        keyExtractor: (_item, index) => `row-${index}`,
        getRowClassName: () => '',
        getRowStyle: undefined,
        handleRowClick: vi.fn(),
        handleRowMouseEnter: vi.fn(),
        handleRowMouseLeave: vi.fn(),
        columnRenderModelsWithOffsets: baseColumns,
        columnVirtualizationConfig: {
          enabled: false,
          overscanColumns: 0,
          stickyStart: 0,
          stickyEnd: 0,
        },
        columnWindowRange: { startIndex: 0, endIndex: 1 },
        handleContextMenu: vi.fn(),
        getCachedCellContent: () => ({ content: 'cell', text: 'tooltip text' }),
        measureRowRef: vi.fn(),
      })
    );

    const renderRow = renderers.get();
    const rowElement = renderRow({ name: 'beta' }, 1, false, 'row-beta') as React.ReactElement;
    const rowProps = rowElement.props as { children: React.ReactNode[] };
    const cells = rowProps.children.filter(Boolean) as React.ReactElement<{ title?: string }>[];

    expect(cells[0]?.props.title).toBeUndefined();

    renderers.cleanup();
  });
});
