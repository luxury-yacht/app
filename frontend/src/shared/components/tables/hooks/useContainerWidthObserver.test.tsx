import React, { act, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useContainerWidthObserver } from '@shared/components/tables/hooks/useContainerWidthObserver';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type WindowStub = {
  window: Window;
  emit: (type: string) => void;
  listeners: Map<string, Set<EventListener>>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

const createWindowStub = (): WindowStub => {
  const listeners = new Map<string, Set<EventListener>>();
  const addEventListener = vi.fn((type: string, listener: EventListener) => {
    const set = listeners.get(type) ?? new Set<EventListener>();
    set.add(listener);
    listeners.set(type, set);
  });
  const removeEventListener = vi.fn((type: string, listener: EventListener) => {
    const set = listeners.get(type);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        listeners.delete(type);
      }
    }
  });
  const dispatchEvent = vi.fn((event: Event) => {
    const set = listeners.get(event.type);
    if (set) {
      set.forEach((listener) => listener(event));
    }
    return true;
  });

  return {
    window: {
      addEventListener,
      removeEventListener,
      dispatchEvent,
    } as unknown as Window,
    emit: (type: string) => {
      const event = new Event(type);
      dispatchEvent(event);
    },
    listeners,
    addEventListener,
    removeEventListener,
  };
};

const createResizeObserverStub = () => {
  const instances: Array<{
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    trigger: () => void;
  }> = [];

  class MockResizeObserver {
    public observe = vi.fn((element: Element) => element);
    public disconnect = vi.fn();
    private callback: ResizeObserverCallback;

    constructor(callback: ResizeObserverCallback) {
      this.callback = callback;
      instances.push({
        observe: this.observe,
        disconnect: this.disconnect,
        trigger: () => this.callback([], this as unknown as ResizeObserver),
      });
    }
  }

  return {
    ResizeObserver: MockResizeObserver as unknown as typeof ResizeObserver,
    instances,
  };
};

type HarnessHandle = {
  setWidth: (value: number) => void;
  unmount: () => Promise<void>;
  windowStub: WindowStub;
  observerInstances: Array<{
    observe: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    trigger: () => void;
  }>;
};

const renderHarness = async (): Promise<{
  handle: HarnessHandle;
  onWidth: ReturnType<typeof vi.fn>;
}> => {
  const windowStub = createWindowStub();
  const { ResizeObserver, instances } = createResizeObserverStub();
  const container = document.createElement('div');
  let currentWidth = 320;
  Object.defineProperty(container, 'clientWidth', {
    configurable: true,
    get() {
      return currentWidth;
    },
  });

  const tableElement = document.createElement('div');
  container.appendChild(tableElement);
  document.body.appendChild(container);

  const rootHost = document.createElement('div');
  document.body.appendChild(rootHost);
  const root = ReactDOM.createRoot(rootHost);
  const onWidth = vi.fn();

  const Harness: React.FC = () => {
    const tableRef = useRef<HTMLElement | null>(null);
    useEffect(() => {
      tableRef.current = tableElement;
      return () => {
        tableRef.current = null;
      };
    }, []);

    useContainerWidthObserver({
      tableRef,
      onContainerWidth: onWidth,
      tableDataLength: 3,
      resolveContainer: () => container,
      windowImpl: windowStub.window,
      resizeObserverImpl: ResizeObserver,
    });

    return null;
  };

  await act(async () => {
    root.render(<Harness />);
  });

  return {
    handle: {
      setWidth: (value: number) => {
        currentWidth = value;
      },
      unmount: async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
        rootHost.remove();
      },
      windowStub,
      observerInstances: instances,
    },
    onWidth,
  };
};

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('useContainerWidthObserver', () => {
  it('reports initial container width and reacts to window resize', async () => {
    const { handle, onWidth } = await renderHarness();

    expect(onWidth).toHaveBeenCalledWith(320);

    handle.setWidth(280);
    await act(async () => {
      handle.windowStub.emit('resize');
    });
    expect(onWidth).toHaveBeenLastCalledWith(280);

    handle.setWidth(360);
    const firstObserver = handle.observerInstances[0];
    expect(firstObserver).toBeDefined();
    firstObserver.trigger();
    expect(onWidth).toHaveBeenLastCalledWith(360);

    await handle.unmount();
  });

  it('does not emit when the container width is unchanged', async () => {
    const { handle, onWidth } = await renderHarness();
    onWidth.mockClear();

    // No width change should not re-emit.
    await act(async () => {
      handle.windowStub.emit('resize');
    });
    expect(onWidth).not.toHaveBeenCalled();

    handle.setWidth(321);
    await act(async () => {
      handle.windowStub.emit('resize');
    });
    expect(onWidth).toHaveBeenCalledWith(321);

    await handle.unmount();
  });

  it('cleans up window listener and observer on unmount', async () => {
    const { handle } = await renderHarness();
    const initialObserver = handle.observerInstances[0];

    await handle.unmount();

    expect(handle.windowStub.removeEventListener).toHaveBeenCalled();
    if (initialObserver) {
      expect(initialObserver.disconnect).toHaveBeenCalled();
    }
  });
});
