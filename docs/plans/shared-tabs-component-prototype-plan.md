# Shared Tabs Component — Phase 1 Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Git policy:** Per project `AGENTS.md`, NEVER run state-modifying git commands without explicit user direction. Each task ends with "Report task complete and wait for user review" instead of an automatic commit. The user will commit at appropriate boundaries.
>
> **Skill calls:** Two tasks (Task 28 and Task 36) require invoking the `new-story` skill via the Skill tool. Do not write Storybook story files by hand — follow the skill's rules.

**Goal:** Build the prototype `<Tabs>` component and drag coordinator, validate them in Storybook, before any real consumer is migrated. Phase 2 (migrating Object Panel, Diagnostics, Cluster Tabs, Dockable Tabs) is gated on user approval of this prototype and is covered by a separate plan.

**Architecture:** A new universal base component `<Tabs>` at `frontend/src/shared/components/tabs/Tabs.tsx` that owns rendering, ARIA, manual-activation keyboard nav, sizing, overflow scrolling, and close-button overlay. A separate drag coordinator module under `dragCoordinator/` exposing `TabDragProvider`, `useTabDragSource`, and `useTabDropTarget` hooks built on HTML5 native drag events with `setDragImage` for custom previews. The discriminated payload union (`'cluster-tab' | 'dockable-tab'`) makes cross-system drops impossible by construction. Two Storybook story files validate everything interactively.

**Tech Stack:** React 19, TypeScript, Vitest + jsdom, Storybook 10 (`@storybook/react-vite`)

**Reference:** [`docs/plans/shared-tabs-component-design.md`](shared-tabs-component-design.md) — full design spec.

---

## ⚠️ Post-prototype revisions (do NOT re-implement the superseded tasks)

Several tasks in this plan specified behaviors that were revised during the prototype review. The design doc is authoritative; this plan is historical. The following tasks are **superseded** and their original test/code snippets should NOT be used:

- **Task 17 (Edge cases — invalid `activeId`):** The original test asserted every tab has `tabIndex=-1` when `activeId` doesn't match. This was a keyboard-reachability bug — it stranded the entire strip. The corrected contract is a roving-tabindex fallback: when no tab matches `activeId`, the first non-disabled tab gets `tabIndex=0` so the strip remains reachable via Tab. See `design.md` → "Behavior contracts → Keyboard".
- **Task 18 (Overflow — per-side independent chevron rendering):** The original spec rendered the left chevron only when tabs were hidden on the left and the right chevron only when tabs were hidden on the right, each conditionally. This was replaced with a single `hasOverflow: boolean` that mounts **both** chevrons together whenever the strip overflows, and each chevron is greyed out via the native `disabled` attribute at its exhausted extreme. The simpler model guarantees tab positions stay stable across clicks (no layout shifts when an indicator appears/disappears), which is what makes the scroll math work.
- **Task 19 (Overflow scroll button click action — fixed-pixel scrollBy):** The original spec used `scrollBy({ left: ±200, behavior: 'smooth' })`. This was replaced by a per-tab navigation algorithm that finds the first clipped tab on the relevant side and computes an exact scroll target, animated manually via `requestAnimationFrame` (250ms ease-out-cubic). Manual rAF replaces `scrollTo({ behavior: 'smooth' })` because Firefox's smooth scroll is unreliable under rapid consecutive interruption.
- **Task 21 (Overflow count badge):** Dropped entirely. There is no count badge on either chevron and no `.tab-strip__overflow-count` rule in `tabs.css`. Rationale: once the model is "both chevrons always mounted together", there's no per-side state to display a count for, and the chevron itself is sufficient signal. The test for this task was rewritten as "renders both overflow indicators together once the strip overflows".
- **`minTabWidth` default:** The plan/design originally said "default 80px". The corrected default is mode-specific — `0` in `fit` mode (so short labels don't get bloated), `80px` in `equal` mode (so tabs sharing a strip don't collapse). Closeable tabs in `fit` mode additionally get an 80px floor via CSS to reserve room for the close button overlay.
- **Tab root element:** The plan/design described each tab as a `<button role="tab">`. This was revised to `<div role="tab">` so the close affordance can be a real nested `<button type="button">` without violating HTML's ban on interactive content inside `<button>`. The `<div>` gets keyboard focusability via roving `tabIndex`, and Enter/Space activation is handled explicitly in `handleKeyDown`.
- **Drop indicator prop (new, not in original plan):** A `dropInsertIndex?: number | null` prop was added to render a thin accent-colored vertical bar at a given flex position to show the drop landing site during a drag. `useTabDropTarget` tracks the index on `dragover` and exposes it alongside `isDragOver`, and passes it into `onDrop` as a third argument.

If you are implementing Phase 2 against this plan, refer to `design.md` for the current contracts and use the implementation in `frontend/src/shared/components/tabs/` as the source of truth.

---

## File Structure

**New files (11):**

```
frontend/src/shared/components/tabs/
├── Tabs.tsx                                 # Base component
├── Tabs.test.tsx                            # Base component tests
├── Tabs.stories.tsx                         # Non-drag Storybook stories (via new-story skill)
├── TabsWithDrag.stories.tsx                 # Drag Storybook stories (via new-story skill)
├── index.ts                                 # Public exports
└── dragCoordinator/
    ├── types.ts                             # TabDragPayload discriminated union
    ├── TabDragProvider.tsx                  # Provider with global dragend listener
    ├── useTabDragSource.ts                  # Source hook
    ├── useTabDropTarget.ts                  # Target hook
    ├── index.ts                             # Barrel export
    └── dragCoordinator.test.tsx             # Coordinator integration tests
```

**Modified files (1):**

```
frontend/styles/components/tabs.css          # Extended with sizing modifiers, custom
                                             # properties for min/max width, uppercase
                                             # variant, overflow indicator block
```

**Untouched (Phase 2 — out of scope for this plan):**

- All four existing consumer components (`ObjectPanelTabs.tsx`, inline diagnostics strip, `ClusterTabs.tsx`, `DockableTabBar.tsx`).
- The vestigial `frontend/src/shared/components/tabs/Tabs/index.tsx` `useTabStyles()` shim.
- All consumer-side CSS (`DockablePanel.css`, `ObjectPanel.css`, `ClusterTabs.css`, `DiagnosticsPanel.css`).
- Documentation files (`docs/development/UI/tabs.md`, `dockable-panels.md`).

These all change in Phase 2 after the prototype is approved.

---

## Test pattern reference

The codebase uses an imperative React 19 testing pattern via `react-dom/client` and `act`. **Match this pattern in all new tests.** Reference: `frontend/src/modules/object-panel/components/ObjectPanel/Maintenance/NodeMaintenanceTab.test.tsx`.

Standard test scaffolding:

```tsx
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

describe('Tabs', () => {
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

  it('does the thing', () => {
    act(() => {
      root.render(<Tabs ... />);
    });
    // Query DOM via container.querySelector(...)
    // Dispatch events via element.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  });
});
```

Run tests with: `cd frontend && /usr/bin/env bash -lc 'npx vitest run <path-to-test>'`

---

## Tasks

### Task 0: Verify infrastructure

**Files:** none (verification only)

- [ ] **Step 1:** Verify the frontend directory exists and has the expected structure.

  Run: `ls /Volumes/git/luxury-yacht/app/frontend/src/shared/components/tabs/`

  Expected output: lists `Tabs/` (the vestigial directory with `index.tsx` and `Tabs.css`).

- [ ] **Step 2:** Verify Vitest runs cleanly on a known file before any changes.

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/kubernetes/ActionsMenu.test.tsx'`

  Expected: `Test Files  1 passed (1)` with no failures.

- [ ] **Step 3:** Verify Storybook config exists.

  Run: `ls /Volumes/git/luxury-yacht/app/frontend/.storybook/`

  Expected: lists `main.ts`, `preview.ts`, `decorators/`, `mocks/`.

- [ ] **Step 4:** Report task complete and wait for user review.

---

### Task 1: Create the empty Tabs shell with required `aria-label`

**Files:**
- Create: `frontend/src/shared/components/tabs/Tabs.tsx`
- Create: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Create `frontend/src/shared/components/tabs/Tabs.test.tsx`:

  ```tsx
  /**
   * frontend/src/shared/components/tabs/Tabs.test.tsx
   */
  import ReactDOM from 'react-dom/client';
  import { act } from 'react';
  import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

  import { Tabs } from './Tabs';

  describe('Tabs', () => {
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

    it('renders an empty tablist with the required aria-label', () => {
      act(() => {
        root.render(
          <Tabs tabs={[]} activeId={null} onActivate={() => {}} aria-label="Test Tabs" />
        );
      });

      const tablist = container.querySelector('[role="tablist"]');
      expect(tablist).toBeTruthy();
      expect(tablist?.getAttribute('aria-label')).toBe('Test Tabs');
      expect(tablist?.querySelectorAll('[role="tab"]').length).toBe(0);
    });
  });
  ```

- [ ] **Step 2: Run the test, verify it fails (file does not exist).**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: error like `Cannot find module './Tabs'`.

- [ ] **Step 3: Create the minimal implementation.**

  Create `frontend/src/shared/components/tabs/Tabs.tsx`:

  ```tsx
  /**
   * frontend/src/shared/components/tabs/Tabs.tsx
   *
   * Universal tab strip base component. Owns rendering, ARIA roles,
   * manual-activation keyboard navigation, sizing, overflow scrolling,
   * and the close-button overlay. Knows nothing about drag, persistence,
   * or system-specific quirks — those live in wrapper components.
   *
   * See docs/plans/shared-tabs-component-design.md for the full design.
   */
  import type { HTMLAttributes, ReactNode } from 'react';

  export interface TabDescriptor {
    id: string;
    label: ReactNode;
  }

  export interface TabsProps {
    tabs: TabDescriptor[];
    activeId: string | null;
    onActivate: (id: string) => void;
    'aria-label': string;
  }

  export function Tabs({ tabs, 'aria-label': ariaLabel }: TabsProps) {
    return (
      <div role="tablist" aria-label={ariaLabel} className="tab-strip">
        {/* tabs rendered in next task */}
      </div>
    );
  }
  ```

- [ ] **Step 4: Run the test, verify it passes.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Test Files  1 passed (1)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 2: Render tabs from descriptors

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add this test inside the existing `describe('Tabs', ...)` in `Tabs.test.tsx`:

  ```tsx
  it('renders one button per tab descriptor with the right label', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
            { id: 'c', label: 'Gamma' },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs.length).toBe(3);
    expect(tabs[0].textContent).toContain('Alpha');
    expect(tabs[1].textContent).toContain('Beta');
    expect(tabs[2].textContent).toContain('Gamma');
  });
  ```

- [ ] **Step 2: Run the test, verify it fails (no buttons rendered yet).**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `expected 0 to be 3`.

- [ ] **Step 3: Implement tab rendering.**

  Replace the body of `Tabs.tsx` `Tabs` function with:

  ```tsx
  export function Tabs({ tabs, 'aria-label': ariaLabel }: TabsProps) {
    return (
      <div role="tablist" aria-label={ariaLabel} className="tab-strip">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="tab-item"
          >
            <span className="tab-item__label">{tab.label}</span>
          </button>
        ))}
      </div>
    );
  }
  ```

- [ ] **Step 4: Run the tests, verify both pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Test Files  1 passed (1)`, `Tests  2 passed (2)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 3: Active state (`aria-selected` + `tab-item--active` class)

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('marks the active tab with aria-selected and the active modifier class', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="b"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].classList.contains('tab-item--active')).toBe(false);
    expect(tabs[1].classList.contains('tab-item--active')).toBe(true);
  });
  ```

- [ ] **Step 2: Run the test, verify it fails.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: assertion failure on `aria-selected`.

- [ ] **Step 3: Implement active state.**

  Update `Tabs.tsx`:

  ```tsx
  export function Tabs({ tabs, activeId, 'aria-label': ariaLabel }: TabsProps) {
    return (
      <div role="tablist" aria-label={ariaLabel} className="tab-strip">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`tab-item${isActive ? ' tab-item--active' : ''}`}
            >
              <span className="tab-item__label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    );
  }
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  3 passed (3)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 4: Click activation + disabled tabs ignore clicks

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing tests.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('calls onActivate with the tab id when a tab is clicked', () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="a"
          onActivate={onActivate}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    act(() => {
      tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith('b');
  });

  it('does not call onActivate when a disabled tab is clicked', () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta', disabled: true },
          ]}
          activeId="a"
          onActivate={onActivate}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    act(() => {
      tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onActivate).not.toHaveBeenCalled();
    expect(tabs[1].getAttribute('aria-disabled')).toBe('true');
  });
  ```

- [ ] **Step 2: Run the tests, verify they fail.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: assertion failures.

- [ ] **Step 3: Implement click + disabled handling.**

  Add `disabled` to the descriptor and the click handler:

  ```tsx
  export interface TabDescriptor {
    id: string;
    label: ReactNode;
    disabled?: boolean;
  }

  export function Tabs({ tabs, activeId, onActivate, 'aria-label': ariaLabel }: TabsProps) {
    return (
      <div role="tablist" aria-label={ariaLabel} className="tab-strip">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-disabled={tab.disabled || undefined}
              className={`tab-item${isActive ? ' tab-item--active' : ''}`}
              onClick={() => {
                if (!tab.disabled) {
                  onActivate(tab.id);
                }
              }}
            >
              <span className="tab-item__label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    );
  }
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  5 passed (5)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 5: Roving tabIndex (active=0, others=−1)

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('uses a roving tabIndex so only the active tab is in the tab order', () => {
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
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[0].tabIndex).toBe(-1);
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[2].tabIndex).toBe(-1);
  });
  ```

- [ ] **Step 2: Run the test, verify it fails.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: assertion failure.

- [ ] **Step 3: Implement roving tabIndex.**

  Add the `tabIndex` prop to each `<button>` in `Tabs.tsx`:

  ```tsx
  <button
    key={tab.id}
    type="button"
    role="tab"
    aria-selected={isActive}
    aria-disabled={tab.disabled || undefined}
    tabIndex={isActive ? 0 : -1}
    className={`tab-item${isActive ? ' tab-item--active' : ''}`}
    onClick={() => {
      if (!tab.disabled) {
        onActivate(tab.id);
      }
    }}
  >
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  6 passed (6)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 6: Arrow key navigation moves focus without activating

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('moves focus between tabs on ArrowRight/ArrowLeft without changing the active tab', () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
            { id: 'c', label: 'Gamma' },
          ]}
          activeId="a"
          onActivate={onActivate}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0].focus();

    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[1]);
    expect(onActivate).not.toHaveBeenCalled();

    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    });
    expect(document.activeElement).toBe(tabs[2]);

    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    });
    // Wraps around to the first tab.
    expect(document.activeElement).toBe(tabs[0]);

    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
      );
    });
    // Wraps around backwards to the last tab.
    expect(document.activeElement).toBe(tabs[2]);

    expect(onActivate).not.toHaveBeenCalled();
  });
  ```

- [ ] **Step 2: Run the test, verify it fails.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: focus doesn't move.

- [ ] **Step 3: Implement arrow key handling.**

  Update `Tabs.tsx` to track refs for each tab button and handle keydown:

  ```tsx
  import { useRef, type HTMLAttributes, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';

  export function Tabs({ tabs, activeId, onActivate, 'aria-label': ariaLabel }: TabsProps) {
    const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    const focusTabAtIndex = (index: number) => {
      if (tabs.length === 0) return;
      const wrapped = ((index % tabs.length) + tabs.length) % tabs.length;
      const target = tabs[wrapped];
      const el = tabRefs.current.get(target.id);
      el?.focus();
    };

    const handleKeyDown = (
      event: ReactKeyboardEvent<HTMLButtonElement>,
      currentIndex: number
    ) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        focusTabAtIndex(currentIndex + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        focusTabAtIndex(currentIndex - 1);
      }
    };

    return (
      <div role="tablist" aria-label={ariaLabel} className="tab-strip">
        {tabs.map((tab, index) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              ref={(el) => {
                if (el) {
                  tabRefs.current.set(tab.id, el);
                } else {
                  tabRefs.current.delete(tab.id);
                }
              }}
              type="button"
              role="tab"
              aria-selected={isActive}
              aria-disabled={tab.disabled || undefined}
              tabIndex={isActive ? 0 : -1}
              className={`tab-item${isActive ? ' tab-item--active' : ''}`}
              onClick={() => {
                if (!tab.disabled) {
                  onActivate(tab.id);
                }
              }}
              onKeyDown={(event) => handleKeyDown(event, index)}
            >
              <span className="tab-item__label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    );
  }
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  7 passed (7)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 7: Home/End and disabled-tab skipping in keyboard nav

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing tests.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('jumps focus to the first tab on Home and the last tab on End', () => {
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
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[1].focus();

    act(() => {
      tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[2]);

    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true })
      );
    });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('skips disabled tabs during arrow navigation', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta', disabled: true },
            { id: 'c', label: 'Gamma' },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0].focus();

    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[2]);
  });
  ```

- [ ] **Step 2: Run the tests, verify they fail.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: failures on Home/End and disabled-skip.

- [ ] **Step 3: Implement Home/End + disabled-skip.**

  Replace the `focusTabAtIndex` and `handleKeyDown` functions in `Tabs.tsx`:

  ```tsx
  const focusFirstEnabled = () => {
    const idx = tabs.findIndex((t) => !t.disabled);
    if (idx >= 0) tabRefs.current.get(tabs[idx].id)?.focus();
  };

  const focusLastEnabled = () => {
    for (let i = tabs.length - 1; i >= 0; i--) {
      if (!tabs[i].disabled) {
        tabRefs.current.get(tabs[i].id)?.focus();
        return;
      }
    }
  };

  const focusNextEnabled = (currentIndex: number, direction: 1 | -1) => {
    if (tabs.length === 0) return;
    let next = currentIndex;
    for (let i = 0; i < tabs.length; i++) {
      next = ((next + direction) % tabs.length + tabs.length) % tabs.length;
      if (!tabs[next].disabled) {
        tabRefs.current.get(tabs[next].id)?.focus();
        return;
      }
    }
  };

  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusNextEnabled(currentIndex, 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusNextEnabled(currentIndex, -1);
        break;
      case 'Home':
        event.preventDefault();
        focusFirstEnabled();
        break;
      case 'End':
        event.preventDefault();
        focusLastEnabled();
        break;
    }
  };
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  9 passed (9)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 8: Enter and Space activate the focused tab

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing tests.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('activates the focused tab on Enter', () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="a"
          onActivate={onActivate}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[1].focus();

    act(() => {
      tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onActivate).toHaveBeenCalledWith('b');
  });

  it('activates the focused tab on Space', () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="a"
          onActivate={onActivate}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[1].focus();

    act(() => {
      tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });

    expect(onActivate).toHaveBeenCalledWith('b');
  });
  ```

- [ ] **Step 2: Run the tests, verify they fail.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `onActivate` not called.

- [ ] **Step 3: Implement Enter/Space activation.**

  Add cases to `handleKeyDown` in `Tabs.tsx`:

  ```tsx
    case 'Enter':
    case ' ':
      event.preventDefault();
      if (!tabs[currentIndex].disabled) {
        onActivate(tabs[currentIndex].id);
      }
      break;
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  11 passed (11)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 9: Per-tab `ariaControls` and `ariaLabel` overrides

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('applies per-tab ariaControls and ariaLabel overrides', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha', ariaControls: 'panel-a' },
            { id: 'b', label: <svg />, ariaLabel: 'Icon-only tab' },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[0].getAttribute('aria-controls')).toBe('panel-a');
    expect(tabs[1].getAttribute('aria-label')).toBe('Icon-only tab');
  });
  ```

- [ ] **Step 2: Run the test, verify it fails.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

- [ ] **Step 3: Add the descriptor fields and pass them through.**

  In `Tabs.tsx`:

  ```tsx
  export interface TabDescriptor {
    id: string;
    label: ReactNode;
    disabled?: boolean;
    ariaControls?: string;
    ariaLabel?: string;
  }
  ```

  In the `<button>` element:

  ```tsx
  <button
    // ... existing props ...
    aria-controls={tab.ariaControls}
    aria-label={tab.ariaLabel}
  >
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  12 passed (12)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 10: `leading` slot rendered before the label

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('renders the leading slot before the label', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            {
              id: 'a',
              label: 'Alpha',
              leading: <span data-testid="leading-a">●</span>,
            },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const button = container.querySelector<HTMLButtonElement>('[role="tab"]');
    const leading = button?.querySelector('[data-testid="leading-a"]');
    const label = button?.querySelector('.tab-item__label');
    expect(leading).toBeTruthy();
    // leading should appear before label in the DOM
    expect(leading?.compareDocumentPosition(label!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  ```

- [ ] **Step 2: Run the test, verify it fails.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

- [ ] **Step 3: Add the `leading` field and render it.**

  In `Tabs.tsx`:

  ```tsx
  export interface TabDescriptor {
    id: string;
    label: ReactNode;
    leading?: ReactNode;
    disabled?: boolean;
    ariaControls?: string;
    ariaLabel?: string;
  }
  ```

  In the `<button>` body, render `tab.leading` before the label `<span>`:

  ```tsx
  <button /* ... */>
    {tab.leading}
    <span className="tab-item__label">{tab.label}</span>
  </button>
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  13 passed (13)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 11: `textTransform` prop, plus `className` and `id` pass-through

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('adds the uppercase modifier class when textTransform="uppercase"', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
          textTransform="uppercase"
        />
      );
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.classList.contains('tab-strip--uppercase')).toBe(true);
  });

  it('does not add the uppercase modifier class by default', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.classList.contains('tab-strip--uppercase')).toBe(false);
  });

  it('merges a consumer className onto the root and applies an id', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
          className="custom-class"
          id="custom-id"
        />
      );
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.classList.contains('tab-strip')).toBe(true);
    expect(tablist?.classList.contains('custom-class')).toBe(true);
    expect(tablist?.id).toBe('custom-id');
  });
  ```

- [ ] **Step 2: Run the tests, verify they fail.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

- [ ] **Step 3: Add the `textTransform`, `className`, and `id` props.**

  In `Tabs.tsx`:

  ```tsx
  export interface TabsProps {
    tabs: TabDescriptor[];
    activeId: string | null;
    onActivate: (id: string) => void;
    'aria-label': string;
    textTransform?: 'none' | 'uppercase';
    className?: string;
    id?: string;
  }

  export function Tabs({
    tabs,
    activeId,
    onActivate,
    'aria-label': ariaLabel,
    textTransform = 'none',
    className: classNameProp,
    id,
  }: TabsProps) {
    const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    // ... existing handlers ...

    const rootClassName = [
      'tab-strip',
      textTransform === 'uppercase' ? 'tab-strip--uppercase' : null,
      classNameProp || null,
    ]
      .filter(Boolean)
      .join(' ');

    return (
      <div role="tablist" aria-label={ariaLabel} className={rootClassName} id={id}>
        {/* tabs map */}
      </div>
    );
  }
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  16 passed (16)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 12: Sizing modifier classes (`fit`/`equal`)

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing tests.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('adds the fit sizing modifier class by default', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.classList.contains('tab-strip--sizing-fit')).toBe(true);
    expect(tablist?.classList.contains('tab-strip--sizing-equal')).toBe(false);
  });

  it('adds the equal sizing modifier class when tabSizing="equal"', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
          tabSizing="equal"
        />
      );
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.classList.contains('tab-strip--sizing-equal')).toBe(true);
    expect(tablist?.classList.contains('tab-strip--sizing-fit')).toBe(false);
  });
  ```

- [ ] **Step 2: Run the tests, verify they fail.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

- [ ] **Step 3: Add the `tabSizing` prop and class.**

  In `Tabs.tsx`:

  ```tsx
  export interface TabsProps {
    tabs: TabDescriptor[];
    activeId: string | null;
    onActivate: (id: string) => void;
    'aria-label': string;
    textTransform?: 'none' | 'uppercase';
    tabSizing?: 'fit' | 'equal';
    className?: string;
    id?: string;
  }

  export function Tabs({
    tabs,
    activeId,
    onActivate,
    'aria-label': ariaLabel,
    textTransform = 'none',
    tabSizing = 'fit',
    className: classNameProp,
    id,
  }: TabsProps) {
    // ...

    const rootClassName = [
      'tab-strip',
      `tab-strip--sizing-${tabSizing}`,
      textTransform === 'uppercase' ? 'tab-strip--uppercase' : null,
      classNameProp || null,
    ]
      .filter(Boolean)
      .join(' ');

    // The JSX root element uses rootClassName and id from this point onward.
    // ...
  }
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  18 passed (18)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 13: Min/max width via CSS custom properties

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('sets --tab-item-min-width and --tab-item-max-width custom properties from props', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
          minTabWidth={100}
          maxTabWidth={300}
        />
      );
    });

    const tablist = container.querySelector<HTMLDivElement>('[role="tablist"]');
    expect(tablist?.style.getPropertyValue('--tab-item-min-width')).toBe('100px');
    expect(tablist?.style.getPropertyValue('--tab-item-max-width')).toBe('300px');
  });

  it('uses defaults of 80px / 240px when min/max not provided', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tablist = container.querySelector<HTMLDivElement>('[role="tablist"]');
    expect(tablist?.style.getPropertyValue('--tab-item-min-width')).toBe('80px');
    expect(tablist?.style.getPropertyValue('--tab-item-max-width')).toBe('240px');
  });
  ```

- [ ] **Step 2: Run the tests, verify they fail.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

- [ ] **Step 3: Add the props and inline style.**

  In `Tabs.tsx`:

  ```tsx
  import type { CSSProperties, HTMLAttributes, ReactNode, KeyboardEvent as ReactKeyboardEvent } from 'react';

  export interface TabsProps {
    tabs: TabDescriptor[];
    activeId: string | null;
    onActivate: (id: string) => void;
    'aria-label': string;
    textTransform?: 'none' | 'uppercase';
    tabSizing?: 'fit' | 'equal';
    minTabWidth?: number;
    maxTabWidth?: number;
  }

  export function Tabs({
    tabs,
    activeId,
    onActivate,
    'aria-label': ariaLabel,
    textTransform = 'none',
    tabSizing = 'fit',
    minTabWidth = 80,
    maxTabWidth = 240,
  }: TabsProps) {
    // ...

    const style = {
      '--tab-item-min-width': `${minTabWidth}px`,
      '--tab-item-max-width': `${maxTabWidth}px`,
    } as CSSProperties;

    return (
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={className}
        style={style}
      >
        {/* tabs map */}
      </div>
    );
  }
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  20 passed (20)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 14: Close button overlay (rendered when `onClose` is set)

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing tests.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('renders a close button when the tab descriptor has onClose', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha', onClose },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[0].classList.contains('tab-item--closeable')).toBe(true);
    expect(tabs[0].querySelector('.tab-item__close')).toBeTruthy();
    expect(tabs[1].classList.contains('tab-item--closeable')).toBe(false);
    expect(tabs[1].querySelector('.tab-item__close')).toBeNull();
  });

  it('invokes onClose when the close button is clicked, without invoking onActivate', () => {
    const onClose = vi.fn();
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha', onClose }]}
          activeId="a"
          onActivate={onActivate}
          aria-label="Test Tabs"
        />
      );
    });

    const closeButton = container.querySelector<HTMLElement>('.tab-item__close');
    expect(closeButton).toBeTruthy();
    act(() => {
      closeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });
  ```

- [ ] **Step 2: Run the tests, verify they fail.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

- [ ] **Step 3: Add `onClose` to the descriptor and render the close button.**

  In `Tabs.tsx`:

  ```tsx
  export interface TabDescriptor {
    id: string;
    label: ReactNode;
    leading?: ReactNode;
    onClose?: () => void;
    disabled?: boolean;
    ariaControls?: string;
    ariaLabel?: string;
  }
  ```

  In the `<button>` body, add the closeable modifier and render the close button:

  ```tsx
  const isCloseable = Boolean(tab.onClose);

  return (
    <button
      // ... existing props ...
      className={`tab-item${isActive ? ' tab-item--active' : ''}${isCloseable ? ' tab-item--closeable' : ''}`}
    >
      {tab.leading}
      <span className="tab-item__label">{tab.label}</span>
      {tab.onClose && (
        <span
          className="tab-item__close"
          role="button"
          aria-label="Close"
          tabIndex={-1}
          onClick={(event) => {
            event.stopPropagation();
            tab.onClose?.();
          }}
        >
          ×
        </span>
      )}
    </button>
  );
  ```

  Note: the close button is a `<span role="button">` instead of a real `<button>` because nesting `<button>` is invalid HTML. Setting `tabIndex={-1}` keeps it out of the tab order — keyboard close happens via Delete/Backspace on the focused tab in the next task.

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  22 passed (22)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 15: Delete and Backspace on a focused closeable tab invoke `onClose`

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing tests.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('invokes onClose when Delete is pressed on a focused closeable tab', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha', onClose }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    tab?.focus();

    act(() => {
      tab!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose when Backspace is pressed on a focused closeable tab', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha', onClose }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    tab?.focus();

    act(() => {
      tab!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onClose on Delete when the tab is not closeable', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    tab?.focus();

    // Should not throw or do anything.
    act(() => {
      tab!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });

    // No assertion needed beyond "doesn't throw" — no onClose to call.
  });
  ```

- [ ] **Step 2: Run the tests, verify they fail.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

- [ ] **Step 3: Add Delete/Backspace handling to `handleKeyDown`.**

  In `Tabs.tsx`:

  ```tsx
  const handleKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number
  ) => {
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        focusNextEnabled(currentIndex, 1);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        focusNextEnabled(currentIndex, -1);
        break;
      case 'Home':
        event.preventDefault();
        focusFirstEnabled();
        break;
      case 'End':
        event.preventDefault();
        focusLastEnabled();
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (!tabs[currentIndex].disabled) {
          onActivate(tabs[currentIndex].id);
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (tabs[currentIndex].onClose) {
          event.preventDefault();
          tabs[currentIndex].onClose?.();
        }
        break;
    }
  };
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  25 passed (25)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 16: `extraProps` escape hatch with reserved-key dev warning

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing tests.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('spreads extraProps onto the tab button', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            {
              id: 'a',
              label: 'Alpha',
              extraProps: {
                'data-testid': 'cluster-id-1',
                draggable: true,
              } as React.HTMLAttributes<HTMLButtonElement>,
            },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    expect(tab?.getAttribute('data-testid')).toBe('cluster-id-1');
    expect(tab?.draggable).toBe(true);
  });

  it('warns in dev mode when extraProps overrides a reserved key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    act(() => {
      root.render(
        <Tabs
          tabs={[
            {
              id: 'a',
              label: 'Alpha',
              extraProps: { tabIndex: 99 } as React.HTMLAttributes<HTMLButtonElement>,
            },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((call) => String(call[0]).includes('tabIndex'))).toBe(true);

    // The base's reserved value still wins at the DOM level.
    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    expect(tab?.tabIndex).toBe(0); // active tab gets tabIndex=0 from the base

    warn.mockRestore();
  });
  ```

- [ ] **Step 2: Run the tests, verify they fail.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

- [ ] **Step 3: Add `extraProps` to the descriptor and the spread + warning.**

  In `Tabs.tsx`:

  ```tsx
  export interface TabDescriptor {
    id: string;
    label: ReactNode;
    leading?: ReactNode;
    onClose?: () => void;
    disabled?: boolean;
    ariaControls?: string;
    ariaLabel?: string;
    extraProps?: HTMLAttributes<HTMLButtonElement>;
  }

  const RESERVED_TAB_KEYS = new Set([
    'role',
    'aria-selected',
    'aria-controls',
    'aria-disabled',
    'aria-label',
    'tabIndex',
    'id',
    'onClick',
    'onKeyDown',
  ]);

  function warnReservedKeys(tabId: string, extraProps: HTMLAttributes<HTMLButtonElement> | undefined) {
    if (process.env.NODE_ENV === 'production' || !extraProps) return;
    for (const key of Object.keys(extraProps)) {
      if (RESERVED_TAB_KEYS.has(key)) {
        // eslint-disable-next-line no-console
        console.warn(
          `<Tabs>: tab "${tabId}" extraProps overrode reserved key "${key}". The base owns this prop. Drop it from extraProps.`
        );
      }
    }
  }
  ```

  In the JSX, **spread `extraProps` first**, then base props on top:

  ```tsx
  {tabs.map((tab, index) => {
    const isActive = tab.id === activeId;
    const isCloseable = Boolean(tab.onClose);
    warnReservedKeys(tab.id, tab.extraProps);

    return (
      <button
        key={tab.id}
        ref={(el) => {
          if (el) {
            tabRefs.current.set(tab.id, el);
          } else {
            tabRefs.current.delete(tab.id);
          }
        }}
        {...tab.extraProps}
        type="button"
        role="tab"
        aria-selected={isActive}
        aria-controls={tab.ariaControls}
        aria-disabled={tab.disabled || undefined}
        aria-label={tab.ariaLabel}
        tabIndex={isActive ? 0 : -1}
        className={`tab-item${isActive ? ' tab-item--active' : ''}${isCloseable ? ' tab-item--closeable' : ''}`}
        onClick={() => {
          if (!tab.disabled) {
            onActivate(tab.id);
          }
        }}
        onKeyDown={(event) => handleKeyDown(event, index)}
      >
        {tab.leading}
        <span className="tab-item__label">{tab.label}</span>
        {tab.onClose && (
          <span
            className="tab-item__close"
            role="button"
            aria-label="Close"
            tabIndex={-1}
            onClick={(event) => {
              event.stopPropagation();
              tab.onClose?.();
            }}
          >
            ×
          </span>
        )}
      </button>
    );
  })}
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  27 passed (27)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 17: Edge cases — empty tabs array and invalid `activeId`

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the test.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('renders an empty tablist without crashing when tabs array is empty', () => {
    act(() => {
      root.render(
        <Tabs tabs={[]} activeId={null} onActivate={() => {}} aria-label="Test Tabs" />
      );
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    expect(tablist?.querySelectorAll('[role="tab"]').length).toBe(0);
  });

  it('does not crash and marks no tab active when activeId does not match any tab', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="nonexistent"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs.length).toBe(2);
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(tabs[0].tabIndex).toBe(-1);
    expect(tabs[1].tabIndex).toBe(-1);
  });
  ```

- [ ] **Step 2: Run the tests, verify they pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  29 passed (29)`. Both edge-case tests should pass without code changes — the existing implementation already handles these correctly.

- [ ] **Step 3:** Report task complete and wait for user review.

---

### Task 18: Overflow scrolling — buttons appear when content exceeds container

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

This task introduces the overflow infrastructure: a `<div>` wrapper around the scrollable strip, scroll buttons rendered conditionally based on `scrollWidth > clientWidth`, and `ResizeObserver` to react to size changes.

- [ ] **Step 1: Write the failing tests.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('does not render scroll buttons when content fits the container', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    expect(container.querySelector('.tab-strip__overflow-indicator')).toBeNull();
  });

  it('renders scroll buttons when overflow="scroll" and content overflows', () => {
    // Force overflow by mocking the scroll measurements.
    const observers: Array<() => void> = [];
    const OriginalResizeObserver = (globalThis as any).ResizeObserver;
    (globalThis as any).ResizeObserver = class {
      constructor(public cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    };

    act(() => {
      root.render(
        <Tabs
          tabs={Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }))}
          activeId="t0"
          onActivate={() => {}}
          aria-label="Test Tabs"
          overflow="scroll"
        />
      );
    });

    // Force scrollWidth > clientWidth on the scroll container.
    const scrollContainer = container.querySelector<HTMLDivElement>('.tab-strip__scroll-container');
    Object.defineProperty(scrollContainer, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 200, configurable: true });

    // Trigger the observer callback.
    act(() => {
      observers.forEach((cb) => cb());
    });

    expect(container.querySelector('.tab-strip__overflow-indicator')).toBeTruthy();

    (globalThis as any).ResizeObserver = OriginalResizeObserver;
  });

  it('does not render scroll buttons when overflow="none"', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }))}
          activeId="t0"
          onActivate={() => {}}
          aria-label="Test Tabs"
          overflow="none"
        />
      );
    });

    expect(container.querySelector('.tab-strip__overflow-indicator')).toBeNull();
  });
  ```

- [ ] **Step 2: Run the tests, verify they fail.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

- [ ] **Step 3: Add overflow infrastructure to `Tabs.tsx`.**

  Restructure the render to add a scroll container and the overflow detection effect:

  ```tsx
  import { useEffect, useRef, useState, type CSSProperties, type HTMLAttributes, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';

  // ... existing TabDescriptor ...

  export interface TabsProps {
    tabs: TabDescriptor[];
    activeId: string | null;
    onActivate: (id: string) => void;
    'aria-label': string;
    textTransform?: 'none' | 'uppercase';
    tabSizing?: 'fit' | 'equal';
    minTabWidth?: number;
    maxTabWidth?: number;
    overflow?: 'scroll' | 'none';
  }

  export function Tabs({
    tabs,
    activeId,
    onActivate,
    'aria-label': ariaLabel,
    textTransform = 'none',
    tabSizing = 'fit',
    minTabWidth = 80,
    maxTabWidth = 240,
    overflow = 'scroll',
  }: TabsProps) {
    const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const scrollRef = useRef<HTMLDivElement>(null);
    const [overflowState, setOverflowState] = useState({ left: 0, right: 0 });

    // Measure overflow whenever the strip size or contents change.
    useEffect(() => {
      if (overflow !== 'scroll' || !scrollRef.current) {
        setOverflowState({ left: 0, right: 0 });
        return;
      }

      const el = scrollRef.current;
      const measure = () => {
        const overflowAmount = el.scrollWidth - el.clientWidth;
        if (overflowAmount <= 0) {
          setOverflowState({ left: 0, right: 0 });
          return;
        }
        // For now, use a simple "any overflow → both arrows" model. The
        // count-of-hidden-tabs computation comes in Task 21.
        setOverflowState({
          left: el.scrollLeft > 0 ? 1 : 0,
          right: el.scrollLeft < overflowAmount ? 1 : 0,
        });
      };

      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(el);
      el.addEventListener('scroll', measure);
      return () => {
        observer.disconnect();
        el.removeEventListener('scroll', measure);
      };
    }, [overflow, tabs]);

    // ... existing handlers (focusFirstEnabled, focusLastEnabled, focusNextEnabled, handleKeyDown) ...

    const className = [
      'tab-strip',
      `tab-strip--sizing-${tabSizing}`,
      textTransform === 'uppercase' ? 'tab-strip--uppercase' : null,
    ]
      .filter(Boolean)
      .join(' ');

    const style = {
      '--tab-item-min-width': `${minTabWidth}px`,
      '--tab-item-max-width': `${maxTabWidth}px`,
    } as CSSProperties;

    const showLeftIndicator = overflow === 'scroll' && (overflowState.left > 0 || overflowState.right > 0);
    const showRightIndicator = showLeftIndicator;

    return (
      <div role="tablist" aria-label={ariaLabel} className={className} style={style}>
        {showLeftIndicator && (
          <button
            type="button"
            className="tab-strip__overflow-indicator tab-strip__overflow-indicator--left"
            aria-label="Scroll tabs left"
            tabIndex={-1}
          >
            ◀
          </button>
        )}
        <div className="tab-strip__scroll-container" ref={scrollRef}>
          {tabs.map((tab, index) => {
            // ... unchanged ...
          })}
        </div>
        {showRightIndicator && (
          <button
            type="button"
            className="tab-strip__overflow-indicator tab-strip__overflow-indicator--right"
            aria-label="Scroll tabs right"
            tabIndex={-1}
          >
            ▶
          </button>
        )}
      </div>
    );
  }
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  32 passed (32)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 19: Overflow scroll button click action

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('scrolls the strip when an overflow indicator is clicked', () => {
    const observers: Array<() => void> = [];
    const OriginalResizeObserver = (globalThis as any).ResizeObserver;
    (globalThis as any).ResizeObserver = class {
      constructor(public cb: () => void) { observers.push(cb); }
      observe() {}
      disconnect() {}
    };

    act(() => {
      root.render(
        <Tabs
          tabs={Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }))}
          activeId="t0"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const scrollContainer = container.querySelector<HTMLDivElement>('.tab-strip__scroll-container')!;
    Object.defineProperty(scrollContainer, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 200, configurable: true });

    act(() => observers.forEach((cb) => cb()));

    const rightButton = container.querySelector<HTMLButtonElement>(
      '.tab-strip__overflow-indicator--right'
    );
    expect(rightButton).toBeTruthy();

    const scrollBySpy = vi.fn();
    scrollContainer.scrollBy = scrollBySpy as any;

    act(() => {
      rightButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(scrollBySpy).toHaveBeenCalled();
    const callArg = scrollBySpy.mock.calls[0][0];
    expect(callArg.left).toBeGreaterThan(0);
    expect(callArg.behavior).toBe('smooth');

    (globalThis as any).ResizeObserver = OriginalResizeObserver;
  });
  ```

- [ ] **Step 2: Run the test, verify it fails.**

- [ ] **Step 3: Wire up `onClick` on the indicators.**

  In `Tabs.tsx`, add a scroll handler and attach to both indicators:

  ```tsx
  const SCROLL_AMOUNT = 200;

  const scrollByPx = (delta: number) => {
    scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' });
  };
  ```

  Update both indicator buttons:

  ```tsx
  {showLeftIndicator && (
    <button
      type="button"
      className="tab-strip__overflow-indicator tab-strip__overflow-indicator--left"
      aria-label="Scroll tabs left"
      tabIndex={-1}
      onClick={() => scrollByPx(-SCROLL_AMOUNT)}
    >
      ◀
    </button>
  )}
  {/* ... */}
  {showRightIndicator && (
    <button
      type="button"
      className="tab-strip__overflow-indicator tab-strip__overflow-indicator--right"
      aria-label="Scroll tabs right"
      tabIndex={-1}
      onClick={() => scrollByPx(SCROLL_AMOUNT)}
    >
      ▶
    </button>
  )}
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Expected: `Tests  33 passed (33)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 20: Auto-scroll active tab into view when `activeId` changes

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('scrolls the active tab into view when activeId changes', () => {
    const scrollIntoViewSpy = vi.fn();
    // Patch HTMLElement.prototype so all buttons share the spy.
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy as any;

    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
          overflow="scroll"
        />
      );
    });

    scrollIntoViewSpy.mockClear();

    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="b"
          onActivate={() => {}}
          aria-label="Test Tabs"
          overflow="scroll"
        />
      );
    });

    expect(scrollIntoViewSpy).toHaveBeenCalled();
    const callArg = scrollIntoViewSpy.mock.calls[0][0];
    expect(callArg.inline).toBe('nearest');
    expect(callArg.behavior).toBe('smooth');

    HTMLElement.prototype.scrollIntoView = original;
  });
  ```

- [ ] **Step 2: Run the test, verify it fails.**

- [ ] **Step 3: Add the auto-scroll effect.**

  In `Tabs.tsx`, after the existing useEffect for overflow measurement:

  ```tsx
  useEffect(() => {
    if (overflow !== 'scroll' || !activeId) return;
    const el = tabRefs.current.get(activeId);
    el?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' });
  }, [activeId, overflow]);
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Expected: `Tests  35 passed (35)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 21: Overflow count badge shows hidden tab count

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Add to `Tabs.test.tsx`:

  ```tsx
  it('shows the count of hidden tabs in the overflow indicators', () => {
    const observers: Array<() => void> = [];
    const OriginalResizeObserver = (globalThis as any).ResizeObserver;
    (globalThis as any).ResizeObserver = class {
      constructor(public cb: () => void) { observers.push(cb); }
      observe() {}
      disconnect() {}
    };

    act(() => {
      root.render(
        <Tabs
          tabs={Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }))}
          activeId="t0"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const scrollContainer = container.querySelector<HTMLDivElement>('.tab-strip__scroll-container')!;
    // Mock 3 tabs visible (from index 1 to 3), 1 hidden left, 1 hidden right.
    Object.defineProperty(scrollContainer, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(scrollContainer, 'scrollLeft', { value: 100, configurable: true });

    // Mock per-tab offsets so the measurement loop can compute hidden counts.
    const buttons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    buttons.forEach((btn, i) => {
      Object.defineProperty(btn, 'offsetLeft', { value: i * 100, configurable: true });
      Object.defineProperty(btn, 'offsetWidth', { value: 100, configurable: true });
    });

    act(() => observers.forEach((cb) => cb()));

    const leftCount = container.querySelector('.tab-strip__overflow-indicator--left .tab-strip__overflow-count');
    const rightCount = container.querySelector('.tab-strip__overflow-indicator--right .tab-strip__overflow-count');

    expect(leftCount?.textContent).toBe('1');
    expect(rightCount?.textContent).toBe('1');

    (globalThis as any).ResizeObserver = OriginalResizeObserver;
  });
  ```

- [ ] **Step 2: Run the test, verify it fails.**

- [ ] **Step 3: Compute and render hidden counts.**

  Replace the `measure()` body inside the useEffect to count hidden tabs by walking `tabRefs`:

  ```tsx
  const measure = () => {
    const overflowAmount = el.scrollWidth - el.clientWidth;
    if (overflowAmount <= 0) {
      setOverflowState({ left: 0, right: 0 });
      return;
    }
    const visibleStart = el.scrollLeft;
    const visibleEnd = el.scrollLeft + el.clientWidth;
    let leftHidden = 0;
    let rightHidden = 0;
    for (const tab of tabs) {
      const btn = tabRefs.current.get(tab.id);
      if (!btn) continue;
      const tabLeft = btn.offsetLeft;
      const tabRight = btn.offsetLeft + btn.offsetWidth;
      if (tabRight <= visibleStart) leftHidden++;
      else if (tabLeft >= visibleEnd) rightHidden++;
    }
    setOverflowState({ left: leftHidden, right: rightHidden });
  };
  ```

  Update the indicator render to show counts and to render only when count > 0:

  ```tsx
  const showLeftIndicator = overflow === 'scroll' && overflowState.left > 0;
  const showRightIndicator = overflow === 'scroll' && overflowState.right > 0;

  // ...

  {showLeftIndicator && (
    <button
      type="button"
      className="tab-strip__overflow-indicator tab-strip__overflow-indicator--left"
      aria-label={`Scroll tabs left (${overflowState.left} hidden)`}
      tabIndex={-1}
      onClick={() => scrollByPx(-SCROLL_AMOUNT)}
    >
      <span className="tab-strip__overflow-icon">◀</span>
      <span className="tab-strip__overflow-count">{overflowState.left}</span>
    </button>
  )}
  {/* ... */}
  {showRightIndicator && (
    <button
      type="button"
      className="tab-strip__overflow-indicator tab-strip__overflow-indicator--right"
      aria-label={`Scroll tabs right (${overflowState.right} hidden)`}
      tabIndex={-1}
      onClick={() => scrollByPx(SCROLL_AMOUNT)}
    >
      <span className="tab-strip__overflow-icon">▶</span>
      <span className="tab-strip__overflow-count">{overflowState.right}</span>
    </button>
  )}
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Expected: `Tests  35 passed (35)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 22: Public exports — `index.ts` for the tabs module

**Files:**
- Create: `frontend/src/shared/components/tabs/index.ts`

- [ ] **Step 1: Create the barrel.**

  ```ts
  /**
   * frontend/src/shared/components/tabs/index.ts
   *
   * Public API for the shared tabs component.
   */
  export { Tabs } from './Tabs';
  export type { TabsProps, TabDescriptor } from './Tabs';
  ```

- [ ] **Step 2: Verify the existing tests still pass after the new file is added.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  35 passed (35)`.

- [ ] **Step 3:** Report task complete and wait for user review.

---

### Task 23: Extend `tabs.css` with new selectors

**Files:**
- Modify: `frontend/styles/components/tabs.css`

This task is CSS only — no test changes. Visual verification happens in Storybook (Task 28).

- [ ] **Step 1: Read the current `tabs.css`.**

  Read `/Volumes/git/luxury-yacht/app/frontend/styles/components/tabs.css` to confirm what's already there. The existing file is 135 lines and already includes `.tab-strip`, `.tab-item`, `.tab-item--active`, hover state, separators, `.tab-item__close` (with hover-only opacity), `.tab-item--closeable`, and focus-visible.

- [ ] **Step 2: Add the new selectors at the end of the file.**

  Append to `frontend/styles/components/tabs.css`:

  ```css
  /* ==========================================================================
     Sizing modifiers — driven by props on <Tabs>
     ========================================================================== */

  .tab-strip--sizing-fit .tab-item {
    flex: 0 0 auto;
    min-width: var(--tab-item-min-width, 80px);
    max-width: var(--tab-item-max-width, 240px);
  }

  .tab-strip--sizing-equal .tab-item {
    flex: 1 1 0;
    min-width: var(--tab-item-min-width, 80px);
    max-width: var(--tab-item-max-width, 240px);
  }

  /* Always-on label truncation. The closeable modifier still adds
     padding-right to reserve space for the absolutely-positioned close
     button — see existing .tab-item--closeable rules above. */
  .tab-item__label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  /* ==========================================================================
     Text-transform variant — the only legitimate per-system difference
     ========================================================================== */

  .tab-strip--uppercase .tab-item {
    text-transform: uppercase;
  }

  /* ==========================================================================
     Overflow scroll container + indicators
     Moved here from DockablePanel.css with selectors renamed
     .dockable-tab-bar__overflow-* → .tab-strip__overflow-*
     ========================================================================== */

  .tab-strip {
    position: relative;
  }

  .tab-strip__scroll-container {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: stretch;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
  }

  .tab-strip__scroll-container::-webkit-scrollbar {
    display: none;
  }

  .tab-strip__overflow-indicator {
    --tab-strip-overflow-indicator-size: 32px;
    position: sticky;
    top: 0;
    width: var(--tab-strip-overflow-indicator-size);
    height: 100%;
    flex: 0 0 var(--tab-strip-overflow-indicator-size);
    display: flex;
    align-items: center;
    justify-content: center;
    align-self: stretch;
    z-index: 3;
    color: var(--color-text-secondary);
    margin: 0;
    padding: 0;
    border: none;
    background: var(--color-bg-secondary);
    cursor: pointer;
    transition:
      background-color var(--duration-fast) var(--ease-out),
      color var(--duration-fast) var(--ease-out);
  }

  .tab-strip__overflow-icon {
    display: block;
    line-height: 1;
  }

  .tab-strip__overflow-count {
    font-size: 10px;
    font-weight: 600;
    line-height: 1;
    color: var(--color-text-tertiary);
    margin-left: 2px;
  }

  .tab-strip__overflow-indicator:hover {
    background: var(--color-bg-tertiary);
    color: var(--color-text);
  }

  .tab-strip__overflow-indicator:hover .tab-strip__overflow-count {
    color: var(--color-text-secondary);
  }

  .tab-strip__overflow-indicator--left {
    left: 0;
  }

  .tab-strip__overflow-indicator--right {
    margin-left: auto;
    right: 0;
  }

  .tab-strip__overflow-indicator:focus-visible {
    outline: 1px solid var(--color-accent);
    outline-offset: -1px;
  }
  ```

- [ ] **Step 3: Verify the existing component tests still pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/Tabs.test.tsx'`

  Expected: `Tests  35 passed (35)`.

- [ ] **Step 4: Verify lint and typecheck still pass for the project.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npm run typecheck && npm run lint:eslint'`

  Expected: no errors.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 24: Drag coordinator types

**Files:**
- Create: `frontend/src/shared/components/tabs/dragCoordinator/types.ts`

- [ ] **Step 1: Create the file.**

  ```ts
  /**
   * frontend/src/shared/components/tabs/dragCoordinator/types.ts
   *
   * Discriminated union describing what's being dragged. Drop targets
   * declare which kinds they accept; the type system guarantees a target
   * registered for one kind cannot be invoked with a payload of another
   * kind. This is what makes cross-system drops (e.g., dragging a cluster
   * tab onto a dockable strip) impossible by construction.
   */
  export type TabDragPayload =
    | { kind: 'cluster-tab'; clusterId: string }
    | { kind: 'dockable-tab'; panelId: string; sourceGroupId: string };

  export type TabDragKind = TabDragPayload['kind'];

  /**
   * Wire-format key used with DataTransfer.setData / getData. Includes the
   * project namespace so it doesn't collide with anything the OS or other
   * apps put in the clipboard during drag.
   */
  export const TAB_DRAG_DATA_TYPE = 'application/x-luxury-yacht-tab';
  ```

- [ ] **Step 2:** Report task complete and wait for user review.

---

### Task 25: `TabDragProvider` with context shell

**Files:**
- Create: `frontend/src/shared/components/tabs/dragCoordinator/TabDragProvider.tsx`
- Create: `frontend/src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx`

- [ ] **Step 1: Write the failing test.**

  Create `frontend/src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx`:

  ```tsx
  /**
   * frontend/src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx
   */
  import ReactDOM from 'react-dom/client';
  import { act, useContext } from 'react';
  import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

  import { TabDragProvider, TabDragContext } from './TabDragProvider';

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
  ```

- [ ] **Step 2: Run the test, verify it fails (file doesn't exist).**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx'`

- [ ] **Step 3: Create `TabDragProvider.tsx`.**

  ```tsx
  /**
   * frontend/src/shared/components/tabs/dragCoordinator/TabDragProvider.tsx
   *
   * Scopes a single tab drag operation. Holds the current payload and a
   * registry of drop targets. Built on HTML5 native drag events.
   *
   * Future seam: when Wails v3 multi-window arrives (or a fake equivalent
   * lands), `onTearOff` will fire on `dragend` events that fall outside
   * any registered target AND outside the window bounds. The seam is
   * stubbed today and not wired by any consumer.
   */
  import {
    createContext,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactNode,
  } from 'react';

  import type { TabDragPayload } from './types';

  export interface DropTargetRegistration {
    element: HTMLElement;
    accepts: ReadonlyArray<TabDragPayload['kind']>;
    onDrop: (payload: TabDragPayload, event: DragEvent) => void;
    onDragEnter?: (payload: TabDragPayload) => void;
    onDragLeave?: () => void;
  }

  interface TabDragContextValue {
    currentDrag: TabDragPayload | null;
    beginDrag: (payload: TabDragPayload) => void;
    endDrag: () => void;
    registerTarget: (id: number, registration: DropTargetRegistration) => void;
    unregisterTarget: (id: number) => void;
  }

  export const TabDragContext = createContext<TabDragContextValue>({
    currentDrag: null,
    beginDrag: () => {},
    endDrag: () => {},
    registerTarget: () => {},
    unregisterTarget: () => {},
  });

  export interface TabDragProviderProps {
    children: ReactNode;
    /**
     * Future. Fires on `dragend` when no target consumed the drop AND the
     * cursor is outside the window bounds. Wrappers can implement this to
     * spawn a new floating panel or (eventually) a new OS window.
     */
    onTearOff?: (payload: TabDragPayload, cursor: { x: number; y: number }) => void;
  }

  export function TabDragProvider({ children, onTearOff }: TabDragProviderProps) {
    const [currentDrag, setCurrentDrag] = useState<TabDragPayload | null>(null);
    const targetsRef = useRef<Map<number, DropTargetRegistration>>(new Map());
    const lastDragRef = useRef<TabDragPayload | null>(null);

    const beginDrag = useCallback((payload: TabDragPayload) => {
      lastDragRef.current = payload;
      setCurrentDrag(payload);
    }, []);

    const endDrag = useCallback(() => {
      lastDragRef.current = null;
      setCurrentDrag(null);
    }, []);

    const registerTarget = useCallback((id: number, registration: DropTargetRegistration) => {
      targetsRef.current.set(id, registration);
    }, []);

    const unregisterTarget = useCallback((id: number) => {
      targetsRef.current.delete(id);
    }, []);

    // Tear-off seam: a global dragend listener that fires onTearOff when
    // no drop target consumed the drag AND the cursor is outside the
    // window bounds. Stubbed for now — no production consumer wires it.
    useEffect(() => {
      if (!onTearOff) return;
      const handler = (event: DragEvent) => {
        const payload = lastDragRef.current;
        if (!payload) return;
        if (event.dataTransfer && event.dataTransfer.dropEffect !== 'none') return;
        const { clientX, clientY } = event;
        if (
          clientX < 0 ||
          clientY < 0 ||
          clientX > window.innerWidth ||
          clientY > window.innerHeight
        ) {
          onTearOff(payload, { x: clientX, y: clientY });
        }
      };
      document.addEventListener('dragend', handler);
      return () => document.removeEventListener('dragend', handler);
    }, [onTearOff]);

    const value = useMemo<TabDragContextValue>(
      () => ({
        currentDrag,
        beginDrag,
        endDrag,
        registerTarget,
        unregisterTarget,
      }),
      [currentDrag, beginDrag, endDrag, registerTarget, unregisterTarget]
    );

    return <TabDragContext.Provider value={value}>{children}</TabDragContext.Provider>;
  }
  ```

- [ ] **Step 4: Run the tests, verify they pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx'`

  Expected: `Tests  1 passed (1)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 26: `useTabDragSource` hook

**Files:**
- Create: `frontend/src/shared/components/tabs/dragCoordinator/useTabDragSource.ts`
- Modify: `frontend/src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx`

- [ ] **Step 1: Write the failing tests.**

  Add to `dragCoordinator.test.tsx`:

  ```tsx
  import { useTabDragSource } from './useTabDragSource';
  import { TAB_DRAG_DATA_TYPE } from './types';

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
        return <button {...captured} type="button">drag</button>;
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
        return <button {...captured} type="button">drag</button>;
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
        return <button {...captured} type="button">drag</button>;
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
        return <button {...captured} type="button">drag</button>;
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
        return <button {...captured} type="button">drag</button>;
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
  ```

- [ ] **Step 2: Run the tests, verify they fail.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx'`

- [ ] **Step 3: Create `useTabDragSource.ts`.**

  ```ts
  /**
   * frontend/src/shared/components/tabs/dragCoordinator/useTabDragSource.ts
   *
   * Source hook. Returns props that the consumer spreads onto a tab via
   * the `extraProps` field on its TabDescriptor. The hook updates the
   * provider's currentDrag state, writes the payload to dataTransfer for
   * round-trip survival, and optionally calls setDragImage with a custom
   * preview element.
   */
  import { useCallback, useContext, type DragEventHandler } from 'react';

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

  export function useTabDragSource(
    payload: TabDragPayload | null,
    options?: UseTabDragSourceOptions
  ): TabDragSourceProps {
    const { beginDrag, endDrag } = useContext(TabDragContext);

    const onDragStart = useCallback<DragEventHandler<HTMLElement>>(
      (event) => {
        if (!payload) return;
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
      [payload, options, beginDrag]
    );

    const onDragEnd = useCallback<DragEventHandler<HTMLElement>>(() => {
      endDrag();
    }, [endDrag]);

    if (!payload) {
      return { draggable: false };
    }

    return {
      draggable: true,
      onDragStart,
      onDragEnd,
    };
  }
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx'`

  Expected: `Tests  6 passed (6)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 27: `useTabDropTarget` hook

**Files:**
- Create: `frontend/src/shared/components/tabs/dragCoordinator/useTabDropTarget.ts`
- Modify: `frontend/src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx`

- [ ] **Step 1: Write the failing tests.**

  Add to `dragCoordinator.test.tsx`:

  ```tsx
  import { useTabDropTarget } from './useTabDropTarget';

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
        return <div ref={captured.ref} data-testid="target">target</div>;
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
        return <div ref={ref} data-testid="target">target</div>;
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
        return <div ref={ref} data-testid="target">target</div>;
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
  });
  ```

- [ ] **Step 2: Run the tests, verify they fail.**

- [ ] **Step 3: Create `useTabDropTarget.ts`.**

  ```ts
  /**
   * frontend/src/shared/components/tabs/dragCoordinator/useTabDropTarget.ts
   *
   * Target hook. Returns a ref callback the consumer attaches to a drop
   * zone element, plus an `isDragOver` boolean for hover styling. The
   * hook only fires onDrop when the current drag's kind matches one of
   * the kinds in `accepts`.
   */
  import {
    useCallback,
    useContext,
    useEffect,
    useRef,
    useState,
    type RefCallback,
  } from 'react';

  import { TabDragContext, type DropTargetRegistration } from './TabDragProvider';
  import { TAB_DRAG_DATA_TYPE, type TabDragPayload } from './types';

  export interface UseTabDropTargetOptions<K extends TabDragPayload['kind']> {
    accepts: K[];
    onDrop: (payload: Extract<TabDragPayload, { kind: K }>, event: DragEvent) => void;
    onDragEnter?: (payload: Extract<TabDragPayload, { kind: K }>) => void;
    onDragLeave?: () => void;
  }

  export interface UseTabDropTargetResult {
    ref: RefCallback<HTMLElement>;
    isDragOver: boolean;
  }

  let nextTargetId = 0;

  function readPayload(event: DragEvent): TabDragPayload | null {
    if (!event.dataTransfer) return null;
    const raw = event.dataTransfer.getData(TAB_DRAG_DATA_TYPE);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as TabDragPayload;
    } catch {
      return null;
    }
  }

  export function useTabDropTarget<K extends TabDragPayload['kind']>(
    opts: UseTabDropTargetOptions<K>
  ): UseTabDropTargetResult {
    const { accepts, onDrop, onDragEnter, onDragLeave } = opts;
    const { registerTarget, unregisterTarget } = useContext(TabDragContext);
    const [isDragOver, setIsDragOver] = useState(false);
    const elementRef = useRef<HTMLElement | null>(null);
    const idRef = useRef<number>(nextTargetId++);

    const acceptsRef = useRef(accepts);
    acceptsRef.current = accepts;

    const handleDragEnter = useCallback(
      (event: DragEvent) => {
        const payload = readPayload(event);
        if (!payload || !acceptsRef.current.includes(payload.kind as K)) return;
        event.preventDefault();
        setIsDragOver(true);
        onDragEnter?.(payload as Extract<TabDragPayload, { kind: K }>);
      },
      [onDragEnter]
    );

    const handleDragOver = useCallback((event: DragEvent) => {
      const payload = readPayload(event);
      if (!payload || !acceptsRef.current.includes(payload.kind as K)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    }, []);

    const handleDragLeave = useCallback(() => {
      setIsDragOver(false);
      onDragLeave?.();
    }, [onDragLeave]);

    const handleDrop = useCallback(
      (event: DragEvent) => {
        const payload = readPayload(event);
        if (!payload || !acceptsRef.current.includes(payload.kind as K)) return;
        event.preventDefault();
        setIsDragOver(false);
        onDrop(payload as Extract<TabDragPayload, { kind: K }>, event);
      },
      [onDrop]
    );

    const ref = useCallback<RefCallback<HTMLElement>>(
      (el) => {
        // Detach from old element
        const previous = elementRef.current;
        if (previous) {
          previous.removeEventListener('dragenter', handleDragEnter);
          previous.removeEventListener('dragover', handleDragOver);
          previous.removeEventListener('dragleave', handleDragLeave);
          previous.removeEventListener('drop', handleDrop);
          unregisterTarget(idRef.current);
        }

        elementRef.current = el;
        if (el) {
          el.addEventListener('dragenter', handleDragEnter);
          el.addEventListener('dragover', handleDragOver);
          el.addEventListener('dragleave', handleDragLeave);
          el.addEventListener('drop', handleDrop);
          registerTarget(idRef.current, {
            element: el,
            accepts,
            onDrop: onDrop as DropTargetRegistration['onDrop'],
            onDragEnter: onDragEnter as DropTargetRegistration['onDragEnter'],
            onDragLeave,
          });
        }
      },
      [
        handleDragEnter,
        handleDragOver,
        handleDragLeave,
        handleDrop,
        accepts,
        onDrop,
        onDragEnter,
        onDragLeave,
        registerTarget,
        unregisterTarget,
      ]
    );

    // Cleanup on unmount.
    useEffect(() => {
      return () => {
        const el = elementRef.current;
        if (el) {
          el.removeEventListener('dragenter', handleDragEnter);
          el.removeEventListener('dragover', handleDragOver);
          el.removeEventListener('dragleave', handleDragLeave);
          el.removeEventListener('drop', handleDrop);
        }
        unregisterTarget(idRef.current);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { ref, isDragOver };
  }
  ```

- [ ] **Step 4: Run the tests, verify all pass.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/dragCoordinator/dragCoordinator.test.tsx'`

  Expected: `Tests  9 passed (9)`.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 28: Drag coordinator barrel export

**Files:**
- Create: `frontend/src/shared/components/tabs/dragCoordinator/index.ts`

- [ ] **Step 1: Create the barrel.**

  ```ts
  /**
   * frontend/src/shared/components/tabs/dragCoordinator/index.ts
   *
   * Public API for the tab drag coordinator.
   */
  export { TabDragProvider, TabDragContext } from './TabDragProvider';
  export type { TabDragProviderProps, DropTargetRegistration } from './TabDragProvider';

  export { useTabDragSource } from './useTabDragSource';
  export type { TabDragSourceProps, UseTabDragSourceOptions } from './useTabDragSource';

  export { useTabDropTarget } from './useTabDropTarget';
  export type { UseTabDropTargetOptions, UseTabDropTargetResult } from './useTabDropTarget';

  export { TAB_DRAG_DATA_TYPE } from './types';
  export type { TabDragPayload, TabDragKind } from './types';
  ```

- [ ] **Step 2: Run the existing tests to verify nothing broke.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/'`

  Expected: all tests pass (Tabs.test.tsx + dragCoordinator.test.tsx).

- [ ] **Step 3:** Report task complete and wait for user review.

---

### Task 29: Create `Tabs.stories.tsx` via the `new-story` skill

**Files:**
- Create: `frontend/src/shared/components/tabs/Tabs.stories.tsx`

- [ ] **Step 1: Invoke the `new-story` skill.**

  Use the `Skill` tool to invoke `new-story` with this brief:

  > Generate a Storybook story file for the new shared `<Tabs>` component at `frontend/src/shared/components/tabs/Tabs.tsx`. The story file goes at `frontend/src/shared/components/tabs/Tabs.stories.tsx`. Use real `<Tabs>` imports — no synthetic wrappers. Use the project CSS classes from `frontend/styles/components/tabs.css` (which has been extended with sizing modifiers and the uppercase variant). The component is fully controlled (`activeId` + `onActivate`); each story should manage `activeId` in local state via a small wrapper component.
  >
  > Stories to create (one per variant):
  > 1. **Default** — 4 short tabs (`Details`, `YAML`, `Events`, `Logs`), default sizing, no close buttons, no overflow.
  > 2. **Uppercase** — same as Default but `textTransform="uppercase"`. Mirrors Object Panel / Diagnostics look.
  > 3. **WithCloseButtons** — closeable tabs (each descriptor has `onClose`). Hover the tab to reveal the ✕. Clicking the ✕ logs the close to the actions panel.
  > 4. **WithLeadingSlot** — tabs with a colored dot before the label (use `leading: <span style={{display:'inline-block', width: 10, height: 10, borderRadius: '50%', background: '#3b82f6'}} />`). Mirrors Dockable kind indicators.
  > 5. **LongLabelsFit** — tabs with labels long enough to truncate at `maxTabWidth: 240`. Demonstrates ellipsis in `'fit'` sizing.
  > 6. **LongLabelsEqual** — same as LongLabelsFit but `tabSizing="equal"`.
  > 7. **NarrowMinMax** — explicit `minTabWidth: 50, maxTabWidth: 120`. Shows the width clamps in action.
  > 8. **OverflowManyTabs** — 20 tabs in a fixed-width container (wrap the story in a div with `style={{ width: 400, border: '1px solid #ccc' }}`). Forces scroll buttons + count badge.
  > 9. **DisabledTabs** — 5 tabs with the middle two `disabled: true`. Arrow nav skips them; clicks ignored.
  > 10. **EmptyTabs** — `tabs={[]}`. Renders an empty container.
  > 11. **InvalidActiveId** — `activeId="nonexistent"`. No tab selected.
  > 12. **KeyboardNav** — same as Default with a docs note explaining: "Click into the strip, then use Left/Right arrows to move focus, Enter/Space to activate, Home/End to jump, Delete to close (no-op without onClose)."
  >
  > Use `aria-label="Demo Tabs"` for every story. Use the `KeyboardProvider` and `Theme` decorators from `frontend/.storybook/decorators/` if needed for the close button hover styling to look right.
  >
  > File should follow the existing project storybook patterns from the 6 existing story files (e.g., `frontend/src/ui/layout/AppHeader.stories.tsx`).

- [ ] **Step 2: After the skill completes, run Storybook locally to verify the stories load.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npm run storybook'` in the background.

  Then ask the user to open `http://localhost:6006` and verify each story renders.

- [ ] **Step 3: Run the test suite to make sure adding stories didn't break anything.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/'`

  Expected: all existing tests still pass.

- [ ] **Step 4:** Report task complete and wait for user review.

---

### Task 30: Create `TabsWithDrag.stories.tsx` via the `new-story` skill

**Files:**
- Create: `frontend/src/shared/components/tabs/TabsWithDrag.stories.tsx`

- [ ] **Step 1: Invoke the `new-story` skill.**

  Use the `Skill` tool to invoke `new-story` with this brief:

  > Generate a Storybook story file for the tab drag coordinator at `frontend/src/shared/components/tabs/TabsWithDrag.stories.tsx`. Each story wraps the `<Tabs>` component in a `<TabDragProvider>` and uses `useTabDragSource` / `useTabDropTarget` to demonstrate drag scenarios. Each story should manage tab state in local React state and log all callback events to the Storybook actions panel via `@storybook/test`'s `fn()` or via `console.log`.
  >
  > Imports:
  > ```tsx
  > import { Tabs, type TabDescriptor } from './Tabs';
  > import {
  >   TabDragProvider,
  >   useTabDragSource,
  >   useTabDropTarget,
  > } from './dragCoordinator';
  > ```
  >
  > Stories to create:
  >
  > 1. **WithinStripReorderClusterStyle** — single strip with 5 tabs. Each tab is a drag source with `{ kind: 'cluster-tab', clusterId: tab.id }`. The strip itself is a drop target accepting `['cluster-tab']`. On drop, reorder the tabs in local state. Use the browser's default drag image (no `getDragImage`).
  >
  > 2. **WithinStripReorderDockableStyle** — same as above but use `dockable-tab` payload, and provide `getDragImage` that returns an offscreen styled element. Render the offscreen element via:
  >    ```tsx
  >    <div ref={previewRef} style={{ position: 'fixed', top: -9999, left: -9999, padding: '0.4rem 0.55rem', borderRadius: 6, border: '1px solid #3b82f6', background: '#1e293b', color: '#fff', fontSize: '0.74rem' }} aria-hidden="true">
  >      Drag preview
  >    </div>
  >    ```
  >    In `getDragImage`, set `previewRef.current.textContent` to the dragged tab's label imperatively, then return `{ element: previewRef.current, offsetX: 14, offsetY: 16 }`.
  >
  > 3. **CrossStripDragDockableStyle** — two side-by-side strips, both using `dockable-tab` payload, with `sourceGroupId: 'left'` and `'right'` respectively. Each strip is its own drop target. On drop with same `sourceGroupId`, reorder; on drop with different `sourceGroupId`, move the tab from one strip's state to the other.
  >
  > 4. **DropOnEmptySpaceCreatesNewStrip** — two strips at the top plus an empty area below them registered as a third drop target via `useTabDropTarget({ accepts: ['dockable-tab'], onDrop: () => addNewStrip(...) })`. When a tab is dragged onto the empty area, "create" a third strip in local state with that tab as its only member.
  >
  > 5. **TypeSafetyDemo** — two strips: one `cluster-tab` payload, one `dockable-tab` payload. Both strips registered as drop targets accepting only their own kind. Try dragging between them — nothing happens. Add a docs note explaining: "The discriminated union payload makes cross-system drops impossible by construction."
  >
  > 6. **TearOffSeam** — single strip wrapped in `<TabDragProvider onTearOff={(payload, cursor) => console.log('tear off', payload, cursor)}>`. Add a docs note: "Drag a tab outside the Storybook iframe bounds. The tear-off seam fires when the drop happens outside any registered target AND outside the window bounds. Currently no production consumer wires this — it's a future-Wails-v3 hook."
  >
  > Use `aria-label="Demo Tabs"` (or appropriately distinct names per story) on each `<Tabs>`. Follow existing storybook conventions in this repo. The file should be self-contained — no external test data, all tab IDs and labels defined inline in each story.

- [ ] **Step 2: After the skill completes, verify Storybook loads the new stories.**

  Open `http://localhost:6006`, navigate to the new TabsWithDrag stories, and click through each one to verify drag behavior works.

- [ ] **Step 3: Run the test suite to make sure nothing broke.**

  Run: `cd /Volumes/git/luxury-yacht/app/frontend && /usr/bin/env bash -lc 'npx vitest run src/shared/components/tabs/'`

- [ ] **Step 4:** Report task complete and wait for user review.

---

### Task 31: Final QC

**Files:** none (verification only)

- [ ] **Step 1: Run `mage qc:prerelease`.**

  Run: `cd /Volumes/git/luxury-yacht/app && /usr/bin/env bash -lc 'mage qc:prerelease'`

  Expected: exit code 0; all frontend tests pass; lint, format, typecheck clean; trivy clean.

- [ ] **Step 2: If any step fails, fix the issue and re-run.**

- [ ] **Step 3: Report Phase 1 complete and ask the user to interactively review the Storybook prototype before proceeding to Phase 2 (the migration plan).**

---

## Phase 2 boundary

This plan ends with the prototype validated in Storybook. **Do not begin migrating any of the four real consumers** (Object Panel, Diagnostics, Cluster Tabs, Dockable Tabs) — that work belongs to a separate Phase 2 plan that the user will request via the `writing-plans` skill after they've reviewed the prototype.

Specifically, **DO NOT** in this phase:

- Modify `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx`
- Modify the inline strip in `frontend/src/core/refresh/components/DiagnosticsPanel.tsx`
- Modify `frontend/src/ui/layout/ClusterTabs.tsx`
- Modify `frontend/src/ui/dockable/DockableTabBar.tsx` (or rename it)
- Modify `frontend/src/ui/dockable/DockablePanelProvider.tsx`
- Delete `frontend/src/shared/components/tabs/Tabs/index.tsx` (the vestigial `useTabStyles()` shim)
- Modify `frontend/src/ui/dockable/DockablePanel.css` to remove tab-related rules
- Modify any consumer-side CSS files
- Modify `docs/development/UI/tabs.md` or `docs/development/UI/dockable-panels.md`

All of those changes are Phase 2.
