/**
 * tabGroupState.ts
 *
 * Pure, immutable helper functions for managing tab group state.
 * Every function returns a new TabGroupState; none mutate the input.
 */

import type { TabGroupState, FloatingTabGroup, GroupKey } from './tabGroupTypes';

/**
 * Generate a deterministic floating group ID from the current state.
 * This stays pure so React StrictMode double-invocations cannot consume IDs.
 */
function nextFloatingGroupId(state: TabGroupState): string {
  const usedIds = new Set(state.floating.map((group) => group.groupId));
  let maxNumericSuffix = 0;

  for (const group of state.floating) {
    const match = /^floating-(\d+)$/.exec(group.groupId);
    if (!match) {
      continue;
    }
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed)) {
      maxNumericSuffix = Math.max(maxNumericSuffix, parsed);
    }
  }

  let candidate = maxNumericSuffix + 1;
  while (usedIds.has(`floating-${candidate}`)) {
    candidate += 1;
  }

  return `floating-${candidate}`;
}

// ---------------------------------------------------------------------------
// createInitialTabGroupState
// ---------------------------------------------------------------------------

/** Returns a fresh, empty TabGroupState. */
export function createInitialTabGroupState(): TabGroupState {
  return {
    right: { tabs: [], activeTab: null },
    bottom: { tabs: [], activeTab: null },
    floating: [],
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Remove a panel from all groups, returning the new state.
 * This is the internal version that does NOT do adjacent-tab activation;
 * it simply strips the panelId out and cleans up empty floating groups.
 */
function stripPanelFromAllGroups(state: TabGroupState, panelId: string): TabGroupState {
  const rightTabs = state.right.tabs.filter((id) => id !== panelId);
  const bottomTabs = state.bottom.tabs.filter((id) => id !== panelId);

  // For docked groups, if the active tab was removed, pick the last tab or null.
  const rightActive =
    state.right.activeTab === panelId
      ? (rightTabs[rightTabs.length - 1] ?? null)
      : rightTabs.includes(state.right.activeTab ?? '')
        ? state.right.activeTab
        : (rightTabs[rightTabs.length - 1] ?? null);

  const bottomActive =
    state.bottom.activeTab === panelId
      ? (bottomTabs[bottomTabs.length - 1] ?? null)
      : bottomTabs.includes(state.bottom.activeTab ?? '')
        ? state.bottom.activeTab
        : (bottomTabs[bottomTabs.length - 1] ?? null);

  // For floating groups, remove the panel and destroy empty groups.
  const floating: FloatingTabGroup[] = [];
  for (const group of state.floating) {
    const tabs = group.tabs.filter((id) => id !== panelId);
    if (tabs.length === 0) {
      // Destroy empty floating groups.
      continue;
    }
    const activeTab =
      group.activeTab === panelId
        ? (tabs[tabs.length - 1] ?? null)
        : tabs.includes(group.activeTab ?? '')
          ? group.activeTab
          : (tabs[tabs.length - 1] ?? null);
    floating.push({ ...group, tabs, activeTab });
  }

  return {
    right: { tabs: rightTabs, activeTab: rightActive },
    bottom: { tabs: bottomTabs, activeTab: bottomActive },
    floating,
  };
}

/**
 * Compute the next activeTab after removing a panel at the given index
 * from a tab list, preferring the right neighbor then left.
 */
function activateAdjacentTab(
  tabs: string[],
  removedIndex: number,
  currentActiveId: string | null,
  removedId: string
): string | null {
  if (tabs.length === 0) {
    return null;
  }
  // Only pick a new active if the removed panel was the active one.
  if (currentActiveId !== removedId) {
    return currentActiveId;
  }
  // Prefer right neighbor (same index since array shifted), then left.
  if (removedIndex < tabs.length) {
    return tabs[removedIndex];
  }
  return tabs[removedIndex - 1] ?? null;
}

// ---------------------------------------------------------------------------
// addPanelToGroup
// ---------------------------------------------------------------------------

/**
 * Add a panel to a dock position group.
 * - For 'right' / 'bottom': appends to the singleton group and activates it.
 * - For 'floating': creates a NEW floating group containing just this panel.
 * - Removes the panel from any existing group first to prevent duplicates.
 */
export function addPanelToGroup(
  state: TabGroupState,
  panelId: string,
  position: 'right' | 'bottom' | 'floating',
  insertIndex?: number
): TabGroupState {
  // Strip from any existing location first.
  const cleaned = stripPanelFromAllGroups(state, panelId);

  if (position === 'right') {
    const tabs = [...cleaned.right.tabs];
    if (insertIndex !== undefined) {
      tabs.splice(insertIndex, 0, panelId);
    } else {
      tabs.push(panelId);
    }
    return {
      ...cleaned,
      right: { tabs, activeTab: panelId },
    };
  }

  if (position === 'bottom') {
    const tabs = [...cleaned.bottom.tabs];
    if (insertIndex !== undefined) {
      tabs.splice(insertIndex, 0, panelId);
    } else {
      tabs.push(panelId);
    }
    return {
      ...cleaned,
      bottom: { tabs, activeTab: panelId },
    };
  }

  // floating: create a brand new floating group.
  const newGroup: FloatingTabGroup = {
    groupId: nextFloatingGroupId(cleaned),
    tabs: [panelId],
    activeTab: panelId,
  };
  return {
    ...cleaned,
    floating: [...cleaned.floating, newGroup],
  };
}

// ---------------------------------------------------------------------------
// removePanelFromGroup
// ---------------------------------------------------------------------------

/**
 * Remove a panel from whichever group it belongs to.
 * - Activates the adjacent tab (right first, then left) in the source group.
 * - Destroys empty floating groups.
 * - Returns state with empty tabs / null activeTab for empty docked groups.
 * - Returns state unchanged if panelId is not found.
 */
export function removePanelFromGroup(state: TabGroupState, panelId: string): TabGroupState {
  // Check if the panel exists anywhere.
  const groupKey = getGroupForPanel(state, panelId);
  if (groupKey === null) {
    return state;
  }

  if (groupKey === 'right' || groupKey === 'bottom') {
    const group = state[groupKey];
    const removedIndex = group.tabs.indexOf(panelId);
    const newTabs = group.tabs.filter((id) => id !== panelId);
    const newActive = activateAdjacentTab(newTabs, removedIndex, group.activeTab, panelId);
    return {
      ...state,
      [groupKey]: { tabs: newTabs, activeTab: newActive },
    };
  }

  // Floating group.
  const floating: FloatingTabGroup[] = [];
  for (const group of state.floating) {
    if (group.groupId !== groupKey) {
      floating.push(group);
      continue;
    }
    const removedIndex = group.tabs.indexOf(panelId);
    const newTabs = group.tabs.filter((id) => id !== panelId);
    if (newTabs.length === 0) {
      // Destroy empty floating group.
      continue;
    }
    const newActive = activateAdjacentTab(newTabs, removedIndex, group.activeTab, panelId);
    floating.push({ ...group, tabs: newTabs, activeTab: newActive });
  }

  return { ...state, floating };
}

// ---------------------------------------------------------------------------
// setActiveTab
// ---------------------------------------------------------------------------

/**
 * Set the active tab within a specific group.
 * @param groupKey - 'right', 'bottom', or a floating groupId.
 */
export function setActiveTab(
  state: TabGroupState,
  panelId: string,
  groupKey: GroupKey
): TabGroupState {
  if (groupKey === 'right' || groupKey === 'bottom') {
    return {
      ...state,
      [groupKey]: { ...state[groupKey], activeTab: panelId },
    };
  }

  // Floating group.
  return {
    ...state,
    floating: state.floating.map((group) =>
      group.groupId === groupKey ? { ...group, activeTab: panelId } : group
    ),
  };
}

// ---------------------------------------------------------------------------
// getGroupForPanel
// ---------------------------------------------------------------------------

/**
 * Find which group a panel belongs to.
 * @returns 'right', 'bottom', a floating groupId string, or null if not found.
 */
export function getGroupForPanel(state: TabGroupState, panelId: string): GroupKey | null {
  if (state.right.tabs.includes(panelId)) {
    return 'right';
  }
  if (state.bottom.tabs.includes(panelId)) {
    return 'bottom';
  }
  for (const group of state.floating) {
    if (group.tabs.includes(panelId)) {
      return group.groupId;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// reorderTab
// ---------------------------------------------------------------------------

/**
 * Move a tab to a new index within the same group.
 * @param groupKey - 'right', 'bottom', or a floating groupId.
 * @param panelId  - The panel to reorder.
 * @param newIndex - Target index in the tab list.
 */
export function reorderTab(
  state: TabGroupState,
  groupKey: GroupKey,
  panelId: string,
  newIndex: number
): TabGroupState {
  const reorder = (tabs: string[]): string[] => {
    const currentIndex = tabs.indexOf(panelId);
    if (currentIndex === -1) {
      return tabs;
    }
    const newTabs = [...tabs];
    newTabs.splice(currentIndex, 1);
    newTabs.splice(newIndex, 0, panelId);
    return newTabs;
  };

  if (groupKey === 'right' || groupKey === 'bottom') {
    return {
      ...state,
      [groupKey]: { ...state[groupKey], tabs: reorder(state[groupKey].tabs) },
    };
  }

  // Floating group.
  return {
    ...state,
    floating: state.floating.map((group) =>
      group.groupId === groupKey ? { ...group, tabs: reorder(group.tabs) } : group
    ),
  };
}

// ---------------------------------------------------------------------------
// movePanelToGroup
// ---------------------------------------------------------------------------

/**
 * Move a panel from its current group to a target group.
 * Target can be 'right', 'bottom', 'floating' (new group), or a specific
 * floating groupId (appends to that existing group).
 */
export function movePanelToGroup(
  state: TabGroupState,
  panelId: string,
  target: GroupKey | 'floating',
  insertIndex?: number
): TabGroupState {
  // Remove from source with proper adjacent-tab activation.
  const removed = removePanelFromGroup(state, panelId);

  if (target === 'right' || target === 'bottom' || target === 'floating') {
    return addPanelToGroup(removed, panelId, target, insertIndex);
  }

  // Target is a specific floating groupId.
  return addPanelToFloatingGroup(removed, panelId, target, insertIndex);
}

// ---------------------------------------------------------------------------
// addPanelToFloatingGroup
// ---------------------------------------------------------------------------

/**
 * Add a panel to a specific existing floating group, optionally at a given index.
 * Removes the panel from any existing group first to prevent duplicates.
 */
export function addPanelToFloatingGroup(
  state: TabGroupState,
  panelId: string,
  groupId: string,
  insertIndex?: number
): TabGroupState {
  // Strip from any existing location first.
  const cleaned = stripPanelFromAllGroups(state, panelId);

  let foundTargetGroup = false;

  const nextState = {
    ...cleaned,
    floating: cleaned.floating.map((group) => {
      if (group.groupId !== groupId) {
        return group;
      }
      foundTargetGroup = true;
      const newTabs = [...group.tabs];
      if (insertIndex !== undefined) {
        newTabs.splice(insertIndex, 0, panelId);
      } else {
        newTabs.push(panelId);
      }
      return { ...group, tabs: newTabs, activeTab: panelId };
    }),
  };

  // If the target floating group no longer exists (race during drag/drop),
  // fall back to creating a new floating group instead of dropping the tab.
  if (!foundTargetGroup) {
    return addPanelToGroup(cleaned, panelId, 'floating');
  }

  return nextState;
}

// ---------------------------------------------------------------------------
// getGroupTabs
// ---------------------------------------------------------------------------

/**
 * Return {tabs, activeTab} for a given group key, or null if unknown.
 */
export function getGroupTabs(
  state: TabGroupState,
  groupKey: GroupKey
): { tabs: string[]; activeTab: string | null } | null {
  if (groupKey === 'right') {
    return { tabs: state.right.tabs, activeTab: state.right.activeTab };
  }
  if (groupKey === 'bottom') {
    return { tabs: state.bottom.tabs, activeTab: state.bottom.activeTab };
  }
  const group = state.floating.find((g) => g.groupId === groupKey);
  if (group) {
    return { tabs: group.tabs, activeTab: group.activeTab };
  }
  return null;
}
