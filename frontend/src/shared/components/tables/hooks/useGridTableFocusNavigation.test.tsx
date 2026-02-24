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
      root.render(<Harness ref={ref} tableData={data} updateHoverForElement={updateHover} />);
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
      root.render(<Harness ref={ref} tableData={data} updateHoverForElement={updateHover} />);
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

/**
 * Extended harness for testing pointer vs keyboard activation, shortcut
 * suppression, and data-shrink clamping.
 */
interface ExtendedHandle extends HarnessHandle {
  shortcutsActive: boolean;
  isShortcutsSuppressed: boolean;
  isWrapperFocused: boolean;
  handleWrapperFocus: (event: React.FocusEvent<HTMLDivElement>) => void;
  handleWrapperBlur: (event: React.FocusEvent<HTMLDivElement>) => void;
  handleRowActivation: (item: Row, index: number, source: 'pointer' | 'keyboard') => void;
  handleRowClick: (item: Row, index: number, event: React.MouseEvent) => void;
  lastNavigationMethodRef: React.RefObject<'pointer' | 'keyboard'>;
}

interface ExtendedProps {
  tableData: Row[];
  updateHoverForElement: (el: HTMLDivElement | null) => void;
  onRowClick?: (item: Row) => void;
  isShortcutOptOutTarget?: (target: EventTarget | null) => boolean;
}

const ExtendedHarness = forwardRef<ExtendedHandle, ExtendedProps>(
  ({ tableData, updateHoverForElement, onRowClick, isShortcutOptOutTarget }, ref) => {
    const wrapperRef = useRef<HTMLDivElement | null>(null);

    const result = useGridTableFocusNavigation<Row>({
      tableData,
      keyExtractor: (row) => row.id,
      wrapperRef,
      updateHoverForElement,
      onRowClick,
      isShortcutOptOutTarget: isShortcutOptOutTarget ?? (() => false),
      shouldIgnoreRowClick: () => false,
    });

    useImperativeHandle(ref, () => ({
      setFocusedRowIndex: result.setFocusedRowIndex,
      focusedRowIndex: result.focusedRowIndex,
      focusedRowKey: result.focusedRowKey,
      shortcutsActive: result.shortcutsActive,
      isShortcutsSuppressed: result.isShortcutsSuppressed,
      isWrapperFocused: result.isWrapperFocused,
      handleWrapperFocus: result.handleWrapperFocus,
      handleWrapperBlur: result.handleWrapperBlur,
      handleRowActivation: result.handleRowActivation,
      handleRowClick: result.handleRowClick,
      lastNavigationMethodRef: result.lastNavigationMethodRef,
    }));

    return (
      <div ref={wrapperRef} tabIndex={0}>
        {tableData.map((row, i) => (
          <div key={row.id} className="gridtable-row" data-row-key={row.id}>
            Row {i}
          </div>
        ))}
      </div>
    );
  }
);

describe('useGridTableFocusNavigation – pointer vs keyboard activation', () => {
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
    act(() => root.unmount());
    container.remove();
  });

  it('keyboard activation triggers onRowClick, pointer activation does not', async () => {
    const onRowClick = vi.fn();
    const data: Row[] = [{ id: 'a' }, { id: 'b' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness
          ref={ref}
          tableData={data}
          updateHoverForElement={vi.fn()}
          onRowClick={onRowClick}
        />
      );
    });

    // Pointer activation should NOT call onRowClick.
    await act(async () => {
      ref.current!.handleRowActivation(data[0], 0, 'pointer');
    });
    expect(onRowClick).not.toHaveBeenCalled();
    expect(ref.current!.focusedRowIndex).toBe(0);
    expect(ref.current!.lastNavigationMethodRef.current).toBe('pointer');

    // Keyboard activation SHOULD call onRowClick.
    await act(async () => {
      ref.current!.handleRowActivation(data[1], 1, 'keyboard');
    });
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(data[1]);
    expect(ref.current!.focusedRowIndex).toBe(1);
    expect(ref.current!.lastNavigationMethodRef.current).toBe('keyboard');
  });
});

describe('useGridTableFocusNavigation – shortcut suppression', () => {
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
    act(() => root.unmount());
    container.remove();
  });

  it('suppresses shortcuts and clears focus when focus target is a shortcut opt-out', async () => {
    const isShortcutOptOutTarget = vi.fn((target: EventTarget | null) => {
      return target instanceof HTMLElement && target.tagName === 'INPUT';
    });
    const data: Row[] = [{ id: 'a' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness
          ref={ref}
          tableData={data}
          updateHoverForElement={vi.fn()}
          isShortcutOptOutTarget={isShortcutOptOutTarget}
        />
      );
    });

    // Simulate focusing on an input element (opt-out target).
    const inputEl = document.createElement('input');
    const fakeEvent = {
      target: inputEl,
    } as unknown as React.FocusEvent<HTMLDivElement>;

    await act(async () => {
      ref.current!.handleWrapperFocus(fakeEvent);
    });

    expect(ref.current!.isShortcutsSuppressed).toBe(true);
    expect(ref.current!.shortcutsActive).toBe(false);
    expect(ref.current!.focusedRowIndex).toBeNull();
  });

  it('does not suppress shortcuts when focus target is not an opt-out', async () => {
    const data: Row[] = [{ id: 'a' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(<ExtendedHarness ref={ref} tableData={data} updateHoverForElement={vi.fn()} />);
    });

    const divEl = document.createElement('div');
    const fakeEvent = {
      target: divEl,
    } as unknown as React.FocusEvent<HTMLDivElement>;

    await act(async () => {
      ref.current!.handleWrapperFocus(fakeEvent);
    });

    expect(ref.current!.isShortcutsSuppressed).toBe(false);
    expect(ref.current!.shortcutsActive).toBe(true);
    // First focus with no prior focused row should default to index 0.
    expect(ref.current!.focusedRowIndex).toBe(0);
  });
});

describe('useGridTableFocusNavigation – data-shrink clamping', () => {
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
    act(() => root.unmount());
    container.remove();
  });

  it('clamps focused row index when data shrinks below the current index', async () => {
    const updateHover = vi.fn();
    const initialData: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={initialData} updateHoverForElement={updateHover} />
      );
    });

    // Focus the last row (index 4).
    await act(async () => {
      ref.current!.setFocusedRowIndex(4);
    });
    expect(ref.current!.focusedRowIndex).toBe(4);

    // Shrink data to 2 rows — focused index 4 is out of range.
    const shrunkData: Row[] = [{ id: 'a' }, { id: 'b' }];
    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={shrunkData} updateHoverForElement={updateHover} />
      );
    });

    // Should be clamped to last valid index (1).
    expect(ref.current!.focusedRowIndex).toBe(1);
  });

  it('nulls focused row index when data becomes empty', async () => {
    const updateHover = vi.fn();
    const initialData: Row[] = [{ id: 'a' }, { id: 'b' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={initialData} updateHoverForElement={updateHover} />
      );
    });

    await act(async () => {
      ref.current!.setFocusedRowIndex(1);
    });
    expect(ref.current!.focusedRowIndex).toBe(1);

    // Empty the data.
    await act(async () => {
      root.render(<ExtendedHarness ref={ref} tableData={[]} updateHoverForElement={updateHover} />);
    });

    expect(ref.current!.focusedRowIndex).toBeNull();
  });
});
