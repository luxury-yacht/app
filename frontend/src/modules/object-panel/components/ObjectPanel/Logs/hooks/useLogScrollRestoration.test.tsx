import { act, useRef, useState } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogScrollPosition } from '../../types';
import { useLogScrollRestoration } from './useLogScrollRestoration';

const getScrollPosition = vi.fn<() => LogScrollPosition | undefined>(() => undefined);
const setScrollPosition = vi.fn();

interface HarnessProps {
  rowCount: number;
  tailFollowSignal: number;
  isActive?: boolean;
  isParsedView?: boolean;
  scrollHeight?: number;
  showScrollContainer?: boolean;
  clampScrollTop?: boolean;
}

const setScrollMetrics = (node: HTMLDivElement, scrollHeight: number, clampScrollTop = false) => {
  Object.defineProperty(node, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(node, 'clientHeight', { configurable: true, value: 100 });
  if (clampScrollTop) {
    if (Object.getOwnPropertyDescriptor(node, 'scrollTop') === undefined) {
      let scrollTop = 0;
      Object.defineProperty(node, 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (nextScrollTop: number) => {
          scrollTop = Math.min(nextScrollTop, node.scrollHeight - node.clientHeight);
        },
      });
    }
    const clampedScrollTop = node.scrollTop;
    node.scrollTop = clampedScrollTop;
  }
};

const dispatchUserWheel = (node: HTMLElement, deltaY: number) => {
  node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY }));
};

const collapseScrollMetricsWhenDetached = (node: HTMLDivElement) => {
  let liveScrollTop = node.scrollTop;
  const liveScrollHeight = node.scrollHeight;
  const liveClientHeight = node.clientHeight;
  Object.defineProperties(node, {
    scrollTop: {
      configurable: true,
      get: () => (node.isConnected ? liveScrollTop : 0),
      set: (nextScrollTop: number) => {
        liveScrollTop = Math.min(nextScrollTop, liveScrollHeight - liveClientHeight);
      },
    },
    scrollHeight: {
      configurable: true,
      get: () => (node.isConnected ? liveScrollHeight : 0),
    },
    clientHeight: {
      configurable: true,
      get: () => (node.isConnected ? liveClientHeight : 0),
    },
  });
};

const Harness = ({
  rowCount,
  tailFollowSignal,
  isActive = true,
  isParsedView = false,
  scrollHeight = 1_000,
  showScrollContainer = true,
  clampScrollTop = false,
}: HarnessProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isTailFollowing, setIsTailFollowing] = useState(true);
  useLogScrollRestoration({
    rootRef,
    isParsedView,
    rowCount,
    tailFollowSignal,
    isActive,
    cacheKey: 'panel-a',
    getScrollPosition,
    setScrollPosition,
    onTailFollowingChange: setIsTailFollowing,
  });

  return (
    <>
      {showScrollContainer ? (
        <div
          ref={(node) => {
            rootRef.current = node;
            if (node && !isParsedView) {
              setScrollMetrics(node, scrollHeight, clampScrollTop);
            }
          }}
        >
          {isParsedView ? (
            <div
              className="gridtable-wrapper"
              ref={(node) => {
                if (node) {
                  setScrollMetrics(node, scrollHeight, clampScrollTop);
                }
              }}
            />
          ) : (
            <div className="logs-viewer-text" />
          )}
        </div>
      ) : null}
      <output data-testid="tail-follow-state">{isTailFollowing ? 'following' : 'paused'}</output>
    </>
  );
};

describe('useLogScrollRestoration', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let nextFrameId = 1;
  let frames = new Map<number, FrameRequestCallback>();

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    frames = new Map();
    nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      frames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames.delete(id);
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) {
      callback(0);
    }
  };

  const flushFramesUntilIdle = (maxGenerations: number): number => {
    let generations = 0;
    while (frames.size > 0 && generations < maxGenerations) {
      flushFrames();
      generations += 1;
    }
    return generations;
  };

  const stubResizeObserver = (): Array<() => void> => {
    const resizeCallbacks: Array<() => void> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: ResizeObserverCallback) {
          resizeCallbacks.push(() => callback([], this as unknown as ResizeObserver));
        }

        observe() {
          // Resize delivery is triggered explicitly by each test.
        }

        unobserve() {
          // Resize delivery is triggered explicitly by each test.
        }

        disconnect() {
          // Resize delivery is triggered explicitly by each test.
        }
      }
    );
    return resizeCallbacks;
  };

  it('preserves a manual scroll that interrupts queued tail-following', async () => {
    await act(async () => {
      root.render(<Harness rowCount={1} tailFollowSignal={1} />);
    });
    act(flushFrames);

    const scrollElement = container.firstElementChild as HTMLDivElement;
    expect(scrollElement.scrollTop).toBe(1_000);

    await act(async () => {
      root.render(<Harness rowCount={2} tailFollowSignal={2} />);
    });

    act(() => {
      dispatchUserWheel(scrollElement, -100);
      scrollElement.scrollTop = 300;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    act(flushFrames);

    expect(scrollElement.scrollTop).toBe(300);
  });

  it('preserves a manual scroll when refresh renders before the browser scroll event', async () => {
    await act(async () => {
      root.render(<Harness rowCount={1} tailFollowSignal={1} />);
    });
    act(flushFrames);

    const scrollElement = container.firstElementChild as HTMLDivElement;
    expect(scrollElement.scrollTop).toBe(1_000);

    act(() => {
      dispatchUserWheel(scrollElement, -100);
      scrollElement.scrollTop = 300;
    });
    await act(async () => {
      root.render(<Harness rowCount={2} tailFollowSignal={2} />);
    });
    act(flushFrames);

    expect(scrollElement.scrollTop).toBe(300);
  });

  it('continues tail-following when refresh changes content without manual scrolling', async () => {
    await act(async () => {
      root.render(<Harness rowCount={1} tailFollowSignal={1} />);
    });
    act(flushFrames);

    const scrollElement = container.firstElementChild as HTMLDivElement;
    expect(scrollElement.scrollTop).toBe(1_000);

    await act(async () => {
      root.render(<Harness rowCount={2} tailFollowSignal={2} scrollHeight={1_200} />);
    });
    act(flushFrames);

    expect(scrollElement.scrollTop).toBe(1_200);
  });

  it.each([
    { isParsedView: false, view: 'text' },
    { isParsedView: true, view: 'table' },
  ])(
    'does not pause $view tail-following when inactive layout changes scroll position',
    async ({ isParsedView }) => {
      await act(async () => {
        root.render(
          <Harness rowCount={200} tailFollowSignal={1} clampScrollTop isParsedView={isParsedView} />
        );
      });
      act(flushFrames);

      const scrollElement = isParsedView
        ? container.querySelector<HTMLDivElement>('.gridtable-wrapper')
        : (container.firstElementChild as HTMLDivElement);
      expect(scrollElement).not.toBeNull();
      if (!scrollElement) {
        return;
      }
      expect(scrollElement.scrollTop).toBe(900);

      await act(async () => {
        root.render(
          <Harness
            rowCount={200}
            tailFollowSignal={1}
            clampScrollTop
            isActive={false}
            isParsedView={isParsedView}
          />
        );
      });
      act(() => {
        scrollElement.scrollTop = 300;
        scrollElement.dispatchEvent(new Event('scroll'));
      });

      expect(
        container.querySelector<HTMLOutputElement>('[data-testid="tail-follow-state"]')?.textContent
      ).toBe('following');

      await act(async () => {
        root.render(
          <Harness rowCount={200} tailFollowSignal={1} clampScrollTop isParsedView={isParsedView} />
        );
      });

      expect(scrollElement.scrollTop).toBe(900);
    }
  );

  it('positions a newly selected table view at the followed tail before the next frame', async () => {
    await act(async () => {
      root.render(<Harness rowCount={200} tailFollowSignal={1} clampScrollTop />);
    });
    act(flushFrames);

    await act(async () => {
      root.render(<Harness rowCount={200} tailFollowSignal={1} clampScrollTop isParsedView />);
    });

    const tableScrollElement = container.querySelector<HTMLDivElement>('.gridtable-wrapper');
    expect(tableScrollElement?.scrollTop).toBe(900);
  });

  it.each([
    { isParsedView: false, view: 'text' },
    { isParsedView: true, view: 'table' },
  ])('does not treat an active $view layout scroll as user intent', async ({ isParsedView }) => {
    await act(async () => {
      root.render(
        <Harness rowCount={200} tailFollowSignal={1} clampScrollTop isParsedView={isParsedView} />
      );
    });
    act(flushFrames);

    const scrollElement = isParsedView
      ? container.querySelector<HTMLDivElement>('.gridtable-wrapper')
      : (container.firstElementChild as HTMLDivElement);
    expect(scrollElement).not.toBeNull();
    if (!scrollElement) {
      return;
    }

    act(() => {
      scrollElement.scrollTop = 300;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    expect(
      container.querySelector<HTMLOutputElement>('[data-testid="tail-follow-state"]')?.textContent
    ).toBe('following');

    await act(async () => {
      root.render(
        <Harness rowCount={200} tailFollowSignal={2} clampScrollTop isParsedView={isParsedView} />
      );
    });
    act(flushFrames);

    expect(scrollElement.scrollTop).toBe(900);
  });

  it('keeps the initial tail pinned while virtualized row measurement grows the content', async () => {
    await act(async () => {
      root.render(<Harness rowCount={200} tailFollowSignal={1} clampScrollTop />);
    });

    const scrollElement = container.firstElementChild as HTMLDivElement;
    act(flushFrames);
    expect(scrollElement.scrollTop).toBe(900);

    Object.defineProperty(scrollElement, 'scrollHeight', {
      configurable: true,
      value: 1_200,
    });
    act(flushFrames);

    expect(scrollElement.scrollTop).toBe(1_100);
  });

  it('stops scheduling frames after the scrollable layout stabilizes', async () => {
    await act(async () => {
      root.render(<Harness rowCount={200} tailFollowSignal={1} clampScrollTop />);
    });

    const generations = flushFramesUntilIdle(20);

    expect(generations).toBe(3);
    expect(frames.size).toBe(0);
  });

  it('stops scheduling frames when the layout never stabilizes', async () => {
    await act(async () => {
      root.render(<Harness rowCount={200} tailFollowSignal={1} clampScrollTop />);
    });

    const scrollElement = container.firstElementChild as HTMLDivElement;
    let changingScrollHeight = 1_000;
    Object.defineProperty(scrollElement, 'scrollHeight', {
      configurable: true,
      get: () => {
        changingScrollHeight += 1;
        return changingScrollHeight;
      },
    });

    const generations = flushFramesUntilIdle(20);

    expect(generations).toBe(20);
    expect(frames.size).toBe(0);
  });

  it('follows Pretty layout growth after the frame-settling window has ended', async () => {
    const resizeCallbacks = stubResizeObserver();
    await act(async () => {
      root.render(<Harness rowCount={200} tailFollowSignal={1} clampScrollTop />);
    });

    const scrollElement = container.firstElementChild as HTMLDivElement;
    flushFramesUntilIdle(20);
    expect(scrollElement.scrollTop).toBe(900);
    expect(frames.size).toBe(0);

    Object.defineProperty(scrollElement, 'scrollHeight', {
      configurable: true,
      value: 1_200,
    });
    act(() => {
      for (const callback of resizeCallbacks) {
        callback();
      }
      flushFrames();
    });

    expect(scrollElement.scrollTop).toBe(1_100);
  });

  it('does not follow late layout growth after the user scrolls away from the tail', async () => {
    const resizeCallbacks = stubResizeObserver();
    await act(async () => {
      root.render(<Harness rowCount={200} tailFollowSignal={1} clampScrollTop />);
    });

    const scrollElement = container.firstElementChild as HTMLDivElement;
    flushFramesUntilIdle(20);
    act(() => {
      dispatchUserWheel(scrollElement, -100);
      scrollElement.scrollTop = 300;
      scrollElement.dispatchEvent(new Event('scroll'));
    });

    Object.defineProperty(scrollElement, 'scrollHeight', {
      configurable: true,
      value: 1_200,
    });
    act(() => {
      for (const callback of resizeCallbacks) {
        callback();
      }
      flushFrames();
    });

    expect(scrollElement.scrollTop).toBe(300);
  });

  it('treats content shorter than the viewport as settled', async () => {
    await act(async () => {
      root.render(<Harness rowCount={200} tailFollowSignal={1} clampScrollTop />);
    });
    flushFramesUntilIdle(20);

    await act(async () => {
      root.render(<Harness rowCount={20} tailFollowSignal={2} scrollHeight={100} clampScrollTop />);
    });
    expect(frames.size).toBe(1);

    act(flushFrames);

    expect(frames.size).toBe(0);
  });

  it('waits for the Pretty layout to become scrollable after the Logs tab remounts', async () => {
    getScrollPosition.mockReturnValue({ scrollTop: 900, isTailFollowing: true });
    await act(async () => {
      root.render(<section>Another object-panel tab</section>);
    });
    await act(async () => {
      root.render(
        <Harness rowCount={200} tailFollowSignal={1} scrollHeight={100} clampScrollTop />
      );
    });

    const scrollElement = container.firstElementChild as HTMLDivElement;
    Object.defineProperty(scrollElement, 'scrollHeight', {
      configurable: true,
      value: 1_200,
    });
    act(flushFrames);

    expect(scrollElement.scrollTop).toBe(1_100);
  });

  it('stops waiting when a remounted layout never becomes scrollable', async () => {
    getScrollPosition.mockReturnValue({ scrollTop: 900, isTailFollowing: true });
    await act(async () => {
      root.render(
        <Harness rowCount={200} tailFollowSignal={1} scrollHeight={100} clampScrollTop />
      );
    });

    const generations = flushFramesUntilIdle(20);

    expect(generations).toBe(20);
    expect(frames.size).toBe(0);
  });

  it('returns to the current tail after the Logs tab unmounts while tail-following', async () => {
    let cachedPosition: LogScrollPosition | undefined;
    getScrollPosition.mockImplementation(() => cachedPosition);
    setScrollPosition.mockImplementation((_cacheKey, position: LogScrollPosition) => {
      cachedPosition = position;
    });

    await act(async () => {
      root.render(
        <Harness rowCount={200} tailFollowSignal={1} scrollHeight={1_000} clampScrollTop />
      );
    });
    act(flushFrames);

    const initialScrollElement = container.firstElementChild as HTMLDivElement;
    initialScrollElement.dispatchEvent(new Event('scroll'));
    expect(cachedPosition).toEqual({ scrollTop: 900, isTailFollowing: true });

    await act(async () => {
      root.render(<section>Another object-panel tab</section>);
    });
    await act(async () => {
      root.render(
        <Harness rowCount={210} tailFollowSignal={2} scrollHeight={1_200} clampScrollTop />
      );
    });
    act(flushFrames);

    const remountedScrollElement = container.firstElementChild as HTMLDivElement;
    expect(remountedScrollElement.scrollTop).toBe(1_100);
  });

  it('restores a manual position after the Logs tab unmounts', async () => {
    let cachedPosition: LogScrollPosition | undefined;
    getScrollPosition.mockImplementation(() => cachedPosition);
    setScrollPosition.mockImplementation((_cacheKey, position: LogScrollPosition) => {
      cachedPosition = position;
    });

    await act(async () => {
      root.render(
        <Harness rowCount={200} tailFollowSignal={1} scrollHeight={1_000} clampScrollTop />
      );
    });
    act(flushFrames);

    const initialScrollElement = container.firstElementChild as HTMLDivElement;
    act(() => {
      dispatchUserWheel(initialScrollElement, -100);
      initialScrollElement.scrollTop = 300;
      initialScrollElement.dispatchEvent(new Event('scroll'));
    });
    expect(cachedPosition).toEqual({ scrollTop: 300, isTailFollowing: false });

    await act(async () => {
      root.render(<section>Another object-panel tab</section>);
    });
    await act(async () => {
      root.render(
        <Harness rowCount={210} tailFollowSignal={2} scrollHeight={1_200} clampScrollTop />
      );
    });
    act(flushFrames);

    const remountedScrollElement = container.firstElementChild as HTMLDivElement;
    expect(remountedScrollElement.scrollTop).toBe(300);
    expect(
      container.querySelector<HTMLOutputElement>('[data-testid="tail-follow-state"]')?.textContent
    ).toBe('paused');
  });

  it('does not replace a manual position with detached zero metrics during unmount', async () => {
    let cachedPosition: LogScrollPosition | undefined;
    getScrollPosition.mockImplementation(() => cachedPosition);
    setScrollPosition.mockImplementation((_cacheKey, position: LogScrollPosition) => {
      cachedPosition = position;
    });

    await act(async () => {
      root.render(
        <Harness rowCount={200} tailFollowSignal={1} scrollHeight={1_000} clampScrollTop />
      );
    });
    act(flushFrames);

    const scrollElement = container.firstElementChild as HTMLDivElement;
    collapseScrollMetricsWhenDetached(scrollElement);
    act(() => {
      dispatchUserWheel(scrollElement, -100);
      scrollElement.scrollTop = 300;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    expect(cachedPosition).toEqual({ scrollTop: 300, isTailFollowing: false });

    await act(async () => {
      root.render(<section>Another object-panel tab</section>);
    });

    expect(scrollElement.isConnected).toBe(false);
    expect(cachedPosition).toEqual({ scrollTop: 300, isTailFollowing: false });
  });

  it('persists reaching the tail when the Logs tab unmounts before the scroll event', async () => {
    let cachedPosition: LogScrollPosition | undefined = {
      scrollTop: 300,
      isTailFollowing: false,
    };
    getScrollPosition.mockImplementation(() => cachedPosition);
    setScrollPosition.mockImplementation((_cacheKey, position: LogScrollPosition) => {
      cachedPosition = position;
    });

    await act(async () => {
      root.render(
        <Harness rowCount={200} tailFollowSignal={1} scrollHeight={1_000} clampScrollTop />
      );
    });
    const initialScrollElement = container.firstElementChild as HTMLDivElement;
    collapseScrollMetricsWhenDetached(initialScrollElement);
    act(() => {
      dispatchUserWheel(initialScrollElement, 100);
      initialScrollElement.scrollTop = 900;
    });

    await act(async () => {
      root.render(<section>Another object-panel tab</section>);
    });
    expect(initialScrollElement.isConnected).toBe(false);
    expect(cachedPosition).toEqual({ scrollTop: 900, isTailFollowing: true });

    await act(async () => {
      root.render(
        <Harness rowCount={210} tailFollowSignal={2} scrollHeight={1_200} clampScrollTop />
      );
    });
    act(flushFrames);

    const remountedScrollElement = container.firstElementChild as HTMLDivElement;
    expect(remountedScrollElement.scrollTop).toBe(1_100);
  });

  it('resumes when the user reaches the prior bottom before refresh extends it', async () => {
    await act(async () => {
      root.render(<Harness rowCount={1} tailFollowSignal={1} />);
    });
    act(flushFrames);

    const scrollElement = container.firstElementChild as HTMLDivElement;
    const tailFollowState = () =>
      container.querySelector<HTMLOutputElement>('[data-testid="tail-follow-state"]')?.textContent;

    await act(async () => {
      dispatchUserWheel(scrollElement, -100);
      scrollElement.scrollTop = 300;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    expect(tailFollowState()).toBe('paused');

    act(() => {
      dispatchUserWheel(scrollElement, 100);
      scrollElement.scrollTop = 900;
    });
    await act(async () => {
      root.render(<Harness rowCount={2} tailFollowSignal={2} scrollHeight={1_200} />);
    });
    await act(async () => {
      scrollElement.dispatchEvent(new Event('scroll'));
    });

    expect(tailFollowState()).toBe('following');
  });

  it('pauses immediately when the viewport mounts after loading and no more logs arrive', async () => {
    await act(async () => {
      root.render(<Harness rowCount={0} tailFollowSignal={0} showScrollContainer={false} />);
    });
    await act(async () => {
      root.render(<Harness rowCount={1} tailFollowSignal={1} />);
    });
    act(flushFrames);

    const scrollElement = container.firstElementChild as HTMLDivElement;
    await act(async () => {
      dispatchUserWheel(scrollElement, -100);
      scrollElement.scrollTop = 300;
      scrollElement.dispatchEvent(new Event('scroll'));
    });

    expect(
      container.querySelector<HTMLOutputElement>('[data-testid="tail-follow-state"]')?.textContent
    ).toBe('paused');
  });

  it('stops parsed-view layout retries when manual scrolling interrupts tail-following', async () => {
    await act(async () => {
      root.render(<Harness rowCount={1} tailFollowSignal={1} isParsedView />);
    });
    act(flushFrames);
    act(flushFrames);

    await act(async () => {
      root.render(<Harness rowCount={2} tailFollowSignal={2} isParsedView scrollHeight={100} />);
    });
    act(flushFrames);

    await act(async () => {
      root.render(<Harness rowCount={2} tailFollowSignal={2} isParsedView scrollHeight={1_000} />);
    });
    const scrollElement = container.querySelector<HTMLDivElement>('.gridtable-wrapper');
    expect(scrollElement).not.toBeNull();
    if (!scrollElement) {
      return;
    }

    act(() => {
      dispatchUserWheel(scrollElement, -100);
      scrollElement.scrollTop = 300;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    act(flushFrames);

    expect(frames.size).toBe(0);
    expect(scrollElement.scrollTop).toBe(300);
  });
});
