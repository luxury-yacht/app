/**
 * frontend/src/ui/dockable/panelLayoutStore.test.ts
 *
 * Tests for the panel layout store, including the tabGroups slice that
 * holds dock-group memberships per store instance (which becomes per
 * cluster once the provider wires up cluster-keyed stores).
 */
import { describe, expect, it, vi } from 'vitest';
import { createPanelLayoutStore } from './panelLayoutStore';
import { addPanelToGroup, createInitialTabGroupState } from './tabGroupState';

describe('createPanelLayoutStore — tabGroups slice', () => {
  it('starts with an empty tabGroups state', () => {
    const store = createPanelLayoutStore();
    expect(store.getTabGroups()).toEqual(createInitialTabGroupState());
  });

  it('setTabGroups applies the updater and updates getTabGroups', () => {
    const store = createPanelLayoutStore();
    store.setTabGroups((prev) => addPanelToGroup(prev, 'panel-a', 'right'));
    // Compare against the full expected state (including the activeTab
    // field set by addPanelToGroup) so the round-trip test verifies the
    // entire returned value was stored, not just the tabs array.
    expect(store.getTabGroups()).toEqual(
      addPanelToGroup(createInitialTabGroupState(), 'panel-a', 'right')
    );
  });

  it('subscribeTabGroups notifies listeners on change', () => {
    const store = createPanelLayoutStore();
    const listener = vi.fn();
    store.subscribeTabGroups(listener);
    store.setTabGroups((prev) => addPanelToGroup(prev, 'panel-a', 'right'));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('subscribeTabGroups returns an unsubscribe function', () => {
    const store = createPanelLayoutStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribeTabGroups(listener);
    unsubscribe();
    store.setTabGroups((prev) => addPanelToGroup(prev, 'panel-a', 'right'));
    expect(listener).not.toHaveBeenCalled();
  });

  it('setTabGroups bails out when the updater returns the same reference', () => {
    const store = createPanelLayoutStore();
    const listener = vi.fn();
    store.subscribeTabGroups(listener);
    store.setTabGroups((prev) => prev); // identity returns same reference
    expect(listener).not.toHaveBeenCalled();
  });

  it('tabGroups slice is independent of per-panel state subscriptions', () => {
    const store = createPanelLayoutStore();
    const tabGroupsListener = vi.fn();
    const panelListener = vi.fn();
    store.subscribeTabGroups(tabGroupsListener);
    store.subscribe('panel-a', panelListener);
    // Mutating tabGroups should NOT notify per-panel listeners.
    store.setTabGroups((prev) => addPanelToGroup(prev, 'panel-a', 'right'));
    expect(tabGroupsListener).toHaveBeenCalledTimes(1);
    expect(panelListener).not.toHaveBeenCalled();
    // Mutating per-panel state should NOT notify tabGroups listeners.
    tabGroupsListener.mockClear();
    store.updateState('panel-a', { isOpen: true });
    expect(panelListener).toHaveBeenCalled();
    expect(tabGroupsListener).not.toHaveBeenCalled();
  });

  it('each store instance owns an independent tabGroups slice', () => {
    const storeA = createPanelLayoutStore();
    const storeB = createPanelLayoutStore();
    storeA.setTabGroups((prev) => addPanelToGroup(prev, 'panel-a', 'right'));
    expect(storeA.getTabGroups().right.tabs).toEqual(['panel-a']);
    expect(storeB.getTabGroups().right.tabs).toEqual([]);
  });

  it('clearPanelState removes the panel from tab groups', () => {
    const store = createPanelLayoutStore();

    store.setTabGroups((prev) => addPanelToGroup(prev, 'panel-a', 'right'));
    expect(store.getTabGroups().right.tabs).toEqual(['panel-a']);

    store.clearPanelState('panel-a');

    expect(store.getTabGroups().right.tabs).toEqual([]);
    expect(store.getTabGroups().right.activeTab).toBeNull();
  });

  it('clearPanelState notifies tab group subscribers when it removes grouped panels', () => {
    const store = createPanelLayoutStore();
    const listener = vi.fn();

    store.setTabGroups((prev) => addPanelToGroup(prev, 'panel-a', 'right'));
    store.subscribeTabGroups(listener);

    store.clearPanelState('panel-a');

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('retains group geometry and maximize when any sibling closes', () => {
    const store = createPanelLayoutStore();
    store.setTabGroups((prev) =>
      addPanelToGroup(addPanelToGroup(prev, 'a', 'right'), 'b', 'right')
    );
    store.updateGroupLayout('right', { rightSize: { width: 640, height: 300 }, isMaximized: true });
    store.clearPanelState('a');
    expect(store.getTabGroups().right.tabs).toEqual(['b']);
    expect(store.getGroupLayout('right')).toMatchObject({
      rightSize: { width: 640 },
      isMaximized: true,
    });
  });
  it('retains dock size but releases maximize when the last tab closes', () => {
    const store = createPanelLayoutStore();
    store.setTabGroups((prev) => addPanelToGroup(prev, 'a', 'right'));
    store.updateGroupLayout('right', { rightSize: { width: 640, height: 300 }, isMaximized: true });
    store.clearPanelState('a');
    expect(store.getGroupLayout('right')).toMatchObject({
      rightSize: { width: 640 },
      isMaximized: false,
    });
    store.setTabGroups((prev) => addPanelToGroup(prev, 'b', 'right'));
    expect(store.getGroupLayout('right').rightSize.width).toBe(640);
  });
});
