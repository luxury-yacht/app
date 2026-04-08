/**
 * frontend/src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx
 */
import * as React from 'react';
import ReactDOM from 'react-dom/client';
import { act, useContext } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { TabDragProvider, TabDragContext } from './TabDragProvider';
import { useTabDragSource, useTabDragSourceFactory } from './useTabDragSource';
import { useTabDropTarget } from './useTabDropTarget';
import { TAB_DRAG_DATA_TYPE } from './types';

describe('TabDragProvider', () => {
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

  it('renders children and exposes a null currentDrag initially', () => {
    let observed: { currentDrag: unknown } | null = null;
    function Probe() {
      const ctx = useContext(TabDragContext);
      observed = ctx;
      return <div data-testid="probe">child</div>;
    }

    act(() => {
      root.render(
        <TabDragProvider>
          <Probe />
        </TabDragProvider>
      );
    });

    expect(container.querySelector('[data-testid="probe"]')).toBeTruthy();
    expect(observed).toBeTruthy();
    expect(observed!.currentDrag).toBeNull();
  });
});

describe('useTabDragSource', () => {
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

  it('returns draggable=true and drag handlers when a payload is supplied', () => {
    let captured: ReturnType<typeof useTabDragSource> | null = null;

    function Probe() {
      captured = useTabDragSource({ kind: 'cluster-tab', clusterId: 'c1' });
      return (
        <button {...captured} type="button">
          drag
        </button>
      );
    }

    act(() => {
      root.render(
        <TabDragProvider>
          <Probe />
        </TabDragProvider>
      );
    });

    expect(captured!.draggable).toBe(true);
    expect(typeof captured!.onDragStart).toBe('function');
    expect(typeof captured!.onDragEnd).toBe('function');
  });

  it('returns draggable=false when payload is null', () => {
    let captured: ReturnType<typeof useTabDragSource> | null = null;

    function Probe() {
      captured = useTabDragSource(null);
      return (
        <button {...captured} type="button">
          drag
        </button>
      );
    }

    act(() => {
      root.render(
        <TabDragProvider>
          <Probe />
        </TabDragProvider>
      );
    });

    expect(captured!.draggable).toBe(false);
  });

  it('writes the payload to dataTransfer on dragstart', () => {
    let captured: ReturnType<typeof useTabDragSource> | null = null;
    function Probe() {
      captured = useTabDragSource({ kind: 'cluster-tab', clusterId: 'c1' });
      return (
        <button {...captured} type="button">
          drag
        </button>
      );
    }

    act(() => {
      root.render(
        <TabDragProvider>
          <Probe />
        </TabDragProvider>
      );
    });

    const setData = vi.fn();
    const fakeEvent = {
      dataTransfer: {
        setData,
        effectAllowed: '',
      },
    } as unknown as React.DragEvent<HTMLElement>;

    act(() => {
      captured!.onDragStart!(fakeEvent);
    });

    expect(setData).toHaveBeenCalledWith(
      TAB_DRAG_DATA_TYPE,
      JSON.stringify({ kind: 'cluster-tab', clusterId: 'c1' })
    );
  });

  it('calls setDragImage when getDragImage returns an element', () => {
    const previewEl = document.createElement('div');
    let captured: ReturnType<typeof useTabDragSource> | null = null;

    function Probe() {
      captured = useTabDragSource(
        { kind: 'cluster-tab', clusterId: 'c1' },
        { getDragImage: () => ({ element: previewEl, offsetX: 14, offsetY: 16 }) }
      );
      return (
        <button {...captured} type="button">
          drag
        </button>
      );
    }

    act(() => {
      root.render(
        <TabDragProvider>
          <Probe />
        </TabDragProvider>
      );
    });

    const setDragImage = vi.fn();
    const setData = vi.fn();
    const fakeEvent = {
      dataTransfer: { setData, setDragImage, effectAllowed: '' },
    } as unknown as React.DragEvent<HTMLElement>;

    act(() => {
      captured!.onDragStart!(fakeEvent);
    });

    expect(setDragImage).toHaveBeenCalledWith(previewEl, 14, 16);
  });

  it('does not call setDragImage when getDragImage returns null', () => {
    let captured: ReturnType<typeof useTabDragSource> | null = null;

    function Probe() {
      captured = useTabDragSource(
        { kind: 'cluster-tab', clusterId: 'c1' },
        { getDragImage: () => null }
      );
      return (
        <button {...captured} type="button">
          drag
        </button>
      );
    }

    act(() => {
      root.render(
        <TabDragProvider>
          <Probe />
        </TabDragProvider>
      );
    });

    const setDragImage = vi.fn();
    const setData = vi.fn();
    const fakeEvent = {
      dataTransfer: { setData, setDragImage, effectAllowed: '' },
    } as unknown as React.DragEvent<HTMLElement>;

    act(() => {
      captured!.onDragStart!(fakeEvent);
    });

    expect(setDragImage).not.toHaveBeenCalled();
  });
});

describe('useTabDragSourceFactory', () => {
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

  it('returns a factory usable inside .map() for an unbounded tab list', () => {
    // Render a component that uses the factory to build drag source props
    // for an arbitrary number of tabs — more than any reasonable unrolled-hook
    // workaround would allow.
    const TAB_COUNT = 40;
    const dragStartCallbacks: Array<(event: any) => void> = [];

    function Harness() {
      const makeDragSource = useTabDragSourceFactory();
      const tabs = Array.from({ length: TAB_COUNT }, (_, i) => ({
        id: `t${i}`,
        label: `Tab ${i}`,
      }));
      return (
        <div>
          {tabs.map((tab) => {
            const props = makeDragSource({ kind: 'cluster-tab', clusterId: tab.id });
            if (props.onDragStart) dragStartCallbacks.push(props.onDragStart);
            return (
              <div key={tab.id} data-testid={`tab-${tab.id}`} draggable={props.draggable}>
                {tab.label}
              </div>
            );
          })}
        </div>
      );
    }

    act(() => {
      root.render(
        <TabDragProvider>
          <Harness />
        </TabDragProvider>
      );
    });

    // All 40 tabs should have draggable={true}.
    const renderedTabs = container.querySelectorAll('[data-testid^="tab-"]');
    expect(renderedTabs.length).toBe(TAB_COUNT);
    renderedTabs.forEach((el) => {
      expect(el.getAttribute('draggable')).toBe('true');
    });

    // Each tab's onDragStart should be a distinct closure (not the same
    // function shared across all tabs).
    expect(new Set(dragStartCallbacks).size).toBe(TAB_COUNT);
  });
});

describe('useTabDropTarget', () => {
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

  it('attaches a ref to the target element and returns isDragOver=false initially', () => {
    let captured: ReturnType<typeof useTabDropTarget<'cluster-tab'>> | null = null;

    function Probe() {
      captured = useTabDropTarget({
        accepts: ['cluster-tab'],
        onDrop: () => {},
      });
      return (
        <div ref={captured.ref} data-testid="target">
          target
        </div>
      );
    }

    act(() => {
      root.render(
        <TabDragProvider>
          <Probe />
        </TabDragProvider>
      );
    });

    expect(captured!.isDragOver).toBe(false);
    expect(container.querySelector('[data-testid="target"]')).toBeTruthy();
  });

  it('fires onDrop with the matching payload when a drop event occurs', () => {
    const onDrop = vi.fn();

    function Probe() {
      const { ref } = useTabDropTarget({
        accepts: ['cluster-tab'],
        onDrop,
      });
      return (
        <div ref={ref} data-testid="target">
          target
        </div>
      );
    }

    let beginDragRef: ((p: any) => void) | null = null;
    function Capture() {
      const ctx = useContext(TabDragContext);
      beginDragRef = ctx.beginDrag;
      return null;
    }

    act(() => {
      root.render(
        <TabDragProvider>
          <Capture />
          <Probe />
        </TabDragProvider>
      );
    });

    // Simulate a drag source starting a drag.
    act(() => {
      beginDragRef!({ kind: 'cluster-tab', clusterId: 'c1' });
    });

    const target = container.querySelector<HTMLElement>('[data-testid="target"]')!;
    // Simulate dragenter then drop.
    const dataTransfer = {
      getData: vi.fn(() => JSON.stringify({ kind: 'cluster-tab', clusterId: 'c1' })),
      types: [TAB_DRAG_DATA_TYPE],
      dropEffect: 'move',
    };
    const dragEnter = new Event('dragenter', { bubbles: true }) as any;
    dragEnter.dataTransfer = dataTransfer;
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as any;
    dropEvent.dataTransfer = dataTransfer;

    act(() => {
      target.dispatchEvent(dragEnter);
      target.dispatchEvent(dropEvent);
    });

    expect(onDrop).toHaveBeenCalledTimes(1);
    const [payload] = onDrop.mock.calls[0];
    expect(payload.kind).toBe('cluster-tab');
    expect((payload as any).clusterId).toBe('c1');
  });

  it('does not fire onDrop when the payload kind is not in accepts', () => {
    const onDrop = vi.fn();

    function Probe() {
      const { ref } = useTabDropTarget({
        accepts: ['dockable-tab'], // accepts only dockable
        onDrop,
      });
      return (
        <div ref={ref} data-testid="target">
          target
        </div>
      );
    }

    let beginDragRef: ((p: any) => void) | null = null;
    function Capture() {
      const ctx = useContext(TabDragContext);
      beginDragRef = ctx.beginDrag;
      return null;
    }

    act(() => {
      root.render(
        <TabDragProvider>
          <Capture />
          <Probe />
        </TabDragProvider>
      );
    });

    act(() => {
      beginDragRef!({ kind: 'cluster-tab', clusterId: 'c1' }); // cluster payload
    });

    const target = container.querySelector<HTMLElement>('[data-testid="target"]')!;
    const dataTransfer = {
      getData: vi.fn(() => JSON.stringify({ kind: 'cluster-tab', clusterId: 'c1' })),
      types: [TAB_DRAG_DATA_TYPE],
      dropEffect: 'move',
    };
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true }) as any;
    dropEvent.dataTransfer = dataTransfer;

    act(() => {
      target.dispatchEvent(dropEvent);
    });

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('stops drop-event propagation to ancestor drop targets when nested', () => {
    const outerOnDrop = vi.fn();
    const innerOnDrop = vi.fn();

    function Harness() {
      const { ref: outerRef } = useTabDropTarget({
        accepts: ['cluster-tab'],
        onDrop: outerOnDrop,
      });
      const { ref: innerRef } = useTabDropTarget({
        accepts: ['cluster-tab'],
        onDrop: innerOnDrop,
      });
      return (
        <div ref={outerRef as (el: HTMLDivElement | null) => void} data-testid="outer">
          <div ref={innerRef as (el: HTMLDivElement | null) => void} data-testid="inner">
            <div role="tab" style={{ width: 100, height: 20 }} />
          </div>
        </div>
      );
    }

    act(() => {
      root.render(
        <TabDragProvider>
          <Harness />
        </TabDragProvider>
      );
    });

    const inner = container.querySelector('[data-testid="inner"]')!;
    // Fire a drop carrying an accepted payload on the inner target.
    const dropEvent = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(dropEvent, 'dataTransfer', {
      value: {
        getData: () => JSON.stringify({ kind: 'cluster-tab', clusterId: 'x' }),
        types: [TAB_DRAG_DATA_TYPE],
      },
    });
    Object.defineProperty(dropEvent, 'clientX', { value: 50 });

    act(() => {
      inner.dispatchEvent(dropEvent);
    });

    // Inner handler fires once; outer handler does NOT fire because the
    // inner one stopped propagation after consuming the event.
    expect(innerOnDrop).toHaveBeenCalledTimes(1);
    expect(outerOnDrop).not.toHaveBeenCalled();
  });

  it('keeps isDragOver=true when the cursor moves between descendant elements', () => {
    let captured: ReturnType<typeof useTabDropTarget<'cluster-tab'>> | null = null;

    function Probe() {
      captured = useTabDropTarget({
        accepts: ['cluster-tab'],
        onDrop: () => {},
      });
      return (
        <div ref={captured.ref} data-testid="target" data-drag-over={captured.isDragOver}>
          <span data-testid="child-a">child a</span>
          <span data-testid="child-b">child b</span>
        </div>
      );
    }

    let beginDragRef: ((p: any) => void) | null = null;
    function Capture() {
      const ctx = useContext(TabDragContext);
      beginDragRef = ctx.beginDrag;
      return null;
    }

    act(() => {
      root.render(
        <TabDragProvider>
          <Capture />
          <Probe />
        </TabDragProvider>
      );
    });

    act(() => {
      beginDragRef!({ kind: 'cluster-tab', clusterId: 'c1' });
    });

    const target = container.querySelector<HTMLElement>('[data-testid="target"]')!;
    const childA = container.querySelector<HTMLElement>('[data-testid="child-a"]')!;
    const childB = container.querySelector<HTMLElement>('[data-testid="child-b"]')!;

    const dataTransfer = {
      getData: vi.fn(() => JSON.stringify({ kind: 'cluster-tab', clusterId: 'c1' })),
      types: [TAB_DRAG_DATA_TYPE],
      dropEffect: 'move',
    };

    // Enter the target initially.
    const dragEnter = new Event('dragenter', { bubbles: true }) as any;
    dragEnter.dataTransfer = dataTransfer;
    act(() => {
      target.dispatchEvent(dragEnter);
    });

    expect(target.getAttribute('data-drag-over')).toBe('true');

    // Cursor moves from target into child A. dragleave fires with relatedTarget=childA.
    const leaveToChildA = new Event('dragleave', { bubbles: true }) as any;
    leaveToChildA.dataTransfer = dataTransfer;
    leaveToChildA.relatedTarget = childA;
    act(() => {
      target.dispatchEvent(leaveToChildA);
    });

    // The hook should have ignored that leave because childA is a descendant.
    expect(target.getAttribute('data-drag-over')).toBe('true');

    // Cursor moves from child A to child B (still inside target). Same behavior.
    const leaveAtoB = new Event('dragleave', { bubbles: true }) as any;
    leaveAtoB.dataTransfer = dataTransfer;
    leaveAtoB.relatedTarget = childB;
    act(() => {
      target.dispatchEvent(leaveAtoB);
    });

    expect(target.getAttribute('data-drag-over')).toBe('true');

    // Cursor leaves the target entirely (relatedTarget is some unrelated element).
    const unrelated = document.createElement('div');
    document.body.appendChild(unrelated);
    const leaveToOutside = new Event('dragleave', { bubbles: true }) as any;
    leaveToOutside.dataTransfer = dataTransfer;
    leaveToOutside.relatedTarget = unrelated;
    act(() => {
      target.dispatchEvent(leaveToOutside);
    });

    expect(target.getAttribute('data-drag-over')).toBe('false');

    unrelated.remove();
  });
});
