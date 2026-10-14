import { useGridTableKeyboardNavigation } from '@shared/components/tables/hooks/useGridTableKeyboardNavigation';
import { withStableListKeys } from '@shared/utils/stableListKeys';
import type { FC, RefObject } from 'react';
import { act, useLayoutEffect, useRef } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

interface HarnessCapture {
  moveSelectionByDelta: (delta: number) => boolean;
  jumpToIndex: (index: number) => boolean;
  getPageSizeRef: RefObject<number>;
}

const requireCapture = (capture: HarnessCapture | null): HarnessCapture => {
  if (!capture) {
    throw new Error('Keyboard navigation harness did not capture hook output');
  }
  return capture;
};

interface HarnessProps {
  tableDataLength: number;
  focusedRowIndex: number | null;
  focusedRowKey: string | null;
  rowKeys?: string[];
  shortcutsActive?: boolean;
  shouldVirtualize?: boolean;
  virtualRowHeight?: number;
  wrapperHeight?: number;
  rowHeight?: number;
  focusByIndex?: (index: number) => void;
  updateHoverForElement?: (element: HTMLDivElement | null) => void;
  getRowTop?: (index: number) => number;
  onCapture: (capture: HarnessCapture) => void;
}

const KeyboardNavigationHarness: FC<HarnessProps> = ({
  tableDataLength,
  focusedRowIndex,
  focusedRowKey,
  rowKeys,
  shortcutsActive = false,
  shouldVirtualize = false,
  virtualRowHeight = 0,
  wrapperHeight = 100,
  rowHeight = 20,
  focusByIndex = vi.fn(),
  updateHoverForElement = vi.fn(),
  getRowTop = (index) => index * rowHeight,
  onCapture,
}) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const lastNavigationMethodRef = useRef<'pointer' | 'keyboard'>('pointer');

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) {
      return;
    }
    // The wrapper scrolls its rows; each row's position follows its scrollTop.
    Object.defineProperty(wrapper, 'clientHeight', {
      configurable: true,
      value: wrapperHeight,
    });
    Object.defineProperty(wrapper, 'scrollHeight', {
      configurable: true,
      value: tableDataLength * rowHeight,
    });
    Object.defineProperty(wrapper, 'scrollTop', { configurable: true, value: 0, writable: true });
    wrapper.querySelectorAll<HTMLElement>('.gridtable-row').forEach((row, index) => {
      row.getBoundingClientRect = () =>
        DOMRect.fromRect({
          y: index * rowHeight - wrapper.scrollTop,
          width: 400,
          height: rowHeight,
        });
    });
  }, [rowHeight, tableDataLength, wrapperHeight]);

  const capture = useGridTableKeyboardNavigation({
    tableDataLength,
    focusedRowIndex,
    focusedRowKey,
    shortcutsActive,
    focusByIndex,
    lastNavigationMethodRef,
    wrapperRef,
    updateHoverForElement,
    shouldVirtualize,
    virtualRowHeight,
    viewportHeight: wrapperHeight,
    getRowTop,
  });

  onCapture(capture);

  const rows = withStableListKeys(
    Array.from({ length: tableDataLength }, (_, index) => rowKeys?.[index] ?? `row-${index}`),
    (rowKey) => rowKey
  );

  return (
    <div ref={wrapperRef}>
      {rows.map(({ key, value: rowKey }, index) => (
        <div
          key={key}
          className="gridtable-row"
          data-row-key={rowKey}
          data-testid={`row-${index}`}
        />
      ))}
    </div>
  );
};

describe('useGridTableKeyboardNavigation', () => {
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

  it('moves selection by delta and clamps direct jumps', async () => {
    const focusByIndex = vi.fn();
    let capture: HarnessCapture | null = null;

    await act(async () => {
      root.render(
        <KeyboardNavigationHarness
          tableDataLength={4}
          focusedRowIndex={1}
          focusedRowKey="row-1"
          focusByIndex={focusByIndex}
          onCapture={(next) => {
            capture = next;
          }}
        />
      );
    });

    await act(async () => {
      expect(requireCapture(capture).moveSelectionByDelta(2)).toBe(true);
      expect(requireCapture(capture).jumpToIndex(99)).toBe(true);
    });

    expect(focusByIndex).toHaveBeenNthCalledWith(1, 3);
    expect(focusByIndex).toHaveBeenNthCalledWith(2, 3);
  });

  it('updates page size from visible rows', async () => {
    let capture: HarnessCapture | null = null;

    await act(async () => {
      root.render(
        <KeyboardNavigationHarness
          tableDataLength={5}
          focusedRowIndex={null}
          focusedRowKey={null}
          wrapperHeight={120}
          rowHeight={30}
          onCapture={(next) => {
            capture = next;
          }}
        />
      );
    });

    expect(requireCapture(capture).getPageSizeRef.current).toBe(4);
  });

  // The app zooms the page: a row's bounding rect is in zoomed pixels while the
  // viewport height is in CSS pixels.
  it('sizes a page by CSS row heights at a page zoom', async () => {
    document.documentElement.style.setProperty('--app-zoom-factor', '2');
    let capture: HarnessCapture | null = null;
    try {
      await act(async () => {
        root.render(
          <KeyboardNavigationHarness
            tableDataLength={5}
            focusedRowIndex={null}
            focusedRowKey={null}
            wrapperHeight={120}
            rowHeight={30 * 2}
            onCapture={(next) => {
              capture = next;
            }}
          />
        );
      });

      expect(requireCapture(capture).getPageSizeRef.current).toBe(4);
    } finally {
      document.documentElement.style.removeProperty('--app-zoom-factor');
    }
  });

  it('scrolls a focused row below the viewport into view and updates hover for it', async () => {
    const updateHoverForElement = vi.fn();
    let capture: HarnessCapture | null = null;
    const renderHarness = () =>
      root.render(
        <KeyboardNavigationHarness
          tableDataLength={10}
          focusedRowIndex={7}
          focusedRowKey="row-7"
          shortcutsActive
          updateHoverForElement={updateHoverForElement}
          onCapture={(next) => {
            capture = next;
          }}
        />
      );

    await act(async () => {
      renderHarness();
    });
    const wrapper = requireValue(container.firstElementChild, 'wrapper');
    // A pointer focus leaves the scroll position alone.
    expect(wrapper.scrollTop).toBe(0);

    await act(async () => {
      requireCapture(capture).jumpToIndex(7);
    });
    await act(async () => {
      renderHarness();
    });

    // Row 7 spans 140-160 in a 100px viewport: scroll just far enough to show it.
    expect(wrapper.scrollTop).toBe(60);
    expect(updateHoverForElement).toHaveBeenCalledWith(
      container.querySelector('[data-testid="row-7"]')
    );
  });

  it('matches rendered rows with selector-sensitive keys without CSS escaping', async () => {
    const updateHoverForElement = vi.fn();
    const rowKey = 'cluster|"prod]/pods/nginx:main';
    let capture: HarnessCapture | null = null;

    await act(async () => {
      root.render(
        <KeyboardNavigationHarness
          tableDataLength={1}
          focusedRowIndex={0}
          focusedRowKey={rowKey}
          rowKeys={[rowKey]}
          shortcutsActive
          updateHoverForElement={updateHoverForElement}
          onCapture={(next) => {
            capture = next;
          }}
        />
      );
    });

    await act(async () => {
      requireCapture(capture).jumpToIndex(0);
    });
    const row = container.querySelector<HTMLDivElement>('[data-testid="row-0"]');

    await act(async () => {
      root.render(
        <KeyboardNavigationHarness
          tableDataLength={1}
          focusedRowIndex={0}
          focusedRowKey={rowKey}
          rowKeys={[rowKey]}
          shortcutsActive
          updateHoverForElement={updateHoverForElement}
          onCapture={(next) => {
            capture = next;
          }}
        />
      );
    });

    expect(updateHoverForElement).toHaveBeenCalledWith(row);
  });

  it('uses virtual row positions when the focused row is not rendered', async () => {
    const scrollTo = vi.fn();
    let capture: HarnessCapture | null = null;

    await act(async () => {
      root.render(
        <KeyboardNavigationHarness
          tableDataLength={100}
          focusedRowIndex={50}
          focusedRowKey="virtual-row-50"
          shortcutsActive
          shouldVirtualize
          virtualRowHeight={20}
          wrapperHeight={100}
          getRowTop={(index) => index * 20}
          onCapture={(next) => {
            capture = next;
          }}
        />
      );
    });

    const wrapper = container.firstElementChild as HTMLDivElement;
    wrapper.scrollTo = scrollTo;
    Object.defineProperty(wrapper, 'scrollTop', {
      configurable: true,
      value: 0,
    });

    await act(async () => {
      requireCapture(capture).jumpToIndex(50);
      root.render(
        <KeyboardNavigationHarness
          tableDataLength={100}
          focusedRowIndex={50}
          focusedRowKey="virtual-row-50"
          shortcutsActive
          shouldVirtualize
          virtualRowHeight={20}
          wrapperHeight={100}
          getRowTop={(index) => index * 20}
          onCapture={(next) => {
            capture = next;
          }}
        />
      );
    });

    expect(scrollTo).toHaveBeenCalledWith({ top: 920, behavior: 'auto' });
  });
});
