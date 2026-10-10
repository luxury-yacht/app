import { act, StrictMode, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import RawLogViewer, { type RenderedLogRow } from './RawLogViewer';

const makeRows = (count: number): RenderedLogRow[] =>
  Array.from({ length: count }, (_, index) => ({ key: String(index), line: `line ${index}` }));

const Harness = ({ rows }: { rows: RenderedLogRow[] }) => {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref} className="logs-viewer-content">
      <RawLogViewer rows={rows} scrollContainerRef={ref} wrapText />
    </div>
  );
};

const observers = new Set<LayoutObserver>();
class LayoutObserver implements ResizeObserver {
  readonly targets = new Set<Element>();
  private readonly callback: ResizeObserverCallback;
  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.add(this);
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
    observers.delete(this);
  }
  notify() {
    this.callback([], this);
  }
}

// jsdom supplies no layout; these measurements represent wrapped log rows.
describe('RawLogViewer measured layout', () => {
  let host: HTMLDivElement;
  let root: Root;
  let rowHeight: number;
  let viewportHeight: number;
  let nextFrame: number;
  let frames: Map<number, FrameRequestCallback>;
  let originalClientHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    rowHeight = 1_700;
    viewportHeight = 600;
    nextFrame = 1;
    frames = new Map();
    observers.clear();
    vi.stubGlobal('ResizeObserver', LayoutObserver);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrame++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      return {
        height: this.classList.contains('log-viewer-row') ? rowHeight : viewportHeight,
      } as DOMRect;
    });
    originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => viewportHeight,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    } else {
      Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
    }
  });

  const flushFrame = () => {
    act(() => {
      const pending = [...frames.values()];
      frames.clear();
      for (const callback of pending) {
        callback(0);
      }
    });
  };

  const settleMeasurements = () => {
    let frameCount = 0;
    // Keep the runaway guard separate from the convergence budget below.
    while (frames.size > 0 && frameCount < 1_000) {
      flushFrame();
      frameCount++;
    }
    if (frames.size > 0) {
      throw new Error(
        `Log measurements still have ${frames.size} callbacks after ${frameCount} frames`
      );
    }
    return frameCount;
  };

  const virtualHeight = () =>
    Number.parseFloat(
      requireValue(host.querySelector<HTMLElement>('.logs-viewer-virtual-body'), 'virtual log body')
        .style.height
    );

  it.each([200, 400, 1_700, 3_000])(
    'settles %ipx wrapped rows after scrolling into an unmeasured tail without nested update failure',
    (height) => {
      rowHeight = height;
      act(() => root.render(<Harness rows={makeRows(1_000)} />));
      settleMeasurements();
      const content = requireValue(
        host.querySelector<HTMLElement>('.logs-viewer-content'),
        'log viewport'
      );
      const target = virtualHeight() - viewportHeight;
      act(() => {
        content.scrollTop = target;
        content.dispatchEvent(new Event('scroll'));
      });
      const settlingFrames = settleMeasurements();
      // This bounds progressive layout work; it is not a wall-clock timing claim.
      expect(settlingFrames, `Convergence budget for ${height}px rows`).toBeLessThanOrEqual(250);
      expect(host.querySelectorAll('.log-viewer-row').length).toBeGreaterThan(0);
      expect(host.querySelectorAll('.log-viewer-row').length).toBeLessThan(1_000);
      expect(content.scrollTop).toBe(target);
    }
  );

  it('cancels a pending measurement on unmount', () => {
    act(() => root.render(<Harness rows={makeRows(200)} />));
    expect(frames.size).toBeGreaterThan(0);
    act(() => root.render(null));
    expect(frames.size).toBe(0);
    expect(observers.size).toBe(0);
  });

  it('publishes measurements under StrictMode before viewport sizing and filters below the threshold', () => {
    viewportHeight = 0;
    act(() =>
      root.render(
        <StrictMode>
          <Harness rows={makeRows(200)} />
        </StrictMode>
      )
    );
    settleMeasurements();
    expect(virtualHeight()).toBeGreaterThan(200 * 26 + 16);
    act(() =>
      root.render(
        <StrictMode>
          <Harness rows={makeRows(2)} />
        </StrictMode>
      )
    );
    settleMeasurements();
    expect(host.querySelectorAll('.log-viewer-row')).toHaveLength(2);
    expect(host.querySelector('.logs-viewer-virtual-body')).toBeNull();
    expect(observers.size).toBe(0);
  });

  it('batches row resizes and updates the visible range when the viewport grows', () => {
    rowHeight = 20;
    act(() => root.render(<Harness rows={makeRows(200)} />));
    settleMeasurements();
    const initialHeight = virtualHeight();
    act(() => {
      rowHeight = 40;
      for (const observer of [...observers]) {
        observer.notify();
      }
    });
    expect(frames.size).toBe(1);
    settleMeasurements();
    expect(virtualHeight()).toBeGreaterThan(initialHeight);
    const initialCount = host.querySelectorAll('.log-viewer-row').length;
    act(() => {
      viewportHeight = 1_200;
      for (const observer of [...observers]) {
        observer.notify();
      }
    });
    settleMeasurements();
    expect(host.querySelectorAll('.log-viewer-row').length).toBeGreaterThan(initialCount);
  });

  it('ignores invalid and insignificant height changes', () => {
    rowHeight = 20;
    act(() => root.render(<Harness rows={makeRows(200)} />));
    settleMeasurements();
    const initialHeight = virtualHeight();
    for (const height of [0, Number.NaN, 20.25]) {
      act(() => {
        rowHeight = height;
        for (const observer of [...observers]) {
          observer.notify();
        }
      });
      expect(frames.size).toBe(0);
      expect(virtualHeight()).toBe(initialHeight);
    }
  });

  it('measures mounted rows without ResizeObserver and renders an empty result', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    rowHeight = 20;
    act(() => root.render(<Harness rows={makeRows(200)} />));
    settleMeasurements();
    expect(virtualHeight()).toBeLessThan(200 * 26 + 16);
    act(() => root.render(<Harness rows={[]} />));
    settleMeasurements();
    expect(host.querySelectorAll('.log-viewer-row')).toHaveLength(0);
  });
});
