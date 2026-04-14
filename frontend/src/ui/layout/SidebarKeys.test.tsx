/**
 * frontend/src/ui/layout/SidebarKeys.test.tsx
 *
 * Test suite for SidebarKeys.
 * Covers key behaviors and edge cases for SidebarKeys.
 */

import React from 'react';
import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider } from '@ui/shortcuts/context';
import {
  useSidebarKeyboardControls,
  targetsAreEqual,
  describeElementTarget,
  type SidebarCursorTarget,
} from './SidebarKeys';

const buildTargetElement = (attrs: Record<string, string>) => {
  const element = document.createElement('div');
  Object.entries(attrs).forEach(([key, value]) => {
    element.setAttribute(key, value);
  });
  return element;
};

describe('Sidebar keyboard helpers', () => {
  it('compares cursor targets correctly', () => {
    expect(
      targetsAreEqual(
        { kind: 'namespace-view', namespace: 'dev', view: 'pods' },
        { kind: 'namespace-view', namespace: 'dev', view: 'pods' }
      )
    ).toBe(true);
    expect(
      targetsAreEqual(
        { kind: 'cluster-view', view: 'nodes' },
        { kind: 'cluster-view', view: 'storage' }
      )
    ).toBe(false);
    expect(
      targetsAreEqual(
        { kind: 'cluster-toggle', id: 'resources' },
        { kind: 'cluster-toggle', id: 'resources' }
      )
    ).toBe(true);
    expect(targetsAreEqual({ kind: 'overview' }, null)).toBe(false);
  });

  it('describes sidebar targets from DOM nodes', () => {
    expect(
      describeElementTarget(buildTargetElement({ 'data-sidebar-target-kind': 'overview' }))
    ).toEqual({ kind: 'overview' });
    expect(
      describeElementTarget(
        buildTargetElement({
          'data-sidebar-target-kind': 'cluster-view',
          'data-sidebar-target-view': 'nodes',
        })
      )
    ).toEqual({ kind: 'cluster-view', view: 'nodes' });
    expect(
      describeElementTarget(
        buildTargetElement({
          'data-sidebar-target-kind': 'namespace-view',
          'data-sidebar-target-namespace': 'dev',
          'data-sidebar-target-view': 'pods',
        })
      )
    ).toEqual({ kind: 'namespace-view', namespace: 'dev', view: 'pods' });
    expect(
      describeElementTarget(
        buildTargetElement({
          'data-sidebar-target-kind': 'namespace-toggle',
          'data-sidebar-target-namespace': 'dev',
        })
      )
    ).toEqual({ kind: 'namespace-toggle', namespace: 'dev' });
    expect(
      describeElementTarget(
        buildTargetElement({
          'data-sidebar-target-kind': 'cluster-toggle',
          'data-sidebar-target-id': 'resources',
        })
      )
    ).toEqual({ kind: 'cluster-toggle', id: 'resources' });
  });
});

type HarnessHandle = ReturnType<typeof useSidebarKeyboardControls> & {
  sidebarRef: React.RefObject<HTMLDivElement | null>;
  setCursorPreview: (target: SidebarCursorTarget | null) => void;
  setPendingSelection: (target: SidebarCursorTarget | null) => void;
  setSelectionTarget: (target: SidebarCursorTarget | null) => void;
};

const TestHarness = React.forwardRef<
  HarnessHandle,
  {
    collapsed?: boolean;
    selectionTarget?: SidebarCursorTarget | null;
    pendingSelection?: SidebarCursorTarget | null;
    onClearPreview?: () => void;
    onNamespaceViewClick?: () => void;
  }
>(
  (
    {
      collapsed = false,
      selectionTarget = null,
      pendingSelection = null,
      onClearPreview,
      onNamespaceViewClick,
    },
    ref
  ) => {
    const sidebarRef = React.useRef<HTMLDivElement | null>(null);
    const keyboardCursorIndexRef = React.useRef<number | null>(null);
    const pendingCommitRef = React.useRef<SidebarCursorTarget | null>(null);
    const keyboardActivationRef = React.useRef(false);
    const [cursorPreview, setCursorPreview] = React.useState<SidebarCursorTarget | null>(null);
    const [pendingSelectionState, setPendingSelection] = React.useState<SidebarCursorTarget | null>(
      pendingSelection
    );
    const selectionTargetRef = React.useRef<SidebarCursorTarget | null>(selectionTarget);
    React.useEffect(() => {
      selectionTargetRef.current = selectionTarget;
    }, [selectionTarget]);

    const clearKeyboardPreview = React.useCallback(() => {
      setCursorPreview(null);
      onClearPreview?.();
    }, [onClearPreview]);

    const api = useSidebarKeyboardControls({
      sidebarRef,
      isCollapsed: collapsed,
      cursorPreview,
      setCursorPreview,
      pendingSelection: pendingSelectionState,
      setPendingSelection,
      keyboardCursorIndexRef,
      pendingCommitRef,
      keyboardActivationRef,
      clearKeyboardPreview,
      getCurrentSelectionTarget: () => selectionTargetRef.current,
    });

    React.useImperativeHandle(ref, () => ({
      ...api,
      sidebarRef,
      setCursorPreview,
      setPendingSelection,
      setSelectionTarget: (target: SidebarCursorTarget | null) => {
        selectionTargetRef.current = target;
      },
    }));

    const buildItem = (
      base: string[],
      target: SidebarCursorTarget,
      extra: Record<string, string>,
      onClick?: () => void
    ) => (
      <div
        key={JSON.stringify(target)}
        tabIndex={-1}
        data-sidebar-focusable="true"
        {...extra}
        className={api.buildSidebarItemClassName(base, target)}
        onClick={onClick}
      >
        {JSON.stringify(target)}
      </div>
    );

    return (
      <div ref={sidebarRef} data-testid="sidebar">
        {buildItem(
          ['sidebar-item'],
          { kind: 'overview' },
          { 'data-sidebar-target-kind': 'overview' }
        )}
        {buildItem(
          ['sidebar-item'],
          { kind: 'cluster-view', view: 'nodes' },
          { 'data-sidebar-target-kind': 'cluster-view', 'data-sidebar-target-view': 'nodes' }
        )}
        {buildItem(
          ['sidebar-item'],
          { kind: 'namespace-toggle', namespace: 'dev' },
          { 'data-sidebar-target-kind': 'namespace-toggle', 'data-sidebar-target-namespace': 'dev' }
        )}
        {buildItem(
          ['sidebar-item'],
          { kind: 'namespace-view', namespace: 'dev', view: 'pods' },
          {
            'data-sidebar-target-kind': 'namespace-view',
            'data-sidebar-target-namespace': 'dev',
            'data-sidebar-target-view': 'pods',
          },
          onNamespaceViewClick
        )}
      </div>
    );
  }
);

const renderHarness = (props?: React.ComponentProps<typeof TestHarness>) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);
  const ref = React.createRef<HarnessHandle>();
  act(() => {
    root.render(
      <KeyboardProvider>
        <TestHarness ref={ref} {...props} />
      </KeyboardProvider>
    );
  });
  return {
    container,
    ref,
    cleanup: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
};

const dispatchTab = async (element: HTMLElement, shiftKey = false) => {
  await act(async () => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey,
        bubbles: true,
        cancelable: true,
      })
    );
    await Promise.resolve();
  });
};

describe('useSidebarKeyboardControls', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('marks active/preview items', () => {
    const { ref, container, cleanup } = renderHarness({
      selectionTarget: { kind: 'overview' },
    });
    const overview = container.querySelector('[data-sidebar-target-kind="overview"]')!;
    expect(overview.className).toContain('active');
    act(() => {
      ref.current?.setCursorPreview({ kind: 'cluster-view', view: 'nodes' });
    });
    const nodes = container.querySelector('[data-sidebar-target-view="nodes"]')!;
    expect(nodes.className).toContain('keyboard-preview');
    cleanup();
  });

  it('does not capture tab entry from arbitrary outside focus', async () => {
    const { cleanup } = renderHarness({
      selectionTarget: { kind: 'overview' },
    });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    expect(document.activeElement).toBe(outside);

    await dispatchTab(outside);

    expect(document.activeElement).toBe(outside);

    outside.remove();
    cleanup();
  });

  it('tabs from the last header control into the current sidebar selection', async () => {
    const { container, cleanup } = renderHarness({
      selectionTarget: { kind: 'overview' },
    });
    const headerButton = document.createElement('button');
    headerButton.setAttribute('data-app-header-last-focusable', 'true');
    document.body.appendChild(headerButton);
    headerButton.focus();

    await dispatchTab(headerButton);

    expect(document.activeElement).toBe(
      container.querySelector('[data-sidebar-target-kind="overview"]')
    );

    headerButton.remove();
    cleanup();
  });

  it('does not intercept shift-tab on the last header control', async () => {
    const { cleanup } = renderHarness({
      selectionTarget: { kind: 'overview' },
    });

    const headerButton = document.createElement('button');
    headerButton.type = 'button';
    headerButton.textContent = 'Settings';
    headerButton.setAttribute('data-app-header-last-focusable', 'true');
    document.body.appendChild(headerButton);
    headerButton.focus();

    await dispatchTab(headerButton, true);

    expect(document.activeElement).toBe(headerButton);

    headerButton.remove();
    cleanup();
  });

  it('shift-tabs from the sidebar back to the last header control', async () => {
    const { container, cleanup } = renderHarness({
      selectionTarget: { kind: 'overview' },
    });
    const headerButton = document.createElement('button');
    headerButton.setAttribute('data-app-header-last-focusable', 'true');
    document.body.appendChild(headerButton);
    const overview = container.querySelector(
      '[data-sidebar-target-kind="overview"]'
    ) as HTMLElement;
    overview.focus();

    await dispatchTab(overview, true);

    expect((document.activeElement as HTMLElement | null)?.dataset.appHeaderLastFocusable).toBe(
      'true'
    );

    headerButton.remove();
    cleanup();
  });

  it('shift-tabs from the sidebar back to the active cluster tab before the header', async () => {
    const { container, cleanup } = renderHarness({
      selectionTarget: { kind: 'overview' },
    });
    const headerButton = document.createElement('button');
    headerButton.setAttribute('data-app-header-last-focusable', 'true');
    document.body.appendChild(headerButton);
    const clusterTabsWrapper = document.createElement('div');
    clusterTabsWrapper.className = 'cluster-tabs-wrapper';
    const activeClusterTab = document.createElement('div');
    activeClusterTab.setAttribute('role', 'tab');
    activeClusterTab.setAttribute('tabindex', '0');
    clusterTabsWrapper.appendChild(activeClusterTab);
    document.body.appendChild(clusterTabsWrapper);
    const overview = container.querySelector(
      '[data-sidebar-target-kind="overview"]'
    ) as HTMLElement;
    overview.focus();

    await dispatchTab(overview, true);

    expect(document.activeElement).toBe(activeClusterTab);

    clusterTabsWrapper.remove();
    headerButton.remove();
    cleanup();
  });

  it('focuses selected items and bubbles pending selection', async () => {
    const podsTarget: SidebarCursorTarget = {
      kind: 'namespace-view',
      namespace: 'dev',
      view: 'pods',
    };
    const { ref, container, cleanup } = renderHarness({
      selectionTarget: { kind: 'overview' },
    });
    const overview = container.querySelector(
      '[data-sidebar-target-kind="overview"]'
    ) as HTMLElement;
    await act(async () => {
      ref.current?.focusSelectedSidebarItem();
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(overview);

    const sidebar = container.querySelector('[data-testid="sidebar"]')!;
    await act(async () => {
      overview.focus();
      await Promise.resolve();
    });
    const fireKey = async (key: string) => {
      await act(async () => {
        sidebar.dispatchEvent(
          new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
        );
        await Promise.resolve();
      });
    };
    await fireKey('ArrowDown');
    const nodes = container.querySelector('[data-sidebar-target-view="nodes"]')!;
    expect(nodes.className).toContain('keyboard-preview');
    expect(ref.current?.isKeyboardNavActive).toBe(true);

    await fireKey('Home');
    expect(overview.className).toContain('keyboard-preview');

    const podsElement = container.querySelector(
      '[data-sidebar-target-kind="namespace-view"][data-sidebar-target-view="pods"]'
    ) as HTMLElement;
    await act(async () => {
      podsElement.focus();
      await Promise.resolve();
    });
    await fireKey('Enter');
    expect(ref.current?.getDisplaySelectionTarget()).toEqual(podsTarget);

    cleanup();
  });

  it('handles pointer movement and focus transitions', async () => {
    const onClearPreview = vi.fn();
    const { ref, container, cleanup } = renderHarness({
      selectionTarget: { kind: 'overview' },
      onClearPreview,
    });
    const sidebar = container.querySelector('[data-testid="sidebar"]')!;
    const overview = container.querySelector(
      '[data-sidebar-target-kind="overview"]'
    ) as HTMLElement;
    await act(async () => {
      overview.focus();
      await Promise.resolve();
    });
    await act(async () => {
      sidebar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      await Promise.resolve();
    });
    expect(ref.current?.isKeyboardNavActive).toBe(true);
    await act(async () => {
      sidebar.dispatchEvent(new Event('pointermove', { bubbles: true }));
      await Promise.resolve();
    });
    expect(ref.current?.isKeyboardNavActive).toBe(false);

    const outside = document.createElement('button');
    document.body.appendChild(outside);
    const focusOut = new FocusEvent('focusout', { bubbles: true, relatedTarget: outside });
    await act(async () => {
      sidebar.dispatchEvent(focusOut);
      await Promise.resolve();
    });
    expect(onClearPreview).toHaveBeenCalled();
    await act(async () => {
      sidebar.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });
    expect(document.activeElement).toBe(
      container.querySelector('[data-sidebar-target-kind="overview"]')
    );
    outside.remove();
    cleanup();
  });

  it('clears pending selection when it matches the current selection', async () => {
    const selection = {
      kind: 'namespace-view',
      namespace: 'dev',
      view: 'pods',
    } as SidebarCursorTarget;
    const { ref, cleanup } = renderHarness({
      selectionTarget: selection,
      pendingSelection: selection,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(ref.current?.getDisplaySelectionTarget()).toEqual(selection);
    cleanup();
  });

  it('does not capture tab entry when collapsed', async () => {
    const { cleanup } = renderHarness({
      collapsed: true,
      selectionTarget: { kind: 'overview' },
    });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    await dispatchTab(outside);

    expect(document.activeElement).toBe(outside);
    outside.remove();
    cleanup();
  });
});
