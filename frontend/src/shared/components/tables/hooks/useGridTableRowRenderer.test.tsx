import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { useGridTableRowRenderer } from '@shared/components/tables/hooks/useGridTableRowRenderer';

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
    get: () => result.current!,
    cleanup: () => {
      act(() => {
        root.unmount();
      });
      document.body.removeChild(container);
    },
  };
};

describe('useGridTableRowRenderer', () => {
  const baseColumns = [
    {
      column: { key: 'name' } as any,
      key: 'name',
      className: 'name-col',
      cellStyle: { width: 100 },
      start: 0,
      end: 0,
      width: 100,
    },
    {
      column: { key: 'age' } as any,
      key: 'age',
      className: 'age-col',
      cellStyle: { width: 50 },
      start: 100,
      end: 150,
      width: 50,
    },
  ];

  it('renders rows with virtualization applied', () => {
    const firstVirtualRowRef = { current: null as HTMLDivElement | null };
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
        getCachedCellContent: (column: any, item: any) => ({
          content: `${column.key}-${item.name}`,
          text: item.name,
        }),
        firstVirtualRowRef,
      })
    );

    const renderRow = renderers.get();
    const rowElement = renderRow({ name: 'alpha' }, 0, true, 'row-alpha') as React.ReactElement;
    const rowProps = rowElement.props as {
      className: string;
      onClick: (event: React.MouseEvent<HTMLDivElement>) => void;
      [key: string]: any;
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
    const firstVirtualRowRef = { current: null as HTMLDivElement | null };
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
        firstVirtualRowRef,
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
    const rowProps = rowElement.props as Record<string, any>;
    expect(rowProps['data-grid-slot']).toBe('slot-1');
    expect(rowProps.className).toContain('gridtable-row');
    expect(rowProps.children.length).toBe(2);
    const event = {
      stopPropagation: vi.fn(),
      target: document.createElement('div'),
    } as unknown as React.MouseEvent<HTMLDivElement>;
    rowProps.onClick(event);
    expect(handleRowClick).toHaveBeenCalledWith({ name: 'beta' }, 1, event);
    renderers.cleanup();
  });
});
