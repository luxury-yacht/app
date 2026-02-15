/**
 * tabGroupState.test.ts
 *
 * Tests for the tab group state helper functions.
 * All helpers are pure functions operating on immutable TabGroupState.
 */

import { describe, expect, it, beforeEach } from 'vitest';

import type { TabGroupState } from './tabGroupTypes';
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
  resetGroupIdCounter,
} from './tabGroupState';

/** Reset the floating group ID counter before each test for deterministic IDs. */
beforeEach(() => {
  resetGroupIdCounter();
});

// ---------------------------------------------------------------------------
// createInitialTabGroupState
// ---------------------------------------------------------------------------
describe('createInitialTabGroupState', () => {
  it('returns empty state with no tabs', () => {
    const state = createInitialTabGroupState();
    expect(state).toEqual({
      right: { tabs: [], activeTab: null },
      bottom: { tabs: [], activeTab: null },
      floating: [],
    });
  });

  it('returns a new object each time', () => {
    const a = createInitialTabGroupState();
    const b = createInitialTabGroupState();
    expect(a).not.toBe(b);
    expect(a.right).not.toBe(b.right);
    expect(a.bottom).not.toBe(b.bottom);
    expect(a.floating).not.toBe(b.floating);
  });
});

// ---------------------------------------------------------------------------
// addPanelToGroup
// ---------------------------------------------------------------------------
describe('addPanelToGroup', () => {
  let state: TabGroupState;

  beforeEach(() => {
    state = createInitialTabGroupState();
  });

  // -- right / bottom -------------------------------------------------------
  it('adds a panel to the right group and activates it', () => {
    const next = addPanelToGroup(state, 'panel-a', 'right');
    expect(next.right.tabs).toEqual(['panel-a']);
    expect(next.right.activeTab).toBe('panel-a');
  });

  it('adds a panel to the bottom group and activates it', () => {
    const next = addPanelToGroup(state, 'panel-b', 'bottom');
    expect(next.bottom.tabs).toEqual(['panel-b']);
    expect(next.bottom.activeTab).toBe('panel-b');
  });

  it('appends to existing tabs in a docked group', () => {
    let next = addPanelToGroup(state, 'a', 'right');
    next = addPanelToGroup(next, 'b', 'right');
    expect(next.right.tabs).toEqual(['a', 'b']);
    expect(next.right.activeTab).toBe('b');
  });

  it('does not duplicate a panel already in the group', () => {
    let next = addPanelToGroup(state, 'a', 'right');
    next = addPanelToGroup(next, 'b', 'right');
    next = addPanelToGroup(next, 'a', 'right');
    // 'a' should be moved to end (re-added), not duplicated
    expect(next.right.tabs).toEqual(['b', 'a']);
    expect(next.right.activeTab).toBe('a');
  });

  it('removes panel from existing group when adding to a different group', () => {
    let next = addPanelToGroup(state, 'a', 'right');
    next = addPanelToGroup(next, 'a', 'bottom');
    expect(next.right.tabs).toEqual([]);
    expect(next.bottom.tabs).toEqual(['a']);
    expect(next.bottom.activeTab).toBe('a');
  });

  // -- floating -------------------------------------------------------------
  it('creates a new floating group each time a panel is added as floating', () => {
    let next = addPanelToGroup(state, 'f1', 'floating');
    next = addPanelToGroup(next, 'f2', 'floating');
    expect(next.floating).toHaveLength(2);
    expect(next.floating[0].tabs).toEqual(['f1']);
    expect(next.floating[1].tabs).toEqual(['f2']);
  });

  it('assigns deterministic IDs to floating groups after counter reset', () => {
    let next = addPanelToGroup(state, 'f1', 'floating');
    next = addPanelToGroup(next, 'f2', 'floating');
    expect(next.floating[0].groupId).toBe('floating-1');
    expect(next.floating[1].groupId).toBe('floating-2');
  });

  it('removes panel from previous group when adding as floating', () => {
    let next = addPanelToGroup(state, 'a', 'right');
    next = addPanelToGroup(next, 'a', 'floating');
    expect(next.right.tabs).toEqual([]);
    expect(next.floating).toHaveLength(1);
    expect(next.floating[0].tabs).toEqual(['a']);
  });

  // -- immutability ---------------------------------------------------------
  it('does not mutate the original state', () => {
    const original = createInitialTabGroupState();
    const frozen = JSON.parse(JSON.stringify(original));
    addPanelToGroup(original, 'x', 'right');
    expect(original).toEqual(frozen);
  });
});

// ---------------------------------------------------------------------------
// removePanelFromGroup
// ---------------------------------------------------------------------------
describe('removePanelFromGroup', () => {
  it('removes a panel from the right group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    const next = removePanelFromGroup(state, 'a');
    expect(next.right.tabs).toEqual([]);
    expect(next.right.activeTab).toBeNull();
  });

  it('activates the right-adjacent tab after removal', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    state = addPanelToGroup(state, 'b', 'right');
    state = addPanelToGroup(state, 'c', 'right');
    // Set active to 'b' (middle tab), then remove it
    state = setActiveTab(state, 'b', 'right');
    const next = removePanelFromGroup(state, 'b');
    // 'c' was to the right of 'b', so it should become active
    expect(next.right.tabs).toEqual(['a', 'c']);
    expect(next.right.activeTab).toBe('c');
  });

  it('activates the left-adjacent tab when no right neighbor', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    state = addPanelToGroup(state, 'b', 'right');
    state = addPanelToGroup(state, 'c', 'right');
    // Set active to 'c' (last tab), then remove it
    state = setActiveTab(state, 'c', 'right');
    const next = removePanelFromGroup(state, 'c');
    expect(next.right.tabs).toEqual(['a', 'b']);
    expect(next.right.activeTab).toBe('b');
  });

  it('clears activeTab when the last tab is removed from a docked group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'bottom');
    const next = removePanelFromGroup(state, 'a');
    expect(next.bottom.tabs).toEqual([]);
    expect(next.bottom.activeTab).toBeNull();
  });

  it('destroys empty floating groups', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'f1', 'floating');
    expect(state.floating).toHaveLength(1);
    const next = removePanelFromGroup(state, 'f1');
    expect(next.floating).toHaveLength(0);
  });

  it('removes the correct panel from a floating group with multiple tabs', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'f1', 'floating');
    state = addPanelToFloatingGroup(state, 'f2', state.floating[0].groupId);
    expect(state.floating[0].tabs).toEqual(['f1', 'f2']);

    const next = removePanelFromGroup(state, 'f1');
    expect(next.floating).toHaveLength(1);
    expect(next.floating[0].tabs).toEqual(['f2']);
    expect(next.floating[0].activeTab).toBe('f2');
  });

  it('returns state unchanged when panel is not found', () => {
    const state = createInitialTabGroupState();
    const next = removePanelFromGroup(state, 'nonexistent');
    expect(next).toEqual(state);
  });

  it('does not mutate the original state', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    const frozen = JSON.parse(JSON.stringify(state));
    removePanelFromGroup(state, 'a');
    expect(state).toEqual(frozen);
  });
});

// ---------------------------------------------------------------------------
// setActiveTab
// ---------------------------------------------------------------------------
describe('setActiveTab', () => {
  it('sets the active tab in the right group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    state = addPanelToGroup(state, 'b', 'right');
    const next = setActiveTab(state, 'a', 'right');
    expect(next.right.activeTab).toBe('a');
  });

  it('sets the active tab in the bottom group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'x', 'bottom');
    state = addPanelToGroup(state, 'y', 'bottom');
    const next = setActiveTab(state, 'x', 'bottom');
    expect(next.bottom.activeTab).toBe('x');
  });

  it('sets the active tab in a floating group by groupId', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'f1', 'floating');
    state = addPanelToFloatingGroup(state, 'f2', state.floating[0].groupId);
    const groupId = state.floating[0].groupId;
    const next = setActiveTab(state, 'f1', groupId);
    expect(next.floating[0].activeTab).toBe('f1');
  });

  it('does not mutate the original state', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    state = addPanelToGroup(state, 'b', 'right');
    const frozen = JSON.parse(JSON.stringify(state));
    setActiveTab(state, 'a', 'right');
    expect(state).toEqual(frozen);
  });
});

// ---------------------------------------------------------------------------
// getGroupForPanel
// ---------------------------------------------------------------------------
describe('getGroupForPanel', () => {
  it('returns "right" for a panel in the right group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    expect(getGroupForPanel(state, 'a')).toBe('right');
  });

  it('returns "bottom" for a panel in the bottom group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'bottom');
    expect(getGroupForPanel(state, 'a')).toBe('bottom');
  });

  it('returns the floating groupId for a panel in a floating group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'floating');
    expect(getGroupForPanel(state, 'a')).toBe('floating-1');
  });

  it('returns null when the panel is not in any group', () => {
    const state = createInitialTabGroupState();
    expect(getGroupForPanel(state, 'nonexistent')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// reorderTab
// ---------------------------------------------------------------------------
describe('reorderTab', () => {
  it('moves a tab to a new index within the right group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    state = addPanelToGroup(state, 'b', 'right');
    state = addPanelToGroup(state, 'c', 'right');
    const next = reorderTab(state, 'right', 'a', 2);
    expect(next.right.tabs).toEqual(['b', 'c', 'a']);
  });

  it('moves a tab to the beginning', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    state = addPanelToGroup(state, 'b', 'right');
    state = addPanelToGroup(state, 'c', 'right');
    const next = reorderTab(state, 'right', 'c', 0);
    expect(next.right.tabs).toEqual(['c', 'a', 'b']);
  });

  it('reorders tabs in a floating group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'f1', 'floating');
    const groupId = state.floating[0].groupId;
    state = addPanelToFloatingGroup(state, 'f2', groupId);
    state = addPanelToFloatingGroup(state, 'f3', groupId);
    const next = reorderTab(state, groupId, 'f3', 0);
    expect(next.floating[0].tabs).toEqual(['f3', 'f1', 'f2']);
  });

  it('does not mutate the original state', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    state = addPanelToGroup(state, 'b', 'right');
    const frozen = JSON.parse(JSON.stringify(state));
    reorderTab(state, 'right', 'a', 1);
    expect(state).toEqual(frozen);
  });
});

// ---------------------------------------------------------------------------
// movePanelToGroup
// ---------------------------------------------------------------------------
describe('movePanelToGroup', () => {
  it('moves a panel from right to bottom', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    const next = movePanelToGroup(state, 'a', 'bottom');
    expect(next.right.tabs).toEqual([]);
    expect(next.bottom.tabs).toEqual(['a']);
    expect(next.bottom.activeTab).toBe('a');
  });

  it('moves a panel from bottom to right', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'bottom');
    const next = movePanelToGroup(state, 'a', 'right');
    expect(next.bottom.tabs).toEqual([]);
    expect(next.right.tabs).toEqual(['a']);
  });

  it('moves a panel from right to a new floating group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    const next = movePanelToGroup(state, 'a', 'floating');
    expect(next.right.tabs).toEqual([]);
    expect(next.floating).toHaveLength(1);
    expect(next.floating[0].tabs).toEqual(['a']);
  });

  it('moves a panel into a specific existing floating group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'f1', 'floating');
    const groupId = state.floating[0].groupId;
    state = addPanelToGroup(state, 'a', 'right');
    const next = movePanelToGroup(state, 'a', groupId);
    expect(next.right.tabs).toEqual([]);
    expect(next.floating).toHaveLength(1);
    expect(next.floating[0].tabs).toContain('a');
    expect(next.floating[0].tabs).toContain('f1');
  });

  it('activates adjacent tab in the source group after moving', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    state = addPanelToGroup(state, 'b', 'right');
    state = addPanelToGroup(state, 'c', 'right');
    state = setActiveTab(state, 'b', 'right');
    const next = movePanelToGroup(state, 'b', 'bottom');
    expect(next.right.tabs).toEqual(['a', 'c']);
    expect(next.right.activeTab).toBe('c');
  });

  it('does not mutate the original state', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    const frozen = JSON.parse(JSON.stringify(state));
    movePanelToGroup(state, 'a', 'bottom');
    expect(state).toEqual(frozen);
  });
});

// ---------------------------------------------------------------------------
// addPanelToFloatingGroup
// ---------------------------------------------------------------------------
describe('addPanelToFloatingGroup', () => {
  it('adds a panel to an existing floating group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'f1', 'floating');
    const groupId = state.floating[0].groupId;
    const next = addPanelToFloatingGroup(state, 'f2', groupId);
    expect(next.floating[0].tabs).toEqual(['f1', 'f2']);
    expect(next.floating[0].activeTab).toBe('f2');
  });

  it('inserts at a specific index', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'f1', 'floating');
    const groupId = state.floating[0].groupId;
    state = addPanelToFloatingGroup(state, 'f2', groupId);
    const next = addPanelToFloatingGroup(state, 'f3', groupId, 0);
    expect(next.floating[0].tabs).toEqual(['f3', 'f1', 'f2']);
    expect(next.floating[0].activeTab).toBe('f3');
  });

  it('removes the panel from its previous group first', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    state = addPanelToGroup(state, 'f1', 'floating');
    const groupId = state.floating[0].groupId;
    const next = addPanelToFloatingGroup(state, 'a', groupId);
    expect(next.right.tabs).toEqual([]);
    expect(next.floating[0].tabs).toContain('a');
  });

  it('does not mutate the original state', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'f1', 'floating');
    const groupId = state.floating[0].groupId;
    const frozen = JSON.parse(JSON.stringify(state));
    addPanelToFloatingGroup(state, 'f2', groupId);
    expect(state).toEqual(frozen);
  });
});

// ---------------------------------------------------------------------------
// getGroupTabs
// ---------------------------------------------------------------------------
describe('getGroupTabs', () => {
  it('returns tabs and activeTab for the right group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'a', 'right');
    state = addPanelToGroup(state, 'b', 'right');
    const result = getGroupTabs(state, 'right');
    expect(result).toEqual({ tabs: ['a', 'b'], activeTab: 'b' });
  });

  it('returns tabs and activeTab for the bottom group', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'x', 'bottom');
    const result = getGroupTabs(state, 'bottom');
    expect(result).toEqual({ tabs: ['x'], activeTab: 'x' });
  });

  it('returns tabs and activeTab for a floating group by groupId', () => {
    let state = createInitialTabGroupState();
    state = addPanelToGroup(state, 'f1', 'floating');
    const groupId = state.floating[0].groupId;
    state = addPanelToFloatingGroup(state, 'f2', groupId);
    const result = getGroupTabs(state, groupId);
    expect(result).toEqual({ tabs: ['f1', 'f2'], activeTab: 'f2' });
  });

  it('returns empty tabs and null activeTab for an empty docked group', () => {
    const state = createInitialTabGroupState();
    const result = getGroupTabs(state, 'right');
    expect(result).toEqual({ tabs: [], activeTab: null });
  });

  it('returns null for an unknown group key', () => {
    const state = createInitialTabGroupState();
    const result = getGroupTabs(state, 'nonexistent-group');
    expect(result).toBeNull();
  });
});
