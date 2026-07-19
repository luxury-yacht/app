import { act, useRef, useState } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLogScrollRestoration } from './useLogScrollRestoration';

const getScrollTop = vi.fn(() => undefined);
const setScrollTop = vi.fn();

interface HarnessProps {
  rowCount: number;
  tailFollowSignal: number;
  isParsedView?: boolean;
  scrollHeight?: number;
  showScrollContainer?: boolean;
}

const setScrollMetrics = (node: HTMLDivElement, scrollHeight: number) => {
  Object.defineProperty(node, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(node, 'clientHeight', { configurable: true, value: 100 });
};

const Harness = ({
  rowCount,
  tailFollowSignal,
  isParsedView = false,
  scrollHeight = 1_000,
  showScrollContainer = true,
}: HarnessProps) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [isTailFollowing, setIsTailFollowing] = useState(true);
  useLogScrollRestoration({
    rootRef,
    isParsedView,
    rowCount,
    tailFollowSignal,
    cacheKey: 'panel-a',
    getScrollTop,
    setScrollTop,
    onTailFollowingChange: setIsTailFollowing,
  });

  return (
    <>
      {showScrollContainer ? (
        <div
          ref={(node) => {
            rootRef.current = node;
            if (node && !isParsedView) {
              setScrollMetrics(node, scrollHeight);
            }
          }}
        >
          {isParsedView ? (
            <div
              className="gridtable-wrapper"
              ref={(node) => {
                if (node) {
                  setScrollMetrics(node, scrollHeight);
                }
              }}
            />
          ) : null}
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
    vi.clearAllMocks();
  });

  const flushFrames = () => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) {
      callback(0);
    }
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

    scrollElement.scrollTop = 300;
    scrollElement.dispatchEvent(new Event('scroll'));
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

    scrollElement.scrollTop = 300;
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

  it('resumes when the user reaches the prior bottom before refresh extends it', async () => {
    await act(async () => {
      root.render(<Harness rowCount={1} tailFollowSignal={1} />);
    });
    act(flushFrames);

    const scrollElement = container.firstElementChild as HTMLDivElement;
    const tailFollowState = () =>
      container.querySelector<HTMLOutputElement>('[data-testid="tail-follow-state"]')?.textContent;

    await act(async () => {
      scrollElement.scrollTop = 300;
      scrollElement.dispatchEvent(new Event('scroll'));
    });
    expect(tailFollowState()).toBe('paused');

    scrollElement.scrollTop = 900;
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

    scrollElement.scrollTop = 300;
    scrollElement.dispatchEvent(new Event('scroll'));
    act(flushFrames);

    expect(frames.size).toBe(0);
    expect(scrollElement.scrollTop).toBe(300);
  });
});
