/**
 * frontend/src/shared/components/tables/hooks/useGridTableFocusNavigation.test.tsx
 *
 * Targeted regression tests for focused-row lookup and activation behavior.
 */

import { AriaGrid } from '@shared/components/tables/AriaGridPrimitives';
import { useGridTableFocusNavigation } from '@shared/components/tables/hooks/useGridTableFocusNavigation';
import React, { act, useImperativeHandle, useRef } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

type Row = { id: string };

interface HarnessHandle {
  setFocusedRowKey: React.Dispatch<React.SetStateAction<string | null>>;
  focusByIndex: (index: number) => void;
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
const Harness = ({
  tableData,
  updateHoverForElement,
  ref,
}: HarnessProps & { ref?: React.Ref<HarnessHandle> }) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<HTMLTableElement | null>(null);

  const result = useGridTableFocusNavigation<Row>({
    tableData,
    keyExtractor: (row) => row.id,
    wrapperRef,
    focusRef,
    updateHoverForElement,
    isShortcutOptOutTarget: () => false,
    shouldIgnoreRowClick: () => false,
  });

  useImperativeHandle(ref, () => ({
    setFocusedRowKey: result.setFocusedRowKey,
    focusByIndex: result.focusByIndex,
    focusedRowIndex: result.focusedRowIndex,
    focusedRowKey: result.focusedRowKey,
  }));

  return (
    <div ref={wrapperRef}>
      <AriaGrid ref={focusRef} tabIndex={0}>
        <tbody>
          {tableData.map((row, i) => (
            <tr key={row.id} className="gridtable-row" data-row-key={row.id}>
              <td>Row {i}</td>
            </tr>
          ))}
        </tbody>
      </AriaGrid>
    </div>
  );
};

describe('useGridTableFocusNavigation', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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

    // Focus row 'row-b' by key.
    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).setFocusedRowKey('row-b');
    });

    // The hook should find the DOM element even though the class and
    // data-row-key attribute live on the same element.
    expect(updateHover).toHaveBeenCalled();
    const calledWith = updateHover.mock.calls[updateHover.mock.calls.length - 1][0];
    expect(calledWith).toBeInstanceOf(HTMLTableRowElement);
    expect(calledWith.dataset.rowKey).toBe('row-b');
    expect(calledWith.classList.contains('gridtable-row')).toBe(true);
  });

  it('handles selector-sensitive row keys', async () => {
    const updateHover = vi.fn();
    const data: Row[] = [{ id: 'cluster|"prod]/pods/nginx:main' }];
    const ref = React.createRef<HarnessHandle>();

    await act(async () => {
      root.render(<Harness ref={ref} tableData={data} updateHoverForElement={updateHover} />);
    });

    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).setFocusedRowKey('cluster|"prod]/pods/nginx:main');
    });

    expect(updateHover).toHaveBeenCalled();
    const calledWith = updateHover.mock.calls[updateHover.mock.calls.length - 1][0];
    expect(calledWith).toBeInstanceOf(HTMLTableRowElement);
    expect(calledWith.dataset.rowKey).toBe('cluster|"prod]/pods/nginx:main');
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
  suppressFocusedRowHighlight: () => void;
  getRowClassNameWithFocus: (item: Row, index: number) => string;
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
  onRowPointerClick?: (item: Row) => void;
  isShortcutOptOutTarget?: (target: EventTarget | null) => boolean;
}

const ExtendedHarness = ({
  tableData,
  updateHoverForElement,
  onRowClick,
  onRowPointerClick,
  isShortcutOptOutTarget,
  ref,
}: ExtendedProps & { ref?: React.Ref<ExtendedHandle> }) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useRef<HTMLTableElement | null>(null);

  const result = useGridTableFocusNavigation<Row>({
    tableData,
    keyExtractor: (row) => row.id,
    wrapperRef,
    focusRef,
    updateHoverForElement,
    onRowClick,
    onRowPointerClick,
    isShortcutOptOutTarget: isShortcutOptOutTarget ?? (() => false),
    shouldIgnoreRowClick: () => false,
  });

  useImperativeHandle(ref, () => ({
    setFocusedRowKey: result.setFocusedRowKey,
    focusByIndex: result.focusByIndex,
    focusedRowIndex: result.focusedRowIndex,
    focusedRowKey: result.focusedRowKey,
    shortcutsActive: result.shortcutsActive,
    isShortcutsSuppressed: result.isShortcutsSuppressed,
    isWrapperFocused: result.isWrapperFocused,
    suppressFocusedRowHighlight: result.suppressFocusedRowHighlight,
    getRowClassNameWithFocus: result.getRowClassNameWithFocus,
    handleWrapperFocus: result.handleWrapperFocus,
    handleWrapperBlur: result.handleWrapperBlur,
    handleRowActivation: result.handleRowActivation,
    handleRowClick: result.handleRowClick,
    lastNavigationMethodRef: result.lastNavigationMethodRef,
  }));

  return (
    <div ref={wrapperRef}>
      <AriaGrid ref={focusRef} tabIndex={0}>
        <tbody>
          {tableData.map((row, i) => (
            <tr key={row.id} className="gridtable-row" data-row-key={row.id}>
              <td>Row {i}</td>
            </tr>
          ))}
        </tbody>
      </AriaGrid>
    </div>
  );
};

describe('useGridTableFocusNavigation – pointer vs keyboard activation', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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
    const onRowPointerClick = vi.fn();
    const data: Row[] = [{ id: 'a' }, { id: 'b' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness
          ref={ref}
          tableData={data}
          updateHoverForElement={vi.fn()}
          onRowClick={onRowClick}
          onRowPointerClick={onRowPointerClick}
        />
      );
    });

    // Pointer activation should NOT call onRowClick.
    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).handleRowActivation(data[0], 0, 'pointer');
    });
    expect(onRowClick).not.toHaveBeenCalled();
    expect(onRowPointerClick).toHaveBeenCalledWith(data[0]);
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBe(0);
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('a');
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .lastNavigationMethodRef.current
    ).toBe('pointer');

    // Keyboard activation SHOULD call onRowClick.
    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).handleRowActivation(data[1], 1, 'keyboard');
    });
    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick).toHaveBeenCalledWith(data[1]);
    expect(onRowPointerClick).toHaveBeenCalledTimes(1);
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBe(1);
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('b');
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .lastNavigationMethodRef.current
    ).toBe('keyboard');
  });

  it('keeps the focused row when the wrapper blurs outside of tab navigation', async () => {
    const data: Row[] = [{ id: 'a' }, { id: 'b' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(<ExtendedHarness ref={ref} tableData={data} updateHoverForElement={vi.fn()} />);
    });

    const focusEvent = {
      target: document.createElement('div'),
    } as unknown as React.FocusEvent<HTMLDivElement>;

    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).handleWrapperFocus(focusEvent);
    });

    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('a');

    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).handleWrapperBlur({} as React.FocusEvent<HTMLDivElement>);
    });

    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .isWrapperFocused
    ).toBe(false);
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('a');
  });

  it('suppresses the highlight on tab exit without forgetting the focused row, then restores it on re-entry', async () => {
    const data: Row[] = [{ id: 'a' }, { id: 'b' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(<ExtendedHarness ref={ref} tableData={data} updateHoverForElement={vi.fn()} />);
    });

    const focusEvent = {
      target: document.createElement('div'),
    } as unknown as React.FocusEvent<HTMLDivElement>;

    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).handleWrapperFocus(focusEvent);
    });

    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('a');
    expect(
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).getRowClassNameWithFocus(data[0], 0)
    ).toContain('gridtable-row--focused');

    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).suppressFocusedRowHighlight();
    });

    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('a');
    expect(
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).getRowClassNameWithFocus(data[0], 0)
    ).not.toContain('gridtable-row--focused');

    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).handleWrapperFocus(focusEvent);
    });

    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('a');
    expect(
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).getRowClassNameWithFocus(data[0], 0)
    ).toContain('gridtable-row--focused');
  });
});

describe('useGridTableFocusNavigation – shortcut suppression', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).handleWrapperFocus(fakeEvent);
    });

    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .isShortcutsSuppressed
    ).toBe(true);
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .shortcutsActive
    ).toBe(false);
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBeNull();
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBeNull();
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
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).handleWrapperFocus(fakeEvent);
    });

    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .isShortcutsSuppressed
    ).toBe(false);
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .shortcutsActive
    ).toBe(true);
    // First focus with no prior focused row should default to index 0.
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBe(0);
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('a');
  });
});

describe('useGridTableFocusNavigation – data-shrink clamping', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('clears focus when focused row disappears from shrunken data', async () => {
    const updateHover = vi.fn();
    const initialData: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={initialData} updateHoverForElement={updateHover} />
      );
    });

    // Focus the last row by key.
    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).setFocusedRowKey('e');
    });
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBe(4);

    // Shrink data to 2 rows — focused key 'e' is no longer present.
    const shrunkData: Row[] = [{ id: 'a' }, { id: 'b' }];
    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={shrunkData} updateHoverForElement={updateHover} />
      );
    });

    // With key-based tracking, key stays in state but derived index resolves to null
    // since the focused key is no longer in the data.
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('e');
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBeNull();
  });

  it('resolves focused row index to null when data becomes empty', async () => {
    const updateHover = vi.fn();
    const initialData: Row[] = [{ id: 'a' }, { id: 'b' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={initialData} updateHoverForElement={updateHover} />
      );
    });

    // Set focus by key.
    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).setFocusedRowKey('b');
    });
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('b');
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBe(1);

    // Empty the data.
    await act(async () => {
      root.render(<ExtendedHarness ref={ref} tableData={[]} updateHoverForElement={updateHover} />);
    });

    // Key is still set in state, but index resolves to null since data is empty.
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('b');
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBeNull();
  });
});

describe('useGridTableFocusNavigation – key-based focus stability', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('focus follows the same logical row when data is reordered', async () => {
    const updateHover = vi.fn();
    const original: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={original} updateHoverForElement={updateHover} />
      );
    });

    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).setFocusedRowKey('b');
    });
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('b');
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBe(1);

    const reordered: Row[] = [{ id: 'a' }, { id: 'c' }, { id: 'b' }];
    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={reordered} updateHoverForElement={updateHover} />
      );
    });

    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('b');
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBe(2);
  });

  it('clears derived index when the focused row is removed from data', async () => {
    const updateHover = vi.fn();
    const original: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={original} updateHoverForElement={updateHover} />
      );
    });

    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).setFocusedRowKey('b');
    });
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBe(1);

    const without: Row[] = [{ id: 'a' }, { id: 'c' }];
    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={without} updateHoverForElement={updateHover} />
      );
    });

    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBeNull();
  });

  it('focus follows key when new rows are inserted before the focused row', async () => {
    const updateHover = vi.fn();
    const original: Row[] = [{ id: 'a' }, { id: 'b' }];
    const ref = React.createRef<ExtendedHandle>();

    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={original} updateHoverForElement={updateHover} />
      );
    });

    await act(async () => {
      requireValue(
        ref.current,
        'expected test value in useGridTableFocusNavigation.test.tsx'
      ).setFocusedRowKey('b');
    });
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBe(1);

    const expanded: Row[] = [{ id: 'x' }, { id: 'y' }, { id: 'a' }, { id: 'b' }];
    await act(async () => {
      root.render(
        <ExtendedHarness ref={ref} tableData={expanded} updateHoverForElement={updateHover} />
      );
    });

    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowKey
    ).toBe('b');
    expect(
      requireValue(ref.current, 'expected test value in useGridTableFocusNavigation.test.tsx')
        .focusedRowIndex
    ).toBe(3);
  });
});
