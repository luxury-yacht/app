# Shared Tabs Component — Phase 2 Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git policy:** Per project `AGENTS.md`, NEVER run state-modifying git commands without explicit user direction. Each task ends with "Report task complete and wait for user review" instead of an automatic commit. The user commits at appropriate boundaries.

**Goal:** Migrate the four production tab consumers (`ObjectPanelTabs`, the `DiagnosticsPanel` inline tabs, `ClusterTabs`, and `DockableTabBar`) to use the shared `<Tabs>` component and drag coordinator from Phase 1, deleting the per-component duplicated markup/CSS in the process. At the end of this phase the shared component is the single source of truth for every tab strip in the app.

**Architecture:** Consumers migrate simplest → most complex so we validate the migration pattern on low-risk code before touching the dockable tab bar (which owns the most complex drag surface in the app). Before any consumer migrates, we add a small number of shared-component features needed to preserve existing production behavior (roving-tabindex opt-out, custom close icon, per-tab close aria-label). Each consumer migration deletes all local tab markup/CSS and replaces it with a `<Tabs>` call; wrapper components only retain consumer-specific logic (persistence, close confirmation modals, focus management, panel chrome).

**Tech Stack:** React 19, TypeScript, Vitest + jsdom, Storybook 10.

**Reference:**
- [`docs/plans/shared-tabs-component-design.md`](shared-tabs-component-design.md) — the authoritative component contract. Updated after Phase 1 to match actual implementation.
- [`docs/plans/shared-tabs-component-prototype-plan.md`](shared-tabs-component-prototype-plan.md) — the Phase 1 prototype plan (historical). Has a "Post-prototype revisions" block at the top listing behaviors that diverged from the design doc.

---

## Scope check

Four consumers in dependency order:

| # | Consumer | Complexity | Drag? | Close? | Custom Focus? |
|---|---|---|---|---|---|
| 1 | `ObjectPanelTabs.tsx` | minimal | no | no | yes (custom nav) |
| 2 | `DiagnosticsPanel.tsx` (inline tabs) | minimal | no | no | yes (custom nav) |
| 3 | `ClusterTabs.tsx` | moderate | yes (intra-strip) | yes (with modal) | no |
| 4 | `DockableTabBar.tsx` + `DockablePanelProvider.tsx` | high | yes (within + cross-strip) | yes | no |

This is one plan per consumer plus shared pre-work and cleanup. The consumers are independent, so they can be executed in any order after the pre-work, but the recommended order above validates the migration pattern on low-risk code first.

---

## Pre-work: Shared component additions

Before any consumer migrates, the shared `<Tabs>` component gains three small features required to preserve existing production behavior in ObjectPanel / Diagnostics / Cluster / Dockable. None of these change existing behavior when consumers don't opt in.

### Task 0: Pre-flight verification

**Files:**
- No changes.

- [ ] **Step 1:** Confirm `mage qc:prerelease` passes on the current `tabs-component` branch before starting. This is the baseline.

  Run:
  ```bash
  cd /Volumes/git/luxury-yacht/app && mage qc:prerelease
  ```

  Expected: clean exit.

- [ ] **Step 2:** Confirm the storybook dev server starts successfully.

  Run:
  ```bash
  cd /Volumes/git/luxury-yacht/app/frontend && npm run storybook &
  sleep 10 && curl -s -o /dev/null -w "%{http_code}" http://localhost:6006/ && echo
  lsof -ti tcp:6006 | xargs -r kill
  ```

  Expected: `200`.

- [ ] **Step 3:** Report task complete and wait for user review.

---

### Task 1: Add `disableRovingTabIndex` prop to `<Tabs>`

**Why:** ObjectPanel and Diagnostics implement their own focus management — they walk the DOM looking for `[data-object-panel-focusable="true"]` / `[data-diagnostics-focusable="true"]` and treat those elements as their focus scope. Their current tab markup sets `tabIndex={-1}` on every tab so the browser's native Tab key doesn't also land on them. The shared `<Tabs>` uses roving tabindex (active = 0, others = -1), which conflicts: the active tab would become a native Tab stop, competing with the custom focus system.

This prop lets those consumers opt OUT of roving tabindex, forcing every tab to `tabIndex=-1`. Keyboard arrow navigation and Enter/Space activation still work — they're driven by the component's own `handleKeyDown`, which only cares about element focus, not tabindex. The consumers' custom focus systems drive `element.focus()` explicitly.

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add to `Tabs.test.tsx` after the existing roving-tabindex tests:

  ```tsx
  it('forces every tab to tabIndex=-1 when disableRovingTabIndex is set', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
            { id: 'c', label: 'Gamma' },
          ]}
          activeId="b"
          onActivate={() => {}}
          aria-label="Test Tabs"
          disableRovingTabIndex
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(tabs.length).toBe(3);
    // aria-selected is unchanged (active tab still reports selected).
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    // But NO tab is a Tab-key stop.
    expect(tabs[0].tabIndex).toBe(-1);
    expect(tabs[1].tabIndex).toBe(-1);
    expect(tabs[2].tabIndex).toBe(-1);
  });
  ```

- [ ] **Step 2: Run test to verify it fails.**

  Run: `./node_modules/.bin/vitest run src/shared/components/tabs/Tabs.test.tsx -t "disableRovingTabIndex"`

  Expected: the new test fails because the prop doesn't exist yet.

- [ ] **Step 3: Add the prop to `TabsProps`.**

  In `Tabs.tsx`, add to the `TabsProps` interface after `dropInsertIndex`:

  ```tsx
  /**
   * When true, every tab gets `tabIndex={-1}` regardless of active state
   * or the fallback focus rule. Use this when the surrounding component
   * implements its own focus management and does not want the tabs to
   * participate in the browser's native Tab-key order. Keyboard arrow
   * navigation and Enter/Space activation still work — they're driven
   * by the component's own `handleKeyDown`, which moves focus
   * explicitly via `.focus()` regardless of tabindex.
   *
   * Default: false.
   */
  disableRovingTabIndex?: boolean;
  ```

- [ ] **Step 4: Destructure the prop with a default.**

  In `Tabs.tsx`, update the function signature:

  ```tsx
  export function Tabs({
    tabs,
    activeId,
    onActivate,
    'aria-label': ariaLabel,
    textTransform = 'none',
    tabSizing = 'fit',
    minTabWidth,
    maxTabWidth = 240,
    overflow = 'scroll',
    className: classNameProp,
    id,
    dropInsertIndex = null,
    disableRovingTabIndex = false,
  }: TabsProps) {
  ```

- [ ] **Step 5: Use the flag when computing per-tab tabIndex.**

  In `Tabs.tsx`, find the existing `isFocusStop` computation inside the `tabs.map((tab, index) => ...)` and update the `tabIndex` attribute on the `<div role="tab">`:

  ```tsx
  tabIndex={disableRovingTabIndex ? -1 : isFocusStop ? 0 : -1}
  ```

- [ ] **Step 6: Run the tests.**

  Run: `./node_modules/.bin/vitest run src/shared/components/tabs/`

  Expected: `Tests  48 passed (48)` — all existing tests plus the new one.

- [ ] **Step 7: Update the design doc.**

  In `docs/plans/shared-tabs-component-design.md`, add a new paragraph to the `TabsProps` block describing `disableRovingTabIndex`, and a note in the "Behavior contracts → Keyboard" section explaining the opt-out.

- [ ] **Step 8:** Report task complete and wait for user review.

---

### Task 1a: Teach `useTabDropTarget` to stop drop-event propagation

**Why:** `useTabDropTarget`'s internal `handleDrop` currently calls `event.preventDefault()` before invoking `onDrop`, but it does NOT call `event.stopPropagation()`. Native HTML5 `drop` events bubble up the DOM just like regular events, so if a consumer nests one drop target inside another — for example, a per-bar drop target inside a container-level empty-space drop target — a single drop fires BOTH the inner and outer handlers. For the Dockable migration, that means a normal tab reorder would also be interpreted as an empty-space drop and would spawn a spurious new floating group. We need an opt-in mode that calls `stopPropagation` after a successful handled drop so nested targets are not triggered.

`preventDefault` and `stopPropagation` are distinct: `preventDefault` tells the browser "don't do the default drop behavior" (navigate to a file, etc.); `stopPropagation` tells the browser "don't let this event bubble to ancestors." Both are needed for nested drop targets to work the way the Dockable migration needs.

**Files:**
- Modify: `frontend/src/shared/components/tabs/dragCoordinator/useTabDropTarget.ts`
- Modify: `frontend/src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add to `dragCoordinator.test.tsx`:

  ```tsx
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
  ```

- [ ] **Step 2: Run test to verify it fails.**

  Run: `./node_modules/.bin/vitest run src/shared/components/tabs/dragCoordinator/`

  Expected: the new test fails because `outerOnDrop` is called via bubbling — the inner handler doesn't currently stop propagation.

- [ ] **Step 3: Update `handleDrop` in `useTabDropTarget.ts`.**

  Find the `handleDrop` callback (around line 121 of `useTabDropTarget.ts`). Add a `stopPropagation()` call immediately after the `preventDefault()`:

  ```tsx
  const handleDrop = useCallback((event: DragEvent) => {
    const payload = readPayload(event);
    if (!payload || !acceptsRef.current.includes(payload.kind as K)) return;
    event.preventDefault();
    event.stopPropagation();
    const el = elementRef.current;
    const insertIndex = el ? computeDropInsertIndex(el, event.clientX) : 0;
    setIsDragOver(false);
    setDropInsertIndex(null);
    onDropRef.current(payload as Extract<TabDragPayload, { kind: K }>, event, insertIndex);
  }, []);
  ```

  Placement matters: `stopPropagation` comes BEFORE `onDrop` is invoked so that if the consumer's `onDrop` throws for any reason, the event is already marked as consumed and the ancestor still doesn't fire. (This is defensive — consumer callbacks shouldn't throw, but the defensive ordering costs nothing.)

  **Note on rejected drops:** if the payload isn't in `acceptsRef`, the early `return` fires and neither `preventDefault` nor `stopPropagation` is called, so the event bubbles normally and an ancestor target with a broader accepts list can still handle it. That's the intended behavior — only targets that actually consume the drop should block propagation.

  Also add `event.stopPropagation()` to `handleDragOver` (the hover-time handler) for symmetry — otherwise the ancestor target's `dragover` handler fires too, flickering its `isDragOver` state on/off as the cursor moves over the inner target. Place it after `preventDefault()` in that handler too.

- [ ] **Step 4: Run the tests.**

  Run: `./node_modules/.bin/vitest run src/shared/components/tabs/dragCoordinator/`

  Expected: new nested-target test passes; all existing drag coordinator tests still pass (stopping propagation is additive and doesn't affect single-target behavior).

- [ ] **Step 5: Update the design doc.**

  In `docs/plans/shared-tabs-component-design.md`, add a note under the drag coordinator / `useTabDropTarget` section explaining that drop events stop propagating at the first consuming target. Reference the Dockable migration's container-level empty-space target as the primary use case.

- [ ] **Step 6:** Report task complete and wait for user review.

---

### Task 1b: Add `useTabDragSourceFactory` hook

**Why:** The existing `useTabDragSource` hook calls `useContext(TabDragContext)` internally, which means consumers with a dynamic-length tab list can't call it inside `.map()` — that would violate the rules of hooks. The Phase 1 preview stories worked around this by unrolling N hook calls at the top level of their component bodies, capped at a small constant (5 tabs per strip).

Carrying that cap into production is a regression — the current `ClusterTabs` and `DockableTabBar` implementations have no upper limit on draggable tab count. Users routinely open 20+ kubeconfig contexts and can legitimately end up with large numbers of dockable panels in a single strip. A hardcoded cap of 16 (or any other number) silently truncates drag support beyond that point, which is exactly the kind of incomplete shortcut AGENTS.md forbids.

The correct fix is to change the hook API so that the `useContext` call happens **once per consumer**, and the per-tab drag-source props are produced by a plain factory function that's legal to call inside `.map()`. This supports any number of tabs without unrolling and without rules-of-hooks workarounds.

**Files:**
- Modify: `frontend/src/shared/components/tabs/dragCoordinator/useTabDragSource.ts`
- Modify: `frontend/src/shared/components/tabs/dragCoordinator/index.ts`
- Modify: `frontend/src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx`

- [x] **Step 1: Write failing tests.**

  Add to `dragCoordinator.test.tsx`:

  ```tsx
  it('useTabDragSourceFactory returns a stable-per-render factory usable in .map()', () => {
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
  ```

  (Import `useTabDragSourceFactory` and `TabDragProvider` at the top of the test file.)

- [x] **Step 2: Run test to verify it fails.**

  Run: `./node_modules/.bin/vitest run src/shared/components/tabs/dragCoordinator/`

  Expected: `useTabDragSourceFactory is not defined` or similar.

- [x] **Step 3: Refactor `useTabDragSource.ts`.**

  Replace the file body with:

  ```tsx
  /**
   * frontend/src/shared/components/tabs/dragCoordinator/useTabDragSource.ts
   *
   * Source-side drag API. Two entry points:
   *
   *   • useTabDragSource(payload, options)  — hook API for the simple
   *     case where a component declares a single draggable element.
   *     Calls useContext internally.
   *
   *   • useTabDragSourceFactory()           — hook API for consumers
   *     that build per-tab drag props inside `.map()` over a
   *     dynamic-length tabs array. Returns a plain factory function;
   *     the factory is safe to call inside loops because it contains
   *     no hook calls. Calls useContext exactly ONCE per consumer
   *     render regardless of tab count.
   *
   * Both entry points ultimately delegate to the same
   * `createTabDragSourceProps` pure factory, which is also exported
   * for unit-testing and for consumers that prefer to manage the
   * context themselves.
   */
  import { useContext, type DragEventHandler } from 'react';

  import { TabDragContext } from './TabDragProvider';
  import { TAB_DRAG_DATA_TYPE, type TabDragPayload } from './types';

  export interface UseTabDragSourceOptions {
    /**
     * Optional custom drag preview. Invoked synchronously at dragstart.
     * Return the element + cursor offset to use as the drag image, or
     * null to fall back to the browser's default (a translucent copy of
     * the source element).
     *
     * The element MUST already be in the DOM when this is called — the
     * browser screenshots it once and never re-reads it.
     */
    getDragImage?: () => { element: HTMLElement; offsetX: number; offsetY: number } | null;
  }

  export interface TabDragSourceProps {
    draggable: boolean;
    onDragStart?: DragEventHandler<HTMLElement>;
    onDragEnd?: DragEventHandler<HTMLElement>;
  }

  /**
   * Pure factory — builds the drag-source event handlers for one tab
   * given an already-resolved TabDragContext. No hooks inside, so this
   * can be called anywhere (including inside loops).
   */
  export function createTabDragSourceProps(
    payload: TabDragPayload | null,
    beginDrag: (payload: TabDragPayload) => void,
    endDrag: () => void,
    options?: UseTabDragSourceOptions
  ): TabDragSourceProps {
    if (!payload) {
      return { draggable: false };
    }
    return {
      draggable: true,
      onDragStart: (event) => {
        event.dataTransfer.setData(TAB_DRAG_DATA_TYPE, JSON.stringify(payload));
        event.dataTransfer.effectAllowed = 'move';
        if (options?.getDragImage) {
          const result = options.getDragImage();
          if (result) {
            event.dataTransfer.setDragImage(result.element, result.offsetX, result.offsetY);
          }
        }
        beginDrag(payload);
      },
      onDragEnd: () => {
        endDrag();
      },
    };
  }

  /**
   * Hook variant for single-source consumers (one draggable element per
   * component). Calls useContext internally. For dynamic-length tab
   * lists, use `useTabDragSourceFactory` instead.
   */
  export function useTabDragSource(
    payload: TabDragPayload | null,
    options?: UseTabDragSourceOptions
  ): TabDragSourceProps {
    const { beginDrag, endDrag } = useContext(TabDragContext);
    return createTabDragSourceProps(payload, beginDrag, endDrag, options);
  }

  /**
   * Hook variant for consumers that render an unbounded number of
   * draggable tabs. Calls useContext exactly once, then returns a plain
   * factory the consumer calls per tab during render. The returned
   * factory closes over the current context values, so it's safe to
   * call inside `.map()` without violating the rules of hooks.
   *
   * Typical usage:
   *
   *   const makeDragSource = useTabDragSourceFactory();
   *   const tabDescriptors = tabs.map((tab) => ({
   *     id: tab.id,
   *     label: tab.label,
   *     extraProps: makeDragSource({ kind: 'cluster-tab', clusterId: tab.id }),
   *   }));
   */
  export function useTabDragSourceFactory(): (
    payload: TabDragPayload | null,
    options?: UseTabDragSourceOptions
  ) => TabDragSourceProps {
    const { beginDrag, endDrag } = useContext(TabDragContext);
    return (payload, options) =>
      createTabDragSourceProps(payload, beginDrag, endDrag, options);
  }
  ```

- [x] **Step 4: Update the barrel export.**

  In `frontend/src/shared/components/tabs/dragCoordinator/index.ts`, add exports for the new names:

  ```tsx
  export {
    useTabDragSource,
    useTabDragSourceFactory,
    createTabDragSourceProps,
    type UseTabDragSourceOptions,
    type TabDragSourceProps,
  } from './useTabDragSource';
  ```

- [x] **Step 5: Run the tests.**

  Run: `./node_modules/.bin/vitest run src/shared/components/tabs/dragCoordinator/`

  Expected: all existing drag-coordinator tests pass plus the new one.

- [x] **Step 6: Update the design doc.**

  In `docs/plans/shared-tabs-component-design.md`, add a note under the drag coordinator section explaining the two hook variants and when to use each. Link the factory variant to the consumer migration sections below.

- [x] **Step 7:** Report task complete and wait for user review.

---

### Task 2: Add `closeIcon` and `closeAriaLabel` to `TabDescriptor`

**Why:** Cluster tabs and dockable tabs both render a close button with a small SVG close icon (`<CloseIcon width={10} height={10} />`) plus a per-tab aria label like `"Close ${tabLabel}"`. The shared `<Tabs>` currently hardcodes a plain `×` text character and `aria-label="Close"`. Migrating without these additions would downgrade both the visual and the screen-reader experience. Both fields are per-tab options on `TabDescriptor`.

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [x] **Step 1: Write the failing tests.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('renders a custom closeIcon node when a descriptor provides one', () => {
    const customIcon = <span data-testid="custom-close">✕</span>;
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha', onClose: () => {}, closeIcon: customIcon }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });
    const closeButton = container.querySelector('.tab-item__close');
    expect(closeButton?.querySelector('[data-testid="custom-close"]')).toBeTruthy();
    // Plain '×' fallback is NOT rendered when a custom icon is provided.
    expect(closeButton?.textContent).not.toBe('×');
  });

  it('uses a per-tab closeAriaLabel when provided, falling back to "Close"', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha', onClose: () => {}, closeAriaLabel: 'Close Alpha tab' },
            { id: 'b', label: 'Beta', onClose: () => {} },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });
    const closeButtons = container.querySelectorAll('.tab-item__close');
    expect(closeButtons[0].getAttribute('aria-label')).toBe('Close Alpha tab');
    expect(closeButtons[1].getAttribute('aria-label')).toBe('Close');
  });
  ```

- [x] **Step 2: Run tests to verify they fail.**

  Run: `./node_modules/.bin/vitest run src/shared/components/tabs/Tabs.test.tsx -t "closeIcon|closeAriaLabel"`

  Expected: both tests fail (fields don't exist yet).

- [x] **Step 3: Extend `TabDescriptor`.**

  In `Tabs.tsx`, add two optional fields:

  ```tsx
  export interface TabDescriptor {
    id: string;
    label: ReactNode;
    leading?: ReactNode;
    onClose?: () => void;
    /**
     * Optional custom content for the close button. Default is a plain
     * `×` text character. Pass a ReactNode (e.g. an SVG icon component)
     * when the consumer needs its own visual.
     */
    closeIcon?: ReactNode;
    /**
     * Optional aria-label override for the close button. Defaults to
     * `"Close"`. Per-tab labels like `"Close my-context-name"` are more
     * informative for screen reader users and should be preferred when
     * the tab label is user-facing text.
     */
    closeAriaLabel?: string;
    disabled?: boolean;
    ariaControls?: string;
    ariaLabel?: string;
    extraProps?: HTMLAttributes<HTMLElement>;
  }
  ```

- [x] **Step 4: Use the new fields in the close-button render.**

  In `Tabs.tsx`, find the existing close-button JSX inside the tab map and replace it:

  ```tsx
  {tab.onClose && (
    <button
      type="button"
      className="tab-item__close"
      aria-label={tab.closeAriaLabel ?? 'Close'}
      tabIndex={-1}
      onClick={(event) => {
        event.stopPropagation();
        tab.onClose?.();
      }}
    >
      {tab.closeIcon ?? '×'}
    </button>
  )}
  ```

- [x] **Step 5: Run the tests.**

  Run: `./node_modules/.bin/vitest run src/shared/components/tabs/`

  Expected: `Tests  50 passed (50)`.

- [x] **Step 6: Update the design doc.**

  In `docs/plans/shared-tabs-component-design.md`, add `closeIcon?: ReactNode` and `closeAriaLabel?: string` to the `TabDescriptor` block with the same descriptions as above.

- [x] **Step 7:** Report task complete and wait for user review.

---

### Task 2b: Mount `TabDragProvider` at the app root

**Why:** Both drag-capable consumers (`ClusterTabs` and `DockableTabBar`) need to call `useTabDragSourceFactory` and `useTabDropTarget`, which read from `TabDragContext`. That context is supplied by `<TabDragProvider>`. Today the app tree has:

```
<DockablePanelProvider>        (App.tsx:256)
  <AppContent>
    <AppLayout>
      <ClusterTabs />           (AppLayout.tsx:182)
      <main>...dockable panels...</main>
    </AppLayout>
  </AppContent>
</DockablePanelProvider>
```

`ClusterTabs` is rendered INSIDE the `DockablePanelProvider` subtree, not outside it. That means a single `TabDragProvider` placed high enough in `App.tsx` covers both consumers — there's no need for either consumer to wrap its own local scope. Doing so would create nested providers (inner one shadowing the outer) and pointlessly split the drag state into isolated coordinator scopes.

The provider is fully inert when no consumers use it — it just sets up context state (useState, useRef, useCallback) and does not attach any document listeners unless an `onTearOff` prop is passed. Mounting it early in the migration is safe: it does nothing until Tasks 7 and 8 actually call the hooks.

**Files:**
- Modify: `frontend/src/App.tsx`

- [x] **Step 1: Mount the provider around `DockablePanelProvider`.**

  In `frontend/src/App.tsx` around line 256, add the import and wrap:

  ```tsx
  import { TabDragProvider } from '@shared/components/tabs/dragCoordinator';

  // ... inside the provider tree ...
  <FavoritesProvider>
    <TabDragProvider>
      <DockablePanelProvider>
        <AppContent />
      </DockablePanelProvider>
    </TabDragProvider>
  </FavoritesProvider>
  ```

  Place `TabDragProvider` OUTSIDE `DockablePanelProvider` rather than inside. `DockablePanelProvider` doesn't need to read `TabDragContext` itself (only its `DockableTabBar` descendants do in Task 8), and keeping the drag provider as an outer wrapper makes the intent clearer: drag coordination is app-wide infrastructure, not dockable-specific.

- [x] **Step 2: Run tests.**

  ```bash
  cd /Volumes/git/luxury-yacht/app/frontend
  ./node_modules/.bin/tsc --noEmit --project .
  ./node_modules/.bin/vitest run
  ```

  Expected: clean. The new provider is inert — nothing should regress.

- [ ] **Step 3: Manual smoke test.**

  Boot the app (`mage run`). Verify nothing visibly changed. Cluster tabs, dockable panels, and object panels should behave exactly as before (all drag still goes through the legacy code paths since no consumer has migrated yet).

- [x] **Step 4:** Report task complete and wait for user review.

---

### Task 3: Run baseline QC

**Files:**
- No changes.

- [x] **Step 1:** Run the full quality gate.

  ```bash
  cd /Volumes/git/luxury-yacht/app && mage qc:prerelease
  ```

  Expected: clean exit with all tests / typecheck / lint passing.

- [x] **Step 2:** Report task complete and wait for user review.

---

## Consumer 1: ObjectPanelTabs

The simplest consumer. `ObjectPanelTabs.tsx` is 38 lines total: a `.map()` over a `tabs: ObjectPanelTabDefinition[]` prop, rendering each as a `<button className="tab-item">`. No close button, no drag, no overflow handling. The only per-tab decoration is `data-object-panel-focusable="true"` for the object panel's custom focus system.

**Files to read before starting:**
- `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx` — current implementation
- `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.test.tsx` — current tests
- `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx:610-625` — the focus-scope walker (`querySelectorAll('[data-object-panel-focusable="true"]')`) that consumes the data attribute
- `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.css:78-96` — the per-panel CSS overrides (`text-transform: uppercase` on tab items, `flex-shrink: 0` on the tab strip)

**Behaviors to preserve:**
- Tab label rendered in uppercase
- Tab items carry `data-object-panel-focusable="true"` so the custom focus walker finds them
- Tabs are NOT native Tab-key stops (they use `tabIndex={-1}` today — the new `disableRovingTabIndex` prop gives us the same)
- Clicking a tab calls `onSelect(tab.id)`
- Active tab gets the `tab-item--active` class (implicit — shared component does this)

**Behaviors intentionally dropped:**
- The wrapper `<div>` with no aria-label. The shared component adds `role="tablist"` + `aria-label="Object Panel Tabs"`, which is an accessibility improvement.
- No `role="tab"` on the buttons today (they're plain `<button>`). The shared component gives every tab `role="tab"`. Improvement.

### Task 4: Migrate `ObjectPanelTabs.tsx`

**Files:**
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx`
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.test.tsx`

- [x] **Step 1: Read the current tests.**

  Read `ObjectPanelTabs.test.tsx` in full. Note which behaviors are asserted — you'll either keep the assertions unchanged (they should still pass after the migration, since the shared component preserves the same DOM classes) or update them to match the shared component's output. The goal is to NOT lose any coverage during the migration.

- [x] **Step 2: Rewrite `ObjectPanelTabs.tsx`.**

  Replace the entire file with:

  ```tsx
  /**
   * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx
   *
   * Object Panel tab strip. Thin wrapper around the shared <Tabs>
   * component that adapts the panel's (tabs, activeTab, onSelect) props
   * to TabDescriptor form, opts out of the shared roving tabindex so
   * the panel's custom focus walker stays in control, and attaches the
   * `data-object-panel-focusable="true"` marker the walker needs.
   */
  import { useMemo } from 'react';

  import { Tabs, type TabDescriptor } from '@shared/components/tabs';
  import type { ViewType } from '@modules/object-panel/components/ObjectPanel/types';

  type ObjectPanelTabDefinition = {
    id: string;
    label: string;
  };

  interface ObjectPanelTabsProps {
    tabs: ObjectPanelTabDefinition[];
    activeTab: ViewType;
    onSelect: (tab: ViewType) => void;
  }

  export function ObjectPanelTabs({ tabs, activeTab, onSelect }: ObjectPanelTabsProps) {
    const descriptors = useMemo<TabDescriptor[]>(
      () =>
        tabs.map((tab) => ({
          id: tab.id,
          label: tab.label,
          // The object panel's custom focus walker locates focusable
          // scope elements via this data attribute. Pass it through via
          // extraProps so the shared component spreads it onto the
          // underlying <div role="tab">.
          extraProps: { 'data-object-panel-focusable': 'true' } as HTMLAttributes<HTMLElement>,
        })),
      [tabs]
    );

    return (
      <Tabs
        aria-label="Object Panel Tabs"
        tabs={descriptors}
        activeId={activeTab}
        onActivate={(id) => onSelect(id as ViewType)}
        textTransform="uppercase"
        disableRovingTabIndex
      />
    );
  }
  ```

  Add the `HTMLAttributes` import at the top:

  ```tsx
  import { useMemo, type HTMLAttributes } from 'react';
  ```

- [x] **Step 3: Update `ObjectPanelTabs.test.tsx`.**

  Walk each existing test. For each:
  - Queries by `.tab-item` continue to work — the shared component renders `.tab-item` on the tab roots.
  - Queries by `<button>` tag need to change to `[role="tab"]` because the shared component uses `<div role="tab">`.
  - `tabIndex` assertions change from `expect(tab.tabIndex).toBe(-1)` (already the case) to the same value (no change needed).
  - Click handlers: clicking on `.tab-item` still triggers `onActivate` which calls `onSelect` — no change.
  - Any text content assertions (`expect(tab.textContent).toBe('DETAILS')`) continue to work because uppercase is applied via CSS.

  Fix any that break after the migration. If an assertion no longer makes sense (e.g., it was testing local implementation detail that the shared component now owns), delete it and leave a comment explaining why.

- [x] **Step 4: Run the tests.**

  Run: `./node_modules/.bin/vitest run src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.test.tsx`

  Expected: all tests pass.

- [x] **Step 5: Delete dead CSS.**

  In `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.css`, delete the `.object-panel .tab-item, .object-panel-body .tab-item { text-transform: uppercase }` rule — the shared component now handles this via `textTransform="uppercase"` in the JSX.

  Keep the `.object-panel-body > .tab-strip { flex-shrink: 0 }` rule — that's a layout override for how the strip sits inside the panel body, not a tab styling override, and the shared component doesn't control parent-context flex behavior.

- [x] **Step 6: Run the broader ObjectPanel tests to catch regressions.**

  Run: `./node_modules/.bin/vitest run src/modules/object-panel/`

  Expected: all tests pass.

- [ ] **Step 7: Manual smoke test.**

  Run the app (`mage run`), open an object panel, click through each tab, verify:
  - Labels render in uppercase
  - Active tab gets the accent underline
  - Clicking a tab activates it
  - The object panel's Escape-to-close keyboard shortcut and arrow-key navigation within the panel still work (the custom focus walker still reaches the tabs)
  - The tab strip does NOT become a separate Tab-key stop outside the panel's focus scope

- [x] **Step 8:** Report task complete and wait for user review.

---

## Consumer 2: DiagnosticsPanel inline tabs

The second-simplest consumer. The tabs are inline JSX inside `DiagnosticsPanel.tsx` around line 2149 — four fixed tabs (`REFRESH DOMAINS`, `STREAMS`, `CAPABILITIES CHECKS`, `EFFECTIVE PERMISSIONS`), uppercase, no close, no drag. Same custom focus story as ObjectPanel: `data-diagnostics-focusable="true"` marker, `tabIndex={-1}` everywhere.

DiagnosticsPanel is ALSO the only remaining consumer of the `useTabStyles` backward-compat shim from `Tabs.tsx`. After this migration, the shim and the legacy `Tabs/index.tsx` directory can be deleted.

**Files to read before starting:**
- `frontend/src/core/refresh/components/DiagnosticsPanel.tsx:37,196,2140-2195` — import, hook call, tab JSX
- `frontend/src/core/refresh/components/DiagnosticsPanel.tsx:2065-2085` — custom focus walker (`querySelectorAll('[data-diagnostics-focusable="true"]')`)
- `frontend/src/core/refresh/components/DiagnosticsPanel.css:348-355` — `.diagnostics-tabs { padding: 0.3rem 0.5rem 0 }` and `.diagnostics-tabs .tab-item { text-transform: uppercase }`
- `frontend/src/core/refresh/components/DiagnosticsPanel.test.ts` — existing diagnostics panel tests

**Behaviors to preserve:**
- Tab labels in uppercase
- `data-diagnostics-focusable="true"` marker on each tab so the focus walker finds them
- Tabs are not native Tab-key stops
- Clicking a tab calls `setActiveTab(...)`
- The outer `.diagnostics-tabs` padding override (handled by keeping the wrapping `<div>` with that class)

### Task 5: Migrate `DiagnosticsPanel` tabs

**Files:**
- Modify: `frontend/src/core/refresh/components/DiagnosticsPanel.tsx`
- Modify: `frontend/src/core/refresh/components/DiagnosticsPanel.css`

- [x] **Step 1: Remove the `useTabStyles` import and call.**

  In `DiagnosticsPanel.tsx`:
  - Delete the import `import { useTabStyles } from '@shared/components/tabs/Tabs';` at line 37.
  - Delete the call `useTabStyles();` at line 196.

  The tab CSS is already loaded globally via `styles/index.css → components/tabs.css`, so removing the call is a no-op. The shim was only there for consumers that imported from the legacy `Tabs/index.tsx` path; it's no longer needed once no consumer calls the hook.

- [x] **Step 2: Add the shared `<Tabs>` import.**

  At the top of `DiagnosticsPanel.tsx`, near the other shared imports:

  ```tsx
  import { Tabs, type TabDescriptor } from '@shared/components/tabs';
  ```

- [x] **Step 3: Define the tab descriptors.**

  Inside the `DiagnosticsPanel` component body, right before the JSX return, add:

  ```tsx
  const diagnosticsTabDescriptors = useMemo<TabDescriptor[]>(
    () => [
      {
        id: 'refresh-domains',
        label: 'Refresh Domains',
        extraProps: {
          'data-diagnostics-focusable': 'true',
        } as HTMLAttributes<HTMLElement>,
      },
      {
        id: 'streams',
        label: 'Streams',
        extraProps: {
          'data-diagnostics-focusable': 'true',
        } as HTMLAttributes<HTMLElement>,
      },
      {
        id: 'capability-checks',
        label: 'Capabilities Checks',
        extraProps: {
          'data-diagnostics-focusable': 'true',
        } as HTMLAttributes<HTMLElement>,
      },
      {
        id: 'effective-permissions',
        label: 'Effective Permissions',
        extraProps: {
          'data-diagnostics-focusable': 'true',
        } as HTMLAttributes<HTMLElement>,
      },
    ],
    []
  );
  ```

  Note the label change from `REFRESH DOMAINS` (hardcoded uppercase in the old JSX) to `Refresh Domains`. The shared component's `textTransform="uppercase"` will render it uppercase via CSS, so the source strings can be natural case. This matches the design-doc convention and makes the strings more searchable.

  Also add `useMemo` to the existing React import at the top of the file if it isn't already imported.

- [x] **Step 4: Replace the tab JSX.**

  In `DiagnosticsPanel.tsx` around line 2149, replace:

  ```tsx
  <div className="tab-strip diagnostics-tabs">
    <button
      className={`tab-item${activeTab === 'refresh-domains' ? ' tab-item--active' : ''}`}
      onClick={() => setActiveTab('refresh-domains')}
      data-diagnostics-focusable="true"
      tabIndex={-1}
    >
      REFRESH DOMAINS
    </button>
    <button ... >STREAMS</button>
    <button ... >CAPABILITIES CHECKS</button>
    <button ... >EFFECTIVE PERMISSIONS</button>
  </div>
  ```

  with:

  ```tsx
  <div className="diagnostics-tabs">
    <Tabs
      aria-label="Diagnostics Panel Tabs"
      tabs={diagnosticsTabDescriptors}
      activeId={activeTab}
      onActivate={(id) =>
        setActiveTab(id as 'refresh-domains' | 'streams' | 'capability-checks' | 'effective-permissions')
      }
      textTransform="uppercase"
      disableRovingTabIndex
    />
  </div>
  ```

  The wrapping `<div className="diagnostics-tabs">` is kept so the existing `.diagnostics-tabs { padding: 0.3rem 0.5rem 0 }` CSS rule continues to apply. The shared component renders `.tab-strip` as its root inside the wrapper.

- [x] **Step 5: Delete dead CSS.**

  In `DiagnosticsPanel.css` around line 348, delete the rule:

  ```css
  .diagnostics-tabs .tab-item {
    text-transform: uppercase;
  }
  ```

  The shared component applies uppercase via `textTransform="uppercase"` on the JSX, so the per-consumer override is no longer needed. Keep the `.diagnostics-tabs { padding: 0.3rem 0.5rem 0 }` rule above it — that's the wrapper layout, unrelated to tab styling.

- [x] **Step 6: Run the tests.**

  Run: `./node_modules/.bin/vitest run src/core/refresh/components/DiagnosticsPanel.test.ts`

  Expected: all tests pass. If any fail because they were querying the tabs by tag name (`button`) or by hardcoded uppercase strings, update them to use `[role="tab"]` queries and natural-case label strings.

- [ ] **Step 7: Manual smoke test.**

  Open the diagnostics panel (via the app's menu), click through each of the four tabs, verify:
  - Labels render in uppercase
  - Active tab gets the accent underline
  - Clicking a tab activates it
  - The diagnostics panel's Escape-to-close and arrow-key focus navigation still work
  - The tab strip is NOT a native Tab-key stop

- [x] **Step 8:** Report task complete and wait for user review.

---

### Task 6: Delete the `useTabStyles` shim

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Delete: `frontend/src/shared/components/tabs/Tabs/index.tsx` (and the empty `Tabs/` directory)

- [x] **Step 1: Verify no consumers remain.**

  Run: `grep -rn "useTabStyles" /Volumes/git/luxury-yacht/app/frontend/src`

  Expected: the only hits are inside `frontend/src/shared/components/tabs/Tabs.tsx` (the shim itself) and `frontend/src/shared/components/tabs/Tabs/index.tsx` (the legacy barrel). Zero consumer references.

- [x] **Step 2: Delete the shim export from `Tabs.tsx`.**

  At the bottom of `Tabs.tsx`, delete the entire block starting at:

  ```tsx
  /**
   * Backward-compat shim. The previous shared tabs module exposed a no-op
   * `useTabStyles` hook (see `frontend/src/shared/components/tabs/Tabs/index.tsx`).
   * ...
   */
  export const useTabStyles = (): boolean => true;
  ```

- [x] **Step 3: Delete the legacy `Tabs/` directory.**

  Delete `frontend/src/shared/components/tabs/Tabs/index.tsx`, then remove the now-empty `Tabs/` directory.

  ```bash
  rm /Volumes/git/luxury-yacht/app/frontend/src/shared/components/tabs/Tabs/index.tsx
  rmdir /Volumes/git/luxury-yacht/app/frontend/src/shared/components/tabs/Tabs
  ```

- [x] **Step 4: Typecheck and test.**

  ```bash
  cd /Volumes/git/luxury-yacht/app/frontend
  ./node_modules/.bin/tsc --noEmit --project .
  ./node_modules/.bin/vitest run src/shared/components/tabs/
  ```

  Expected: clean.

- [x] **Step 5:** Report task complete and wait for user review.

---

## Consumer 3: ClusterTabs

First drag-capable consumer. `ClusterTabs.tsx` is 347 lines. Responsibilities:

1. Render a horizontal strip of kubeconfig context tabs (conditional: only when ≥ 2 contexts are open)
2. Drag-and-drop reorder within the strip, persisted via `setClusterTabOrder`
3. Close button per tab, with a confirmation modal if the cluster has active port forwards
4. Label collision handling (uses `id` instead of `name` when two contexts have the same name)
5. Publishes its own height to a `--cluster-tabs-height` CSS variable so dockable panels can offset correctly

**The shared `<Tabs>` and drag coordinator already support all the drag/drop needs via the `cluster-tab` payload variant.**

**Files to read before starting:**
- `frontend/src/ui/layout/ClusterTabs.tsx` (full — all 347 lines)
- `frontend/src/ui/layout/ClusterTabs.css` (full — 19 lines)
- `frontend/src/ui/layout/ClusterTabs.test.tsx` — existing tests
- `frontend/src/shared/components/tabs/dragCoordinator/types.ts` — confirm the `cluster-tab` payload shape (`{ kind: 'cluster-tab', clusterId: string }`)
- `frontend/src/shared/components/tabs/ClusterTabsPreview.stories.tsx` — the Phase 1 preview story that already demonstrates this exact migration shape

**Behaviors to preserve:**
- Conditional rendering: if `orderedTabs.length < 2`, return `null`
- Persistence: drag reorder calls `setClusterTabOrder(nextOrder)`
- Height observer: publishes `--cluster-tabs-height` CSS custom property via `ResizeObserver`
- Close button with port-forward confirmation modal
- Label collision → `id` fallback
- Close aria-label includes the cluster label (`Close ${tab.label}`)
- Active tab is the one matching `selectedKubeconfig`
- Clicking a tab calls `setActiveKubeconfig(selection)`

**Behaviors that change (drop-target surface):**
- Current: drag highlights the hovered TARGET tab; dropping on a tab reorders the dragged tab to that position
- New: drag shows a vertical drop-indicator bar between tabs; dropping anywhere on the strip inserts at the indicator position
- Result is identical (same reordering semantics), the visual cue improves

**Drag payload migration:**
- Current: `text/plain` payload with the tab id
- New: `cluster-tab` discriminated union payload via `useTabDragSource`

### Task 7: Migrate `ClusterTabs.tsx` to shared `<Tabs>`

**Files:**
- Modify: `frontend/src/ui/layout/ClusterTabs.tsx`
- Modify: `frontend/src/ui/layout/ClusterTabs.css`
- Modify: `frontend/src/ui/layout/ClusterTabs.test.tsx`

> **Provider scope:** Task 2b already mounted a single app-root `<TabDragProvider>` in `App.tsx` that wraps `DockablePanelProvider`. `ClusterTabs` is rendered inside that subtree (`AppLayout.tsx:182` → inside `DockablePanelProvider` → inside `TabDragProvider`), so its hooks find the context automatically. **Do NOT add a local `<TabDragProvider>` wrapper inside `ClusterTabs.tsx` or around its mount point** — that would create a nested provider scope that shadows the app-root one and silently splits drag state across contexts.

- [x] **Step 1: Read the existing `ClusterTabs.test.tsx`.**

  Note every assertion — these are the behaviors that must still work post-migration. Key areas:
  - Drag-and-drop reorder persistence
  - Close button with port-forward modal
  - Conditional rendering (`< 2` tabs → null)
  - Label rendering (with collision fallback)

- [x] **Step 2: Rewrite the `ClusterTabs` component body.**

  The new component retains almost all of its current logic — state, persistence, label computation, close-with-modal, height observer — but replaces the render body with a `<Tabs>` call wired through the drag coordinator. Here's the target shape (read in full before editing):

  ```tsx
  import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
  import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
  import {
    getClusterTabOrder,
    hydrateClusterTabOrder,
    setClusterTabOrder,
    subscribeClusterTabOrder,
  } from '@core/persistence/clusterTabOrder';
  import {
    GetClusterPortForwardCount,
    StopClusterPortForwards,
    StopClusterShellSessions,
  } from '@wailsjs/go/backend/App';
  import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
  import { CloseIcon } from '@shared/components/icons/MenuIcons';
  import { Tabs, type TabDescriptor } from '@shared/components/tabs';
  import {
    useTabDragSourceFactory,
    useTabDropTarget,
  } from '@shared/components/tabs/dragCoordinator';
  import './ClusterTabs.css';

  // ... ordersMatch helper stays unchanged ...
  // NOTE: the legacy `moveTab(order, sourceId, targetId)` helper is
  // DELETED as part of this migration. The shared drop target gives us
  // an `insertIndex`, not a target id, and the two don't round-trip
  // correctly (moveTab splices at target's ORIGINAL index in the
  // reduced array, which shifts source one position too far for forward
  // drags). The onDrop handler below does the reorder directly.

  type ClusterTab = {
    id: string;
    label: string;
    selection: string;
  };

  const ClusterTabs: React.FC = () => {
    // ... existing state / refs / effects unchanged through `orderedTabs` ...

    // One useContext call for the entire drag coordinator, regardless
    // of how many tabs are rendered. The returned factory is a plain
    // function that's legal to call inside `.map()` — no rules-of-hooks
    // workaround and no upper bound on the number of draggable tabs.
    const makeDragSource = useTabDragSourceFactory();

    const { ref: dropRef, dropInsertIndex } = useTabDropTarget({
      accepts: ['cluster-tab'],
      onDrop: (payload, _event, insertIndex) => {
        // Reorder directly against insertIndex. DO NOT try to reuse the
        // legacy `moveTab(sourceId, targetId)` helper — it takes a target
        // id and splices at the target's ORIGINAL index in the reduced
        // array, which produces off-by-one results for forward drags
        // (source always lands one position past the intended spot
        // because removing source shifts subsequent elements left).
        //
        // The shift compensation below is the only subtlety: when source
        // is before the insert index, removing it bumps every later
        // position down by 1, so the effective destination is
        // insertIndex - 1. When source is at or after the insert index,
        // no shift is needed.
        const sourceIdx = mergedOrder.indexOf(payload.clusterId);
        if (sourceIdx < 0) return;
        const adjustedInsert = sourceIdx < insertIndex ? insertIndex - 1 : insertIndex;
        if (adjustedInsert === sourceIdx) return; // no-op drop onto itself
        const nextOrder = [...mergedOrder];
        nextOrder.splice(sourceIdx, 1);
        nextOrder.splice(adjustedInsert, 0, payload.clusterId);
        if (!ordersMatch(nextOrder, mergedOrder)) {
          setClusterTabOrder(nextOrder);
        }
      },
    });

    const tabDescriptors: TabDescriptor[] = orderedTabs.map((tab) => ({
      id: tab.id,
      label: tab.label,
      closeIcon: <CloseIcon width={10} height={10} />,
      closeAriaLabel: `Close ${tab.label}`,
      onClose: () => {
        void handleCloseTab(tab.selection);
      },
      extraProps: {
        title: tab.label, // tooltip for full text when truncated
        ...makeDragSource({ kind: 'cluster-tab', clusterId: tab.id }),
      } as HTMLAttributes<HTMLElement>,
    }));

    // ... existing height-observer effect unchanged ...

    if (orderedTabs.length < 2) {
      return null;
    }

    // Compose the tabsRef + dropRef into a single ref callback so both
    // the height observer and the drop target see the same element.
    const assignRootRef = useCallback(
      (el: HTMLDivElement | null) => {
        tabsRef.current = el;
        dropRef(el);
      },
      [dropRef]
    );

    return (
      <>
        <div ref={assignRootRef} className="cluster-tabs-wrapper">
          <Tabs
            aria-label="Cluster Tabs"
            tabs={tabDescriptors}
            activeId={activeTabId}
            onActivate={(id) => {
              const tab = tabsById.get(id);
              if (tab) handleTabClick(tab.selection);
            }}
            dropInsertIndex={dropInsertIndex}
            className="cluster-tabs"
          />
        </div>
        <ConfirmationModal
          // ... unchanged ...
        />
      </>
    );
  };

  export default React.memo(ClusterTabs);
  ```

  **Critical notes for the implementer:**
  - **`useTabDragSourceFactory` is the only supported pattern** for building per-tab drag props on a dynamic-length tab list. Do NOT unroll `useTabDragSource` calls for a fixed number of slots — that artificially caps the number of draggable tabs, which is a production regression. The factory returns a plain function the consumer calls inside `.map()`; one `useContext` call serves any number of tabs.
  - **Delete** the legacy `moveTab(order, sourceId, targetId)` helper entirely. Do NOT try to convert `insertIndex` back into a `targetId` and call it — the semantics don't round-trip (source lands one position too far right for forward drags because `moveTab` splices at the target's original index in the reduced array). The onDrop handler above does the reorder directly with a shift-compensation (`sourceIdx < insertIndex ? insertIndex - 1 : insertIndex`) that is correct for every source / insert index combination.
  - The `cluster-tabs-wrapper` class is a new wrapper div; the `.cluster-tabs` class now sits on the shared component's root via `className`. Check existing CSS rules below.
  - Keep the existing `handleCloseTab` / `handleConfirmClose` / port-forward modal logic unchanged.
  - Keep the existing height-observer effect unchanged — it reads `tabsRef.current?.getBoundingClientRect().height`, and `tabsRef` still points to the outer wrapper div.

- [x] **Step 3: Update `ClusterTabs.css`.**

  Current file is 19 lines. The `.cluster-tabs { padding: 0 6px; overflow-x: auto; grid-column: 1/-1; grid-row: 2 }` rule targets the strip element; the grid positioning still applies via the shared component's root element (which gets the `cluster-tabs` class via the new `className` prop). The `overflow-x: auto` is a duplicate — the shared component already handles overflow — but it's harmless to keep.

  Delete the drag-state classes `.cluster-tab--dragging` and `.cluster-tab--drop-target` — the shared drop indicator replaces them.

  Final file:

  ```css
  /* Cluster tab strip — layout-specific overrides.
     Base tab styles live in styles/components/tabs.css */

  .cluster-tabs {
    padding: 0 6px;
    grid-column: 1 / -1;
    grid-row: 2;
  }
  ```

- [x] **Step 4: Update tests.**

  Walk each assertion in `ClusterTabs.test.tsx`:
  - Queries by `<button>` → `[role="tab"]` (shared component uses `<div role="tab">`)
  - Drag tests that simulated `dragstart` with `text/plain` payload → update to use the shared drag coordinator. The cleanest approach is to mock `useTabDragSource` at the module level, OR restructure the test to dispatch drag events on the `[role="tab"]` element directly and assert the onDrop side-effect via the persistence call. The latter is more end-to-end.
  - Close-button queries by class `.tab-item__close` continue to work.
  - Close-with-modal assertions unchanged.
  - Conditional-rendering assertion (`< 2` tabs → null) unchanged.

- [x] **Step 5: Run the tests.**

  Run: `./node_modules/.bin/vitest run src/ui/layout/`

  Expected: all tests pass.

- [ ] **Step 6: Manual smoke test.**

  Open the app with 3+ kubeconfigs selected. Verify:
  - Strip appears only when ≥ 2 contexts are open
  - Each tab shows its label (or id fallback for name collisions)
  - Clicking a tab switches the active cluster
  - Dragging a tab shows the vertical drop indicator bar between tabs (new visual)
  - Dropping reorders and persists (reload the app — order is preserved)
  - Close button works, including the port-forward confirmation modal
  - `--cluster-tabs-height` CSS variable is set (check in devtools; dockable panels should still respect the offset)
  - Keyboard: Tab key reaches the active tab, arrow keys move focus between tabs, Enter activates

- [x] **Step 7:** Report task complete and wait for user review.

---

## Consumer 4: DockableTabBar

The largest and most complex consumer. `DockableTabBar.tsx` is 413 lines. `DockablePanelProvider.tsx` is 812 lines and — in the current pre-migration code — owns a custom floating drag-preview element that tracks the cursor via pointermove-updated CSS custom properties. **Per `design.md:28` (Compromises taken), the live cursor-following preview is explicitly dropped as part of Phase 2.** The replacement is a static `event.dataTransfer.setDragImage()` snapshot taken once at dragstart — identical in visual styling but positioned by the browser's native drag-image rendering, not by the provider. The Phase 1 `ObjectTabsPreview` story already demonstrates this approach end-to-end and is the implementation reference for Task 9.

**Migration is split into three sub-tasks** because this consumer has three distinct responsibilities:

1. **Task 8** — `DockableTabBar.tsx` renders the tab strip. Migrate rendering (shared `<Tabs>`), drag reorder within strip, overflow scrolling. Delete dead `.dockable-tab-bar__overflow-*` CSS.
2. **Task 9** — `DockablePanelProvider.tsx` owns cross-strip drag coordination and the floating-group undock feature. Add two thin adapter methods on the context value: `movePanel(panelId, sourceGroupId, targetGroupId, insertIndex)` (dispatches between the existing `reorderTabInGroup` and `movePanelBetweenGroups` based on whether source and target match), and `createFloatingGroupWithPanel(panelId, sourceGroupId, cursorPos)` (wraps the existing `movePanelBetweenGroups(panelId, 'floating')` + `setPanelFloatingPositionById(...)` calls). Add a container-level `useTabDropTarget` that calls `createFloatingGroupWithPanel` on drop — this is the explicit empty-space-to-floating-group target required by `design.md:393`, replacing the legacy gesture-based undock. **Delete** the live cursor-following preview machinery (`startTabDrag`, pointermove listeners, `--dockable-tab-drag-x` / `--dockable-tab-drag-y` CSS vars), the legacy mousemove drag handler, the `dragState` machine, the `tabBarElementsRef` registry, and the `UNDOCK_THRESHOLD` constant. Mount a static preview element always in the DOM (offscreen by default), have `DockableTabBar`'s `getDragImage` write per-tab content into it before handing it to `setDragImage`, and let the browser render it at the cursor during drag. `TabDragProvider` is already in scope from Task 2b — Task 9 does NOT add another provider wrapper inside `DockablePanelProvider`.
3. **Task 10** — Delete dead CSS from `DockablePanel.css`, including the `--dockable-tab-drag-x` / `--dockable-tab-drag-y` custom properties and the `transform: translate3d(var(...), var(...), 0)` rule that relied on them. (The `tabBarElementsRef` / `registerTabBarElement` registry is deleted in Task 9 Step 4, not here — by the time Task 10 runs there are no references left to clean up.)

**Files to read before starting:**
- `frontend/src/ui/dockable/DockableTabBar.tsx` (full — 413 lines)
- `frontend/src/ui/dockable/DockableTabBar.test.tsx`
- `frontend/src/ui/dockable/DockableTabBar.drag.test.tsx`
- `frontend/src/ui/dockable/DockablePanelProvider.tsx` (full — 812 lines)
- `frontend/src/ui/dockable/DockablePanelProvider.test.tsx`
- `frontend/src/ui/dockable/DockablePanel.css:397-590` — tab-bar / drag-preview rules (`.dockable-tab-bar-shell`, `.dockable-tab-bar`, `.dockable-tab`, `.dockable-tab-bar__overflow-*`, `.dockable-tab-bar__drop-indicator`, `.dockable-tab-drag-preview`, `.dockable-tab-drag-preview__*`)
- `frontend/src/shared/components/tabs/ObjectTabsPreview.stories.tsx` — the Phase 1 preview story that already demonstrates the exact migration target, including within-strip reorder, cross-strip moves, empty-space new-strip creation, custom drag preview with per-tab kind updates, and overflow scrolling. **Use this as the implementation reference.**

### Task 8: Migrate `DockableTabBar.tsx` rendering + intra-strip drag

**Files:**
- Modify: `frontend/src/ui/dockable/DockableTabBar.tsx`
- Modify: `frontend/src/ui/dockable/DockableTabBar.test.tsx`
- Modify: `frontend/src/ui/dockable/DockableTabBar.drag.test.tsx`

**Behaviors to preserve:**
- Tab rendering with kind indicator (via `leading` slot using `dockable-tab__kind-indicator` class)
- Close button with `CloseIcon` and per-tab `aria-label` (via `closeIcon` + `closeAriaLabel` from Task 2)
- Overflow scrolling with the per-tab navigation algorithm (already in shared component)
- Within-strip drag reorder
- Cross-strip drop target (via `useTabDropTarget`, payload = `dockable-tab`)
- Active tab reveal: when `activeTab` changes, scroll it into view (already in shared component via auto-scroll effect)

**Behaviors DELETED (do NOT preserve):**
- `registerTabBarElement(groupKey, barRef.current)` useEffect registration. The provider's `tabBarElementsRef` registry has exactly one reader — the mousemove-based undock detection inside the legacy drag-state machine at `DockablePanelProvider.tsx:608`. Task 9 deletes that legacy machine (along with `dragState`, `startTabDrag`, the mousemove listener, and the undock-threshold logic). Once Task 9 runs, the registry has zero readers and `registerTabBarElement` becomes dead code. Task 8 MUST delete the useEffect from `DockableTabBar.tsx:56-61` as part of this migration — preserving it would leave a dangling write to a registry nothing ever reads and would couple the new tab-bar component to soon-to-be-deleted provider infrastructure.
- `data-group-key` attribute on the bar root. Its only consumer today is the same legacy mousemove handler that reads `tabBarElementsRef` to figure out which group the cursor is hovering. `useTabDropTarget` handles drop detection via native HTML5 drag events, which don't need a `data-group-key` lookup — the `onDrop` handler in the template below forwards the event directly to `movePanel(payload.panelId, payload.sourceGroupId, groupKey, insertIndex)` using the `groupKey` prop, closing over it via closure. No DOM attribute needed.

**Behaviors that change:**
- The `.dockable-tab-drag-preview` element stays in the provider (Task 9), but its cursor-tracking **mechanism changes**. Current live code updates `--dockable-tab-drag-x` / `--dockable-tab-drag-y` CSS custom properties on pointer move and re-renders the element via `transform: translate3d(...)`. Per the design doc, this is **dropped** — the replacement is a single `event.dataTransfer.setDragImage(element, offsetX, offsetY)` call at dragstart, and the browser handles cursor positioning natively from there. The tab bar's `getDragImage` option (passed through `useTabDragSourceFactory`) updates the element's label + kind class synchronously before the browser screenshots it. No more pointermove machinery.
- Drag-state visuals (`.dockable-tab--dragging`) → the shared component applies `.tab-item` base; the dragging class can be kept via `extraProps` conditionally. OR: accept the visual simplification (no extra opacity for the dragged source — the drag image already provides enough feedback).

- [x] **Step 1: Read both tests in full.** Note assertions around drag events and overflow chevron behavior — those are behaviors to preserve. Assertions that query by `.dockable-tab` or `data-group-key`, or that call `registerTabBarElement` to set up fixtures, will need to change: the DOM markup moves to `[role="tab"]` and the `data-group-key` attribute + `registerTabBarElement` registry are both deleted as part of this task (see Step 2) and Task 9. Do NOT treat those fixture-setup patterns as behaviors to preserve.

- [x] **Step 2: Rewrite the component body.** Replace the current 413-line component with a ~120-line shared-component-backed version. Key structural changes:
  - Delete the custom overflow measurement effect, `overflowHint` state, `scrollToNextTab`, `scrollLeft`/`scrollRight` click handlers, `updateOverflowHint` — all handled by `<Tabs>`.
  - Delete the `handleBarMouseDown`/`handleOverflowMouseDown` stopPropagation glue — no longer needed (shared component doesn't fire mousedown on drag).
  - Delete the `registerTabBarElement(groupKey, barRef.current)` useEffect. Its only purpose was to feed the legacy provider registry that Task 9 deletes.
  - Delete the `data-group-key` attribute on the bar root. Its only reader was the same legacy registry. The `groupKey` prop is still available via closure in the `onDrop` handler below, so drop routing works without any DOM-attribute lookup.
  - Replace the per-tab `<div role="tab">` JSX with a `TabDescriptor[]` built via `tabs.map(...)` and passed to `<Tabs>`.
  - Replace the per-tab `onDragStart/onDragEnd/onDragEnter/onDragOver/onDrop` handlers with a single `useTabDragSourceFactory()` call at the top of the component, then invoke the returned factory inside the tab `.map()` to produce each tab's drag source props. No unrolling, no tab-count cap.
  - Replace the per-tab drop target with `useTabDropTarget` at the bar level.

  **Template** (read fully, then adapt):

  ```tsx
  import React from 'react';
  import { Tabs, type TabDescriptor } from '@shared/components/tabs';
  import {
    useTabDragSourceFactory,
    useTabDropTarget,
  } from '@shared/components/tabs/dragCoordinator';
  import { CloseIcon } from '@shared/components/icons/MenuIcons';
  import { useDockablePanelContext } from './DockablePanelContext';

  interface DockableTab {
    panelId: string;
    title: string;
    kindClass?: string;
  }

  interface DockableTabBarProps {
    tabs: DockableTab[];
    activeTab: string | null;
    groupKey: string;
    onTabClick: (panelId: string) => void;
    closeTab: (panelId: string) => void;
  }

  const DockableTabBar: React.FC<DockableTabBarProps> = ({
    tabs,
    activeTab,
    groupKey,
    onTabClick,
    closeTab,
  }) => {
    // Only `dragPreviewRef` (for getDragImage) and `movePanel` (for
    // onDrop) are read from the provider. `registerTabBarElement` is
    // intentionally NOT destructured here — Task 9 deletes it along with
    // the legacy drag-state machine that was its only reader.
    const { dragPreviewRef, movePanel } = useDockablePanelContext();

    // One useContext call for the whole bar, regardless of tab count.
    // The returned factory is a plain function called per tab inside
    // .map() — no rules-of-hooks workaround, no upper limit on tabs.
    const makeDragSource = useTabDragSourceFactory();

    const { ref: dropRef, dropInsertIndex } = useTabDropTarget({
      accepts: ['dockable-tab'],
      onDrop: (payload, _event, insertIndex) => {
        // Forward to the provider's `movePanel` adapter (added in Task 9
        // Step 4). The adapter dispatches internally between the
        // existing `reorderTabInGroup` and `movePanelBetweenGroups`
        // functions based on whether source and target groups match, so
        // this single call handles BOTH within-strip reorder and
        // cross-strip moves.
        movePanel(payload.panelId, payload.sourceGroupId, groupKey, insertIndex);
      },
    });

    const tabDescriptors: TabDescriptor[] = tabs.map((tab) => {
      // Build a per-tab drag source via the factory. getDragImage writes
      // the tab's label + kind class into the provider's floating
      // preview element BEFORE setDragImage takes the screenshot.
      const dragProps = makeDragSource(
        { kind: 'dockable-tab', panelId: tab.panelId, sourceGroupId: groupKey },
        {
          getDragImage: () => {
            if (!dragPreviewRef.current) return null;
            const labelEl = dragPreviewRef.current.querySelector<HTMLSpanElement>(
              '.dockable-tab-drag-preview__label'
            );
            if (labelEl) labelEl.textContent = tab.title;
            const kindEl = dragPreviewRef.current.querySelector<HTMLSpanElement>(
              '.dockable-tab-drag-preview__kind'
            );
            if (kindEl) {
              kindEl.className = `dockable-tab-drag-preview__kind kind-badge${
                tab.kindClass ? ` ${tab.kindClass}` : ''
              }`;
            }
            return { element: dragPreviewRef.current, offsetX: 14, offsetY: 16 };
          },
        }
      );
      return {
        id: tab.panelId,
        label: tab.title,
        leading: tab.kindClass ? (
          <span
            className={`dockable-tab__kind-indicator kind-badge ${tab.kindClass}`}
            aria-hidden="true"
          />
        ) : undefined,
        closeIcon: <CloseIcon width={10} height={10} />,
        closeAriaLabel: `Close ${tab.title}`,
        onClose: () => closeTab(tab.panelId),
        extraProps: {
          'data-panel-id': tab.panelId,
          ...dragProps,
        } as HTMLAttributes<HTMLElement>,
      };
    });

    return (
      <div ref={dropRef as (el: HTMLDivElement | null) => void} className="dockable-tab-bar-shell">
        <Tabs
          aria-label="Object Tabs"
          tabs={tabDescriptors}
          activeId={activeTab}
          onActivate={onTabClick}
          dropInsertIndex={dropInsertIndex}
          className="dockable-tab-bar"
        />
      </div>
    );
  };

  export default DockableTabBar;
  ```

  **Gotchas for the implementer:**
  - `useDockablePanelContext` currently exposes `registerTabBarElement`, `dragState`, `startTabDrag`, etc. The Task 8 template only reads `dragPreviewRef` and `movePanel` — those two fields must exist on the context value. Task 9 adds `dragPreviewRef` and ensures `movePanel` stays exposed; the two tasks are interdependent, so do Task 9's Step 3 (extend the context type) BEFORE running Task 8's tests, OR run Tasks 8 and 9 as a single atomic commit.
  - `useTabDragSourceFactory()` is called ONCE at the top of the component. The factory it returns is a plain function that's legal to call inside `.map()` — one call per tab to produce that tab's drag source props. No rules-of-hooks issue and no upper bound on tab count.
  - The `groupKey` prop is read inside `onDrop` via closure — no DOM attribute is needed to route drops back to the correct group. Cross-strip moves work because the drop handler sees both `groupKey` (the target, from props) and `payload.sourceGroupId` (the source, from the dragged tab's payload) and forwards both to `movePanel`.

- [x] **Step 3: Update tests.** Drag tests that simulate raw `dragstart`/`drop` events on individual tabs still work — the shared drag coordinator uses the same native HTML5 drag API. Update queries from the old markup (`.dockable-tab`) to the new markup (`[role="tab"]`). Tests that assert on `.dockable-tab-bar__overflow-indicator` classes need to update to `.tab-strip__overflow-indicator`.

- [x] **Step 4: Run the tests.** `./node_modules/.bin/vitest run src/ui/dockable/DockableTabBar`. Expected: all tests pass.

- [x] **Step 5:** Report task complete and wait for user review.

---

### Task 9: Migrate `DockablePanelProvider.tsx` drag coordination

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanelProvider.tsx`
- Modify: `frontend/src/ui/dockable/DockablePanelProvider.test.tsx`

**What needs to happen:**
The provider currently owns five distinct pieces of machinery. Phase 2 deletes two outright, transforms one, and adds two small adapters on top of the existing (preserved) state-mutation functions:

1. A `dragState` state machine for cross-strip drag detection (bars registered via `registerTabBarElement`, cursor position tracked via pointer move) — **DELETED.** The shared `useTabDropTarget` handles drop detection via native HTML5 drag events, no custom hit-testing needed.
2. A floating `<div className="dockable-tab-drag-preview">` element that follows the cursor via CSS custom properties `--dockable-tab-drag-x` / `--dockable-tab-drag-y` updated on pointer move — **live-tracking machinery DELETED** per `design.md:28`. The element itself STAYS (same markup, same inner spans, same visual styling) but becomes a static `setDragImage` snapshot source: mounted permanently in the DOM, positioned offscreen via default styling, updated by `getDragImage` callbacks immediately before the browser screenshots it at dragstart, and then positioned by the browser's native drag-image rendering during the drag. The `startTabDrag` / `endTabDrag` methods, the pointermove listener, and the CSS custom properties are all deleted.
3. The **existing** panel-state mutation functions `reorderTabInGroup(groupKey, panelId, newIndex)` (at `DockablePanelProvider.tsx:483`), `movePanelBetweenGroups(panelId, targetGroupKey, insertIndex?)` (at `:489`), and `movePanelBetweenGroupsAndFocus(...)` are **ALL KEPT unchanged.** These are the authoritative panel-state mutators and the migration preserves them byte-for-byte. Task 9 adds a new thin **adapter** method on the context value — `movePanel(panelId, sourceGroupId, targetGroupId, insertIndex)` — that matches the `useTabDropTarget` `onDrop` callback shape (four args including the source group id from the drag payload) and internally dispatches to the appropriate existing function: same-group → `reorderTabInGroup`, cross-group → `movePanelBetweenGroups`. The adapter is the only new thing on the panel-state mutation side; no existing function is renamed or reshaped. The live code today has no `movePanel` field — the name is a clean slate.
4. The `registerTabBarElement` registry (`tabBarElementsRef` + the `registerTabBarElement` setter) — **DELETED.** Its one reader (the mousemove handler at `DockablePanelProvider.tsx:608`) is part of the drag-state machine being removed in item 1. The current code has no non-drag consumers; `grep -rn "tabBarElementsRef\|registerTabBarElement" frontend/src` returns only writes in `DockableTabBar.tsx:56-61` (deleted by Task 8) and the reader in the about-to-be-deleted mousemove handler. No conditional — the registry is dead infrastructure and is removed outright.
5. The **undock-to-floating-group** behavior currently implemented by the mousemove handler at `DockablePanelProvider.tsx:599-627` (which reads the source bar rect, checks if the cursor moved more than `UNDOCK_THRESHOLD` pixels away vertically, and then calls `movePanelBetweenGroups(panelId, 'floating')` + `setPanelFloatingPositionById(...)`) — the **gesture-based trigger is DELETED**, but the **feature is preserved and reimplemented** as an explicit empty-space drop target per `design.md:393`. Task 9 adds a second new adapter — `createFloatingGroupWithPanel(panelId, sourceGroupId, cursorPos)` — that wraps the existing `movePanelBetweenGroups(panelId, 'floating')` + `setPanelFloatingPositionById(panelId, { x, y })` calls into a single function, and a new container-level `useTabDropTarget` (acceptance list `['dockable-tab']`) that calls this adapter on drop. Native HTML5 drag events bubble, so a drop that lands inside a tab bar's drop target is handled there first; only drops that fall through to empty space reach the container target. The container target attaches to whatever DOM element currently wraps the dockable panel content area — see Step 5 below for identifying and instrumenting it.

**Reference:** The Phase 1 preview story `ObjectTabsPreview.stories.tsx` already implements exactly the static-preview + factory-per-tab + empty-space drop zone shape — a permanently-mounted `.dockable-tab-drag-preview` element with a `getDragImage` that updates the label + kind class inside it, then returns it to `setDragImage`; and a `NewStripDropZone` that accepts dockable-tab drops outside the strip drop targets and spawns a new group. No CSS vars, no pointermove listener, no transform tracking. The story works correctly in every browser and demonstrates every piece of the target shape at once. Use it as the implementation template.

**Migration strategy:**
- `TabDragProvider` is already in scope from Task 2b (mounted around `DockablePanelProvider` at the app root in `App.tsx`). Do NOT add another provider wrapper inside `DockablePanelProvider` — the existing one from Task 2b covers every `DockableTabBar` descendant and every `ClusterTabs` descendant in the same single context scope, which is what we want.
- Mount the `.dockable-tab-drag-preview` element **permanently** (not conditionally on `dragState` — there's no `dragState` anymore). The element's CSS handles keeping it offscreen until it's screenshotted by the browser.
- Expose `dragPreviewRef` via context so `DockableTabBar`'s per-tab `getDragImage` can write the tab's label + kind class into the element's inner spans before handing the element to `setDragImage`.
- Add the `movePanel(panelId, sourceGroupId, targetGroupId, insertIndex)` adapter to the context value. It is NOT renaming or reshaping the existing `movePanelBetweenGroups` — it's a new thin wrapper that dispatches to the existing same-group (`reorderTabInGroup`) and cross-group (`movePanelBetweenGroups`) functions based on whether `sourceGroupId === targetGroupId`.
- Add the `createFloatingGroupWithPanel(panelId, sourceGroupId, cursorPos)` adapter and a container-level empty-space drop target that calls it on drop. This preserves the undock-to-floating-group feature that the legacy mousemove handler provided, now keyed on an actual drop event on a container element rather than a cursor-distance gesture.
- Delete `startTabDrag`, `endTabDrag`, the `dragState` state, the pointermove listener, the mousemove handler at `:599-627` (including its `UNDOCK_THRESHOLD` reference), the `tabBarElementsRef` registry, and `registerTabBarElement` (all dead once the legacy drag-state machine is removed — see Step 7 for the grep-verified zero-consumer proof). The `setDragImage` call inside `getDragImage` is the entire "start the drag visual" mechanism; the browser owns cursor-tracking from there.
- Existing `reorderTabInGroup`, `movePanelBetweenGroups`, `movePanelBetweenGroupsAndFocus`, and `setPanelFloatingPositionById` stay in the provider unchanged. They're still exposed via context where applicable for non-migration callers (panel lifecycle, close button, etc.).

- [x] **Step 1: Read the full `DockablePanelProvider.tsx` file** and map current responsibilities.

- [x] **Step 2: Mount the drag preview element permanently.**

  `TabDragProvider` is already in scope from Task 2b (it wraps `DockablePanelProvider` at the app root). Do NOT add another `<TabDragProvider>` here — it would create a nested scope that isolates cross-strip drag state inside this provider's subtree. Just mount `.dockable-tab-drag-preview` as an always-in-DOM element (no `dragState` conditional, no provider wrapping):

  ```tsx
  // ... inside the provider's return, replacing the old conditional preview JSX ...
  return (
    <PanelLayoutStoreContext.Provider value={layoutStore}>
      <DockablePanelContext.Provider value={value}>
        <DockablePanelHostContext.Provider value={hostNode}>
          {children}
          {/* Always mounted — the browser screenshots this element via
              setDragImage at dragstart. Offscreen by default via CSS. */}
          <div ref={dragPreviewRef} className="dockable-tab-drag-preview" aria-hidden="true">
            <span
              className="dockable-tab-drag-preview__kind kind-badge"
              aria-hidden="true"
            />
            <span className="dockable-tab-drag-preview__label" />
          </div>
        </DockablePanelHostContext.Provider>
      </DockablePanelContext.Provider>
    </PanelLayoutStoreContext.Provider>
  );
  ```

  The inner spans are empty placeholders; `DockableTabBar`'s per-tab `getDragImage` callback writes the actual label + kind class into them immediately before calling `setDragImage`. This mirrors the Phase 1 `ObjectTabsPreview` story's pattern exactly.

- [x] **Step 3: Expose `dragPreviewRef` and `movePanel` via context.**

  Add a `useRef<HTMLDivElement | null>(null)` at the top of the provider, ref the drag preview element to it, and include both `dragPreviewRef` and `movePanel` in the context value so `DockableTabBar` can consume them:

  ```tsx
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  // ...
  const value = useMemo<DockablePanelContextValue>(
    () => ({
      // ... existing fields MINUS any dragState / startTabDrag / endTabDrag ...
      dragPreviewRef,
      movePanel,
      createFloatingGroupWithPanel,
    }),
    [/* existing deps */]
  );
  ```

  Update the `DockablePanelContextValue` type to ADD `dragPreviewRef`, `movePanel`, and `createFloatingGroupWithPanel`, and to REMOVE the no-longer-exposed `dragState`, `startTabDrag`, `endTabDrag`, and `registerTabBarElement` fields. The existing `reorderTabInGroup`, `movePanelBetweenGroups`, `movePanelBetweenGroupsAndFocus`, and `setPanelFloatingPositionById` fields stay on the type unchanged — they're still called by non-drag panel-management code (panel lifecycle, close buttons, etc.) and the adapters below delegate to them. Grep for existing context consumers and make sure no caller depends on the removed fields — any that do need to migrate at the same time.

- [x] **Step 4: Add the `movePanel` adapter.**

  `DockableTabBar`'s `onDrop` from Task 8 calls `movePanel(panelId, sourceGroupId, targetGroupId, insertIndex)` — a four-argument shape that matches the `useTabDropTarget` callback. The current provider does NOT expose anything with that name; it exposes two separate functions: `reorderTabInGroup(groupKey, panelId, newIndex)` for same-group reorders and `movePanelBetweenGroups(panelId, targetGroupKey, insertIndex?)` for cross-group moves. `movePanel` is a new thin adapter that dispatches between them based on whether source and target groups match. Neither existing function is renamed, reshaped, or wrapped destructively.

  Add to the provider (near the other panel-state callbacks, around `DockablePanelProvider.tsx:489`).

  **First, a group-tab lookup helper** that handles the asymmetric shape of `TabGroupState`. The type (see `frontend/src/ui/dockable/tabGroupTypes.ts:38-42`) exposes `right` and `bottom` as keyed children (`{ tabs: string[]; activeTab: string | null }`) but `floating` as an ARRAY of `FloatingTabGroup` objects, each with its own `{ groupId, tabs, activeTab }`. A floating group's id is a runtime-generated string like `'floating-abc123'`, NOT a key on the root `TabGroupState` object. Naive property access like `state[targetGroupId]` returns `undefined` for any floating group id and silently skips the shift compensation, re-introducing the forward-drop-by-one bug on floating strips.

  Write a helper that distinguishes the three cases:

  ```tsx
  // Helper (colocated with the adapter, or moved into tabGroupState.ts
  // if other call sites want it). Returns an empty array if the group
  // doesn't exist.
  function getGroupTabs(state: TabGroupState, groupKey: GroupKey): string[] {
    if (groupKey === 'right') return state.right.tabs;
    if (groupKey === 'bottom') return state.bottom.tabs;
    return state.floating.find((g) => g.groupId === groupKey)?.tabs ?? [];
  }
  ```

  Then the adapter:

  ```tsx
  const movePanel = useCallback(
    (
      panelId: string,
      sourceGroupId: string,
      targetGroupId: string,
      insertIndex: number
    ) => {
      if (sourceGroupId === targetGroupId) {
        // Same group → reorder within that group. reorderTabInGroup
        // eventually calls reorderTab() in tabGroupState.ts, which
        // removes the source tab first and then splices it back in at
        // the given index. When the source is BEFORE the insert index
        // in the original order, removing it shifts every later
        // position left by one, so the destination that the shared
        // drop coordinator reported (based on the pre-removal tab
        // layout) is now one slot too far right. Compensate here the
        // same way the Cluster migration does.
        //
        // Resolve the source's current position in the target group
        // via the authoritative tabGroups ref (not via the state
        // snapshot in closure — that may be stale if two drops fire in
        // rapid succession), AND via the getGroupTabs helper (not via
        // direct property access — that returns undefined for floating
        // group ids because floating groups live in an array, not as
        // keys on TabGroupState).
        const groupTabs = getGroupTabs(tabGroupsRef.current, targetGroupId as GroupKey);
        const sourceIdx = groupTabs.indexOf(panelId);
        const adjustedInsert =
          sourceIdx >= 0 && sourceIdx < insertIndex ? insertIndex - 1 : insertIndex;
        if (sourceIdx === adjustedInsert) return; // no-op drop onto self
        reorderTabInGroup(targetGroupId as GroupKey, panelId, adjustedInsert);
      } else {
        // Cross group → moveBetweenGroups takes (panelId, targetGroupKey,
        // insertIndex). The source is determined internally by walking
        // the current tabGroups state to find where `panelId` lives. No
        // shift compensation needed: cross-group moves remove the
        // source from a DIFFERENT array than the insert, so index math
        // in the target isn't affected by the removal.
        movePanelBetweenGroups(panelId, targetGroupId as GroupKey, insertIndex);
      }
    },
    [reorderTabInGroup, movePanelBetweenGroups]
  );
  ```

  **Why `tabGroupsRef` and not the state snapshot:** the provider already maintains a ref mirror of `tabGroups` state for stale-closure-free reads (check the current file for the exact name — it may be `tabGroupsRef` or similar). The adapter must read the latest tab order because `reorderTabInGroup` is called synchronously and the React state snapshot in closure may be stale if two drops fire in rapid succession.

  **Why the helper, not direct property access:** `TabGroupState` is an asymmetric shape. `state.right.tabs` and `state.bottom.tabs` work because those group keys are literal property names on the state object. Floating groups, however, live inside `state.floating: FloatingTabGroup[]` and are looked up by walking that array for a matching `groupId`. Without the helper, the adapter would silently skip the shift compensation for every floating-group reorder and forward drops on floating strips would land one slot too far right — the exact bug the Cluster migration and this Dockable migration both fix. If other call sites in `DockablePanelProvider.tsx` already have an equivalent helper (e.g. `findGroupByKey` or similar), reuse it instead of defining `getGroupTabs` inline; grep the current file before adding a duplicate. If no helper exists, prefer to add `getGroupTabs` to `tabGroupState.ts` as an exported utility rather than colocating it in the provider — other future callers (tests, adapters) are likely to need the same lookup.

  **Trace verification** for a 4-tab group `['a','b','c','d']`, source `'a'` (sourceIdx=0):
  - `insertIndex=0` (drop on self at start): `sourceIdx < insertIndex` false, `adjustedInsert = 0`, `sourceIdx === adjustedInsert` → no-op ✓
  - `insertIndex=1` (drop right after self): `sourceIdx < insertIndex` true, `adjustedInsert = 0`, `sourceIdx === adjustedInsert` → no-op ✓
  - `insertIndex=2` (drop between b and c): `adjustedInsert = 1`, reorderTab removes 'a' → `['b','c','d']`, splices at 1 → `['b','a','c','d']` ✓
  - `insertIndex=3` (drop between c and d): `adjustedInsert = 2`, reorderTab removes 'a' → `['b','c','d']`, splices at 2 → `['b','c','a','d']` ✓
  - `insertIndex=4` (drop at end): `adjustedInsert = 3`, reorderTab removes 'a' → `['b','c','d']`, splices at 3 → `['b','c','d','a']` ✓

  For source `'c'` (sourceIdx=2):
  - `insertIndex=0`: `sourceIdx < insertIndex` false, `adjustedInsert = 0`, reorderTab removes 'c' → `['a','b','d']`, splices at 0 → `['c','a','b','d']` ✓
  - `insertIndex=2` (drop on self): `sourceIdx < insertIndex` false, `adjustedInsert = 2`, `sourceIdx === adjustedInsert` → no-op ✓
  - `insertIndex=3`: `sourceIdx < insertIndex` true, `adjustedInsert = 2`, `sourceIdx === adjustedInsert` → no-op ✓ (drop right after self is no-op)
  - `insertIndex=4`: `sourceIdx < insertIndex` true, `adjustedInsert = 3`, reorderTab removes 'c' → `['a','b','d']`, splices at 3 → `['a','b','d','c']` ✓

  **Floating-group verification** — the same traces must hold for a floating strip. Exercise a reorder within a group whose `groupId` is a runtime id like `'floating-xyz'`:
  - Seed `tabGroupsRef.current` with `{ right: {tabs: [], ...}, bottom: {tabs: [], ...}, floating: [{ groupId: 'floating-xyz', tabs: ['a','b','c','d'], activeTab: 'a' }] }`.
  - Call `movePanel('a', 'floating-xyz', 'floating-xyz', 2)`.
  - `getGroupTabs(state, 'floating-xyz')` must return `['a','b','c','d']` (NOT `[]`), so `sourceIdx = 0`, `adjustedInsert = 1`, and `reorderTabInGroup('floating-xyz', 'a', 1)` lands `'a'` between `'b'` and `'c'`. Final: `['b','a','c','d']`.
  - If `getGroupTabs` returns `[]` for a floating group, `sourceIdx` is `-1`, the compensation is skipped, and `reorderTabInGroup('floating-xyz', 'a', 2)` runs with the un-adjusted index → result `['b','c','a','d']` (one slot too far right). That wrong result is the exact signature of the floating-group bug; spotting it in a test is how you verify the helper works for all three branches (`right` / `bottom` / floating).

  **Add an automated test** for this specifically: render the provider with one floating group containing 4 tabs, dispatch a drop event on the floating strip's `[role="tab"]` elements to trigger a forward reorder, and assert the resulting tab order matches the intended visual position. This is the regression gate for `getGroupTabs`; without it a future refactor can silently break floating-group reorders and the bug only shows up in manual smoke tests.

  Every case lands at the intended visual position. Same correction the Cluster migration already applies; documented here because the Dockable path has its own state-mutation helper that exhibits the same source-removal-first semantics AND its state container has an asymmetric shape where floating groups live in an array keyed by `groupId` rather than as direct properties on `TabGroupState`.

  Export the adapter via the context value in Step 3.

- [x] **Step 5: Add the `createFloatingGroupWithPanel` adapter and the container-level empty-space drop target.**

  This is the replacement for the current gesture-based undock behavior (legacy mousemove handler at `DockablePanelProvider.tsx:599-627`). Per `design.md:393-404`, the design requires an explicit container-level `useTabDropTarget` that creates a floating group on drop.

  **Step 5a. Add the adapter function.** Near `movePanel`, add:

  ```tsx
  const createFloatingGroupWithPanel = useCallback(
    (panelId: string, _sourceGroupId: string, cursorPos: { x: number; y: number }) => {
      // Route the panel into the 'floating' group. movePanelBetweenGroups
      // generates a new floating group id internally when targetGroupKey
      // is 'floating', and pendingFocusPanelIdRef handles activation.
      movePanelBetweenGroups(panelId, 'floating');

      // Position the floating panel at the cursor, relative to the
      // content bounds. This mirrors the exact logic the legacy
      // mousemove handler at lines 617-621 of DockablePanelProvider.tsx
      // used, so the undock UX is visually preserved.
      const contentBounds = getContentBounds();
      setPanelFloatingPositionById(panelId, {
        x: cursorPos.x - contentBounds.left,
        y: cursorPos.y - contentBounds.top,
      });
    },
    [movePanelBetweenGroups, setPanelFloatingPositionById, getContentBounds]
  );
  ```

  Note `_sourceGroupId` is accepted for API symmetry (matches the `onDrop` callback shape) but unused — the existing `movePanelBetweenGroups` finds the source internally.

  **Step 5b. Identify the container target element.** The container-level drop target needs a DOM element that (a) wraps or sits behind the dockable panels so drops in empty space land on it, AND (b) actually receives pointer events. The `.dockable-panel-layer` element (`DockablePanelProvider.tsx:765`, CSS at `DockablePanel.css:3-8`) is **NOT a valid target** — it's declared `pointer-events: none` (line 6) specifically so drops fall through to the app content underneath, and only its `.dockable-panel` children opt back in via `pointer-events: auto` (line 11). If you attach `useTabDropTarget` to the layer directly, the browser will not route drop events to it; the drops will pass through to whatever is below.

  The two viable options are:

  1. **Attach the drop target to the existing app-content element (recommended).** Expose a small `useDockablePanelEmptySpaceDropTarget()` hook from `frontend/src/ui/dockable/DockablePanelContentArea.tsx` (or similar) that reads `createFloatingGroupWithPanel` from `useDockablePanelContext()`, calls `useTabDropTarget`, and returns the ref. Consumers merge the returned ref directly onto an **existing** DOM element in their layout — typically `AppLayout.tsx`'s main content area element. **Do NOT introduce a new wrapper element**; the drop target needs a real bounding rect for hit-testing, and every new nesting level is a risk of breaking unrelated CSS selectors. Example:

     ```tsx
     // New file: frontend/src/ui/dockable/DockablePanelContentArea.tsx
     export function useDockablePanelEmptySpaceDropTarget() {
       const { createFloatingGroupWithPanel } = useDockablePanelContext();
       return useTabDropTarget({
         accepts: ['dockable-tab'],
         onDrop: (payload, event) => {
           createFloatingGroupWithPanel(payload.panelId, payload.sourceGroupId, {
             x: event.clientX,
             y: event.clientY,
           });
         },
       });
     }
     ```

     Then in `AppLayout.tsx` (around the existing `<main className="app-main">` at the approximate mount point for dockable panels), merge the ref onto the existing element:

     ```tsx
     const { ref: emptySpaceDropRef } = useDockablePanelEmptySpaceDropTarget();

     return (
       <div className="app-container">
         <AppHeader ... />
         <ClusterTabs />
         <main
           ref={emptySpaceDropRef as (el: HTMLElement | null) => void}
           className={`app-main ${hasActiveClusters ? '' : 'app-main-inactive'}`}
         >
           <Sidebar />
           {/* existing dockable panel content */}
         </main>
       </div>
     );
     ```

     The `<main>` element already has a real layout box (`display: flex` or similar — inherited from existing styles), so the browser can hit-test drops against its bounding rect. No new nesting, no new CSS, no `display: contents`, no ghost wrappers. The drop target's hit area is exactly the existing main content region.

     **Why a new wrapper component would be wrong.** A purely structural wrapper (`<DockablePanelContentArea><main>...</main></DockablePanelContentArea>`) is NOT safe even if it "just inherits" the parent's layout. Either the wrapper has a real layout box (which changes the nesting depth for any CSS selector like `.app > main`, `.app-container > main`, `[data-testid="app-main"] + *`, etc.) OR you reach for `display: contents` to flatten it — and `display: contents` **deletes the element's hit area entirely**. An element with `display: contents` has no bounding rect and no surface for drop hit-testing; empty space within the "logical" wrapper region falls through to whatever is behind, and the empty-space drop target that the wrapper was supposed to provide simply doesn't work. **Never put `display: contents` on a drop-target element.** The only safe pattern is the one above: merge the ref onto an existing real box that already has the layout role you need.

  2. **Hoist the drop target onto `hostNode` with a pointer-events override.** If option 1 requires layout surgery that bleeds into unrelated code, the fallback is to give the `.dockable-panel-layer` element targeted pointer-events back. Add a new child element inside the layer (or modify the layer's CSS) that covers the layer area with `pointer-events: auto` **only for drag events**. Native HTML5 drag events DO fire on elements with `pointer-events: none` in some browsers but behavior is inconsistent, so the safe path is a new child element:

     ```css
     .dockable-panel-layer__drop-catcher {
       position: absolute;
       inset: 0;
       pointer-events: auto;
       z-index: 0; /* below .dockable-panel children */
     }
     ```

     The `.dockable-panel-layer > .dockable-panel` children sit at a higher z-index and with their own `pointer-events: auto`, so they still receive clicks normally. The drop-catcher element only catches drops that fall through the panels into empty space. This is more invasive (changes the layer's hit-testing model for any drag event, even non-tab drags that happen to pass over the layer) and should only be chosen if option 1 is impractical.

  **Do NOT attach the drop target directly to `.dockable-panel-layer` itself** — the `pointer-events: none` on line 6 of `DockablePanel.css` will prevent the browser from ever routing drag/drop events to it, and the implementer will spend hours debugging why their drop target never fires.

  **Step 5c. Wire the drop target.** If you chose option 1 in Step 5b (the recommended path), the `useTabDropTarget` call lives inside the `useDockablePanelEmptySpaceDropTarget` hook defined in the new `DockablePanelContentArea.tsx` file — NOT inside `DockablePanelProvider` — because the provider doesn't own a DOM element that matches the "content area" scope. The hook reads `createFloatingGroupWithPanel` from `useDockablePanelContext()` and returns the drop target ref; `AppLayout.tsx` calls the hook and merges the returned ref onto its existing `<main>` element (no new nesting, no new wrapper component, no `display: contents` — just a ref merge onto a real DOM element that already has a layout box). The provider's only Step 5 responsibility in that case is (a) exposing `createFloatingGroupWithPanel` on the context value (already done in Step 3).

  If you chose option 2 (the drop-catcher child element), the `useTabDropTarget` call goes inside the provider at the top level alongside the other hook calls, and the returned ref attaches to a new `<div className="dockable-panel-layer__drop-catcher">` that's rendered as the first child of the layer node.

  **Update `Task 9` Files:** if you chose option 1, add `Create: frontend/src/ui/dockable/DockablePanelContentArea.tsx` to Task 9's Files list and `Modify: frontend/src/ui/layout/AppLayout.tsx` for the ref merge. If you chose option 2, add `Modify: frontend/src/ui/dockable/DockablePanel.css` for the `.dockable-panel-layer__drop-catcher` rule and modify `DockablePanelProvider.tsx` to render the drop-catcher inside the layer host node.

  **Step 5d. Verify nested drop-target isolation works.** Native HTML5 drag-and-drop events BUBBLE by default — `preventDefault` alone is not enough to stop propagation. Task 1a added an `event.stopPropagation()` call to `useTabDropTarget`'s internal drop handler specifically so that consuming targets don't leak drops to ancestor targets. Without Task 1a, a drop inside a `DockableTabBar`'s drop target would fire the bar's `onDrop` first AND then bubble up to the container-level `useTabDropTarget` on the layer, which would misinterpret the reorder as an empty-space drop and spawn a spurious floating group. With Task 1a in place, the inner bar target's `onDrop` calls `stopPropagation` after consuming the event, and the container target never sees it.

  Verify this by hand: open 2+ dockable panels. First, drop a tab on the other panel's bar and confirm it moves there (`movePanel` fires, no new floating group is created). Then drop a tab on empty space outside any bar and confirm it becomes a new floating group (`createFloatingGroupWithPanel` fires, no reorder fires). If a single drop ever triggers BOTH behaviors, that's a regression of Task 1a's `stopPropagation` — re-check `useTabDropTarget.ts` for the `event.stopPropagation()` call inside `handleDrop`.

- [x] **Step 6: Delete the live cursor-tracking machinery, the custom drop-detection state, and the tab-bar registry.**

  With Steps 4 and 5 in place, the legacy drag-state machine now has a complete replacement and can be deleted wholesale. The following code all gets removed:
  - The `dragState` state variable, its setter, and anything that reads it.
  - `startTabDrag` / `endTabDrag` methods on the context value and their implementations.
  - The document-level `mousemove` / `mouseup` handler at `DockablePanelProvider.tsx:599-627` (approx) that computed drop targets, read the `tabBarElementsRef` registry for undock detection, called `reorderTabInGroup` / `movePanelBetweenGroups`, and cleared `dragState`. Drop detection is now handled by `useTabDropTarget` inside `DockableTabBar` (which dispatches to `movePanel` from Step 4 via the context) and by the container-level `useTabDropTarget` in Step 5 (which dispatches to `createFloatingGroupWithPanel`).
  - The `UNDOCK_THRESHOLD` constant. It was read exclusively by the mousemove handler being deleted above, and the feature it gated (undock-to-floating) is now handled by the Step 5 empty-space drop target. Nothing else in the codebase references it — grep before deleting to confirm.
  - The `tabBarElementsRef = useRef(new Map<string, HTMLElement>())` declaration and the `registerTabBarElement` callback that writes to it. The grep (`grep -rn "tabBarElementsRef\|registerTabBarElement" frontend/src`) against the current live code returns **three sites**: the field + setter at `DockablePanelProvider.tsx:88,220,229`, the one reader at `DockablePanelProvider.tsx:608` (the mousemove handler being deleted above), and one consumer-side useEffect at `DockableTabBar.tsx:56-61`. Task 8 already deletes the consumer-side useEffect, and this step deletes the reader + the field + the setter. Zero remaining usages → full removal.
  - `registerTabBarElement` as an exposed field on `DockablePanelContextValue`. Remove it from the type, from the `useMemo` context value, and from the dev-time `useContext` return shape.
  - The pointermove (or dragover) listener that sets `--dockable-tab-drag-x` / `--dockable-tab-drag-y` CSS custom properties on the preview element. The live cursor-tracking effect is dropped per `design.md:28`; the browser handles drag-image positioning natively via the `setDragImage(element, offsetX, offsetY)` call in each tab's `getDragImage`.
  - The `--dockable-tab-drag-x` / `--dockable-tab-drag-y` CSS custom properties themselves, and the `transform: translate3d(var(...), var(...), 0)` rule on `.dockable-tab-drag-preview` that consumed them. These get deleted from `DockablePanel.css` in Task 10 — don't forget to do both sides.

  **KEEP:**
  - `reorderTabInGroup`, `movePanelBetweenGroups`, `movePanelBetweenGroupsAndFocus`, `setPanelFloatingPositionById`, and `getContentBounds` — all unchanged. The new adapters from Steps 4 and 5 delegate to them; other non-drag code paths (panel lifecycle, close buttons, layout persistence) still call them directly.
  - `movePanel` and `createFloatingGroupWithPanel` — added in Steps 4 and 5 respectively, exposed on the context value.
  - The always-mounted `.dockable-tab-drag-preview` element and its `dragPreviewRef`.
  - Any panel-management code unrelated to drag (panel creation, close, collapse, layout persistence, etc.).

  **Verification:** after deleting, run `grep -rn "tabBarElementsRef\|registerTabBarElement\|startTabDrag\|endTabDrag\|dragState\|UNDOCK_THRESHOLD" frontend/src` — expected: **zero** hits. If any remain, they're dangling references to the removed infrastructure and need to be deleted too (or the test suite will fail at import time).

  **Why no replacement "global dragover listener" is needed:** the entire cursor-tracking effect is now provided by the browser's native drag-image rendering. Each tab's `getDragImage` option is called once at dragstart; it updates the preview element's label + kind class synchronously, then returns `{ element, offsetX, offsetY }` to `useTabDragSourceFactory`'s internal `onDragStart`, which calls `event.dataTransfer.setDragImage(element, offsetX, offsetY)`. The browser takes a snapshot of the element right then and displays that snapshot at the cursor for the rest of the drag. No pointermove listener, no CSS var updates, no per-frame state to maintain.

- [x] **Step 7: Update the provider tests.**

  `DockablePanelProvider.test.tsx` asserts against the drag preview element and against the registered bar elements. Update to match the new flow:
  - Preview element is always mounted (not conditional on `dragState`). Any assertion like `queryByTestId('dockable-tab-drag-preview')` that was scoped to during-drag should now expect the element always, and check its inner `.dockable-tab-drag-preview__label` textContent for the "is a drag in flight" signal instead (the label text is updated by `getDragImage` at dragstart and stays until the next drag overwrites it).
  - No more assertions on `--dockable-tab-drag-x` / `--dockable-tab-drag-y` CSS custom properties being set during drag. Those don't exist anymore.
  - `movePanel` and `createFloatingGroupWithPanel` are exposed on the context value and callable from test helpers.
  - Delete every `registerTabBarElement` assertion — the registry is gone. Tests that set up fixtures via `registerTabBarElement(groupKey, domNode)` need to be rewritten to dispatch drop events directly on the rendered `[role="tab"]` elements and assert the resulting `movePanel` / state change.
  - Drag-start / drag-end lifecycle assertions that were scoped to `startTabDrag` / `endTabDrag` migrate to checking `useTabDragSourceFactory`-driven events instead — dispatch `dragstart` on a `[role="tab"]` element and verify the label inside `.dockable-tab-drag-preview` updates.
  - **Add** a test for the container-level empty-space drop target: render the provider with two groups, dispatch a `drop` event on the container element (outside any tab bar's drop zone) carrying a `dockable-tab` payload, and assert that the panel moved to a new `floating` group with its position set via `setPanelFloatingPositionById`. This is the automated gate for the design.md:393 requirement; a regression here means the empty-space-to-floating feature silently broke.

- [x] **Step 8: Run the dockable tests.**

  ```bash
  ./node_modules/.bin/vitest run src/ui/dockable/
  ```

  Expected: all tests pass.

- [ ] **Step 9: Manual smoke test.**

  Open the app. Open 4+ dockable panels. Verify:
  - Within-strip reorder works (drag a tab left/right within the same bar).
  - Cross-strip moves work (drag from one bar to another).
  - The drag preview appears under the cursor as soon as the drag begins and carries the correct tab label + kind badge. (It's a static browser-rendered snapshot — no live CSS-var updates, no per-frame tracking. The visual looks identical to pre-migration behavior because the CSS styling of `.dockable-tab-drag-preview` is unchanged; only the cursor-tracking mechanism moves from provider-owned pointermove updates to browser-native drag-image rendering.)
  - The drop-position indicator bar appears inside the target strip.
  - **Empty-space drop creates a floating panel (REQUIRED):** drag a tab away from its current bar and drop it on empty space within the dockable content area (a gap between panels, or the layer background with no panels at all). The panel should detach into a new floating group positioned at the cursor. This replaces the legacy "drag far away from the source bar" gesture trigger with an explicit drop target, but the end result — a new floating panel at the cursor — is identical to pre-migration behavior. If this doesn't work, the container-level `useTabDropTarget` from Step 5 isn't wired correctly; check the ref assignment and the element it's attached to.
  - Overflow chevrons appear and scroll correctly when many tabs are open.
  - Clicking a tab still activates it.
  - Close button still works.

- [x] **Step 10:** Report task complete and wait for user review.

---

### Task 10: Delete dead Dockable CSS

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanel.css`

- [x] **Step 1: Delete rules the shared component now handles.**

  In `DockablePanel.css`, delete:
  - `.dockable-tab-bar::-webkit-scrollbar { display: none }` — shared `.tab-strip::-webkit-scrollbar` covers this
  - `.dockable-tab` class styles that duplicate `.tab-item` — diff against `tabs.css`, delete duplicates
  - `.dockable-tab__label` truncation rules — shared `.tab-item__label` handles this
  - `.dockable-tab-bar__overflow-indicator` and all `.dockable-tab-bar__overflow-*` rules — shared `.tab-strip__overflow-indicator` covers these
  - `.dockable-tab-bar__drop-indicator` — shared `.tab-strip__drop-indicator` covers it

- [x] **Step 2: Strip the live cursor-tracking plumbing from `.dockable-tab-drag-preview`.**

  Per `design.md:28` and the Task 9 rewrite, the preview element is now positioned by the browser's native drag-image rendering, not by provider-driven CSS custom properties. In `DockablePanel.css`, modify the `.dockable-tab-drag-preview` rule to:
  - **Delete** the `transform: translate3d(var(--dockable-tab-drag-x, -9999px), var(--dockable-tab-drag-y, -9999px), 0)` declaration — the CSS custom properties no longer exist, and the browser's drag image handles positioning.
  - **Replace** it with an offscreen-by-default rule that keeps the element out of sight when no drag is in flight (e.g., `position: fixed; top: -9999px; left: -9999px;`) so the element doesn't visually pollute the app between drags. `setDragImage` screenshots the element at its current computed styles, so offscreen positioning is fine.
  - **Keep** the rest of the `.dockable-tab-drag-preview` rule body (padding, border, background, color, font-size, max-width, border-radius, box-shadow) — that's the visual styling the design doc explicitly says to preserve.
  - **Keep** the `.dockable-tab-drag-preview__kind` and `.dockable-tab-drag-preview__label` child rules unchanged.

- [x] **Step 3: Review what else to keep vs. delete.**

  KEEP:
  - `.dockable-tab-bar-shell` container layout (it's still the wrapper around `<Tabs>`)
  - `.dockable-tab-bar` layout rules (`height: 100%`, `flex: 1`, etc.) — applied via `className="dockable-tab-bar"` on the shared component's root
  - `.dockable-tab-bar--drag-active` / `.dockable-tab-bar--drop-target` — if still used anywhere; otherwise delete
  - `.dockable-tab__kind-indicator.kind-badge` override — this is the leading-slot visual, still needed
  - `.dockable-tab-drag-preview` (with the transform/CSS-var rule stripped per Step 2) and all `.dockable-tab-drag-preview__*` rules — the visual styling is preserved, only the cursor-tracking mechanism is gone
  - `.dockable-tab--dragging` — if used for drag-source visual feedback via `extraProps` conditional classNames; otherwise delete

- [x] **Step 4: Run tests and manual smoke again.**

  ```bash
  ./node_modules/.bin/vitest run src/ui/dockable/
  ```

  Visually spot-check that no CSS regression occurred during deletion. Pay particular attention to the drag preview: starting a drag should still show a styled preview at the cursor (the static snapshot), and the preview element should not be visible on screen between drags.

- [x] **Step 5:** Report task complete and wait for user review.

---

## Final cleanup

### Task 11: Delete the preview stories

**Files:**
- Delete: `frontend/src/shared/components/tabs/ObjectTabsPreview.stories.tsx`
- Delete: `frontend/src/shared/components/tabs/ObjectPanelTabsPreview.stories.tsx`
- Delete: `frontend/src/shared/components/tabs/ClusterTabsPreview.stories.tsx`
- Delete: `frontend/src/shared/components/tabs/stories.css` (if no other file references it)
- Modify: `frontend/.storybook/preview.ts` — remove preview story entries from the `storySort` order

Once all four consumers migrate, the preview stories become redundant — they were built specifically to validate the shared component in isolation and to smoke-test the migration pattern. The real consumers now demonstrate the same behaviors in-context. Keep `Tabs.stories.tsx` (the raw `DisabledTabs` etc. demos) and `TabsWithDrag.stories.tsx` (type-safety and tear-off demos) since those still showcase shared-component-specific features the consumers don't cover individually.

- [x] **Step 1: Delete the three preview story files.**
- [x] **Step 2: Delete `stories.css`** if nothing else references it. Verify:
  ```bash
  grep -rn "stories.css\|tabs-story-" /Volumes/git/luxury-yacht/app/frontend/src
  ```
  If only `Tabs.stories.tsx` or `TabsWithDrag.stories.tsx` hits, move the minimum-needed classes back into those files' local styles OR keep `stories.css` around for them. If zero hits, delete.

  Kept `stories.css` — `TabsWithDrag.stories.tsx` still uses `tabs-story-drag-*` classes extensively.
- [x] **Step 3: Update `.storybook/preview.ts`** — remove the three preview-story ids from the `storySort` order array.
- [x] **Step 4: Run tests and start storybook** to confirm nothing broke.
- [x] **Step 5:** Report task complete and wait for user review.

### Task 12: Update the design doc

**Files:**
- Modify: `docs/plans/shared-tabs-component-design.md`

- [x] **Step 1:** Add a "Consumers" section at the bottom listing all four consumers and their current migration status (now: all migrated). Remove any references to `useTabStyles` or the preview stories from the doc. Confirm the `TabsProps` block lists `disableRovingTabIndex` and that `TabDescriptor` lists `closeIcon` / `closeAriaLabel` (added in Tasks 1 and 2).
- [x] **Step 2:** Report task complete and wait for user review.

### Task 13: Final QC gate

**Files:**
- No changes.

- [x] **Step 1: Run the full release check.**

  ```bash
  cd /Volumes/git/luxury-yacht/app && mage qc:prerelease
  ```

  Expected: clean exit.

- [ ] **Step 2: Boot Storybook and click through every remaining story.**

  Run `npm run storybook` and verify every story still renders and exercises the behaviors it claims to.

- [ ] **Step 3: Boot the full app and smoke-test each consumer.**

  - Object Panel tabs: click through, uppercase labels, focus behavior
  - Diagnostics Panel tabs: click through, uppercase labels, focus behavior
  - Cluster Tabs: reorder via drag, close with port-forward modal, `--cluster-tabs-height` CSS var
  - Dockable tab bars: within-strip reorder (drag a tab left/right within the same bar), cross-strip move (drag a tab from one bar to another), **empty-space undock-to-floating-group (drop a tab on empty space between or around panels → new floating group at the cursor)**, overflow chevrons, custom drag preview. All five behaviors must work — the empty-space drop in particular is a required migration target per `design.md:393` and was previously provided by the now-deleted legacy mousemove handler, so regressing it is a silent ship-blocker.

- [ ] **Step 4:** Report Phase 2 complete.

---

## Risks and mitigations

**Risk: `DockablePanelProvider` migration breaks cross-strip drag or the undock-to-floating feature.**
Mitigation: Task 9 has the largest surface area and the most code to delete. Since Task 2b already mounted `TabDragProvider` at the app root, the recommended sequencing is: (1) mount the always-in-DOM preview element (Step 2), (2) expose `dragPreviewRef` + add both adapters (`movePanel` in Step 4, `createFloatingGroupWithPanel` in Step 5), (3) wire up the container-level empty-space drop target (Step 5), (4) verify within-strip reorder, cross-strip moves, AND empty-space undock-to-floating all work via the new shared-coordinator paths before deleting ANY legacy code. Only AFTER all three behaviors are green against the new paths, delete the `dragState` / `startTabDrag` / mousemove / registry / `UNDOCK_THRESHOLD` machinery (Step 6). This order means the old and new systems coexist briefly — both the legacy mousemove undock AND the new container drop target will handle undock until Step 6 deletes the legacy path, but the result is the same (both call into `movePanelBetweenGroups(panelId, 'floating')`), so no conflict. Iterate in small commits so regressions are easy to bisect.

**Risk: The custom focus-management systems in ObjectPanel / Diagnostics regress.**
Mitigation: the `disableRovingTabIndex` prop is explicitly designed to preserve those systems' invariants. The `data-*-focusable` attributes pass through cleanly via `extraProps`. If any manual smoke test fails, the focus walker is probably not finding the shared component's output — verify the attribute made it onto the rendered DOM.

**Risk: `useTabDragSourceFactory` creates new function identities on every render.**
Mitigation: the factory call inside `.map()` produces a fresh `{ onDragStart, onDragEnd }` closure per render per tab. These closures are attached to the DOM via prop spreading, so React re-attaches event listeners on each render of the consumer. The perf cost is negligible for realistic tab counts (tens, not thousands), and correctness is unaffected because the closures capture the latest `payload` and `options`. If this ever shows up in a profile, the fix is to memoize the descriptors array with `useMemo` keyed on `[tabs, makeDragSource]` — the factory identity is stable across renders when the context values are stable, so the memoization works as expected.

**Risk: The `.dockable-tab-drag-preview` visual regresses after the live cursor-tracking machinery is removed.**
Mitigation: The element's visual styling (padding, border, background, badge + label layout) is preserved byte-for-byte in Task 10 — only the `transform: translate3d(var(...), var(...), 0)` rule and its CSS custom properties are removed. Cursor positioning is handed off to the browser's native drag-image rendering via `event.dataTransfer.setDragImage(element, 14, 16)`. The Phase 1 `ObjectTabsPreview` story already demonstrates this approach works correctly in Safari and Firefox — if the visual doesn't match after migration, diff the computed styles of `.dockable-tab-drag-preview` in devtools against the Phase 1 story's rendering to find the drift. The brainstorming explicitly accepted the "static snapshot instead of live follow" tradeoff in `design.md:28`; reintroducing pointermove tracking to "fix" any perceived snappiness regression would reopen that compromise and is not allowed by the plan.

**Risk: Drag tests in existing consumer test files break because they use the old native drag event shapes.**
Mitigation: The shared drag coordinator ALSO uses native HTML5 drag events, so existing tests that simulate `dragstart` / `drop` on tab elements should continue to work with minor query updates (`.dockable-tab` → `[role="tab"]`). Tests that mock module-level state (`useTabDragSource`) will need rewriting, but the simpler end-to-end approach (dispatch real events, assert on persistence/state-change side effects) is preferred.

---

## Acceptance criteria

Phase 2 is complete when:

- [ ] All four consumers render their tab strips via `<Tabs>` from `@shared/components/tabs`
- [ ] The `useTabStyles` backward-compat shim is deleted
- [ ] The legacy `Tabs/index.tsx` barrel is deleted
- [ ] Per-consumer tab markup and tab-specific CSS duplication is removed (the diff should show net deletion in every consumer file)
- [ ] `mage qc:prerelease` passes
- [ ] All pre-migration behaviors are preserved end-to-end:
  - Within-strip reorder (Cluster and Dockable)
  - Cross-strip moves (Dockable)
  - **Empty-space undock-to-floating-group (Dockable)** — previously provided by the legacy mousemove `UNDOCK_THRESHOLD` handler, now provided by the container-level `useTabDropTarget` from Task 9 Step 5. Regressing this is explicitly a ship-blocker per `design.md:393`.
  - Port-forward close confirmation modal (Cluster)
  - Custom focus management in Object Panel and Diagnostics (via `disableRovingTabIndex`)
  - Overflow chevrons (Cluster and Dockable)
  - Static drag preview (Dockable, via `setDragImage`)
- [ ] The design doc reflects the final API surface (including `disableRovingTabIndex`, `closeIcon`, `closeAriaLabel`, `useTabDragSourceFactory`)
- [ ] The preview stories are deleted
- [ ] `grep -rn "tabBarElementsRef\|registerTabBarElement\|startTabDrag\|endTabDrag\|dragState\|UNDOCK_THRESHOLD\|useTabStyles\|dockable-tab-drag-x\|dockable-tab-drag-y" frontend/src` returns zero hits — all legacy drag-state / live-preview infrastructure and the back-compat shim are fully removed
