/**
 * frontend/src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx
 */

import type * as React from 'react';
import { act, useContext } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

import { TabDragContext, TabDragProvider } from './TabDragProvider';
import { TAB_DRAG_DATA_TYPE, type TabDragPayload } from './types';
import { useTabDragSource, useTabDragSourceFactory } from './useTabDragSource';
import { useTabDropTarget } from './useTabDropTarget';

type DragSourceResult = ReturnType<typeof useTabDragSource>;
type ClusterDropTargetResult = ReturnType<typeof useTabDropTarget<'cluster-tab'>>;

const requireDragSource = (value: DragSourceResult | null): DragSourceResult =>
  requireValue<DragSourceResult | null>(value, 'expected the tab drag source after rendering');

const requireClusterDropTarget = (value: ClusterDropTargetResult | null): ClusterDropTargetResult =>
  requireValue<ClusterDropTargetResult | null>(
    value,
    'expected the cluster tab drop target after rendering'
  );

type TestDataTransfer = {
  getData: (format: string) => string;
  types: string[];
  dropEffect: string;
};

type TestDragEvent = Event & {
  dataTransfer: TestDataTransfer;
  relatedTarget: EventTarget | null;
};

const createTestDragEvent = (
  type: string,
  dataTransfer: TestDataTransfer,
  relatedTarget: EventTarget | null = null
): TestDragEvent => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TestDragEvent;
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget });
  return event;
};

describe('TabDragProvider', () => {
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
    expect(
      requireValue<{ currentDrag: unknown } | null>(
        observed,
        'expected the tab drag context after rendering'
      ).currentDrag
    ).toBeNull();
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

    expect(requireDragSource(captured).draggable).toBe(true);
    expect(typeof requireDragSource(captured).onDragStart).toBe('function');
    expect(typeof requireDragSource(captured).onDragEnd).toBe('function');
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

    expect(requireDragSource(captured).draggable).toBe(false);
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
      requireValue(
        requireDragSource(captured).onDragStart,
        'expected test value in dragCoordinator.test.tsx'
      )(fakeEvent);
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
      requireValue(
        requireDragSource(captured).onDragStart,
        'expected test value in dragCoordinator.test.tsx'
      )(fakeEvent);
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
      requireValue(
        requireDragSource(captured).onDragStart,
        'expected test value in dragCoordinator.test.tsx'
      )(fakeEvent);
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
    const dragStartCallbacks: Array<React.DragEventHandler<HTMLElement>> = [];

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
            if (props.onDragStart) {
              dragStartCallbacks.push(props.onDragStart);
            }
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
        onDrop: () => undefined,
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

    expect(requireClusterDropTarget(captured).isDragOver).toBe(false);
    expect(container.querySelector('[data-testid="target"]')).toBeTruthy();
  });

  it('fires onDrop with the matching payload when a drop event occurs', () => {
    const onDrop = vi.fn<(payload: TabDragPayload) => void>();

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

    let beginDragRef: ((payload: TabDragPayload) => void) | null = null;
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
      requireValue(
        beginDragRef,
        'expected test value in dragCoordinator.test.tsx'
      )({ kind: 'cluster-tab', clusterId: 'c1' });
    });

    const target = requireValue(
      container.querySelector<HTMLElement>('[data-testid="target"]'),
      'expected test value in dragCoordinator.test.tsx'
    );
    // Simulate dragenter then drop.
    const dataTransfer = {
      getData: vi.fn(() => JSON.stringify({ kind: 'cluster-tab', clusterId: 'c1' })),
      types: [TAB_DRAG_DATA_TYPE],
      dropEffect: 'move',
    };
    const dragEnter = createTestDragEvent('dragenter', dataTransfer);
    const dropEvent = createTestDragEvent('drop', dataTransfer);

    act(() => {
      target.dispatchEvent(dragEnter);
      target.dispatchEvent(dropEvent);
    });

    expect(onDrop).toHaveBeenCalledTimes(1);
    const [payload] = onDrop.mock.calls[0];
    expect(payload.kind).toBe('cluster-tab');
    if (payload.kind !== 'cluster-tab') {
      throw new Error('expected a cluster-tab drop payload');
    }
    expect(payload.clusterId).toBe('c1');
  });

  it('calls preventDefault on dragover under HTML5 "protected mode" semantics', () => {
    // Regression test for a spec-compliance bug: during dragenter/dragover,
    // the drag data store is in protected mode and getData() returns an
    // empty string for custom MIME types in every real browser. The hook
    // must not rely on getData() there — if it does, preventDefault never
    // runs and the browser silently refuses to fire the subsequent drop,
    // making drag-and-drop look "broken" in production with no error.
    //
    // This test simulates protected mode by having getData() return "" on
    // dragenter/dragover (matching real browser behaviour) and the full
    // payload only at drop time. The hook must still mark the event as
    // accepted by calling preventDefault on dragenter AND dragover, and
    // must still fire onDrop with the correct payload at drop time.
    const onDrop = vi.fn<(payload: TabDragPayload) => void>();

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

    let beginDragRef: ((payload: TabDragPayload) => void) | null = null;
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
      requireValue(
        beginDragRef,
        'expected test value in dragCoordinator.test.tsx'
      )({ kind: 'cluster-tab', clusterId: 'c1' });
    });

    // Protected-mode data transfer: types readable, getData returns ''.
    const protectedGetData = vi.fn(() => '');
    const protectedDataTransfer = {
      getData: protectedGetData,
      types: [TAB_DRAG_DATA_TYPE],
      dropEffect: 'move',
    };
    const dragEnter = createTestDragEvent('dragenter', protectedDataTransfer);
    const dragOver = createTestDragEvent('dragover', protectedDataTransfer);

    const target = requireValue(
      container.querySelector<HTMLElement>('[data-testid="target"]'),
      'expected test value in dragCoordinator.test.tsx'
    );
    act(() => {
      target.dispatchEvent(dragEnter);
      target.dispatchEvent(dragOver);
    });

    // preventDefault should be called on BOTH events — if it isn't, the
    // browser will refuse to fire drop and drag-and-drop is silently broken.
    expect(dragEnter.defaultPrevented).toBe(true);
    expect(dragOver.defaultPrevented).toBe(true);

    // At drop time the store is in read-only mode; simulate getData() now
    // returning the real payload.
    const readOnlyDataTransfer = {
      getData: vi.fn(() => JSON.stringify({ kind: 'cluster-tab', clusterId: 'c1' })),
      types: [TAB_DRAG_DATA_TYPE],
      dropEffect: 'move',
    };
    const dropEvent = createTestDragEvent('drop', readOnlyDataTransfer);
    act(() => {
      target.dispatchEvent(dropEvent);
    });

    expect(onDrop).toHaveBeenCalledTimes(1);
    const [payload] = onDrop.mock.calls[0];
    expect(payload.kind).toBe('cluster-tab');
    if (payload.kind !== 'cluster-tab') {
      throw new Error('expected a cluster-tab drop payload');
    }
    expect(payload.clusterId).toBe('c1');
  });

  it('does not fire onDrop when the payload kind is not in accepts', () => {
    const onDrop = vi.fn<(payload: TabDragPayload) => void>();

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

    let beginDragRef: ((payload: TabDragPayload) => void) | null = null;
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
      requireValue(
        beginDragRef,
        'expected test value in dragCoordinator.test.tsx'
      )({ kind: 'cluster-tab', clusterId: 'c1' }); // cluster payload
    });

    const target = requireValue(
      container.querySelector<HTMLElement>('[data-testid="target"]'),
      'expected test value in dragCoordinator.test.tsx'
    );
    const dataTransfer = {
      getData: vi.fn(() => JSON.stringify({ kind: 'cluster-tab', clusterId: 'c1' })),
      types: [TAB_DRAG_DATA_TYPE],
      dropEffect: 'move',
    };
    const dropEvent = createTestDragEvent('drop', dataTransfer);

    act(() => {
      target.dispatchEvent(dropEvent);
    });

    expect(onDrop).not.toHaveBeenCalled();
  });

  it('stops drop-event propagation to ancestor drop targets when nested', () => {
    const outerOnDrop = vi.fn<(payload: TabDragPayload) => void>();
    const innerOnDrop = vi.fn<(payload: TabDragPayload) => void>();

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
            <div role="tab" tabIndex={-1} style={{ width: 100, height: 20 }} />
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

    const inner = requireValue(
      container.querySelector('[data-testid="inner"]'),
      'expected test value in dragCoordinator.test.tsx'
    );
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
        onDrop: () => undefined,
      });
      return (
        <div ref={captured.ref} data-testid="target" data-drag-over={captured.isDragOver}>
          <span data-testid="child-a">child a</span>
          <span data-testid="child-b">child b</span>
        </div>
      );
    }

    let beginDragRef: ((payload: TabDragPayload) => void) | null = null;
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
      requireValue(
        beginDragRef,
        'expected test value in dragCoordinator.test.tsx'
      )({ kind: 'cluster-tab', clusterId: 'c1' });
    });

    const target = requireValue(
      container.querySelector<HTMLElement>('[data-testid="target"]'),
      'expected test value in dragCoordinator.test.tsx'
    );
    const childA = requireValue(
      container.querySelector<HTMLElement>('[data-testid="child-a"]'),
      'expected test value in dragCoordinator.test.tsx'
    );
    const childB = requireValue(
      container.querySelector<HTMLElement>('[data-testid="child-b"]'),
      'expected test value in dragCoordinator.test.tsx'
    );

    const dataTransfer = {
      getData: vi.fn(() => JSON.stringify({ kind: 'cluster-tab', clusterId: 'c1' })),
      types: [TAB_DRAG_DATA_TYPE],
      dropEffect: 'move',
    };

    // Enter the target initially.
    const dragEnter = createTestDragEvent('dragenter', dataTransfer);
    act(() => {
      target.dispatchEvent(dragEnter);
    });

    expect(target.getAttribute('data-drag-over')).toBe('true');

    // Cursor moves from target into child A. dragleave fires with relatedTarget=childA.
    const leaveToChildA = createTestDragEvent('dragleave', dataTransfer, childA);
    act(() => {
      target.dispatchEvent(leaveToChildA);
    });

    // The hook should have ignored that leave because childA is a descendant.
    expect(target.getAttribute('data-drag-over')).toBe('true');

    // Cursor moves from child A to child B (still inside target). Same behavior.
    const leaveAtoB = createTestDragEvent('dragleave', dataTransfer, childB);
    act(() => {
      target.dispatchEvent(leaveAtoB);
    });

    expect(target.getAttribute('data-drag-over')).toBe('true');

    // Cursor leaves the target entirely (relatedTarget is some unrelated element).
    const unrelated = document.createElement('div');
    document.body.appendChild(unrelated);
    const leaveToOutside = createTestDragEvent('dragleave', dataTransfer, unrelated);
    act(() => {
      target.dispatchEvent(leaveToOutside);
    });

    expect(target.getAttribute('data-drag-over')).toBe('false');

    unrelated.remove();
  });
});
