/**
 * frontend/src/shared/components/tables/hooks/useGridTableExternalFocus.test.tsx
 *
 * A focus request ("show in list") highlights the matching row and scrolls the
 * table to show it.
 */

import { useGridTableExternalFocus } from '@shared/components/tables/hooks/useGridTableExternalFocus';
import { act, useLayoutEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { requireValue } from '@/test-utils/requireValue';

interface Row {
  key: string;
  name: string;
}

const rows: Row[] = Array.from({ length: 10 }, (_, index) => ({
  key: `cluster-a|apps/v1/Deployment/default/web-${index}`,
  name: `web-${index}`,
}));
const keyOf = (row: Row) => row.key;

let focusedKey: string | null = null;

interface HarnessProps {
  rowHeight: number;
  /** Rows rendered before the table scrolls; the rest render once it does (virtualization). */
  initiallyRendered?: number;
  /** The virtual body's height, from which a virtualized table estimates row positions. */
  estimatedHeight?: number;
}

const Harness = ({ rowHeight, initiallyRendered = rows.length, estimatedHeight }: HarnessProps) => {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const virtualBodyRef = useRef<HTMLDivElement | null>(null);
  const scrollableRef = useRef(false);
  const [focusedRowKey, setFocusedRowKey] = useState<string | null>(null);
  const [rendered, setRendered] = useState(() => rows.slice(0, initiallyRendered));
  focusedKey = focusedRowKey;

  // The wrapper shows 100px of the rows; each row's position follows its scrollTop.
  useLayoutEffect(() => {
    const wrapper = requireValue(wrapperRef.current, 'wrapper');
    if (!scrollableRef.current) {
      scrollableRef.current = true;
      Object.defineProperty(wrapper, 'clientHeight', { configurable: true, value: 100 });
      Object.defineProperty(wrapper, 'scrollHeight', {
        configurable: true,
        value: rows.length * rowHeight,
      });
      Object.defineProperty(wrapper, 'scrollTop', { configurable: true, value: 0, writable: true });
      // Scrolling a virtualized table renders the rows around the new position.
      wrapper.scrollTo = ((options: ScrollToOptions) => {
        wrapper.scrollTop = options.top ?? wrapper.scrollTop;
        setRendered(rows);
      }) as typeof wrapper.scrollTo;
    }
    if (estimatedHeight !== undefined && virtualBodyRef.current) {
      Object.defineProperty(virtualBodyRef.current, 'offsetHeight', {
        configurable: true,
        value: estimatedHeight,
      });
    }
    wrapper.querySelectorAll<HTMLElement>('.gridtable-row').forEach((row) => {
      const index = rows.findIndex((candidate) => candidate.key === row.dataset.rowKey);
      row.getBoundingClientRect = () =>
        DOMRect.fromRect({
          y: index * rowHeight - wrapper.scrollTop,
          width: 400,
          height: rowHeight,
        });
    });
  });

  useGridTableExternalFocus({ tableData: rows, keyExtractor: keyOf, setFocusedRowKey, wrapperRef });

  return (
    <div ref={wrapperRef} className="gridtable-wrapper">
      <div
        ref={virtualBodyRef}
        className={estimatedHeight === undefined ? undefined : 'gridtable-virtual-body'}
      >
        {rendered.map((row) => (
          <div key={row.key} className="gridtable-row" data-row-key={row.key} />
        ))}
      </div>
    </div>
  );
};

const request = (index: number) => ({
  clusterId: 'cluster-a',
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'default',
  name: rows[index].name,
  rowKey: rows[index].key,
});

describe('useGridTableExternalFocus', () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: FrameRequestCallback[];
  const flushFrame = () =>
    act(async () => {
      const due = frames;
      frames = [];
      for (const callback of due) {
        callback(0);
      }
    });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.push(callback);
      return frames.length;
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    focusedKey = null;
  });

  const wrapper = () =>
    requireValue(container.querySelector<HTMLElement>('.gridtable-wrapper'), 'wrapper');

  it('highlights the requested row and scrolls just far enough to show it', async () => {
    await act(async () => {
      root.render(<Harness rowHeight={20} />);
    });

    await act(async () => {
      eventBus.emit('gridtable:focus-request', request(7));
    });
    await flushFrame();

    expect(focusedKey).toBe(rows[7].key);
    // Row 7 spans 140-160 in a 100px viewport.
    expect(wrapper().scrollTop).toBe(60);
  });

  // A virtualized table jumps to the row's estimated position, then reveals the
  // row exactly once it renders (here rows are taller than the estimate).
  it('reveals a virtualized row that was not rendered once scrolling renders it', async () => {
    await act(async () => {
      root.render(<Harness rowHeight={30} initiallyRendered={4} estimatedHeight={200} />);
    });

    await act(async () => {
      eventBus.emit('gridtable:focus-request', request(8));
    });
    await flushFrame();
    // Estimated at 8 x 20px, centered in the viewport.
    expect(wrapper().scrollTop).toBe(110);

    await flushFrame();

    expect(focusedKey).toBe(rows[8].key);
    // Row 8 actually spans 240-270: its bottom meets the viewport's.
    expect(wrapper().scrollTop).toBe(170);
  });
});
