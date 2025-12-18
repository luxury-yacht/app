import React from 'react';
import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useSidebarKeyboardControls,
  targetsAreEqual,
  describeElementTarget,
  type SidebarCursorTarget,
} from './SidebarKeys';

const useKeyboardNavigationScopeMock = vi.hoisted(() => vi.fn());

vi.mock('@ui/shortcuts', () => ({
  useKeyboardNavigationScope: (...args: unknown[]) => useKeyboardNavigationScopeMock(...args),
}));

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
    root.render(<TestHarness ref={ref} {...props} />);
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

describe('useSidebarKeyboardControls', () => {
  beforeEach(() => {
    useKeyboardNavigationScopeMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers keyboard scopes and marks active/preview items', () => {
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
    expect(useKeyboardNavigationScopeMock).toHaveBeenCalled();
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

  it('disables navigation when collapsed', () => {
    const { cleanup } = renderHarness({ collapsed: true });
    const scopeArgs = useKeyboardNavigationScopeMock.mock.calls[0][0];
    expect(scopeArgs.disabled).toBe(true);
    cleanup();
  });
});
