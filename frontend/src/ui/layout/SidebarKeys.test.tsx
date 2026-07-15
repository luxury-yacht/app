/**
 * frontend/src/ui/layout/SidebarKeys.test.tsx
 *
 * Test suite for SidebarKeys.
 * Covers key behaviors and edge cases for SidebarKeys.
 */

import { KeyboardProvider } from '@ui/shortcuts/context';
import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import {
  describeElementTarget,
  getFocusableSidebarItems,
  type SidebarCursorTarget,
  targetsAreEqual,
  useSidebarKeyboardControls,
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
        { kind: 'namespace-view', namespace: 'dev', view: 'workloads' },
        { kind: 'namespace-view', namespace: 'dev', view: 'workloads' }
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
        { kind: 'global-view', view: 'fleet' },
        { kind: 'global-view', view: 'fleet' }
      )
    ).toBe(true);
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
          'data-sidebar-target-kind': 'global-view',
          'data-sidebar-target-view': 'global-namespaces',
        })
      )
    ).toEqual({ kind: 'global-view', view: 'global-namespaces' });
    expect(
      describeElementTarget(
        buildTargetElement({
          'data-sidebar-target-kind': 'namespace-view',
          'data-sidebar-target-namespace': 'dev',
          'data-sidebar-target-view': 'workloads',
        })
      )
    ).toEqual({ kind: 'namespace-view', namespace: 'dev', view: 'workloads' });
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

  it('yields no target for dataset view values outside the view unions', () => {
    // The dataset round-trips through the DOM as strings; a value that is not
    // a member of the view unions must not become a cursor target.
    expect(
      describeElementTarget(
        buildTargetElement({
          'data-sidebar-target-kind': 'cluster-view',
          'data-sidebar-target-view': 'not-a-view',
        })
      )
    ).toBeNull();
    expect(
      describeElementTarget(
        buildTargetElement({
          'data-sidebar-target-kind': 'global-view',
          'data-sidebar-target-view': 'nodes',
        })
      )
    ).toBeNull();
    expect(
      describeElementTarget(
        buildTargetElement({
          'data-sidebar-target-kind': 'namespace-view',
          'data-sidebar-target-namespace': 'dev',
          'data-sidebar-target-view': 'not-a-view',
        })
      )
    ).toBeNull();
  });

  it('excludes items inside hidden sidebar sections from keyboard navigation', () => {
    const sidebar = document.createElement('div');
    const visibleItem = document.createElement('button');
    visibleItem.dataset.sidebarFocusable = 'true';
    const hiddenSection = document.createElement('section');
    hiddenSection.hidden = true;
    const hiddenItem = document.createElement('button');
    hiddenItem.dataset.sidebarFocusable = 'true';
    hiddenSection.appendChild(hiddenItem);
    sidebar.append(visibleItem, hiddenSection);

    expect(getFocusableSidebarItems(sidebar)).toEqual([visibleItem]);
  });
});

type HarnessHandle = ReturnType<typeof useSidebarKeyboardControls> & {
  sidebarRef: React.RefObject<HTMLDivElement | null>;
  setCursorPreview: (target: SidebarCursorTarget | null) => void;
  setPendingSelection: (target: SidebarCursorTarget | null) => void;
  setSelectionTarget: (target: SidebarCursorTarget | null) => void;
};

interface TestHarnessProps {
  collapsed?: boolean;
  selectionTarget?: SidebarCursorTarget | null;
  pendingSelection?: SidebarCursorTarget | null;
  onClearPreview?: () => void;
  onNamespaceViewClick?: () => void;
  ref?: React.Ref<HarnessHandle>;
}

const TestHarness = ({
  collapsed = false,
  selectionTarget = null,
  pendingSelection = null,
  onClearPreview,
  onNamespaceViewClick,
  ref,
}: TestHarnessProps) => {
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
    <button
      key={JSON.stringify(target)}
      type="button"
      tabIndex={-1}
      data-sidebar-focusable="true"
      {...extra}
      className={api.buildSidebarItemClassName(base, target)}
      onClick={onClick}
    >
      {JSON.stringify(target)}
    </button>
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
        { kind: 'namespace-view', namespace: 'dev', view: 'workloads' },
        {
          'data-sidebar-target-kind': 'namespace-view',
          'data-sidebar-target-namespace': 'dev',
          'data-sidebar-target-view': 'workloads',
        },
        onNamespaceViewClick
      )}
    </div>
  );
};

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

  it('leaves keys to a focused input inside the sidebar', async () => {
    // The inline namespace-scope editor lives inside the sidebar: while it
    // has focus the navigation scope must not claim Enter/arrows — a claimed
    // Enter gets its default prevented and macOS beeps for the key the
    // input needed (docs/frontend/keyboard.md: preserve native editing).
    const { container, cleanup } = renderHarness({
      selectionTarget: { kind: 'overview' },
    });
    const sidebarRoot = requireValue(
      requireValue(
        container.querySelector<HTMLElement>('[data-sidebar-target-kind="overview"]'),
        'expected test value in SidebarKeys.test.tsx'
      ).parentElement,
      'expected test value in SidebarKeys.test.tsx'
    );
    const input = document.createElement('input');
    sidebarRoot.appendChild(input);
    input.focus();

    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      input.dispatchEvent(enter);
      await Promise.resolve();
    });
    expect(enter.defaultPrevented).toBe(false);

    const arrow = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      input.dispatchEvent(arrow);
      await Promise.resolve();
    });
    expect(arrow.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(input);

    input.remove();
    cleanup();
  });

  it('marks active/preview items', () => {
    const { ref, container, cleanup } = renderHarness({
      selectionTarget: { kind: 'overview' },
    });
    const overview = requireValue(
      container.querySelector('[data-sidebar-target-kind="overview"]'),
      'expected test value in SidebarKeys.test.tsx'
    );
    expect(overview.className).toContain('active');
    act(() => {
      ref.current?.setCursorPreview({ kind: 'cluster-view', view: 'nodes' });
    });
    const nodes = requireValue(
      container.querySelector('[data-sidebar-target-view="nodes"]'),
      'expected test value in SidebarKeys.test.tsx'
    );
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
    const workloadsTarget: SidebarCursorTarget = {
      kind: 'namespace-view',
      namespace: 'dev',
      view: 'workloads',
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

    const sidebar = requireValue(
      container.querySelector('[data-testid="sidebar"]'),
      'expected test value in SidebarKeys.test.tsx'
    );
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
    const nodes = requireValue(
      container.querySelector('[data-sidebar-target-view="nodes"]'),
      'expected test value in SidebarKeys.test.tsx'
    );
    expect(nodes.className).toContain('keyboard-preview');
    expect(ref.current?.isKeyboardNavActive).toBe(true);

    await fireKey('Home');
    expect(overview.className).toContain('keyboard-preview');

    const workloadsElement = container.querySelector(
      '[data-sidebar-target-kind="namespace-view"][data-sidebar-target-view="workloads"]'
    ) as HTMLElement;
    await act(async () => {
      workloadsElement.focus();
      await Promise.resolve();
    });
    await fireKey('Enter');
    expect(ref.current?.getDisplaySelectionTarget()).toEqual(workloadsTarget);

    cleanup();
  });

  it('handles pointer movement and focus transitions', async () => {
    const onClearPreview = vi.fn();
    const { ref, container, cleanup } = renderHarness({
      selectionTarget: { kind: 'overview' },
      onClearPreview,
    });
    const sidebar = requireValue(
      container.querySelector('[data-testid="sidebar"]'),
      'expected test value in SidebarKeys.test.tsx'
    );
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
      view: 'workloads',
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
