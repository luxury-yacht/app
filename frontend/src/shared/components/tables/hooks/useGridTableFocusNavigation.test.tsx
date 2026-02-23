/**
 * frontend/src/shared/components/tables/hooks/useGridTableFocusNavigation.test.tsx
 *
 * Targeted regression test: when the focused row index changes, the hook must
 * find the row element via a compound selector (.gridtable-row[data-row-key="..."])
 * and pass it to updateHoverForElement. A descendant selector would return null
 * because both class and data attribute live on the same element.
 */

import React, { useRef, useImperativeHandle, forwardRef } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridTableFocusNavigation } from '@shared/components/tables/hooks/useGridTableFocusNavigation';

type Row = { id: string };

interface HarnessHandle {
  setFocusedRowIndex: React.Dispatch<React.SetStateAction<number | null>>;
  focusedRowIndex: number | null;
  focusedRowKey: string | null;
}

interface HarnessProps {
  tableData: Row[];
  updateHoverForElement: (el: HTMLDivElement | null) => void;
}

/**
 * Renders the hook inside a wrapper div that contains row elements matching the
 * real GridTable DOM structure: a single div with both .gridtable-row class and
 * data-row-key attribute on the same element.
 */
const Harness = forwardRef<HarnessHandle, HarnessProps>(
  ({ tableData, updateHoverForElement }, ref) => {
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    const result = useGridTableFocusNavigation<Row>({
      tableData,
      keyExtractor: (row) => row.id,
      wrapperRef,
      updateHoverForElement,
      isShortcutOptOutTarget: () => false,
      shouldIgnoreRowClick: () => false,
    });

    useImperativeHandle(ref, () => ({
      setFocusedRowIndex: result.setFocusedRowIndex,
      focusedRowIndex: result.focusedRowIndex,
      focusedRowKey: result.focusedRowKey,
    }));

    return (
      <div ref={wrapperRef} tabIndex={0}>
        {tableData.map((row, i) => (
          // Mirrors useGridTableRowRenderer: both .gridtable-row and
          // data-row-key are on the same element.
          <div key={row.id} className="gridtable-row" data-row-key={row.id}>
            Row {i}
          </div>
        ))}
      </div>
    );
  }
);

describe('useGridTableFocusNavigation', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

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

  it('calls updateHoverForElement with the focused row element when index changes', async () => {
    const updateHover = vi.fn();
    const data: Row[] = [{ id: 'row-a' }, { id: 'row-b' }, { id: 'row-c' }];
    const ref = React.createRef<HarnessHandle>();

    await act(async () => {
      root.render(
        <Harness ref={ref} tableData={data} updateHoverForElement={updateHover} />
      );
    });

    // Focus row index 1 (row-b).
    await act(async () => {
      ref.current!.setFocusedRowIndex(1);
    });

    // The hook should have found the DOM element via compound selector and
    // passed it to updateHoverForElement. If the selector were a descendant
    // selector, the query would return null and this call would never happen.
    expect(updateHover).toHaveBeenCalled();
    const calledWith = updateHover.mock.calls[updateHover.mock.calls.length - 1][0];
    expect(calledWith).toBeInstanceOf(HTMLDivElement);
    expect(calledWith.dataset.rowKey).toBe('row-b');
    expect(calledWith.classList.contains('gridtable-row')).toBe(true);
  });

  it('handles row keys that need CSS.escape', async () => {
    const updateHover = vi.fn();
    // Key with special characters that CSS.escape would handle.
    const data: Row[] = [{ id: 'ns/pod:container' }];
    const ref = React.createRef<HarnessHandle>();

    await act(async () => {
      root.render(
        <Harness ref={ref} tableData={data} updateHoverForElement={updateHover} />
      );
    });

    await act(async () => {
      ref.current!.setFocusedRowIndex(0);
    });

    expect(updateHover).toHaveBeenCalled();
    const calledWith = updateHover.mock.calls[updateHover.mock.calls.length - 1][0];
    expect(calledWith).toBeInstanceOf(HTMLDivElement);
    expect(calledWith.dataset.rowKey).toBe('ns/pod:container');
  });
});
