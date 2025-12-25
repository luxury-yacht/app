/**
 * frontend/src/shared/components/tables/hooks/useGridTablePagination.test.tsx
 *
 * Test suite for useGridTablePagination.
 * Covers key behaviors and edge cases for useGridTablePagination.
 */

import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useGridTablePagination } from '@shared/components/tables/hooks/useGridTablePagination';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type HarnessHandle = {
  triggerManual: () => void;
  triggerAuto: () => void;
  getStatus: () => string;
  setRequesting: (value: boolean) => void;
  setHasMore: (value: boolean) => void;
};

const observerCallbacks: IntersectionObserverCallback[] = [];

const observerStub: IntersectionObserver = {
  root: null,
  rootMargin: '0px',
  thresholds: [0],
  observe() {},
  unobserve() {},
  disconnect() {},
  takeRecords: () => [],
};

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number>;

  constructor(callback: IntersectionObserverCallback) {
    observerCallbacks.push(callback);
    this.root = null;
    this.rootMargin = '0px';
    this.thresholds = [0];
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const Harness = forwardRef<HarnessHandle, { requestMock: (trigger: 'manual' | 'auto') => void }>(
  ({ requestMock }, ref) => {
    const wrapperRef = useRef<HTMLDivElement | null>(null);
    const tableRef = useRef<HTMLElement | null>(null);
    const sentinelRef = useRef<HTMLDivElement | null>(null);
    const [isRequestingMore, setIsRequestingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    if (!wrapperRef.current) {
      const wrapper = document.createElement('div');
      wrapper.className = 'gridtable-wrapper';
      const table = document.createElement('div');
      wrapper.appendChild(table);
      document.body.appendChild(wrapper);
      wrapperRef.current = wrapper;
      tableRef.current = table;
    }

    if (!sentinelRef.current) {
      sentinelRef.current = document.createElement('div');
    }

    const { loadMoreSentinelRef, handleManualLoadMore, paginationStatus } = useGridTablePagination({
      paginationEnabled: true,
      autoLoadMore: true,
      hasMore,
      isRequestingMore,
      onRequestMore: requestMock,
      tableDataLength: 5,
      tableRef,
    });

    if (sentinelRef.current) {
      loadMoreSentinelRef.current = sentinelRef.current;
    }

    useEffect(() => {
      return () => {
        wrapperRef.current?.remove();
        wrapperRef.current = null;
        tableRef.current = null;
        sentinelRef.current = null;
      };
    }, []);

    useImperativeHandle(ref, () => ({
      triggerManual: () => handleManualLoadMore(),
      triggerAuto: () => {
        if (!loadMoreSentinelRef.current || observerCallbacks.length === 0) {
          return;
        }
        const callback = observerCallbacks[observerCallbacks.length - 1];
        const entry = {
          isIntersecting: true,
          target: loadMoreSentinelRef.current,
          boundingClientRect: {} as DOMRectReadOnly,
          intersectionRatio: 1,
          intersectionRect: {} as DOMRectReadOnly,
          rootBounds: null,
          time: Date.now(),
        } as IntersectionObserverEntry;
        callback([entry], observerStub);
      },
      getStatus: () => paginationStatus,
      setRequesting: setIsRequestingMore,
      setHasMore,
    }));

    return null;
  }
);

const renderHarness = async (requestMock: (trigger: 'manual' | 'auto') => void) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const ref = React.createRef<HarnessHandle>();

  await act(async () => {
    root.render(<Harness ref={ref} requestMock={requestMock} />);
  });

  return {
    handle() {
      if (!ref.current) {
        throw new Error('Harness not ready');
      }
      return ref.current;
    },
    async rerender(newRequestMock: (trigger: 'manual' | 'auto') => void) {
      await act(async () => {
        root.render(<Harness ref={ref} requestMock={newRequestMock} />);
      });
    },
    async unmount() {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

beforeEach(() => {
  observerCallbacks.length = 0;
  (globalThis as any).IntersectionObserver = MockIntersectionObserver;
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useGridTablePagination', () => {
  it('triggers manual pagination via handler', async () => {
    const requestMock = vi.fn();
    const harness = await renderHarness(requestMock);
    const handle = harness.handle();

    await act(async () => {
      handle.triggerManual();
    });

    expect(requestMock).toHaveBeenCalledWith('manual');

    await harness.unmount();
  });

  it('notifies auto pagination when sentinel intersects', async () => {
    const requestMock = vi.fn();
    const harness = await renderHarness(requestMock);
    const handle = harness.handle();

    await act(async () => {
      handle.triggerAuto();
      await Promise.resolve();
    });

    expect(requestMock).toHaveBeenCalledWith('auto');

    await harness.unmount();
  });

  it('computes pagination status strings', async () => {
    const requestMock = vi.fn();
    const harness = await renderHarness(requestMock);
    const handle = harness.handle();

    expect(handle.getStatus()).toBe('Scroll or click to load more results');

    await act(async () => {
      handle.setRequesting(true);
      await Promise.resolve();
    });
    expect(harness.handle().getStatus()).toBe('Loading more…');

    await act(async () => {
      handle.setRequesting(false);
      handle.setHasMore(false);
      await Promise.resolve();
    });
    expect(harness.handle().getStatus()).toBe('No additional pages');

    await harness.unmount();
  });
});
