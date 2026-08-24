import {
  type GridTableViewport,
  useGridTableViewport,
} from '@shared/components/tables/hooks/useGridTableViewport';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface ViewportHarness {
  wrapper: HTMLDivElement;
  getViewport: () => GridTableViewport;
  callbacks: {
    scheduleHeaderSync: ReturnType<typeof vi.fn>;
    updateHoverForElement: ReturnType<typeof vi.fn>;
    updateColumnWindowRange: ReturnType<typeof vi.fn>;
    startFrameSampler: ReturnType<typeof vi.fn>;
    stopFrameSampler: ReturnType<typeof vi.fn>;
  };
  resizeObserver: {
    trigger: () => void;
    disconnect: ReturnType<typeof vi.fn>;
  };
  unmount: () => void;
}

const renderViewport = async ({
  shouldVirtualize = false,
  hideHeader = false,
}: {
  shouldVirtualize?: boolean;
  hideHeader?: boolean;
} = {}): Promise<ViewportHarness> => {
  const width = 320;
  const height = 180;
  const wrapper = document.createElement('div');
  const hoveredRow = document.createElement('div');
  wrapper.appendChild(hoveredRow);
  Object.defineProperties(wrapper, {
    clientWidth: { configurable: true, get: () => width },
    clientHeight: { configurable: true, get: () => height },
    offsetWidth: { configurable: true, get: () => width + 15 },
    scrollTop: { configurable: true, writable: true, value: 0 },
  });
  document.body.appendChild(wrapper);

  const observerInstances: Array<{
    trigger: () => void;
    disconnect: ReturnType<typeof vi.fn>;
  }> = [];
  class MockResizeObserver {
    public observe = vi.fn();
    public disconnect = vi.fn();
    public constructor(callback: ResizeObserverCallback) {
      observerInstances.push({
        trigger: () => callback([], this as unknown as ResizeObserver),
        disconnect: this.disconnect,
      });
    }
  }
  vi.stubGlobal('ResizeObserver', MockResizeObserver);

  const callbacks = {
    scheduleHeaderSync: vi.fn(),
    updateHoverForElement: vi.fn(),
    updateColumnWindowRange: vi.fn(),
    startFrameSampler: vi.fn(),
    stopFrameSampler: vi.fn(),
  };
  let viewport: GridTableViewport | undefined;
  const wrapperRef = { current: wrapper };
  const hoverRowRef = { current: hoveredRow };
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);
  const Harness: React.FC = () => {
    viewport = useGridTableViewport({
      wrapperRef,
      dataLength: 3,
      hideHeader,
      shouldVirtualize,
      scheduleHeaderSync: callbacks.scheduleHeaderSync,
      updateHoverForElement: callbacks.updateHoverForElement,
      hoverRowRef,
      updateColumnWindowRange: callbacks.updateColumnWindowRange,
      startFrameSampler: callbacks.startFrameSampler,
      stopFrameSampler: callbacks.stopFrameSampler,
    });
    return null;
  };

  await act(async () => {
    root.render(<Harness />);
  });

  const resizeObserver = observerInstances[0];
  if (!viewport || !resizeObserver) {
    throw new Error('Viewport harness did not initialize');
  }

  return {
    wrapper,
    getViewport: () => {
      if (!viewport) {
        throw new Error('Viewport harness lost its result');
      }
      return viewport;
    },
    callbacks,
    resizeObserver,
    unmount: () => {
      act(() => root.unmount());
      wrapper.remove();
      host.remove();
    },
  };
};

describe('useGridTableViewport', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reports wrapper geometry through one resize observer', async () => {
    const harness = await renderViewport();

    expect(harness.getViewport()).toMatchObject({
      width: 320,
      height: 180,
      scrollbarWidth: 15,
    });
    expect(harness.callbacks.updateHoverForElement).toHaveBeenCalled();

    harness.resizeObserver.trigger();
    expect(harness.getViewport().width).toBe(320);

    harness.unmount();
    expect(harness.resizeObserver.disconnect).toHaveBeenCalled();
  });

  it('runs non-virtualized scroll coordination immediately', async () => {
    const harness = await renderViewport();
    harness.callbacks.scheduleHeaderSync.mockClear();
    harness.callbacks.updateHoverForElement.mockClear();
    harness.callbacks.updateColumnWindowRange.mockClear();

    await act(async () => {
      harness.wrapper.dispatchEvent(new Event('scroll'));
    });

    expect(harness.callbacks.scheduleHeaderSync).toHaveBeenCalledOnce();
    expect(harness.callbacks.updateHoverForElement).toHaveBeenCalledOnce();
    expect(harness.callbacks.updateColumnWindowRange).toHaveBeenCalledOnce();
    harness.unmount();
  });

  it('coalesces virtualized scroll coordination into an animation frame', async () => {
    let flushFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      flushFrame = callback;
      return 1;
    });
    const harness = await renderViewport({ shouldVirtualize: true });
    harness.callbacks.scheduleHeaderSync.mockClear();
    harness.callbacks.updateColumnWindowRange.mockClear();
    harness.wrapper.scrollTop = 88;

    await act(async () => {
      harness.wrapper.dispatchEvent(new Event('scroll'));
    });

    expect(harness.callbacks.startFrameSampler).toHaveBeenCalledOnce();
    expect(harness.callbacks.scheduleHeaderSync).not.toHaveBeenCalled();

    await act(async () => {
      flushFrame?.(0);
    });

    expect(harness.getViewport().scrollTop).toBe(88);
    expect(harness.callbacks.scheduleHeaderSync).toHaveBeenCalledOnce();
    expect(harness.callbacks.updateColumnWindowRange).toHaveBeenCalledOnce();
    harness.unmount();
  });
});
