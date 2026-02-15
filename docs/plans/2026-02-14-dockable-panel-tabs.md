# Dockable Panel Tabs Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable multiple dockable panels to share a dock position via tabs, with full drag-to-reorder and drag-to-undock support.

**Architecture:** The `DockablePanelProvider` manages tab groups (ordered lists of panel IDs per position). A new `DockableTabGroup` component renders the shared container (positioning, resize, header with tab bar, active panel body). `DockablePanel` becomes a registration-only component that contributes its body content to the active slot of its tab group.

**Tech Stack:** React 18, TypeScript, CSS, Vitest

**Design doc:** `docs/plans/2026-02-14-dockable-panel-tabs-design.md`

---

## Phase 1: Tab Group Types & State Model

### Task 1: Define tab group types

**Files:**
- Create: `frontend/src/components/dockable/tabGroupTypes.ts`

**Step 1: Create the types file**

```ts
/**
 * tabGroupTypes.ts
 *
 * Type definitions for the tab group system.
 * A tab group is an ordered collection of panel IDs sharing a dock position.
 */

import type { DockPosition } from './useDockablePanelState';

/** Metadata that a panel provides when it registers with the provider. */
export interface PanelRegistration {
  panelId: string;
  title: string;
  position: DockPosition;
  defaultSize?: { width?: number; height?: number };
  allowMaximize?: boolean;
  maximizeTargetSelector?: string;
  className?: string;
  contentClassName?: string;
  onClose?: () => void;
  onPositionChange?: (position: DockPosition) => void;
  onMaximizeChange?: (isMaximized: boolean) => void;
  /** Ref forwarded from the consumer for keyboard scoping etc. */
  panelRef?: React.Ref<HTMLDivElement>;
}

/** A floating tab group with its own position/size identity. */
export interface FloatingTabGroup {
  groupId: string;
  tabs: string[];
  activeTab: string | null;
}

/** State for all tab groups managed by the provider. */
export interface TabGroupState {
  right: { tabs: string[]; activeTab: string | null };
  bottom: { tabs: string[]; activeTab: string | null };
  floating: FloatingTabGroup[];
}

/** Drag state tracked by the provider during tab drags. */
export interface TabDragState {
  panelId: string;
  sourceGroupKey: string; // 'right' | 'bottom' | floating groupId
  cursorPosition: { x: number; y: number };
  dropTarget: { groupKey: string; insertIndex: number } | null;
}

/** Identifies which group a panel belongs to. */
export type GroupKey = 'right' | 'bottom' | string; // string = floating groupId
```

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors from the new file.

---

### Task 2: Write failing tests for tab group state helpers

**Files:**
- Create: `frontend/src/components/dockable/tabGroupState.test.ts`

**Step 1: Write tests**

```ts
/**
 * tabGroupState.test.ts
 *
 * Tests for tab group state management helpers.
 */

import { describe, expect, it } from 'vitest';
import {
  createInitialTabGroupState,
  addPanelToGroup,
  removePanelFromGroup,
  setActiveTab,
  getGroupForPanel,
  reorderTab,
  movePanelToGroup,
} from './tabGroupState';
import type { TabGroupState } from './tabGroupTypes';

describe('tabGroupState', () => {
  const empty = (): TabGroupState => createInitialTabGroupState();

  describe('addPanelToGroup', () => {
    it('adds a panel to the right group', () => {
      const state = addPanelToGroup(empty(), 'panel-a', 'right');
      expect(state.right.tabs).toEqual(['panel-a']);
      expect(state.right.activeTab).toBe('panel-a');
    });

    it('appends to existing tabs and activates new panel', () => {
      let state = addPanelToGroup(empty(), 'panel-a', 'right');
      state = addPanelToGroup(state, 'panel-b', 'right');
      expect(state.right.tabs).toEqual(['panel-a', 'panel-b']);
      expect(state.right.activeTab).toBe('panel-b');
    });

    it('does not duplicate a panel already in the group', () => {
      let state = addPanelToGroup(empty(), 'panel-a', 'right');
      state = addPanelToGroup(state, 'panel-a', 'right');
      expect(state.right.tabs).toEqual(['panel-a']);
    });

    it('creates a new floating group for floating panels', () => {
      const state = addPanelToGroup(empty(), 'panel-a', 'floating');
      expect(state.floating).toHaveLength(1);
      expect(state.floating[0].tabs).toEqual(['panel-a']);
      expect(state.floating[0].activeTab).toBe('panel-a');
    });

    it('creates separate floating groups for each floating panel', () => {
      let state = addPanelToGroup(empty(), 'panel-a', 'floating');
      state = addPanelToGroup(state, 'panel-b', 'floating');
      expect(state.floating).toHaveLength(2);
    });
  });

  describe('removePanelFromGroup', () => {
    it('removes a panel and activates adjacent tab', () => {
      let state = addPanelToGroup(empty(), 'panel-a', 'right');
      state = addPanelToGroup(state, 'panel-b', 'right');
      state = setActiveTab(state, 'right', 'panel-a');
      state = removePanelFromGroup(state, 'panel-a');
      expect(state.right.tabs).toEqual(['panel-b']);
      expect(state.right.activeTab).toBe('panel-b');
    });

    it('clears activeTab when last panel is removed', () => {
      let state = addPanelToGroup(empty(), 'panel-a', 'right');
      state = removePanelFromGroup(state, 'panel-a');
      expect(state.right.tabs).toEqual([]);
      expect(state.right.activeTab).toBeNull();
    });

    it('removes the floating group when its last panel is removed', () => {
      let state = addPanelToGroup(empty(), 'panel-a', 'floating');
      const groupId = state.floating[0].groupId;
      state = removePanelFromGroup(state, 'panel-a');
      expect(state.floating.find((g) => g.groupId === groupId)).toBeUndefined();
    });

    it('activates adjacent-right when active tab is removed', () => {
      let state = addPanelToGroup(empty(), 'a', 'bottom');
      state = addPanelToGroup(state, 'b', 'bottom');
      state = addPanelToGroup(state, 'c', 'bottom');
      state = setActiveTab(state, 'bottom', 'b');
      state = removePanelFromGroup(state, 'b');
      expect(state.bottom.activeTab).toBe('c');
    });

    it('activates adjacent-left when rightmost tab is removed', () => {
      let state = addPanelToGroup(empty(), 'a', 'bottom');
      state = addPanelToGroup(state, 'b', 'bottom');
      state = setActiveTab(state, 'bottom', 'b');
      state = removePanelFromGroup(state, 'b');
      expect(state.bottom.activeTab).toBe('a');
    });
  });

  describe('getGroupForPanel', () => {
    it('returns the group key for a docked panel', () => {
      const state = addPanelToGroup(empty(), 'panel-a', 'right');
      expect(getGroupForPanel(state, 'panel-a')).toBe('right');
    });

    it('returns the floating groupId for a floating panel', () => {
      const state = addPanelToGroup(empty(), 'panel-a', 'floating');
      const groupId = state.floating[0].groupId;
      expect(getGroupForPanel(state, 'panel-a')).toBe(groupId);
    });

    it('returns null for an unknown panel', () => {
      expect(getGroupForPanel(empty(), 'unknown')).toBeNull();
    });
  });

  describe('reorderTab', () => {
    it('moves a tab to a new index within its group', () => {
      let state = addPanelToGroup(empty(), 'a', 'right');
      state = addPanelToGroup(state, 'b', 'right');
      state = addPanelToGroup(state, 'c', 'right');
      state = reorderTab(state, 'right', 'a', 2);
      expect(state.right.tabs).toEqual(['b', 'c', 'a']);
    });
  });

  describe('movePanelToGroup', () => {
    it('moves a panel from right to bottom', () => {
      let state = addPanelToGroup(empty(), 'panel-a', 'right');
      state = movePanelToGroup(state, 'panel-a', 'bottom');
      expect(state.right.tabs).not.toContain('panel-a');
      expect(state.bottom.tabs).toContain('panel-a');
      expect(state.bottom.activeTab).toBe('panel-a');
    });

    it('moves a panel into a specific floating group', () => {
      let state = addPanelToGroup(empty(), 'panel-a', 'floating');
      const groupId = state.floating[0].groupId;
      state = addPanelToGroup(state, 'panel-b', 'right');
      state = movePanelToGroup(state, 'panel-b', groupId);
      const group = state.floating.find((g) => g.groupId === groupId);
      expect(group?.tabs).toContain('panel-b');
      expect(state.right.tabs).not.toContain('panel-b');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/dockable/tabGroupState.test.ts 2>&1 | tail -10`
Expected: FAIL — module `./tabGroupState` does not exist.

---

### Task 3: Implement tab group state helpers

**Files:**
- Create: `frontend/src/components/dockable/tabGroupState.ts`

**Step 1: Implement**

```ts
/**
 * tabGroupState.ts
 *
 * Pure functions for managing tab group state.
 * All functions are immutable — they return new state objects.
 */

import type { TabGroupState, FloatingTabGroup, GroupKey } from './tabGroupTypes';

let nextGroupId = 1;

/** Generate a unique floating group ID. */
function generateGroupId(): string {
  return `float-${nextGroupId++}`;
}

/** Create an empty tab group state. */
export function createInitialTabGroupState(): TabGroupState {
  return {
    right: { tabs: [], activeTab: null },
    bottom: { tabs: [], activeTab: null },
    floating: [],
  };
}

/**
 * Add a panel to a tab group at the given position.
 * For right/bottom: joins the singleton group. For floating: creates a new group.
 * The new panel becomes the active tab.
 */
export function addPanelToGroup(
  state: TabGroupState,
  panelId: string,
  position: 'right' | 'bottom' | 'floating'
): TabGroupState {
  // First remove the panel from any existing group to avoid duplicates.
  const cleaned = removePanelFromGroup(state, panelId);

  if (position === 'floating') {
    const newGroup: FloatingTabGroup = {
      groupId: generateGroupId(),
      tabs: [panelId],
      activeTab: panelId,
    };
    return { ...cleaned, floating: [...cleaned.floating, newGroup] };
  }

  const group = cleaned[position];
  if (group.tabs.includes(panelId)) {
    return { ...cleaned, [position]: { ...group, activeTab: panelId } };
  }

  return {
    ...cleaned,
    [position]: {
      tabs: [...group.tabs, panelId],
      activeTab: panelId,
    },
  };
}

/**
 * Add a panel to a specific floating group (for cross-group moves).
 * The panel becomes the active tab at the given insert index.
 */
export function addPanelToFloatingGroup(
  state: TabGroupState,
  panelId: string,
  groupId: string,
  insertIndex?: number
): TabGroupState {
  const cleaned = removePanelFromGroup(state, panelId);
  return {
    ...cleaned,
    floating: cleaned.floating.map((g) => {
      if (g.groupId !== groupId) return g;
      const tabs = [...g.tabs];
      const idx = insertIndex != null ? Math.min(insertIndex, tabs.length) : tabs.length;
      tabs.splice(idx, 0, panelId);
      return { ...g, tabs, activeTab: panelId };
    }),
  };
}

/**
 * Remove a panel from whichever group it belongs to.
 * Activates the adjacent tab (right, then left). Destroys empty floating groups.
 */
export function removePanelFromGroup(state: TabGroupState, panelId: string): TabGroupState {
  const result = { ...state };

  // Check right
  if (result.right.tabs.includes(panelId)) {
    result.right = removeFromSingletonGroup(result.right, panelId);
    return result;
  }

  // Check bottom
  if (result.bottom.tabs.includes(panelId)) {
    result.bottom = removeFromSingletonGroup(result.bottom, panelId);
    return result;
  }

  // Check floating groups
  result.floating = result.floating
    .map((g) => {
      if (!g.tabs.includes(panelId)) return g;
      const updated = removeFromSingletonGroup(g, panelId);
      return { ...g, ...updated };
    })
    .filter((g) => g.tabs.length > 0);

  return result;
}

/** Helper: remove a panel from a group's tab list and pick the next active tab. */
function removeFromSingletonGroup<T extends { tabs: string[]; activeTab: string | null }>(
  group: T,
  panelId: string
): T {
  const idx = group.tabs.indexOf(panelId);
  if (idx === -1) return group;

  const tabs = group.tabs.filter((id) => id !== panelId);
  let activeTab: string | null = group.activeTab;

  if (activeTab === panelId) {
    if (tabs.length === 0) {
      activeTab = null;
    } else if (idx < tabs.length) {
      // Activate the tab to the right (which shifted into idx)
      activeTab = tabs[idx];
    } else {
      // Was the last tab, activate the new last
      activeTab = tabs[tabs.length - 1];
    }
  }

  return { ...group, tabs, activeTab };
}

/** Set the active tab within a group identified by groupKey. */
export function setActiveTab(
  state: TabGroupState,
  groupKey: GroupKey,
  panelId: string
): TabGroupState {
  if (groupKey === 'right') {
    if (!state.right.tabs.includes(panelId)) return state;
    return { ...state, right: { ...state.right, activeTab: panelId } };
  }
  if (groupKey === 'bottom') {
    if (!state.bottom.tabs.includes(panelId)) return state;
    return { ...state, bottom: { ...state.bottom, activeTab: panelId } };
  }
  // Floating group
  return {
    ...state,
    floating: state.floating.map((g) => {
      if (g.groupId !== groupKey) return g;
      if (!g.tabs.includes(panelId)) return g;
      return { ...g, activeTab: panelId };
    }),
  };
}

/** Find which group a panel belongs to. Returns 'right', 'bottom', or the floating groupId. */
export function getGroupForPanel(state: TabGroupState, panelId: string): GroupKey | null {
  if (state.right.tabs.includes(panelId)) return 'right';
  if (state.bottom.tabs.includes(panelId)) return 'bottom';
  const floatingGroup = state.floating.find((g) => g.tabs.includes(panelId));
  return floatingGroup?.groupId ?? null;
}

/** Reorder a tab within its group to a new index. */
export function reorderTab(
  state: TabGroupState,
  groupKey: GroupKey,
  panelId: string,
  newIndex: number
): TabGroupState {
  const updateTabs = (tabs: string[]): string[] => {
    const idx = tabs.indexOf(panelId);
    if (idx === -1) return tabs;
    const result = tabs.filter((id) => id !== panelId);
    const clampedIndex = Math.min(newIndex, result.length);
    result.splice(clampedIndex, 0, panelId);
    return result;
  };

  if (groupKey === 'right') {
    return { ...state, right: { ...state.right, tabs: updateTabs(state.right.tabs) } };
  }
  if (groupKey === 'bottom') {
    return { ...state, bottom: { ...state.bottom, tabs: updateTabs(state.bottom.tabs) } };
  }
  return {
    ...state,
    floating: state.floating.map((g) =>
      g.groupId === groupKey ? { ...g, tabs: updateTabs(g.tabs) } : g
    ),
  };
}

/**
 * Move a panel to a different group.
 * targetGroupKey can be 'right', 'bottom', 'floating' (creates new group), or a floating groupId.
 */
export function movePanelToGroup(
  state: TabGroupState,
  panelId: string,
  targetGroupKey: GroupKey | 'floating',
  insertIndex?: number
): TabGroupState {
  const cleaned = removePanelFromGroup(state, panelId);

  if (targetGroupKey === 'right' || targetGroupKey === 'bottom') {
    return addPanelToGroup(cleaned, panelId, targetGroupKey);
  }

  if (targetGroupKey === 'floating') {
    return addPanelToGroup(cleaned, panelId, 'floating');
  }

  // Target is a specific floating group
  return addPanelToFloatingGroup(cleaned, panelId, targetGroupKey, insertIndex);
}

/**
 * Get the tab list and active tab for a given group key.
 * Returns null if the group doesn't exist (e.g. unknown floating groupId).
 */
export function getGroupTabs(
  state: TabGroupState,
  groupKey: GroupKey
): { tabs: string[]; activeTab: string | null } | null {
  if (groupKey === 'right') return state.right;
  if (groupKey === 'bottom') return state.bottom;
  const group = state.floating.find((g) => g.groupId === groupKey);
  return group ?? null;
}

/** Reset the floating group ID counter (for tests). */
export function resetGroupIdCounter(): void {
  nextGroupId = 1;
}
```

**Step 2: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/dockable/tabGroupState.test.ts 2>&1 | tail -10`
Expected: All tests PASS.

---

### Task 4: Add `resetGroupIdCounter` to test setup for deterministic IDs

**Files:**
- Modify: `frontend/src/components/dockable/tabGroupState.test.ts`

**Step 1: Import and call reset in beforeEach**

Add at the top of the describe block:

```ts
import {
  // ... existing imports ...
  resetGroupIdCounter,
} from './tabGroupState';

// Inside describe, add:
beforeEach(() => {
  resetGroupIdCounter();
});
```

**Step 2: Run tests**

Run: `cd frontend && npx vitest run src/components/dockable/tabGroupState.test.ts 2>&1 | tail -10`
Expected: All tests PASS.

---

## Phase 2: DockableTabBar Component

### Task 5: Write failing tests for DockableTabBar

**Files:**
- Create: `frontend/src/components/dockable/DockableTabBar.test.tsx`

**Step 1: Write tests**

```tsx
/**
 * DockableTabBar.test.tsx
 *
 * Tests for the DockableTabBar component.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockableTabBar } from './DockableTabBar';

interface RenderContext {
  container: HTMLDivElement;
  root: ReactDOM.Root;
}

describe('DockableTabBar', () => {
  let ctx: RenderContext;

  beforeEach(() => {
    ctx = {} as RenderContext;
    ctx.container = document.createElement('div');
    document.body.appendChild(ctx.container);
    ctx.root = ReactDOM.createRoot(ctx.container);
  });

  afterEach(() => {
    act(() => ctx.root.unmount());
    ctx.container.remove();
  });

  const renderTabBar = async (props: Partial<React.ComponentProps<typeof DockableTabBar>> = {}) => {
    const defaultProps = {
      tabs: [
        { panelId: 'panel-a', title: 'Panel A' },
        { panelId: 'panel-b', title: 'Panel B' },
      ],
      activeTab: 'panel-a',
      onTabClick: vi.fn(),
      onTabClose: vi.fn(),
      groupKey: 'right' as const,
    };
    await act(async () => {
      ctx.root.render(<DockableTabBar {...defaultProps} {...props} />);
    });
    return { ...defaultProps, ...props };
  };

  it('renders tab labels for each panel', async () => {
    await renderTabBar();
    const tabs = ctx.container.querySelectorAll('.dockable-tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent).toContain('Panel A');
    expect(tabs[1].textContent).toContain('Panel B');
  });

  it('marks the active tab', async () => {
    await renderTabBar();
    const tabs = ctx.container.querySelectorAll('.dockable-tab');
    expect(tabs[0].classList.contains('dockable-tab--active')).toBe(true);
    expect(tabs[1].classList.contains('dockable-tab--active')).toBe(false);
  });

  it('calls onTabClick when a tab is clicked', async () => {
    const props = await renderTabBar();
    const tabs = ctx.container.querySelectorAll('.dockable-tab');
    await act(async () => {
      tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.onTabClick).toHaveBeenCalledWith('panel-b');
  });

  it('calls onTabClose when the close button is clicked', async () => {
    const props = await renderTabBar();
    const closeButtons = ctx.container.querySelectorAll('.dockable-tab__close');
    await act(async () => {
      closeButtons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(props.onTabClose).toHaveBeenCalledWith('panel-a');
    // Should NOT also fire onTabClick
    expect(props.onTabClick).not.toHaveBeenCalled();
  });

  it('renders a single tab without a close button', async () => {
    await renderTabBar({
      tabs: [{ panelId: 'panel-a', title: 'Panel A' }],
    });
    const closeButtons = ctx.container.querySelectorAll('.dockable-tab__close');
    expect(closeButtons).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/dockable/DockableTabBar.test.tsx 2>&1 | tail -10`
Expected: FAIL — module `./DockableTabBar` not found.

---

### Task 6: Implement DockableTabBar

**Files:**
- Create: `frontend/src/components/dockable/DockableTabBar.tsx`

**Step 1: Implement**

```tsx
/**
 * DockableTabBar.tsx
 *
 * Renders tab labels with close buttons for a tab group.
 * Handles click-to-switch and close interactions.
 * Drag support will be added in Phase 5.
 */

import React, { useCallback } from 'react';

export interface TabInfo {
  panelId: string;
  title: string;
}

interface DockableTabBarProps {
  tabs: TabInfo[];
  activeTab: string | null;
  onTabClick: (panelId: string) => void;
  onTabClose: (panelId: string) => void;
  groupKey: string;
}

export const DockableTabBar: React.FC<DockableTabBarProps> = ({
  tabs,
  activeTab,
  onTabClick,
  onTabClose,
}) => {
  const handleTabClick = useCallback(
    (panelId: string) => {
      onTabClick(panelId);
    },
    [onTabClick]
  );

  const handleCloseClick = useCallback(
    (e: React.MouseEvent, panelId: string) => {
      // Prevent the tab click handler from firing
      e.stopPropagation();
      onTabClose(panelId);
    },
    [onTabClose]
  );

  // Only show close buttons when there are multiple tabs
  const showClose = tabs.length > 1;

  return (
    <div className="dockable-tab-bar" onMouseDown={(e) => e.stopPropagation()}>
      {tabs.map((tab) => (
        <div
          key={tab.panelId}
          className={`dockable-tab ${activeTab === tab.panelId ? 'dockable-tab--active' : ''}`}
          onClick={() => handleTabClick(tab.panelId)}
          role="tab"
          aria-selected={activeTab === tab.panelId}
          title={tab.title}
        >
          <span className="dockable-tab__label">{tab.title}</span>
          {showClose && (
            <button
              className="dockable-tab__close"
              onClick={(e) => handleCloseClick(e, tab.panelId)}
              title={`Close ${tab.title}`}
              aria-label={`Close ${tab.title}`}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
```

**Step 2: Run tests**

Run: `cd frontend && npx vitest run src/components/dockable/DockableTabBar.test.tsx 2>&1 | tail -10`
Expected: All tests PASS.

---

### Task 7: Add DockableTabBar styles

**Files:**
- Modify: `frontend/src/components/dockable/DockablePanel.css`

**Step 1: Append tab bar styles to end of DockablePanel.css**

```css
/* Tab bar */
.dockable-tab-bar {
  display: flex;
  align-items: stretch;
  gap: 0;
  flex: 1;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.dockable-tab-bar::-webkit-scrollbar {
  display: none;
}

.dockable-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text-secondary, #999);
  cursor: pointer;
  white-space: nowrap;
  border-bottom: 2px solid transparent;
  transition: color 0.15s, border-color 0.15s, background-color 0.15s;
  user-select: none;
  flex-shrink: 0;
}

.dockable-tab:hover {
  color: var(--color-text, #fff);
  background: var(--color-bg-tertiary, rgba(255 255 255 / 5%));
}

.dockable-tab--active {
  color: var(--color-text, #fff);
  border-bottom-color: var(--color-accent, #3b82f6);
}

.dockable-tab__label {
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 160px;
}

.dockable-tab__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 3px;
  background: transparent;
  color: var(--color-text-tertiary, #666);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.dockable-tab__close:hover {
  background: rgba(239 68 68 / 15%);
  color: rgb(239 68 68);
}

/* Drop target highlight for drag-and-drop (Phase 5) */
.dockable-tab-bar--drop-target {
  background: var(--color-accent-bg, rgba(59 130 246 / 10%));
  outline: 1px dashed var(--color-accent, #3b82f6);
  outline-offset: -1px;
}

.dockable-tab-bar__drop-indicator {
  width: 2px;
  background: var(--color-accent, #3b82f6);
  flex-shrink: 0;
  align-self: stretch;
  border-radius: 1px;
}
```

**Step 2: Verify build**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -5`
Expected: No errors.

---

## Phase 3: Integrate Tab Groups into Provider

### Task 8: Refactor DockablePanelProvider to use tab group state

**Files:**
- Modify: `frontend/src/components/dockable/DockablePanelProvider.tsx`

**Step 1: Update the context interface and provider**

Replace the entire file content. The key changes are:
1. Context now exposes tab group state and panel registration map
2. `registerPanel` and `unregisterPanel` use tab group helpers
3. New methods: `switchTab`, `closeTab`, `getTabGroup`
4. Panel registrations stored in a Map for title/metadata access

```tsx
/**
 * DockablePanelProvider.tsx
 *
 * Context provider for managing dockable panels and tab groups.
 * Tracks tab groups per dock position, panel registrations, and the portal host.
 */

import React, { createContext, useContext, useState, useCallback, useLayoutEffect, useRef } from 'react';
import type { TabGroupState, PanelRegistration, GroupKey, TabDragState } from './tabGroupTypes';
import {
  createInitialTabGroupState,
  addPanelToGroup,
  removePanelFromGroup,
  setActiveTab,
  getGroupForPanel,
  reorderTab,
  movePanelToGroup,
  addPanelToFloatingGroup,
  getGroupTabs,
} from './tabGroupState';
import type { DockPosition } from './useDockablePanelState';

interface DockablePanelContextValue {
  // Tab group state
  tabGroups: TabGroupState;

  // Panel registrations (metadata)
  panelRegistrations: Map<string, PanelRegistration>;

  // Register/unregister panels
  registerPanel: (registration: PanelRegistration) => void;
  unregisterPanel: (panelId: string) => void;

  // Tab actions
  switchTab: (groupKey: GroupKey, panelId: string) => void;
  closeTab: (panelId: string) => void;
  reorderTabInGroup: (groupKey: GroupKey, panelId: string, newIndex: number) => void;
  movePanelBetweenGroups: (panelId: string, targetGroupKey: GroupKey | 'floating', insertIndex?: number) => void;
  addPanelToExistingFloatingGroup: (panelId: string, groupId: string, insertIndex?: number) => void;

  // Drag state
  dragState: TabDragState | null;
  setDragState: (state: TabDragState | null) => void;

  // Legacy compat: track docked panels for CSS offset calculation
  dockedPanels: { right: string[]; bottom: string[] };

  // Get adjusted dimensions accounting for other docked panels
  getAdjustedDimensions: () => { rightOffset: number; bottomOffset: number };
}

const defaultDockablePanelContext: DockablePanelContextValue = {
  tabGroups: createInitialTabGroupState(),
  panelRegistrations: new Map(),
  registerPanel: () => {},
  unregisterPanel: () => {},
  switchTab: () => {},
  closeTab: () => {},
  reorderTabInGroup: () => {},
  movePanelBetweenGroups: () => {},
  addPanelToExistingFloatingGroup: () => {},
  dragState: null,
  setDragState: () => {},
  dockedPanels: { right: [], bottom: [] },
  getAdjustedDimensions: () => ({ rightOffset: 0, bottomOffset: 0 }),
};

const DockablePanelContext = createContext<DockablePanelContextValue | null>(null);
const DockablePanelHostContext = createContext<HTMLElement | null | undefined>(undefined);

export const useDockablePanelContext = () => {
  const context = useContext(DockablePanelContext);
  return context ?? defaultDockablePanelContext;
};

let globalHostNode: HTMLElement | null = null;

/** Resolve the `.content` element that panels are mounted inside. */
function getContentContainer(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const el = document.querySelector('.content');
  return el instanceof HTMLElement ? el : null;
}

function getOrCreateGlobalHost(): HTMLElement | null {
  if (globalHostNode && globalHostNode.parentElement) {
    return globalHostNode;
  }
  const container = getContentContainer();
  if (!container) {
    return null;
  }
  const node = document.createElement('div');
  node.className = 'dockable-panel-layer';
  container.appendChild(node);
  globalHostNode = node;
  return globalHostNode;
}

export const useDockablePanelHost = (): HTMLElement | null => {
  const contextHost = useContext(DockablePanelHostContext);
  if (contextHost !== undefined) {
    return contextHost;
  }
  return getOrCreateGlobalHost();
};

interface DockablePanelProviderProps {
  children: React.ReactNode;
}

export const DockablePanelProvider: React.FC<DockablePanelProviderProps> = ({ children }) => {
  const [tabGroups, setTabGroups] = useState<TabGroupState>(createInitialTabGroupState);
  const [dragState, setDragState] = useState<TabDragState | null>(null);
  const registrationsRef = useRef<Map<string, PanelRegistration>>(new Map());
  // Bump a counter to force re-render when registrations change.
  const [, setRegistrationVersion] = useState(0);

  const registerPanel = useCallback((registration: PanelRegistration) => {
    registrationsRef.current.set(registration.panelId, registration);
    setRegistrationVersion((v) => v + 1);
    setTabGroups((prev) => addPanelToGroup(prev, registration.panelId, registration.position));
  }, []);

  const unregisterPanel = useCallback((panelId: string) => {
    registrationsRef.current.delete(panelId);
    setRegistrationVersion((v) => v + 1);
    setTabGroups((prev) => removePanelFromGroup(prev, panelId));
  }, []);

  const switchTab = useCallback((groupKey: GroupKey, panelId: string) => {
    setTabGroups((prev) => setActiveTab(prev, groupKey, panelId));
  }, []);

  const closeTab = useCallback((panelId: string) => {
    const registration = registrationsRef.current.get(panelId);
    setTabGroups((prev) => removePanelFromGroup(prev, panelId));
    registrationsRef.current.delete(panelId);
    setRegistrationVersion((v) => v + 1);
    registration?.onClose?.();
  }, []);

  const reorderTabInGroup = useCallback((groupKey: GroupKey, panelId: string, newIndex: number) => {
    setTabGroups((prev) => reorderTab(prev, groupKey, panelId, newIndex));
  }, []);

  const movePanelBetweenGroups = useCallback(
    (panelId: string, targetGroupKey: GroupKey | 'floating', insertIndex?: number) => {
      setTabGroups((prev) => movePanelToGroup(prev, panelId, targetGroupKey, insertIndex));
    },
    []
  );

  const addPanelToExistingFloatingGroup = useCallback(
    (panelId: string, groupId: string, insertIndex?: number) => {
      setTabGroups((prev) => addPanelToFloatingGroup(prev, panelId, groupId, insertIndex));
    },
    []
  );

  // Derive legacy dockedPanels for backward compatibility
  const dockedPanels = {
    right: tabGroups.right.tabs,
    bottom: tabGroups.bottom.tabs,
  };

  const getAdjustedDimensions = useCallback(() => {
    return {
      rightOffset: tabGroups.right.tabs.length > 0 ? 400 : 0,
      bottomOffset: tabGroups.bottom.tabs.length > 0 ? 300 : 0,
    };
  }, [tabGroups.right.tabs.length, tabGroups.bottom.tabs.length]);

  const value: DockablePanelContextValue = {
    tabGroups,
    panelRegistrations: registrationsRef.current,
    registerPanel,
    unregisterPanel,
    switchTab,
    closeTab,
    reorderTabInGroup,
    movePanelBetweenGroups,
    addPanelToExistingFloatingGroup,
    dragState,
    setDragState,
    dockedPanels,
    getAdjustedDimensions,
  };

  const [hostNode, setHostNode] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const container = getContentContainer();
    if (!container) {
      return;
    }
    const node = document.createElement('div');
    node.className = 'dockable-panel-layer';
    container.appendChild(node);
    setHostNode(node);

    return () => {
      if (container.contains(node)) {
        container.removeChild(node);
      }
      if (globalHostNode === node) {
        globalHostNode = null;
      }
      setHostNode(null);
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const target = document.documentElement;
    return () => {
      target.style.removeProperty('--dock-right-offset');
      target.style.removeProperty('--dock-bottom-offset');
    };
  }, []);

  return (
    <DockablePanelContext.Provider value={value}>
      <DockablePanelHostContext.Provider value={hostNode}>
        {children}
      </DockablePanelHostContext.Provider>
    </DockablePanelContext.Provider>
  );
};
```

**Step 2: Run all dockable tests**

Run: `cd frontend && npx vitest run src/components/dockable/ 2>&1 | tail -15`
Expected: Existing tests should pass. Some may need adjustment if they depend on the old `registerPanel` signature. Fix any failures in the next task.

---

### Task 9: Update DockablePanelHeader to support tab bar

**Files:**
- Modify: `frontend/src/components/dockable/DockablePanelHeader.tsx`

**Step 1: Update to render tab bar when multiple tabs exist, title when single tab**

```tsx
/**
 * DockablePanelHeader.tsx
 *
 * Panel header that renders either a tab bar (multiple tabs) or a plain title (single tab).
 * Always renders the controls region on the right.
 */

import React from 'react';
import { DockableTabBar } from './DockableTabBar';
import type { TabInfo } from './DockableTabBar';

interface DockablePanelHeaderProps {
  title: string;
  /** When provided, renders a tab bar instead of the title. */
  tabs?: TabInfo[];
  activeTab?: string | null;
  onTabClick?: (panelId: string) => void;
  onTabClose?: (panelId: string) => void;
  groupKey?: string;
  onMouseDown: (event: React.MouseEvent) => void;
  controls: React.ReactNode;
}

export const DockablePanelHeader: React.FC<DockablePanelHeaderProps> = ({
  title,
  tabs,
  activeTab,
  onTabClick,
  onTabClose,
  groupKey,
  onMouseDown,
  controls,
}) => {
  const showTabBar = tabs && tabs.length > 1 && onTabClick && onTabClose && groupKey;

  return (
    <div className="dockable-panel__header" onMouseDown={onMouseDown} role="banner">
      <div className="dockable-panel__header-content">
        {showTabBar ? (
          <DockableTabBar
            tabs={tabs}
            activeTab={activeTab ?? null}
            onTabClick={onTabClick}
            onTabClose={onTabClose}
            groupKey={groupKey}
          />
        ) : (
          <span className="dockable-panel__title">{title}</span>
        )}
      </div>
      {controls}
    </div>
  );
};
```

**Step 2: Run tests**

Run: `cd frontend && npx vitest run src/components/dockable/ 2>&1 | tail -15`
Expected: All tests PASS.

---

### Task 10: Update DockablePanel to use tab group context

**Files:**
- Modify: `frontend/src/components/dockable/DockablePanel.tsx`

This is the biggest change. DockablePanel now:
1. Registers with the provider using the new `PanelRegistration` interface
2. Queries the provider for its tab group
3. Only the "group leader" (first panel in the group) renders the container
4. The header renders tabs when multiple panels share a group
5. Only the active panel's body content is visible

**Step 1: Update the imports and registration logic**

The key changes to `DockablePanelInner`:
- Call `registerPanel` with a `PanelRegistration` object instead of `(panelId, position)`
- Query `tabGroups` from context to determine if this panel should render the container
- Pass tab info to `DockablePanelHeader`
- Only render children when this panel is the active tab

This is a large change — update the component in place. The full updated component code should:

1. On open: call `context.registerPanel({ panelId, title, position, ... })` instead of `registerPanel(panelId, position)`
2. On close/unmount: call `context.unregisterPanel(panelId)`
3. Determine group membership via `getGroupForPanel(context.tabGroups, panelId)`
4. If panel is the first tab in its group → render the full container with tab bar
5. If panel is NOT the first tab → render nothing (the group leader renders this panel's body when active)
6. Remove `headerContent` prop (no longer needed — we moved controls to body in the previous plan)
7. Remove `closeDockedPanels` calls (replaced by tab joining)

**Important:** This task should be done carefully, preserving all existing behavior for the single-panel case while enabling multi-panel tab groups. The `headerContent` prop was already removed in the prior "move controls to body" plan, so this change builds on that.

I recommend implementing this change incrementally:
- First, update registration to use the new provider API
- Then, add tab bar rendering to the header
- Then, add group-leader logic to decide which panel renders the container
- Test after each sub-step

**Step 2: Run all tests**

Run: `cd frontend && npx vitest run 2>&1 | tail -15`
Expected: All tests PASS.

---

### Task 11: Update barrel exports

**Files:**
- Modify: `frontend/src/components/dockable/index.ts`

**Step 1: Add new exports**

```ts
export { default as DockablePanel } from './DockablePanel';
export type { DockPosition } from './DockablePanel';
export {
  useDockablePanelState,
  getAllPanelStates,
  restorePanelStates,
} from './useDockablePanelState';
export { DockablePanelProvider, useDockablePanelContext } from './DockablePanelProvider';
export { DockableTabBar } from './DockableTabBar';
export type { TabInfo } from './DockableTabBar';
export type { PanelRegistration, TabGroupState, GroupKey, TabDragState } from './tabGroupTypes';
```

**Step 2: Run index exports test**

Run: `cd frontend && npx vitest run src/components/dockable/index.test.ts 2>&1 | tail -10`
Expected: May need to update `index.test.ts` to include new exports. Fix if needed.

---

## Phase 4: Update Consumers

### Task 12: Update ObjectPanel to use new registration API

**Files:**
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx`

The ObjectPanel already removed `headerContent` in the prior plan. Now ensure it registers with the provider correctly. The `title` prop is already `"Object Panel"` and `defaultPosition="right"`. No further changes needed unless the DockablePanel registration API changed shape — in which case, update the props passed to `<DockablePanel>`.

**Step 1: Verify ObjectPanel still works**

Run: `cd frontend && npx vitest run src/modules/object-panel/ 2>&1 | tail -10`
Expected: All tests PASS.

---

### Task 13: Update AppLogsPanel to use new registration API

**Files:**
- Modify: `frontend/src/components/content/AppLogsPanel/AppLogsPanel.tsx`

Same as Task 12 — verify the panel still works with the updated DockablePanel component.

**Step 1: Verify AppLogsPanel still works**

Run: `cd frontend && npx vitest run src/components/content/AppLogsPanel/ 2>&1 | tail -10`
Expected: All tests PASS.

---

### Task 14: Update PortForwardsPanel and DiagnosticsPanel

**Files:**
- Modify: `frontend/src/modules/port-forward/PortForwardsPanel.tsx`
- Modify: `frontend/src/core/refresh/components/DiagnosticsPanel.tsx`

Verify both panels still work. If they use `headerContent`, move their controls to body following the same pattern as the prior plan.

**Step 1: Check if they use headerContent**

Run: `cd frontend && grep -n "headerContent" src/modules/port-forward/PortForwardsPanel.tsx src/core/refresh/components/DiagnosticsPanel.tsx`

If either uses `headerContent`, apply the same "move controls to body" change as was done for ObjectPanel and AppLogsPanel.

**Step 2: Run full test suite**

Run: `cd frontend && npx vitest run 2>&1 | tail -15`
Expected: All tests PASS.

---

## Phase 5: Tab Drag & Drop

### Task 15: Add drag state tracking to provider

**Files:**
- Modify: `frontend/src/components/dockable/DockablePanelProvider.tsx` (already done in Task 8)

The provider already has `dragState` and `setDragState` from Task 8. Verify it works.

---

### Task 16: Write failing tests for tab drag behavior

**Files:**
- Create: `frontend/src/components/dockable/DockableTabBar.drag.test.tsx`

**Step 1: Write drag interaction tests**

```tsx
/**
 * DockableTabBar.drag.test.tsx
 *
 * Tests for tab drag-to-reorder and drag-to-undock behavior.
 */

import { describe, expect, it, vi } from 'vitest';
// Tests here should verify:
// - mousedown on a tab initiates drag state
// - dragging within same tab bar reorders tabs
// - dragging past a threshold outside the bar triggers undock
// - dragging onto another tab bar triggers cross-group move
// - drop indicator appears at insertion point
// - ghost tab shown at original position during drag
```

(Placeholder — detailed drag interaction tests will be written during implementation since they depend heavily on the final DOM structure and event handling approach.)

---

### Task 17: Add drag handlers to DockableTabBar

**Files:**
- Modify: `frontend/src/components/dockable/DockableTabBar.tsx`

**Step 1: Add mousedown handler to each tab that initiates drag**

Key behaviors to implement:
1. `onMouseDown` on a tab label sets drag state in the provider context
2. Global `mousemove` listener tracks cursor position
3. If cursor stays within tab bar bounds → show reorder indicator
4. If cursor leaves tab bar by more than a threshold (e.g. 40px) → undock mode
5. `mouseup` commits the action: reorder, undock, or cross-group move
6. Tab bar checks `dragState.dropTarget` from context to render highlight

**Step 2: Run drag tests**

Run: `cd frontend && npx vitest run src/components/dockable/DockableTabBar.drag.test.tsx 2>&1 | tail -10`
Expected: All tests PASS.

---

### Task 18: Add drop target detection to tab bars

**Files:**
- Modify: `frontend/src/components/dockable/DockableTabBar.tsx`

**Step 1: Add `onMouseEnter`/`onMouseLeave` handlers to tab bar for drop target detection**

When a drag is active (from context), entering another tab bar updates `dragState.dropTarget` to that bar's `groupKey`. The tab bar renders the `.dockable-tab-bar--drop-target` class and a `.dockable-tab-bar__drop-indicator` element at the insertion position.

**Step 2: Run all tests**

Run: `cd frontend && npx vitest run 2>&1 | tail -15`
Expected: All tests PASS.

---

## Phase 6: Tests & Cleanup

### Task 19: Update existing DockablePanel behavior tests

**Files:**
- Modify: `frontend/src/components/dockable/DockablePanel.behavior.test.tsx`
- Modify: `frontend/src/components/dockable/DockablePanel.test.tsx`

**Step 1: Update dock-conflict tests**

Tests that assert dock-conflict behavior (panel A closes when panel B docks at same position) need to be updated. The new behavior: panel B joins panel A's tab group instead.

**Step 2: Add tab group integration tests**

Add tests verifying:
- Two panels at same position form a tab group
- Tab switching shows correct content
- Closing active tab activates adjacent
- Closing last tab removes group

**Step 3: Run all tests**

Run: `cd frontend && npx vitest run 2>&1 | tail -15`
Expected: All tests PASS.

---

### Task 20: Run full test suite and verify

**Step 1: Run all tests**

Run: `cd frontend && npx vitest run 2>&1 | tail -20`
Expected: All 200+ test files pass.

**Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit --pretty 2>&1 | tail -10`
Expected: No type errors.

**Step 3: Build the app**

Run: `cd frontend && npm run build 2>&1 | tail -10`
Expected: Build succeeds.

---

## Verification Checklist

After all tasks are complete, verify in the running app:

- [ ] Object Panel header shows "Object Panel" title + dock/maximize/close controls
- [ ] App Logs header shows "Application Logs" title + dock/maximize/close controls
- [ ] Opening Object Panel and Port Forwards (both right-docked) shows tabs in header
- [ ] Opening App Logs and Diagnostics (both bottom-docked) shows tabs in header
- [ ] Clicking tab labels switches active panel content
- [ ] Close button on tabs works (adjacent tab activates)
- [ ] Closing last tab removes the docked area
- [ ] Dock controls (right/bottom/float) move the entire tab group
- [ ] Maximize maximizes the entire tab group
- [ ] Panel-specific toolbar controls don't initiate drag
- [ ] Drag to reorder tabs within a group works
- [ ] Drag a tab out of the bar creates a new floating panel
- [ ] Drag a tab onto another group's tab bar moves it there
- [ ] Drop target highlight appears when dragging over another tab bar
- [ ] Multiple floating tab groups work independently
- [ ] All keyboard shortcuts still work for active panel
