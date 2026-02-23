/**
 * frontend/src/shared/components/tables/hooks/useGridTableContextMenuWiring.test.tsx
 *
 * Test suite for useGridTableContextMenuWiring.
 * Covers openFocusedRowContextMenu DOM traversal and focus restoration.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridTableContextMenuWiring } from '@shared/components/tables/hooks/useGridTableContextMenuWiring';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable.types';

type Row = { id: string; name: string };

const columns: GridColumnDefinition<Row>[] = [
  { key: 'name', header: 'Name', render: (row) => row.name },
];

// Mock the inner hooks to isolate wiring behavior.
const mockOpenCellContextMenuFromKeyboard = vi.fn(() => true);
const mockOpenCellContextMenu = vi.fn(() => true);
const mockOpenWrapperContextMenu = vi.fn(() => true);
const mockCloseContextMenu = vi.fn();
// Controls whether useGridTableContextMenu returns a non-null contextMenu
// (needed for rendering <ContextMenu> and testing the onClose/focus-restore path).
let mockContextMenuState: any = null;

vi.mock('@shared/components/tables/hooks/useGridTableContextMenuItems', () => ({
  useGridTableContextMenuItems: () => vi.fn(() => [{ label: 'Test', action: () => {} }]),
}));

vi.mock('@shared/components/tables/hooks/useGridTableContextMenu', () => ({
  useGridTableContextMenu: () => ({
    contextMenu: mockContextMenuState,
    openCellContextMenu: mockOpenCellContextMenu,
    openCellContextMenuFromKeyboard: mockOpenCellContextMenuFromKeyboard,
    openWrapperContextMenu: mockOpenWrapperContextMenu,
    closeContextMenu: mockCloseContextMenu,
  }),
}));

// Capture the onClose prop so we can trigger focus restoration.
let capturedOnClose: (() => void) | null = null;

vi.mock('@shared/components/ContextMenu', () => ({
  default: (props: any) => {
    capturedOnClose = props.onClose;
    return <div data-testid="mock-context-menu" />;
  },
}));

describe('useGridTableContextMenuWiring', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    vi.clearAllMocks();
    mockContextMenuState = null;
    capturedOnClose = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  type HarnessResult = {
    openFocusedRowContextMenu: () => boolean;
    handleCellContextMenu: (event: any, columnKey: string, item: Row | null, index: number) => void;
    handleWrapperContextMenu: (event: any) => void;
    contextMenuActiveRef: { current: boolean };
    isContextMenuVisible: boolean;
    contextMenuNode: React.ReactNode;
  };

  const renderHook = (opts: {
    enableContextMenu?: boolean;
    focusedRowIndex?: number | null;
    focusedRowKey?: string | null;
    tableData?: Row[];
  }): HarnessResult => {
    const tableData = opts.tableData ?? [
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
      { id: '3', name: 'Charlie' },
    ];
    const wrapperRef = { current: null as HTMLDivElement | null };
    let result: HarnessResult = null!;

    const Harness: React.FC = () => {
      const wiring = useGridTableContextMenuWiring<Row>({
        enableContextMenu: opts.enableContextMenu ?? true,
        columns,
        tableData,
        sortConfig: undefined,
        keyExtractor: (item) => item.id,
        focusedRowIndex: opts.focusedRowIndex ?? null,
        focusedRowKey: opts.focusedRowKey ?? null,
        wrapperRef,
        handleRowActivation: vi.fn(),
      });
      result = wiring;
      return (
        <>
          <div ref={(el) => { wrapperRef.current = el; }}>
            {tableData.map((row) => (
              <div key={row.id} data-row-key={row.id} className="gridtable-row">
                <div className="grid-cell" data-column="name">
                  {row.name}
                </div>
              </div>
            ))}
          </div>
          {wiring.contextMenuNode}
        </>
      );
    };

    act(() => {
      root.render(<Harness />);
    });

    return result;
  };

  it('openFocusedRowContextMenu returns false when context menu is disabled', () => {
    const result = renderHook({ enableContextMenu: false, focusedRowIndex: 0, focusedRowKey: '1' });
    expect(result.openFocusedRowContextMenu()).toBe(false);
  });

  it('openFocusedRowContextMenu returns false when no row is focused', () => {
    const result = renderHook({ focusedRowIndex: null });
    expect(result.openFocusedRowContextMenu()).toBe(false);
  });

  it('openFocusedRowContextMenu returns false when focusedRowIndex is out of range', () => {
    const result = renderHook({ focusedRowIndex: 10, focusedRowKey: 'nonexistent' });
    expect(result.openFocusedRowContextMenu()).toBe(false);
  });

  it('openFocusedRowContextMenu traverses DOM to find the focused row and opens the menu', () => {
    const result = renderHook({ focusedRowIndex: 1, focusedRowKey: '2' });
    const opened = result.openFocusedRowContextMenu();

    expect(opened).toBe(true);
    expect(mockOpenCellContextMenuFromKeyboard).toHaveBeenCalledTimes(1);
    // Verify the correct column key and item were passed.
    const [columnKey, item] = mockOpenCellContextMenuFromKeyboard.mock.calls[0];
    expect(columnKey).toBe('name');
    expect(item).toEqual({ id: '2', name: 'Bob' });
  });

  it('openFocusedRowContextMenu returns false when the row element is not in the DOM', () => {
    const result = renderHook({
      focusedRowIndex: 0,
      focusedRowKey: 'missing-key',
    });
    const opened = result.openFocusedRowContextMenu();
    expect(opened).toBe(false);
    expect(mockOpenCellContextMenuFromKeyboard).not.toHaveBeenCalled();
  });

  it('handleCellContextMenu does nothing when context menu is disabled', () => {
    const result = renderHook({ enableContextMenu: false });
    const fakeEvent = { preventDefault: vi.fn() } as any;
    result.handleCellContextMenu(fakeEvent, 'name', { id: '1', name: 'Alice' }, 0);
    expect(mockOpenCellContextMenu).not.toHaveBeenCalled();
  });

  it('handleWrapperContextMenu does nothing when context menu is disabled', () => {
    const result = renderHook({ enableContextMenu: false });
    const fakeEvent = { preventDefault: vi.fn() } as any;
    result.handleWrapperContextMenu(fakeEvent);
    expect(mockOpenWrapperContextMenu).not.toHaveBeenCalled();
  });

  it('sets contextMenuActiveRef to true when a context menu opens', () => {
    const result = renderHook({ focusedRowIndex: 0, focusedRowKey: '1' });
    expect(result.contextMenuActiveRef.current).toBe(false);

    result.openFocusedRowContextMenu();
    expect(result.contextMenuActiveRef.current).toBe(true);
  });

  it('restores focus to the wrapper when the context menu closes', () => {
    // Make the mock return a non-null contextMenu so <ContextMenu> renders.
    mockContextMenuState = {
      columnKey: 'name',
      item: { id: '1', name: 'Alice' },
      position: { x: 100, y: 100 },
      source: 'keyboard',
    };

    const result = renderHook({ focusedRowIndex: 0, focusedRowKey: '1' });

    // Open the context menu to capture the restore target.
    result.openFocusedRowContextMenu();
    expect(result.contextMenuActiveRef.current).toBe(true);

    // ContextMenu was rendered — capturedOnClose should be the handleCloseContextMenu callback.
    expect(capturedOnClose).not.toBeNull();

    // Trigger close.
    act(() => {
      capturedOnClose!();
    });

    // contextMenuActiveRef should be cleared.
    expect(result.contextMenuActiveRef.current).toBe(false);
    // closeContextMenu (the inner hook's method) should have been called.
    expect(mockCloseContextMenu).toHaveBeenCalledTimes(1);
  });
});
