/**
 * DockablePanelProvider.tsx
 *
 * Context provider for managing dockable panels.
 * Tracks tab groups (right, bottom, floating), panel registrations,
 * and provides actions for switching, closing, reordering, and moving tabs.
 * Manages the host DOM node for rendering floating panels.
 */

import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useLayoutEffect,
  useRef,
  useMemo,
} from 'react';
import type { TabGroupState, GroupKey, PanelRegistration } from './tabGroupTypes';
import type { DockPosition } from './useDockablePanelState';
import {
  focusPanelById,
  setPanelFloatingPositionById,
  setPanelOpenById,
  setPanelPositionById,
} from './useDockablePanelState';
import {
  createPanelLayoutStore,
  getActivePanelLayoutStore,
  setActivePanelLayoutStore,
} from './panelLayoutStore';
import { getContentBounds } from './dockablePanelLayout';
import { PanelLayoutStoreContext } from './panelLayoutStoreContext';
import {
  createInitialTabGroupState,
  addPanelToGroup,
  removePanelFromGroup,
  setActiveTab,
  reorderTab,
  movePanelToGroup,
  addPanelToFloatingGroup,
  getGroupForPanel,
  getGroupTabs,
} from './tabGroupState';

interface DockablePanelContextValue {
  // Tab group state
  tabGroups: TabGroupState;

  // Panel registrations (metadata like title, callbacks)
  panelRegistrations: Map<string, PanelRegistration>;

  // Register/unregister panels -- called by DockablePanel components
  registerPanel: (registration: PanelRegistration) => void;
  unregisterPanel: (panelId: string) => void;
  // Keep tab-group membership aligned with an open panel's current dock position.
  syncPanelGroup: (
    panelId: string,
    position: DockPosition,
    preferredGroupKey?: GroupKey | 'floating'
  ) => void;
  // Remove tab-group membership for closed/unmounted panels.
  removePanelFromGroups: (panelId: string) => void;

  // Tab actions
  switchTab: (groupKey: GroupKey, panelId: string) => void;
  closeTab: (panelId: string) => void;
  reorderTabInGroup: (groupKey: GroupKey, panelId: string, newIndex: number) => void;
  movePanelBetweenGroups: (
    panelId: string,
    targetGroupKey: GroupKey | 'floating',
    insertIndex?: number
  ) => void;
  // Move a panel and bring the target container/frontmost panel into focus.
  movePanelBetweenGroupsAndFocus: (
    panelId: string,
    targetGroupKey: GroupKey | 'floating',
    insertIndex?: number,
    focusTargetPanelId?: string
  ) => void;

  // Drag preview ref: the permanently-mounted `.dockable-tab-drag-preview`
  // element. DockableTabBar's per-tab `getDragImage` callback writes the
  // dragged tab's label + kind class into the element's inner spans
  // synchronously before returning it to `setDragImage`, which lets the
  // browser take a native screenshot of the updated element at dragstart.
  dragPreviewRef: React.MutableRefObject<HTMLDivElement | null>;
  // Adapter for drag-drop reorders/moves from DockableTabBar. Dispatches
  // to `reorderTabInGroup` (same group) or `movePanelBetweenGroups`
  // (cross group) depending on whether source and target match.
  movePanel: (
    panelId: string,
    sourceGroupId: string,
    targetGroupId: string,
    insertIndex: number
  ) => void;
  // Adapter for the container-level empty-space drop target. Moves a
  // panel into a brand-new floating group at the cursor position.
  createFloatingGroupWithPanel: (
    panelId: string,
    sourceGroupId: string,
    cursorPos: { x: number; y: number }
  ) => void;

  // Content registry -- allows the group leader to render other panels' body content.
  panelContentRefsMap: React.MutableRefObject<Map<string, React.MutableRefObject<React.ReactNode>>>;
  notifyContentChange: (groupKey: GroupKey) => void;
  subscribeContentChange: (groupKey: GroupKey, fn: () => void) => () => void;
  // Runtime refs currently shared across panels in this provider.
  groupLeaderByKeyRef: React.MutableRefObject<Map<string, string>>;
  updateGridTableHoverSuppression: (shouldSuppress: boolean) => void;

  // Last-focused group -- tracks which panel group was most recently interacted with,
  // so new panels (e.g. object tabs) can open in the same group.
  lastFocusedGroupKey: GroupKey | null;
  setLastFocusedGroupKey: (key: GroupKey) => void;
  // Resolve the concrete group key new panels should target.
  getPreferredOpenGroupKey: (fallbackPosition?: DockPosition) => GroupKey | 'floating';
  getLastFocusedPosition: () => DockPosition;

  // Focus a panel by ID -- activates its tab and brings the panel to front.
  focusPanel: (panelId: string) => void;
}

const DockablePanelContext = createContext<DockablePanelContextValue | null>(null);
const DockablePanelHostContext = createContext<HTMLElement | null | undefined>(undefined);

export const useDockablePanelContext = () => {
  const context = useContext(DockablePanelContext);
  if (!context) {
    throw new Error('useDockablePanelContext must be used within DockablePanelProvider');
  }
  return context;
};

/** Resolve the `.content` element that panels are mounted inside. */
function getContentContainer(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  const el = document.querySelector('.content');
  return el instanceof HTMLElement ? el : null;
}

export const useDockablePanelHost = (): HTMLElement | null => {
  const contextHost = useContext(DockablePanelHostContext);
  if (contextHost === undefined) {
    throw new Error('useDockablePanelHost must be used within DockablePanelProvider');
  }
  return contextHost;
};

interface DockablePanelProviderProps {
  children: React.ReactNode;
}

export const DockablePanelProvider: React.FC<DockablePanelProviderProps> = ({ children }) => {
  // Provider-scoped panel layout store (Phase 3 migration).
  const panelLayoutStoreRef = useRef(createPanelLayoutStore());
  const previousActiveStoreRef = useRef(getActivePanelLayoutStore());

  // Bridge imperative helper call sites to this provider's store after commit.
  useLayoutEffect(() => {
    previousActiveStoreRef.current = getActivePanelLayoutStore();
    setActivePanelLayoutStore(panelLayoutStoreRef.current);
    return () => {
      setActivePanelLayoutStore(previousActiveStoreRef.current);
    };
  }, []);

  // Tab group state -- the primary model for which panels live where.
  const [tabGroups, setTabGroups] = useState<TabGroupState>(() => createInitialTabGroupState());
  // Keep latest tabGroups available to stable callbacks without recreating them.
  const tabGroupsRef = useRef<TabGroupState>(tabGroups);
  tabGroupsRef.current = tabGroups;

  // Panel registrations are stored in a ref for callback access and mirrored
  // into snapshot state to notify context consumers when metadata changes.
  const panelRegistrationsRef = useRef<Map<string, PanelRegistration>>(new Map());
  const [panelRegistrationsSnapshot, setPanelRegistrationsSnapshot] = useState<
    Map<string, PanelRegistration>
  >(() => new Map());

  // Ref to the permanently-mounted `.dockable-tab-drag-preview` element.
  // The element stays in the DOM at all times; DockableTabBar's per-tab
  // `getDragImage` callback mutates its inner spans synchronously at
  // dragstart, and the browser screenshots the element once via
  // `setDragImage`. No live cursor tracking — the browser handles that
  // natively once the snapshot is taken.
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);

  // Last-focused group -- tracks which panel group the user most recently interacted with.
  // Keep both state (for rendering) and a ref (for same-tick reads in callbacks).
  const [lastFocusedGroupKey, setLastFocusedGroupKeyState] = useState<GroupKey | null>(null);
  const lastFocusedGroupKeyRef = useRef<GroupKey | null>(null);
  // When a tab is moved to a *new* floating group, the final group key
  // is only known after tabGroups updates. Track the moved panel id so we
  // can resolve and store the focused floating group in an effect.
  const pendingFocusPanelIdRef = useRef<string | null>(null);
  const setLastFocusedGroupKey = useCallback((key: GroupKey) => {
    lastFocusedGroupKeyRef.current = key;
    setLastFocusedGroupKeyState(key);
  }, []);

  // Resolve the best target group key for opening a new panel.
  const getPreferredOpenGroupKey = useCallback(
    (fallbackPosition: DockPosition = 'right'): GroupKey | 'floating' => {
      // If we have a valid last-focused group with tabs, use it.
      const focusedGroupKey = lastFocusedGroupKeyRef.current;
      if (focusedGroupKey) {
        const group = getGroupTabs(tabGroups, focusedGroupKey);
        if (group && group.tabs.length > 0) {
          return focusedGroupKey;
        }
      }
      // No valid focused group -- use the requested fallback.
      return fallbackPosition;
    },
    [tabGroups]
  );

  /** Map the currently focused group to a DockPosition for new panels.
   *  New object panels should follow focus. If no valid focused group exists,
   *  default to right-docked placement. */
  const getLastFocusedPosition = useCallback((): DockPosition => {
    // Helper: map a group key to a DockPosition.
    const keyToPosition = (key: GroupKey | 'floating'): DockPosition => {
      if (key === 'right') return 'right';
      if (key === 'bottom') return 'bottom';
      return 'floating';
    };

    const focusedGroupKey = lastFocusedGroupKeyRef.current;
    if (focusedGroupKey) {
      const group = getGroupTabs(tabGroups, focusedGroupKey);
      if (group && group.tabs.length > 0) {
        return keyToPosition(focusedGroupKey);
      }
    }

    // No valid focused group — default to configured open fallback.
    return keyToPosition(getPreferredOpenGroupKey('right'));
  }, [tabGroups, getPreferredOpenGroupKey]);

  // Focus a panel by ID: activate its tab in the group and bring it to front.
  const focusPanel = useCallback(
    (panelId: string) => {
      const focusedGroupKey = getGroupForPanel(tabGroupsRef.current, panelId);
      if (focusedGroupKey) {
        setLastFocusedGroupKey(focusedGroupKey);
      }
      setTabGroups((prev) => {
        const groupKey = getGroupForPanel(prev, panelId);
        if (!groupKey) return prev;
        return setActiveTab(prev, panelId, groupKey);
      });
      focusPanelById(panelId);
    },
    [setLastFocusedGroupKey]
  );

  useLayoutEffect(() => {
    const pendingPanelId = pendingFocusPanelIdRef.current;
    if (!pendingPanelId) {
      return;
    }
    const resolvedGroupKey = getGroupForPanel(tabGroups, pendingPanelId);
    if (!resolvedGroupKey) {
      return;
    }
    pendingFocusPanelIdRef.current = null;
    setLastFocusedGroupKey(resolvedGroupKey);
  }, [tabGroups, setLastFocusedGroupKey]);

  // -----------------------------------------------------------------------
  // registerPanel stores panel metadata only.
  // Group membership is handled by explicit tab-group actions.
  // -----------------------------------------------------------------------
  const registerPanel = useCallback((registration: PanelRegistration) => {
    // Store the registration metadata.
    panelRegistrationsRef.current.set(registration.panelId, registration);
    setPanelRegistrationsSnapshot(new Map(panelRegistrationsRef.current));
  }, []);

  // -----------------------------------------------------------------------
  // unregisterPanel removes panel metadata only.
  // -----------------------------------------------------------------------
  const unregisterPanel = useCallback((panelId: string) => {
    panelRegistrationsRef.current.delete(panelId);
    setPanelRegistrationsSnapshot(new Map(panelRegistrationsRef.current));
  }, []);

  // -----------------------------------------------------------------------
  // syncPanelGroup -- align one panel with its declared dock position.
  // -----------------------------------------------------------------------
  const syncPanelGroup = useCallback(
    (panelId: string, position: DockPosition, preferredGroupKey?: GroupKey | 'floating') => {
      setTabGroups((prev) => {
        const currentGroup = getGroupForPanel(prev, panelId);
        const isCurrentFloating =
          currentGroup !== null && currentGroup !== 'right' && currentGroup !== 'bottom';
        // `preferredGroupKey` is only an initial placement hint.
        // Once grouped, follow the panel position + focus routing rules.
        const effectivePreferredGroupKey = currentGroup === null ? preferredGroupKey : undefined;
        let targetGroupKey: GroupKey | 'floating' = effectivePreferredGroupKey ?? position;
        if (!effectivePreferredGroupKey && position === 'floating') {
          if (isCurrentFloating) {
            // Keep already-floating panels in their current floating group.
            // This prevents unrelated tab-group updates from collapsing
            // independent floating windows into the currently focused one.
            targetGroupKey = currentGroup;
          } else {
            const focusedGroupKey = lastFocusedGroupKeyRef.current;
            if (focusedGroupKey && focusedGroupKey !== 'right' && focusedGroupKey !== 'bottom') {
              const focusedFloatingGroup = getGroupTabs(prev, focusedGroupKey);
              if (focusedFloatingGroup && focusedFloatingGroup.tabs.length > 0) {
                targetGroupKey = focusedGroupKey;
              }
            }
          }
        }
        const alreadyInDesiredGroup =
          targetGroupKey === 'floating'
            ? isCurrentFloating
            : currentGroup !== null && currentGroup === targetGroupKey;

        if (alreadyInDesiredGroup) {
          return prev;
        }

        if (targetGroupKey === 'right' || targetGroupKey === 'bottom') {
          return addPanelToGroup(prev, panelId, targetGroupKey);
        }
        if (targetGroupKey === 'floating') {
          return addPanelToGroup(prev, panelId, 'floating');
        }

        const targetGroup = getGroupTabs(prev, targetGroupKey);
        if (targetGroup && targetGroup.tabs.length > 0) {
          return addPanelToFloatingGroup(prev, panelId, targetGroupKey);
        }

        // Preferred floating group disappeared -- fall back to position behavior.
        if (position === 'right' || position === 'bottom') {
          return addPanelToGroup(prev, panelId, position);
        }
        return addPanelToGroup(prev, panelId, 'floating');
      });
    },
    []
  );

  // -----------------------------------------------------------------------
  // removePanelFromGroups -- drop a panel from all groups when closing/unmounting.
  // -----------------------------------------------------------------------
  const removePanelFromGroups = useCallback((panelId: string) => {
    setTabGroups((prev) => removePanelFromGroup(prev, panelId));
  }, []);

  // -----------------------------------------------------------------------
  // switchTab -- set the active tab within a group.
  // NOTE: setActiveTab helper signature is (state, panelId, groupKey).
  // -----------------------------------------------------------------------
  const switchTab = useCallback((groupKey: GroupKey, panelId: string) => {
    setTabGroups((prev) => setActiveTab(prev, panelId, groupKey));
  }, []);

  // -----------------------------------------------------------------------
  // closeTab -- removes a panel from its group AND fires onClose callback.
  // -----------------------------------------------------------------------
  const closeTab = useCallback((panelId: string) => {
    const registration = panelRegistrationsRef.current.get(panelId);

    // Remove from the tab group.
    setTabGroups((prev) => removePanelFromGroup(prev, panelId));

    // Prefer external close handler, but fall back to directly closing the panel.
    if (registration?.onClose) {
      registration.onClose();
      return;
    }
    setPanelOpenById(panelId, false);
  }, []);

  // -----------------------------------------------------------------------
  // reorderTabInGroup -- move a tab to a new index within the same group.
  // -----------------------------------------------------------------------
  const reorderTabInGroup = useCallback((groupKey: GroupKey, panelId: string, newIndex: number) => {
    setTabGroups((prev) => reorderTab(prev, groupKey, panelId, newIndex));
  }, []);

  // -----------------------------------------------------------------------
  // movePanelBetweenGroups -- move a panel to a different group.
  // -----------------------------------------------------------------------
  const movePanelBetweenGroups = useCallback(
    (panelId: string, targetGroupKey: GroupKey | 'floating', insertIndex?: number) => {
      setTabGroups((prev) => movePanelToGroup(prev, panelId, targetGroupKey, insertIndex));

      if (targetGroupKey === 'floating') {
        // New floating group id is generated during the tabGroups update;
        // resolve it in the layout effect above.
        pendingFocusPanelIdRef.current = panelId;
      } else {
        pendingFocusPanelIdRef.current = null;
        setLastFocusedGroupKey(targetGroupKey);
      }

      // Keep panel-state position aligned with tab-group destination.
      const targetPosition: DockPosition =
        targetGroupKey === 'right' || targetGroupKey === 'bottom' ? targetGroupKey : 'floating';
      setPanelPositionById(panelId, targetPosition);
    },
    [setLastFocusedGroupKey]
  );

  // -----------------------------------------------------------------------
  // movePanelBetweenGroupsAndFocus -- convenience command used by panel
  // controls so move + focus updates stay centralized.
  // -----------------------------------------------------------------------
  const movePanelBetweenGroupsAndFocus = useCallback(
    (
      panelId: string,
      targetGroupKey: GroupKey | 'floating',
      insertIndex?: number,
      focusTargetPanelId?: string
    ) => {
      movePanelBetweenGroups(panelId, targetGroupKey, insertIndex);
      focusPanelById(focusTargetPanelId ?? panelId);
    },
    [movePanelBetweenGroups]
  );

  // -----------------------------------------------------------------------
  // movePanel -- adapter called by DockableTabBar's useTabDropTarget onDrop.
  // Dispatches between the existing `reorderTabInGroup` (same group) and
  // `movePanelBetweenGroups` (cross group) functions. Applies shift
  // compensation for same-group reorders so a forward drop lands at the
  // intended visual position after the source tab is removed first.
  //
  // Reads the authoritative tabs list via `tabGroupsRef` (not via state
  // snapshot in closure) to avoid stale reads when multiple drops fire in
  // rapid succession. Uses `getGroupTabs` from tabGroupState.ts to handle
  // the asymmetric TabGroupState shape: `right` and `bottom` are keyed
  // children, but `floating` is an array keyed by `groupId`.
  // -----------------------------------------------------------------------
  const movePanel = useCallback(
    (panelId: string, sourceGroupId: string, targetGroupId: string, insertIndex: number) => {
      if (sourceGroupId === targetGroupId) {
        const groupTabs = getGroupTabs(tabGroupsRef.current, targetGroupId as GroupKey)?.tabs ?? [];
        const sourceIdx = groupTabs.indexOf(panelId);
        const adjustedInsert =
          sourceIdx >= 0 && sourceIdx < insertIndex ? insertIndex - 1 : insertIndex;
        if (sourceIdx === adjustedInsert) {
          // No-op drop onto self (or immediately after self).
          return;
        }
        reorderTabInGroup(targetGroupId as GroupKey, panelId, adjustedInsert);
        return;
      }
      // Cross-group: no shift compensation needed — the source is removed
      // from a different array than the insert.
      movePanelBetweenGroups(panelId, targetGroupId as GroupKey, insertIndex);
    },
    [reorderTabInGroup, movePanelBetweenGroups]
  );

  // -----------------------------------------------------------------------
  // createFloatingGroupWithPanel -- adapter called by the container-level
  // empty-space drop target. Wraps the existing movePanelBetweenGroups +
  // setPanelFloatingPositionById calls so a drop outside any tab bar
  // spawns a brand-new floating group positioned at the cursor. Preserves
  // the legacy "undock by dragging away from the source bar" feature,
  // now keyed on an explicit drop event rather than a cursor-distance
  // gesture. `_sourceGroupId` is accepted for API symmetry but unused —
  // `movePanelBetweenGroups` resolves the source internally.
  // -----------------------------------------------------------------------
  const createFloatingGroupWithPanel = useCallback(
    (panelId: string, _sourceGroupId: string, cursorPos: { x: number; y: number }) => {
      movePanelBetweenGroups(panelId, 'floating');
      const contentBounds = getContentBounds();
      setPanelFloatingPositionById(panelId, {
        x: cursorPos.x - contentBounds.left,
        y: cursorPos.y - contentBounds.top,
      });
    },
    [movePanelBetweenGroups]
  );

  // -----------------------------------------------------------------------
  // Content registry -- allows the group leader to render other panels' body
  // content. Each panel stores its children in a ref so the leader can
  // access it without requiring a re-render of the provider.
  // -----------------------------------------------------------------------
  const panelContentRefsMap = useRef(new Map<string, React.MutableRefObject<React.ReactNode>>());
  const contentChangeListeners = useRef(new Map<GroupKey, Set<() => void>>());

  const notifyContentChange = useCallback((groupKey: GroupKey) => {
    const listeners = contentChangeListeners.current.get(groupKey);
    if (!listeners) {
      return;
    }
    listeners.forEach((fn) => fn());
  }, []);

  const subscribeContentChange = useCallback((groupKey: GroupKey, fn: () => void) => {
    const listenersByGroup = contentChangeListeners.current;
    if (!listenersByGroup.has(groupKey)) {
      listenersByGroup.set(groupKey, new Set());
    }
    const listeners = listenersByGroup.get(groupKey)!;
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
      if (listeners.size === 0) {
        listenersByGroup.delete(groupKey);
      }
    };
  }, []);

  // -----------------------------------------------------------------------
  // Shared runtime refs for panel-level coordination inside this provider.
  // -----------------------------------------------------------------------
  const groupLeaderByKeyRef = useRef(new Map<string, string>());
  const hoverSuppressionCountRef = useRef(0);
  const updateGridTableHoverSuppression = useCallback((shouldSuppress: boolean) => {
    if (typeof document === 'undefined') {
      return;
    }
    if (shouldSuppress) {
      if (hoverSuppressionCountRef.current === 0) {
        document.body.classList.add('gridtable-disable-hover');
      }
      hoverSuppressionCountRef.current += 1;
      return;
    }
    if (hoverSuppressionCountRef.current > 0) {
      hoverSuppressionCountRef.current -= 1;
      if (hoverSuppressionCountRef.current === 0) {
        document.body.classList.remove('gridtable-disable-hover');
      }
    }
  }, []);

  const value: DockablePanelContextValue = useMemo(
    () => ({
      tabGroups,
      panelRegistrations: panelRegistrationsSnapshot,
      registerPanel,
      unregisterPanel,
      syncPanelGroup,
      removePanelFromGroups,
      switchTab,
      closeTab,
      reorderTabInGroup,
      movePanelBetweenGroups,
      movePanelBetweenGroupsAndFocus,
      dragPreviewRef,
      movePanel,
      createFloatingGroupWithPanel,
      panelContentRefsMap,
      notifyContentChange,
      subscribeContentChange,
      groupLeaderByKeyRef,
      updateGridTableHoverSuppression,
      lastFocusedGroupKey,
      setLastFocusedGroupKey,
      getPreferredOpenGroupKey,
      getLastFocusedPosition,
      focusPanel,
    }),
    [
      tabGroups,
      panelRegistrationsSnapshot,
      registerPanel,
      unregisterPanel,
      syncPanelGroup,
      removePanelFromGroups,
      switchTab,
      closeTab,
      reorderTabInGroup,
      movePanelBetweenGroups,
      movePanelBetweenGroupsAndFocus,
      movePanel,
      createFloatingGroupWithPanel,
      notifyContentChange,
      subscribeContentChange,
      updateGridTableHoverSuppression,
      lastFocusedGroupKey,
      setLastFocusedGroupKey,
      getPreferredOpenGroupKey,
      getLastFocusedPosition,
      focusPanel,
    ]
  );

  // -----------------------------------------------------------------------
  // Portal host node -- panels are rendered into this DOM element via portals.
  // -----------------------------------------------------------------------
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
      setHostNode(null);
    };
  }, []);

  // Clean up CSS variables on unmount.
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

  // CSS variables --dock-right-offset and --dock-bottom-offset are set by
  // individual DockablePanel instances based on their actual docked size.
  // The cleanup effect above removes them when the provider unmounts.

  return (
    <PanelLayoutStoreContext.Provider value={panelLayoutStoreRef.current}>
      <DockablePanelContext.Provider value={value}>
        <DockablePanelHostContext.Provider value={hostNode}>
          {children}
          {/* Permanently mounted drag preview. The browser screenshots
              this element via setDragImage at dragstart; DockableTabBar's
              per-tab getDragImage callback writes the dragged tab's
              label + kind class into the inner spans before handing the
              element off. Offscreen by default via CSS fallback
              (`transform: translate3d(var(--dockable-tab-drag-x, -9999px), ...)`). */}
          <div ref={dragPreviewRef} className="dockable-tab-drag-preview" aria-hidden="true">
            <span className="dockable-tab-drag-preview__kind kind-badge" aria-hidden="true" />
            <span className="dockable-tab-drag-preview__label" />
          </div>
        </DockablePanelHostContext.Provider>
      </DockablePanelContext.Provider>
    </PanelLayoutStoreContext.Provider>
  );
};
