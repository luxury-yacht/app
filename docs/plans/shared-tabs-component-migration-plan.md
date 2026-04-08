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

### Task 2: Add `closeIcon` and `closeAriaLabel` to `TabDescriptor`

**Why:** Cluster tabs and dockable tabs both render a close button with a small SVG close icon (`<CloseIcon width={10} height={10} />`) plus a per-tab aria label like `"Close ${tabLabel}"`. The shared `<Tabs>` currently hardcodes a plain `×` text character and `aria-label="Close"`. Migrating without these additions would downgrade both the visual and the screen-reader experience. Both fields are per-tab options on `TabDescriptor`.

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Modify: `frontend/src/shared/components/tabs/Tabs.test.tsx`

- [ ] **Step 1: Write the failing tests.**

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

- [ ] **Step 2: Run tests to verify they fail.**

  Run: `./node_modules/.bin/vitest run src/shared/components/tabs/Tabs.test.tsx -t "closeIcon|closeAriaLabel"`

  Expected: both tests fail (fields don't exist yet).

- [ ] **Step 3: Extend `TabDescriptor`.**

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

- [ ] **Step 4: Use the new fields in the close-button render.**

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

- [ ] **Step 5: Run the tests.**

  Run: `./node_modules/.bin/vitest run src/shared/components/tabs/`

  Expected: `Tests  50 passed (50)`.

- [ ] **Step 6: Update the design doc.**

  In `docs/plans/shared-tabs-component-design.md`, add `closeIcon?: ReactNode` and `closeAriaLabel?: string` to the `TabDescriptor` block with the same descriptions as above.

- [ ] **Step 7:** Report task complete and wait for user review.

---

### Task 3: Run baseline QC

**Files:**
- No changes.

- [ ] **Step 1:** Run the full quality gate.

  ```bash
  cd /Volumes/git/luxury-yacht/app && mage qc:prerelease
  ```

  Expected: clean exit with all tests / typecheck / lint passing.

- [ ] **Step 2:** Report task complete and wait for user review.

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

- [ ] **Step 1: Read the current tests.**

  Read `ObjectPanelTabs.test.tsx` in full. Note which behaviors are asserted — you'll either keep the assertions unchanged (they should still pass after the migration, since the shared component preserves the same DOM classes) or update them to match the shared component's output. The goal is to NOT lose any coverage during the migration.

- [ ] **Step 2: Rewrite `ObjectPanelTabs.tsx`.**

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

- [ ] **Step 3: Update `ObjectPanelTabs.test.tsx`.**

  Walk each existing test. For each:
  - Queries by `.tab-item` continue to work — the shared component renders `.tab-item` on the tab roots.
  - Queries by `<button>` tag need to change to `[role="tab"]` because the shared component uses `<div role="tab">`.
  - `tabIndex` assertions change from `expect(tab.tabIndex).toBe(-1)` (already the case) to the same value (no change needed).
  - Click handlers: clicking on `.tab-item` still triggers `onActivate` which calls `onSelect` — no change.
  - Any text content assertions (`expect(tab.textContent).toBe('DETAILS')`) continue to work because uppercase is applied via CSS.

  Fix any that break after the migration. If an assertion no longer makes sense (e.g., it was testing local implementation detail that the shared component now owns), delete it and leave a comment explaining why.

- [ ] **Step 4: Run the tests.**

  Run: `./node_modules/.bin/vitest run src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.test.tsx`

  Expected: all tests pass.

- [ ] **Step 5: Delete dead CSS.**

  In `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.css`, delete the `.object-panel .tab-item, .object-panel-body .tab-item { text-transform: uppercase }` rule — the shared component now handles this via `textTransform="uppercase"` in the JSX.

  Keep the `.object-panel-body > .tab-strip { flex-shrink: 0 }` rule — that's a layout override for how the strip sits inside the panel body, not a tab styling override, and the shared component doesn't control parent-context flex behavior.

- [ ] **Step 6: Run the broader ObjectPanel tests to catch regressions.**

  Run: `./node_modules/.bin/vitest run src/modules/object-panel/`

  Expected: all tests pass.

- [ ] **Step 7: Manual smoke test.**

  Run the app (`mage run`), open an object panel, click through each tab, verify:
  - Labels render in uppercase
  - Active tab gets the accent underline
  - Clicking a tab activates it
  - The object panel's Escape-to-close keyboard shortcut and arrow-key navigation within the panel still work (the custom focus walker still reaches the tabs)
  - The tab strip does NOT become a separate Tab-key stop outside the panel's focus scope

- [ ] **Step 8:** Report task complete and wait for user review.

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

- [ ] **Step 1: Remove the `useTabStyles` import and call.**

  In `DiagnosticsPanel.tsx`:
  - Delete the import `import { useTabStyles } from '@shared/components/tabs/Tabs';` at line 37.
  - Delete the call `useTabStyles();` at line 196.

  The tab CSS is already loaded globally via `styles/index.css → components/tabs.css`, so removing the call is a no-op. The shim was only there for consumers that imported from the legacy `Tabs/index.tsx` path; it's no longer needed once no consumer calls the hook.

- [ ] **Step 2: Add the shared `<Tabs>` import.**

  At the top of `DiagnosticsPanel.tsx`, near the other shared imports:

  ```tsx
  import { Tabs, type TabDescriptor } from '@shared/components/tabs';
  ```

- [ ] **Step 3: Define the tab descriptors.**

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

- [ ] **Step 4: Replace the tab JSX.**

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

- [ ] **Step 5: Delete dead CSS.**

  In `DiagnosticsPanel.css` around line 348, delete the rule:

  ```css
  .diagnostics-tabs .tab-item {
    text-transform: uppercase;
  }
  ```

  The shared component applies uppercase via `textTransform="uppercase"` on the JSX, so the per-consumer override is no longer needed. Keep the `.diagnostics-tabs { padding: 0.3rem 0.5rem 0 }` rule above it — that's the wrapper layout, unrelated to tab styling.

- [ ] **Step 6: Run the tests.**

  Run: `./node_modules/.bin/vitest run src/core/refresh/components/DiagnosticsPanel.test.ts`

  Expected: all tests pass. If any fail because they were querying the tabs by tag name (`button`) or by hardcoded uppercase strings, update them to use `[role="tab"]` queries and natural-case label strings.

- [ ] **Step 7: Manual smoke test.**

  Open the diagnostics panel (via the app's menu), click through each of the four tabs, verify:
  - Labels render in uppercase
  - Active tab gets the accent underline
  - Clicking a tab activates it
  - The diagnostics panel's Escape-to-close and arrow-key focus navigation still work
  - The tab strip is NOT a native Tab-key stop

- [ ] **Step 8:** Report task complete and wait for user review.

---

### Task 6: Delete the `useTabStyles` shim

**Files:**
- Modify: `frontend/src/shared/components/tabs/Tabs.tsx`
- Delete: `frontend/src/shared/components/tabs/Tabs/index.tsx` (and the empty `Tabs/` directory)

- [ ] **Step 1: Verify no consumers remain.**

  Run: `grep -rn "useTabStyles" /Volumes/git/luxury-yacht/app/frontend/src`

  Expected: the only hits are inside `frontend/src/shared/components/tabs/Tabs.tsx` (the shim itself) and `frontend/src/shared/components/tabs/Tabs/index.tsx` (the legacy barrel). Zero consumer references.

- [ ] **Step 2: Delete the shim export from `Tabs.tsx`.**

  At the bottom of `Tabs.tsx`, delete the entire block starting at:

  ```tsx
  /**
   * Backward-compat shim. The previous shared tabs module exposed a no-op
   * `useTabStyles` hook (see `frontend/src/shared/components/tabs/Tabs/index.tsx`).
   * ...
   */
  export const useTabStyles = (): boolean => true;
  ```

- [ ] **Step 3: Delete the legacy `Tabs/` directory.**

  Delete `frontend/src/shared/components/tabs/Tabs/index.tsx`, then remove the now-empty `Tabs/` directory.

  ```bash
  rm /Volumes/git/luxury-yacht/app/frontend/src/shared/components/tabs/Tabs/index.tsx
  rmdir /Volumes/git/luxury-yacht/app/frontend/src/shared/components/tabs/Tabs
  ```

- [ ] **Step 4: Typecheck and test.**

  ```bash
  cd /Volumes/git/luxury-yacht/app/frontend
  ./node_modules/.bin/tsc --noEmit --project .
  ./node_modules/.bin/vitest run src/shared/components/tabs/
  ```

  Expected: clean.

- [ ] **Step 5:** Report task complete and wait for user review.

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
- Modify: top-level layout where `ClusterTabs` is mounted (add `TabDragProvider` scope)

- [ ] **Step 1: Locate the `ClusterTabs` mount point and confirm the `TabDragProvider` is in scope.**

  The shared drag coordinator requires a `TabDragProvider` context. `DockablePanelProvider` already supplies its own — but `ClusterTabs` sits OUTSIDE the dockable panel layer in the layout hierarchy. It needs its own provider.

  Find where `<ClusterTabs />` is rendered (likely `frontend/src/ui/layout/MainLayout.tsx` or similar). Grep:

  ```bash
  grep -rn "ClusterTabs" /Volumes/git/luxury-yacht/app/frontend/src --include="*.tsx" | grep -v ClusterTabs.test
  ```

  In the parent component that renders `<ClusterTabs />`, wrap it:

  ```tsx
  import { TabDragProvider } from '@shared/components/tabs/dragCoordinator';

  // ... inside the layout JSX ...
  <TabDragProvider>
    <ClusterTabs />
  </TabDragProvider>
  ```

  Note: once the Dockable migration happens (Consumer 4), the top-level app will need a single `TabDragProvider` that wraps everything. For now, the Cluster and Dockable providers are separate scopes. This is acceptable because the discriminated payload types prevent cross-scope drops by construction.

- [ ] **Step 2: Read the existing `ClusterTabs.test.tsx`.**

  Note every assertion — these are the behaviors that must still work post-migration. Key areas:
  - Drag-and-drop reorder persistence
  - Close button with port-forward modal
  - Conditional rendering (`< 2` tabs → null)
  - Label rendering (with collision fallback)

- [ ] **Step 3: Rewrite the `ClusterTabs` component body.**

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
    useTabDragSource,
    useTabDropTarget,
  } from '@shared/components/tabs/dragCoordinator';
  import './ClusterTabs.css';

  // ... ordersMatch helper stays unchanged ...
  // ... moveTab helper stays unchanged ...

  type ClusterTab = {
    id: string;
    label: string;
    selection: string;
  };

  // Max slots to unroll — the rules of hooks forbid calling hooks inside
  // .map(), so we unroll a fixed number of useTabDragSource calls. 16 is
  // generous enough for typical usage (no user opens more than 16
  // kubeconfig contexts at once); the overflow chevrons handle the rare
  // case of more.
  const MAX_CLUSTER_TAB_SLOTS = 16;

  const ClusterTabs: React.FC = () => {
    // ... existing state / refs / effects unchanged through `orderedTabs` ...

    // Replace the old drag handlers with the shared drag coordinator.
    // Each slot binds to the CURRENT tab at that index so payloads stay
    // in sync after reorders. Unused slots pass null (safely disabled).
    const dragSlots: (TabDescriptor['extraProps'] | undefined)[] = [];
    for (let i = 0; i < MAX_CLUSTER_TAB_SLOTS; i += 1) {
      const tab = orderedTabs[i];
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const slotProps = useTabDragSource(
        tab ? { kind: 'cluster-tab', clusterId: tab.id } : null
      );
      dragSlots.push(slotProps);
    }

    const { ref: dropRef, dropInsertIndex } = useTabDropTarget({
      accepts: ['cluster-tab'],
      onDrop: (payload, _event, insertIndex) => {
        // Reuse the existing moveTab() helper to compute the next order.
        // moveTab takes (order, sourceId, targetId) — but our new onDrop
        // gives us an insert index, not a target id. Convert: the target
        // id is the one CURRENTLY at `insertIndex` in mergedOrder. Fall
        // back to the last id when inserting at the end.
        const sourceId = payload.clusterId;
        const targetId =
          mergedOrder[Math.min(insertIndex, mergedOrder.length - 1)] ?? sourceId;
        if (sourceId === targetId) return;
        const nextOrder = moveTab(mergedOrder, sourceId, targetId);
        if (!ordersMatch(nextOrder, mergedOrder)) {
          setClusterTabOrder(nextOrder);
        }
      },
    });

    const tabDescriptors: TabDescriptor[] = useMemo(
      () =>
        orderedTabs.map((tab, i) => ({
          id: tab.id,
          label: tab.label,
          closeIcon: <CloseIcon width={10} height={10} />,
          closeAriaLabel: `Close ${tab.label}`,
          onClose: () => {
            void handleCloseTab(tab.selection);
          },
          extraProps: {
            title: tab.label, // tooltip for full text when truncated
            ...dragSlots[i],
          } as HTMLAttributes<HTMLElement>,
        })),
      [orderedTabs, dragSlots, handleCloseTab]
    );

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
  - The `useTabDragSource` loop at `MAX_CLUSTER_TAB_SLOTS` fixed iterations is a rules-of-hooks workaround. The ESLint disable comment is intentional — the loop iteration count is a compile-time constant, so hook order is stable across renders. This pattern mirrors the Phase 1 preview stories.
  - `moveTab` takes `(order, sourceId, targetId)` — the shared drop target gives us an `insertIndex`. Convert by looking up `mergedOrder[insertIndex]` to get the target id, as shown above.
  - The `cluster-tabs-wrapper` class is a new wrapper div; the `.cluster-tabs` class now sits on the shared component's root via `className`. Check existing CSS rules below.
  - Keep the existing `handleCloseTab` / `handleConfirmClose` / port-forward modal logic unchanged.
  - Keep the existing height-observer effect unchanged — it reads `tabsRef.current?.getBoundingClientRect().height`, and `tabsRef` still points to the outer wrapper div.

- [ ] **Step 4: Update `ClusterTabs.css`.**

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

- [ ] **Step 5: Update tests.**

  Walk each assertion in `ClusterTabs.test.tsx`:
  - Queries by `<button>` → `[role="tab"]` (shared component uses `<div role="tab">`)
  - Drag tests that simulated `dragstart` with `text/plain` payload → update to use the shared drag coordinator. The cleanest approach is to mock `useTabDragSource` at the module level, OR restructure the test to dispatch drag events on the `[role="tab"]` element directly and assert the onDrop side-effect via the persistence call. The latter is more end-to-end.
  - Close-button queries by class `.tab-item__close` continue to work.
  - Close-with-modal assertions unchanged.
  - Conditional-rendering assertion (`< 2` tabs → null) unchanged.

- [ ] **Step 6: Run the tests.**

  Run: `./node_modules/.bin/vitest run src/ui/layout/`

  Expected: all tests pass.

- [ ] **Step 7: Manual smoke test.**

  Open the app with 3+ kubeconfigs selected. Verify:
  - Strip appears only when ≥ 2 contexts are open
  - Each tab shows its label (or id fallback for name collisions)
  - Clicking a tab switches the active cluster
  - Dragging a tab shows the vertical drop indicator bar between tabs (new visual)
  - Dropping reorders and persists (reload the app — order is preserved)
  - Close button works, including the port-forward confirmation modal
  - `--cluster-tabs-height` CSS variable is set (check in devtools; dockable panels should still respect the offset)
  - Keyboard: Tab key reaches the active tab, arrow keys move focus between tabs, Enter activates

- [ ] **Step 8:** Report task complete and wait for user review.

---

## Consumer 4: DockableTabBar

The largest and most complex consumer. `DockableTabBar.tsx` is 413 lines. `DockablePanelProvider.tsx` is 812 lines and owns the floating drag-preview element that tracks the cursor during a dockable tab drag.

**Migration is split into three sub-tasks** because this consumer has three distinct responsibilities:

1. **Task 8** — `DockableTabBar.tsx` renders the tab strip. Migrate rendering (shared `<Tabs>`), drag reorder within strip, overflow scrolling. Delete dead `.dockable-tab-bar__overflow-*` CSS.
2. **Task 9** — `DockablePanelProvider.tsx` owns cross-strip drag coordination and the floating drag preview. Migrate to use `TabDragProvider` + the shared drop target for cross-strip moves. Keep the floating-preview element since it tracks the cursor via CSS vars (distinct from the shared `setDragImage` approach).
3. **Task 10** — Delete dead CSS from `DockablePanel.css`. Update the Phase 1 preview stories to import from the real file locations (they already do). Clean up `registerTabBarElement` if it's no longer needed.

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
- `registerTabBarElement(groupKey, element)` provider registration (provider still needs to know which bar maps to which group for some reveal-on-activation logic — check by grepping `registerTabBarElement` usage)
- `data-group-key` attribute on the bar (used by the provider for drag-over detection at the bar level)
- Active tab reveal: when `activeTab` changes, scroll it into view (already in shared component via auto-scroll effect)

**Behaviors that change:**
- The floating `.dockable-tab-drag-preview` element stays in the provider (Task 9), but the tab bar's `getDragImage` calls into it. In the shared coordinator, `useTabDragSource` accepts a `getDragImage` option — that's how we hand off to the provider's preview element.
- Drag-state visuals (`.dockable-tab--dragging`) → the shared component applies `.tab-item` base; the dragging class can be kept via `extraProps` conditionally. OR: accept the visual simplification (no extra opacity for the dragged source — the drag image already provides enough feedback).

- [ ] **Step 1: Read both tests in full.** Note assertions around drag events, overflow chevron behavior, and the `data-group-key` attribute. Every assertion is a behavior to preserve.

- [ ] **Step 2: Rewrite the component body.** Replace the current 413-line component with a ~150-line shared-component-backed version. Key structural changes:
  - Delete the custom overflow measurement effect, `overflowHint` state, `scrollToNextTab`, `scrollLeft`/`scrollRight` click handlers, `updateOverflowHint` — all handled by `<Tabs>`.
  - Delete the `handleBarMouseDown`/`handleOverflowMouseDown` stopPropagation glue — no longer needed (shared component doesn't fire mousedown on drag).
  - Replace the per-tab `<div role="tab">` JSX with a `TabDescriptor[]` built via `tabs.map(...)` and passed to `<Tabs>`.
  - Replace the per-tab `onDragStart/onDragEnd/onDragEnter/onDragOver/onDrop` handlers with `useTabDragSource` (per slot, unrolled like in `ObjectTabsPreview.stories.tsx`).
  - Replace the per-tab drop target with `useTabDropTarget` at the bar level.
  - Keep `registerTabBarElement(groupKey, barRef.current)` call — it's needed by the provider for its own tracking.
  - Keep the `data-group-key` attribute on the bar root via `className` or via a ref-callback that sets the attribute post-mount. Actually: the shared `<Tabs>` supports `className` but not arbitrary root-level data attributes. **Add a `rootExtraProps?: HTMLAttributes<HTMLDivElement>` prop to `<Tabs>` if needed** — OR, the simpler path, wrap the shared `<Tabs>` in a `<div className="dockable-tab-bar-shell" data-group-key={groupKey}>` and let the provider's query selectors target the wrapper. The wrapper pattern is cleaner.

  **Template** (read fully, then adapt):

  ```tsx
  import React, { useCallback, useMemo, useRef } from 'react';
  import { Tabs, type TabDescriptor } from '@shared/components/tabs';
  import { useTabDragSource, useTabDropTarget } from '@shared/components/tabs/dragCoordinator';
  import { CloseIcon } from '@shared/components/icons/MenuIcons';
  import { useDockablePanelContext } from './DockablePanelContext';

  // 16-tab max per bar — more than any realistic user scenario. The rest
  // scroll via the shared overflow chevrons.
  const MAX_DOCKABLE_TAB_SLOTS = 16;

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
    const { registerTabBarElement, dragPreviewRef } = useDockablePanelContext();
    const shellRef = useRef<HTMLDivElement | null>(null);

    // Register/unregister the bar with the provider so cross-strip drag
    // detection can find it by groupKey.
    const assignShellRef = useCallback(
      (el: HTMLDivElement | null) => {
        shellRef.current = el;
        registerTabBarElement(groupKey, el);
      },
      [groupKey, registerTabBarElement]
    );

    // Unrolled drag sources. Each slot's getDragImage hands off to the
    // provider's floating preview element (which tracks the cursor via
    // CSS vars updated by the provider during drag).
    const dragSlots: (TabDescriptor['extraProps'] | undefined)[] = [];
    for (let i = 0; i < MAX_DOCKABLE_TAB_SLOTS; i += 1) {
      const tab = tabs[i];
      // eslint-disable-next-line react-hooks/rules-of-hooks
      const slotProps = useTabDragSource(
        tab
          ? { kind: 'dockable-tab', panelId: tab.panelId, sourceGroupId: groupKey }
          : null,
        {
          getDragImage: () => {
            if (!tab || !dragPreviewRef.current) return null;
            // Update the preview element's label span and kind class
            // BEFORE setDragImage is called. See DockablePanelProvider
            // for how the element is rendered.
            const labelEl = dragPreviewRef.current.querySelector<HTMLSpanElement>(
              '.dockable-tab-drag-preview__label'
            );
            if (labelEl) labelEl.textContent = tab.title;
            const kindEl = dragPreviewRef.current.querySelector<HTMLSpanElement>(
              '.dockable-tab-drag-preview__kind'
            );
            if (kindEl && tab.kindClass) {
              kindEl.className = `dockable-tab-drag-preview__kind kind-badge ${tab.kindClass}`;
            }
            return { element: dragPreviewRef.current, offsetX: 14, offsetY: 16 };
          },
        }
      );
      dragSlots.push(slotProps);
    }

    const { ref: dropRef, dropInsertIndex } = useTabDropTarget({
      accepts: ['dockable-tab'],
      onDrop: (payload, _event, insertIndex) => {
        // Delegate to the provider's cross-strip move handler — see the
        // `movePanel` method it exposes via context. Handles BOTH
        // within-strip reorder (source === target) and cross-strip moves.
        // The provider owns the state, so the bar just forwards the intent.
        const { movePanel } = useDockablePanelContext();
        movePanel(payload.panelId, payload.sourceGroupId, groupKey, insertIndex);
      },
    });

    const tabDescriptors: TabDescriptor[] = useMemo(
      () =>
        tabs.map((tab, i) => ({
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
            ...dragSlots[i],
          } as HTMLAttributes<HTMLElement>,
        })),
      [tabs, dragSlots, closeTab]
    );

    return (
      <div
        ref={(el) => {
          assignShellRef(el);
          dropRef(el);
        }}
        className="dockable-tab-bar-shell"
        data-group-key={groupKey}
      >
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
  - `useDockablePanelContext` is the hook that currently gives `registerTabBarElement`. Verify its current shape by reading `DockablePanelProvider.tsx`. If `movePanel` and `dragPreviewRef` aren't already exposed, add them in Task 9 BEFORE running Task 8's tests — the two tasks are interdependent.
  - The example above CALLS `useDockablePanelContext()` inside `onDrop`, which is a rules-of-hooks violation (hooks inside callbacks). Fix by hoisting the context destructure:

    ```tsx
    const { registerTabBarElement, dragPreviewRef, movePanel } = useDockablePanelContext();
    ```

    at the top of the component, and reference `movePanel` from the closure.
  - `registerTabBarElement` currently registers the BAR element (`barRef.current`), but here we register the SHELL element. Check whether the provider's consumers of the registered element care about the distinction (they probably use it for `bar.querySelector('[role="tab"]')` which works on either).

- [ ] **Step 3: Update tests.** Drag tests that simulate raw `dragstart`/`drop` events on individual tabs still work — the shared drag coordinator uses the same native HTML5 drag API. Update queries from the old markup (`.dockable-tab`) to the new markup (`[role="tab"]`). Tests that assert on `.dockable-tab-bar__overflow-indicator` classes need to update to `.tab-strip__overflow-indicator`.

- [ ] **Step 4: Run the tests.** `./node_modules/.bin/vitest run src/ui/dockable/DockableTabBar`. Expected: all tests pass.

- [ ] **Step 5:** Report task complete and wait for user review.

---

### Task 9: Migrate `DockablePanelProvider.tsx` drag coordination

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanelProvider.tsx`
- Modify: `frontend/src/ui/dockable/DockablePanelProvider.test.tsx`

**What needs to happen:**
The provider currently owns:
1. A `dragState` state machine for cross-strip drag detection (bars registered via `registerTabBarElement`, cursor position tracked via pointer move)
2. A floating `<div className="dockable-tab-drag-preview">` element that follows the cursor via CSS custom properties `--dockable-tab-drag-x` / `--dockable-tab-drag-y` updated on pointer move
3. A `movePanel(panelId, sourceGroupId, targetGroupId, toIndex)` method (or equivalent)
4. The `registerTabBarElement` registry so the provider knows which DOM element maps to which group

**Migration strategy:**
- Wrap the provider's children tree in `<TabDragProvider>` so `useTabDragSource` and `useTabDropTarget` inside `DockableTabBar` have a context.
- KEEP the floating preview element — it provides cursor-tracking visual feedback that the shared `setDragImage` snapshot approach cannot (setDragImage takes a screenshot once at dragstart; it doesn't animate). The floating element is rendered independently and positioned via CSS vars on pointermove.
- Expose `dragPreviewRef` via context so `DockableTabBar` can pass it to `setDragImage` at dragstart (the browser screenshots it there; between dragstart and drop the provider continues to update the CSS vars for the live "attached to cursor" effect).
- Delete the old custom drag-state machine and `registerTabBarElement`-driven hit testing — the shared `useTabDropTarget` handles drop detection now.
- `movePanel` stays in the provider, still exposed via context. `DockableTabBar`'s `onDrop` calls it.
- `registerTabBarElement` can be removed IF nothing else uses it. Check with grep before deleting.

- [ ] **Step 1: Read the full `DockablePanelProvider.tsx` file** and map current responsibilities.

- [ ] **Step 2: Add `TabDragProvider` wrapping the rendered children.**

  Wrap the provider's returned JSX in `<TabDragProvider>`:

  ```tsx
  import { TabDragProvider } from '@shared/components/tabs/dragCoordinator';

  // ... inside the provider's return ...
  return (
    <PanelLayoutStoreContext.Provider value={layoutStore}>
      <DockablePanelContext.Provider value={value}>
        <TabDragProvider>
          <DockablePanelHostContext.Provider value={hostNode}>
            {children}
            {dragState ? (
              <div className="dockable-tab-drag-preview" aria-hidden="true">
                {/* ... preview contents ... */}
              </div>
            ) : null}
          </DockablePanelHostContext.Provider>
        </TabDragProvider>
      </DockablePanelContext.Provider>
    </PanelLayoutStoreContext.Provider>
  );
  ```

- [ ] **Step 3: Expose `dragPreviewRef` via context.**

  Add a `useRef<HTMLDivElement | null>(null)` at the top of the provider, ref the floating preview element to it, and include `dragPreviewRef` in the context value:

  ```tsx
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  // ...
  const value = useMemo<DockablePanelContextValue>(
    () => ({
      // ... existing fields ...
      dragPreviewRef,
      movePanel, // if not already exposed
    }),
    [/* existing deps */]
  );
  // ...
  <div ref={dragPreviewRef} className="dockable-tab-drag-preview" aria-hidden="true">
  ```

  **Important:** the preview element must ALWAYS be mounted (not conditionally rendered on `dragState`), because `DockableTabBar`'s `getDragImage` needs to hand the browser a DOM element at dragstart. The element's CSS default `transform: translate3d(var(--dockable-tab-drag-x, -9999px), var(--dockable-tab-drag-y, -9999px), 0)` keeps it offscreen when no drag is in flight. The provider updates those CSS vars during drag to make it follow the cursor visually.

  Update the DockablePanelContextValue type accordingly and grep for context consumers to make sure nothing breaks.

- [ ] **Step 4: Delete the custom drag-state machine.**

  The existing `dragState`, `startTabDrag`, `endTabDrag`, dropTarget computation, and the `registerTabBarElement`-based hit testing are all subsumed by the shared drag coordinator. Delete:
  - The `dragState` state and setter
  - `startTabDrag` / `endTabDrag` methods (if present)
  - Any pointermove listener that computed `dropTarget` by walking registered bars
  - The `registerTabBarElement` registry if no other consumer uses it (grep to confirm — it may be used by the panel shell for something else)

  KEEP:
  - The CSS-var-updating pointermove listener that sets `--dockable-tab-drag-x` / `--dockable-tab-drag-y` on the preview element. This is what gives the floating preview its cursor tracking, and it's orthogonal to the drop-target logic.
  - The `movePanel` method — still called by `DockableTabBar`'s onDrop.

- [ ] **Step 5: Add a global `dragstart` / `dragend` listener** that sets/unsets the CSS vars for the preview element's positioning. Move this logic out of the old `startTabDrag`/`endTabDrag` methods:

  ```tsx
  useEffect(() => {
    const preview = dragPreviewRef.current;
    if (!preview) return;

    const handleDragOver = (e: DragEvent) => {
      // Only update when a tab drag is in flight (check dataTransfer types).
      if (!e.dataTransfer?.types.includes('application/x-tab-drag')) return;
      preview.style.setProperty('--dockable-tab-drag-x', `${e.clientX}px`);
      preview.style.setProperty('--dockable-tab-drag-y', `${e.clientY}px`);
    };
    const handleDragEnd = () => {
      preview.style.removeProperty('--dockable-tab-drag-x');
      preview.style.removeProperty('--dockable-tab-drag-y');
    };

    document.addEventListener('dragover', handleDragOver);
    document.addEventListener('dragend', handleDragEnd);
    document.addEventListener('drop', handleDragEnd);
    return () => {
      document.removeEventListener('dragover', handleDragOver);
      document.removeEventListener('dragend', handleDragEnd);
      document.removeEventListener('drop', handleDragEnd);
    };
  }, []);
  ```

  **Check `frontend/src/shared/components/tabs/dragCoordinator/types.ts`** for the MIME type string used by `useTabDragSource` (currently `TAB_DRAG_DATA_TYPE`). Import and use that constant instead of hardcoding `'application/x-tab-drag'`.

- [ ] **Step 6: Update the provider tests.** `DockablePanelProvider.test.tsx` asserts against the drag preview element and the registered bar elements. Update to match the new flow:
  - Preview element is always mounted (not conditional on `dragState`).
  - Drag events on `[role="tab"]` elements trigger `useTabDragSource`'s internal handlers, which set CSS vars via the global listener.
  - `movePanel` is still exposed and still callable from test helpers.
  - `registerTabBarElement`-based assertions are DELETED if the registry was removed.

- [ ] **Step 7: Run the dockable tests.**

  ```bash
  ./node_modules/.bin/vitest run src/ui/dockable/
  ```

  Expected: all tests pass.

- [ ] **Step 8: Manual smoke test.**

  Open the app. Open 4+ dockable panels. Verify:
  - Within-strip reorder works (drag a tab left/right within the same bar)
  - Cross-strip moves work (drag from one bar to another)
  - The floating drag preview follows the cursor
  - The drop-position indicator bar appears inside the target strip
  - Dropping in an empty area creates a new strip (if the current codebase supports it — confirm with the user)
  - Overflow chevrons appear and scroll correctly when many tabs are open
  - Clicking a tab still activates it
  - Close button still works

- [ ] **Step 9:** Report task complete and wait for user review.

---

### Task 10: Delete dead Dockable CSS

**Files:**
- Modify: `frontend/src/ui/dockable/DockablePanel.css`

- [ ] **Step 1: Delete rules the shared component now handles.**

  In `DockablePanel.css`, delete:
  - `.dockable-tab-bar::-webkit-scrollbar { display: none }` — shared `.tab-strip::-webkit-scrollbar` covers this
  - `.dockable-tab` class styles that duplicate `.tab-item` — diff against `tabs.css`, delete duplicates
  - `.dockable-tab__label` truncation rules — shared `.tab-item__label` handles this
  - `.dockable-tab-bar__overflow-indicator` and all `.dockable-tab-bar__overflow-*` rules — shared `.tab-strip__overflow-indicator` covers these
  - `.dockable-tab-bar__drop-indicator` — shared `.tab-strip__drop-indicator` covers it

  KEEP:
  - `.dockable-tab-bar-shell` container layout (it's still the wrapper around `<Tabs>`)
  - `.dockable-tab-bar` layout rules (`height: 100%`, `flex: 1`, etc.) — applied via `className="dockable-tab-bar"` on the shared component's root
  - `.dockable-tab-bar--drag-active` / `.dockable-tab-bar--drop-target` — if still used anywhere; otherwise delete
  - `.dockable-tab__kind-indicator.kind-badge` override — this is the leading-slot visual, still needed
  - `.dockable-tab-drag-preview` and all `.dockable-tab-drag-preview__*` rules — still the custom cursor-following preview element
  - `.dockable-tab--dragging` — if used for drag-source visual feedback via `extraProps` conditional classNames; otherwise delete

- [ ] **Step 2: Run tests and manual smoke again.**

  ```bash
  ./node_modules/.bin/vitest run src/ui/dockable/
  ```

  Visually spot-check that no CSS regression occurred during deletion.

- [ ] **Step 3:** Report task complete and wait for user review.

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

- [ ] **Step 1: Delete the three preview story files.**
- [ ] **Step 2: Delete `stories.css`** if nothing else references it. Verify:
  ```bash
  grep -rn "stories.css\|tabs-story-" /Volumes/git/luxury-yacht/app/frontend/src
  ```
  If only `Tabs.stories.tsx` or `TabsWithDrag.stories.tsx` hits, move the minimum-needed classes back into those files' local styles OR keep `stories.css` around for them. If zero hits, delete.
- [ ] **Step 3: Update `.storybook/preview.ts`** — remove the three preview-story ids from the `storySort` order array.
- [ ] **Step 4: Run tests and start storybook** to confirm nothing broke.
- [ ] **Step 5:** Report task complete and wait for user review.

### Task 12: Update the design doc

**Files:**
- Modify: `docs/plans/shared-tabs-component-design.md`

- [ ] **Step 1:** Add a "Consumers" section at the bottom listing all four consumers and their current migration status (now: all migrated). Remove any references to `useTabStyles` or the preview stories from the doc. Confirm the `TabsProps` block lists `disableRovingTabIndex` and that `TabDescriptor` lists `closeIcon` / `closeAriaLabel` (added in Tasks 1 and 2).
- [ ] **Step 2:** Report task complete and wait for user review.

### Task 13: Final QC gate

**Files:**
- No changes.

- [ ] **Step 1: Run the full release check.**

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
  - Dockable tab bars: within-strip reorder, cross-strip move, empty-space new strip, overflow chevrons, custom drag preview

- [ ] **Step 4:** Report Phase 2 complete.

---

## Risks and mitigations

**Risk: `DockablePanelProvider` migration breaks cross-strip drag.**
Mitigation: Task 9 has the largest surface area and the most code to delete. Approach: start by wrapping in `TabDragProvider` and verifying within-strip reorder still works (just replaces the old intra-bar handlers with the shared ones). Only AFTER that's green, delete the old cross-strip detection code. Iterate in small commits so regressions are easy to bisect.

**Risk: The custom focus-management systems in ObjectPanel / Diagnostics regress.**
Mitigation: the `disableRovingTabIndex` prop is explicitly designed to preserve those systems' invariants. The `data-*-focusable` attributes pass through cleanly via `extraProps`. If any manual smoke test fails, the focus walker is probably not finding the shared component's output — verify the attribute made it onto the rendered DOM.

**Risk: The `useTabDragSource` unrolled-hook pattern is fragile at the upper limit of `MAX_*_TAB_SLOTS`.**
Mitigation: 16 slots is well above any realistic usage. If a user genuinely opens 17+ clusters or 17+ dockable panels in one strip, only the first 16 would be draggable — acceptable edge case. The overflow chevrons still handle the visual scrolling.

**Risk: The floating `dockable-tab-drag-preview` element loses cursor tracking after migration.**
Mitigation: The CSS-var-driven positioning is orthogonal to the shared drag coordinator. Task 9 explicitly preserves the pointermove listener and the offscreen-by-default CSS. Verify with devtools: during a drag, the element should reposition on every mousemove via inline `style` updates to the CSS vars.

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
- [ ] All existing behaviors are preserved (manual smoke tests checked off in each task)
- [ ] The design doc reflects the final API surface (including `disableRovingTabIndex`, `closeIcon`, `closeAriaLabel`)
- [ ] The preview stories are deleted
