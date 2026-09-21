/**
 * DockablePanelProvider.tsx
 *
 * Context provider for managing dockable panels.
 * Tracks tab groups (right, bottom, floating), panel registrations,
 * and provides actions for switching, closing, reordering, and moving tabs.
 * The layout renders group-owned surfaces; tabs portal their own content.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { type TabDragPayload, TabDragProvider } from '@shared/components/tabs/dragCoordinator';
import type React from 'react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useOptionalPanelLifecycleGuardRegistry } from '@/core/panel-windows/panelLifecycleGuards';
import {
  DockablePanelContext,
  type DockablePanelContextValue,
  useDockablePanelContext,
} from './DockablePanelContext';
import { DockablePanelGroup } from './DockablePanelGroup';
import type { PanelLayoutStore } from './panelLayoutStore';
import { createPanelLayoutStore } from './panelLayoutStore';
import { PanelLayoutStoreContext } from './panelLayoutStoreContext';
import type { AdjacentTabActivationPreference } from './tabGroupState';
import {
  addPanelToFloatingGroup,
  addPanelToGroup,
  getGroupForPanel,
  getGroupTabs,
  movePanelToGroup,
  removePanelFromGroup,
  reorderTab,
  setActiveTab,
} from './tabGroupState';
import type { GroupKey, PanelRegistration, TabGroupState } from './tabGroupTypes';
import type { DockPosition } from './useDockablePanelState';

export { useDockablePanelContext } from './DockablePanelContext';

function focusDockableTab(panelId: string): void {
  if (typeof document === 'undefined') {
    return;
  }

  const tab = Array.from(
    document.querySelectorAll<HTMLElement>('[role="tab"][data-panel-id]')
  ).find((element) => element.dataset.panelId === panelId);
  tab?.focus();
}

function firstGroupWithTabs(tabGroups: TabGroupState): GroupKey | null {
  if (tabGroups.right.tabs.length > 0) {
    return 'right';
  }
  if (tabGroups.bottom.tabs.length > 0) {
    return 'bottom';
  }
  return tabGroups.floating.find((group) => group.tabs.length > 0)?.groupId ?? null;
}

const isFloatingGroupKey = (groupKey: GroupKey | null): groupKey is GroupKey =>
  groupKey !== null && groupKey !== 'right' && groupKey !== 'bottom';

const resolveFocusedFloatingGroup = (
  tabGroups: TabGroupState,
  currentGroup: GroupKey | null,
  focusedGroup: GroupKey | null
): GroupKey => {
  if (isFloatingGroupKey(currentGroup)) {
    return currentGroup;
  }
  if (!isFloatingGroupKey(focusedGroup)) {
    return 'floating';
  }
  const group = getGroupTabs(tabGroups, focusedGroup);
  return group && group.tabs.length > 0 ? focusedGroup : 'floating';
};

const resolvePanelTargetGroup = (
  tabGroups: TabGroupState,
  currentGroup: GroupKey | null,
  position: DockPosition,
  preferredGroup: GroupKey | undefined,
  focusedGroup: GroupKey | null
): GroupKey => {
  if (currentGroup === null && preferredGroup !== undefined) {
    return preferredGroup;
  }
  if (position === 'floating') {
    return resolveFocusedFloatingGroup(tabGroups, currentGroup, focusedGroup);
  }
  return position;
};

const panelAlreadyInTargetGroup = (currentGroup: GroupKey | null, targetGroup: GroupKey) =>
  targetGroup === 'floating'
    ? isFloatingGroupKey(currentGroup)
    : currentGroup !== null && currentGroup === targetGroup;

const addPanelToResolvedGroup = (
  tabGroups: TabGroupState,
  panelId: string,
  targetGroup: GroupKey,
  fallbackPosition: DockPosition
): TabGroupState => {
  if (targetGroup === 'right' || targetGroup === 'bottom' || targetGroup === 'floating') {
    return addPanelToGroup(tabGroups, panelId, targetGroup);
  }
  const existingTarget = getGroupTabs(tabGroups, targetGroup);
  if (existingTarget && existingTarget.tabs.length > 0) {
    return addPanelToFloatingGroup(tabGroups, panelId, targetGroup);
  }
  return fallbackPosition === 'right' || fallbackPosition === 'bottom'
    ? addPanelToGroup(tabGroups, panelId, fallbackPosition)
    : addPanelToGroup(tabGroups, panelId, 'floating');
};

const syncPanelGroupState = (
  tabGroups: TabGroupState,
  panelId: string,
  position: DockPosition,
  preferredGroup: GroupKey | undefined,
  focusedGroup: GroupKey | null
): TabGroupState => {
  const currentGroup = getGroupForPanel(tabGroups, panelId);
  const targetGroup = resolvePanelTargetGroup(
    tabGroups,
    currentGroup,
    position,
    preferredGroup,
    focusedGroup
  );
  return panelAlreadyInTargetGroup(currentGroup, targetGroup)
    ? tabGroups
    : addPanelToResolvedGroup(tabGroups, panelId, targetGroup, position);
};

// The layout owns group roots and their content slots; tab content portals retain
// their original React ancestry while the group owns presentation.
export function DockablePanelLayer() {
  const { tabGroups, panelRegistrations } = useDockablePanelContext();
  const { selectedClusterId } = useKubeconfig();
  const groups = [
    { groupKey: 'right', ...tabGroups.right },
    { groupKey: 'bottom', ...tabGroups.bottom },
    ...tabGroups.floating.map(({ groupId, ...group }) => ({ groupKey: groupId, ...group })),
  ];
  return (
    <div className="dockable-panel-layer">
      {groups.map((group) => {
        const visibleTabs = group.tabs.filter((id) => {
          const registration = panelRegistrations.get(id);
          return registration && !registration.suppressSurface;
        });
        return visibleTabs.length > 0 ? (
          <DockablePanelGroup
            key={`${selectedClusterId}:${group.groupKey}`}
            groupKey={group.groupKey}
            tabs={visibleTabs}
            activeTab={group.activeTab}
          />
        ) : null;
      })}
    </div>
  );
}

interface DockablePanelProviderProps {
  children: React.ReactNode;
  initialTabGroups?: TabGroupState;
  onGroupMoveRequest?: (
    group: { groupKey: GroupKey; tabs: string[]; activeTab: string | null },
    targetPosition: DockPosition
  ) => boolean | undefined;
  onTabCloseRequest?: (panelId: string) => void;
  nativeWindowMode?: boolean;
  tabDragIdentity?: {
    windowName: string;
    clusterId: string;
    nativeGroupId?: string;
    getTabSnapshot: (
      panelId: string
    ) => Extract<TabDragPayload, { kind: 'dockable-tab' }>['tab'] | undefined;
  };
  onExternalTabDrop?: (
    payload: Extract<TabDragPayload, { kind: 'dockable-tab' }>,
    targetGroupId: string,
    insertIndex: number
  ) => void;
  onClusterTabTearOff?: (
    payload: Extract<TabDragPayload, { kind: 'cluster-tab' }>,
    cursor: { x: number; y: number }
  ) => void;
  onTabTearOff?: (
    payload: Extract<TabDragPayload, { kind: 'dockable-tab' }>,
    cursor: { x: number; y: number }
  ) => void;
  onTabMoveRequest?: (
    payload: Extract<TabDragPayload, { kind: 'dockable-tab' }>,
    targetPosition: DockPosition
  ) => void;
  canStartTabDrag?: (panelId: string) => boolean;
}

export const DockablePanelProvider: React.FC<DockablePanelProviderProps> = ({
  children,
  initialTabGroups,
  onGroupMoveRequest,
  onTabCloseRequest,
  nativeWindowMode = false,
  tabDragIdentity,
  onExternalTabDrop,
  onTabTearOff,
  onTabMoveRequest,
  onClusterTabTearOff,
  canStartTabDrag,
}) => {
  const lifecycleGuards = useOptionalPanelLifecycleGuardRegistry();
  // Per-cluster panel layout stores. Each open cluster gets its own
  // PanelLayoutStore that holds tab lifetime, group geometry and membership for
  // that cluster. The active store mirrors selectedClusterId. Cluster
  // tab close prunes the entry.
  const { selectedClusterId, selectedClusterIds } = useKubeconfig();
  const storesRef = useRef<Map<string, PanelLayoutStore>>(new Map());

  const getOrCreateStoreForCluster = useCallback(
    (clusterKey: string): PanelLayoutStore => {
      let store = storesRef.current.get(clusterKey);
      if (!store) {
        store = createPanelLayoutStore(initialTabGroups);
        storesRef.current.set(clusterKey, store);
      }
      return store;
    },
    [initialTabGroups]
  );

  // CRITICAL: activeStore is computed in render via useMemo, NOT via
  // useState + useLayoutEffect. The useState approach has a one-render
  // lag between selectedClusterId changing and activeStore catching up
  // — during that lag the wrong store is the context value, and any
  // children that mount in that render (e.g. AppLayout's ObjectPanels
  // for the new cluster, or remounting panels for the cluster we just
  // switched back to) register themselves against the WRONG store.
  // Floating groups in particular get fragmented because the panels
  // re-sync against the wrong store on the lag render and the right
  // store on the following render, sometimes producing two separate
  // floating groups instead of one.
  const activeStore = useMemo(
    () => getOrCreateStoreForCluster(selectedClusterId || '__default__'),
    [selectedClusterId, getOrCreateStoreForCluster]
  );

  // Prune stores for clusters that have been closed. Mirrors the
  // identical pattern in ObjectPanelStateContext.tsx (which keeps
  // per-cluster `openPanels` slices). The '__default__' key is never
  // pruned — it's the no-cluster-selected slot.
  useEffect(() => {
    const allowed = new Set(selectedClusterIds ?? []);
    for (const clusterKey of Array.from(storesRef.current.keys())) {
      if (clusterKey !== '__default__' && !allowed.has(clusterKey)) {
        storesRef.current.delete(clusterKey);
      }
    }
  }, [selectedClusterIds]);

  // Tab group state lives inside the active cluster's store. Subscribe
  // via useSyncExternalStore so React re-renders on any tabGroups change
  // from any source (drag, close, programmatic move). When the active
  // store changes (cluster switch), the subscribe function identity
  // changes via [activeStore], so useSyncExternalStore re-subscribes to
  // the new store automatically.
  const getClusterTabGroups = useCallback(
    (clusterId: string) => getOrCreateStoreForCluster(clusterId).getTabGroups(),
    [getOrCreateStoreForCluster]
  );
  const tabGroups = useSyncExternalStore(activeStore.subscribeTabGroups, activeStore.getTabGroups);

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
  const setLastFocusedGroupKeyValue = useCallback((key: GroupKey | null) => {
    if (lastFocusedGroupKeyRef.current === key) {
      return;
    }
    lastFocusedGroupKeyRef.current = key;
    setLastFocusedGroupKeyState(key);
  }, []);
  const setLastFocusedGroupKey = setLastFocusedGroupKeyValue;

  const reconcileLastFocusedGroup = useCallback(
    (nextTabGroups: TabGroupState) => {
      const focusedGroupKey = lastFocusedGroupKeyRef.current;
      if (!focusedGroupKey) {
        return;
      }
      const focusedGroup = getGroupTabs(nextTabGroups, focusedGroupKey);
      if (focusedGroup && focusedGroup.tabs.length > 0) {
        return;
      }
      setLastFocusedGroupKeyValue(firstGroupWithTabs(nextTabGroups));
    },
    [setLastFocusedGroupKeyValue]
  );

  // Some close paths mutate tabGroups through the layout store directly
  // (for example committed object-panel removal). Reconcile here
  // so the visual focus group never points at a group that no longer exists.
  useLayoutEffect(() => {
    reconcileLastFocusedGroup(tabGroups);
  }, [tabGroups, reconcileLastFocusedGroup]);

  // Track DOM focus shifts globally and route them to setLastFocusedGroupKey.
  // The mousedown handler on each panel already covers click activation; this
  // listener additionally covers keyboard focus moves (Tab cycling between
  // fields in different panels) and programmatic focus() calls. Walks up from
  // the focus target looking for the nearest [data-dockable-group-key]
  // attribute, which DockablePanel sets on its root element.
  useEffect(() => {
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const owner = target.closest<HTMLElement>('[data-dockable-group-key]');
      if (!owner) {
        return;
      }
      const key = owner.dataset.dockableGroupKey;
      if (!key) {
        return;
      }
      setLastFocusedGroupKey(key as GroupKey);
    };
    document.addEventListener('focusin', handleFocusIn);
    return () => document.removeEventListener('focusin', handleFocusIn);
  }, [setLastFocusedGroupKey]);

  // Resolve the best target group key for opening a new panel.
  const getPreferredOpenGroupKey = useCallback(
    (fallbackPosition: DockPosition = 'right'): GroupKey => {
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
    const groupKey = getPreferredOpenGroupKey('right');
    return groupKey === 'right' || groupKey === 'bottom' ? groupKey : 'floating';
  }, [getPreferredOpenGroupKey]);

  // Keep the request here: opening a related object can unmount its launcher
  // before the new panel registers. Explicit cluster identity also survives
  // the render between activating another cluster and mounting its panels.
  const [pendingFocus, setPendingFocus] = useState<{
    panelId: string;
    clusterId: string;
  } | null>(null);
  const previousFocusClusterRef = useRef(selectedClusterId);
  useLayoutEffect(() => {
    if (previousFocusClusterRef.current !== selectedClusterId) {
      setPendingFocus((request) => (request?.clusterId === selectedClusterId ? request : null));
      previousFocusClusterRef.current = selectedClusterId;
    }
  }, [selectedClusterId]);

  const focusPanel = useCallback(
    (panelId: string, clusterId = selectedClusterId) => {
      setPendingFocus({ panelId, clusterId });
    },
    [selectedClusterId]
  );

  useEffect(() => {
    if (!pendingFocus || pendingFocus.clusterId !== selectedClusterId) {
      return;
    }
    const { panelId } = pendingFocus;
    const groupKey = getGroupForPanel(tabGroups, panelId);
    if (!groupKey) {
      return;
    }
    setLastFocusedGroupKey(groupKey);
    if (getGroupTabs(tabGroups, groupKey)?.activeTab !== panelId) {
      activeStore.setTabGroups((prev) => setActiveTab(prev, panelId, groupKey));
      return;
    }
    activeStore.focusPanelById(panelId);
    const timer = window.setTimeout(() => {
      focusDockableTab(panelId);
      setPendingFocus(null);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [pendingFocus, selectedClusterId, tabGroups, activeStore, setLastFocusedGroupKey]);

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
    (panelId: string, position: DockPosition, preferredGroupKey?: GroupKey) => {
      activeStore.setTabGroups((prev) =>
        syncPanelGroupState(
          prev,
          panelId,
          position,
          preferredGroupKey,
          lastFocusedGroupKeyRef.current
        )
      );
    },
    [activeStore]
  );

  // -----------------------------------------------------------------------
  // removePanelFromGroups -- drop a panel from all groups when closing/unmounting.
  // -----------------------------------------------------------------------
  const removePanelFromGroups = useCallback(
    (panelId: string) => {
      activeStore.setTabGroups((prev) => {
        const next = removePanelFromGroup(prev, panelId);
        reconcileLastFocusedGroup(next);
        return next;
      });
    },
    [activeStore, reconcileLastFocusedGroup]
  );

  // -----------------------------------------------------------------------
  // switchTab -- set the active tab within a group.
  // NOTE: setActiveTab helper signature is (state, panelId, groupKey).
  // -----------------------------------------------------------------------
  const switchTab = useCallback(
    (groupKey: GroupKey, panelId: string) => {
      activeStore.setTabGroups((prev) => setActiveTab(prev, panelId, groupKey));
    },
    [activeStore]
  );

  // -----------------------------------------------------------------------
  // commitTabClose -- applies an already-authorized local close.
  // -----------------------------------------------------------------------
  const commitTabClose = useCallback(
    (panelId: string, activationPreference: AdjacentTabActivationPreference = 'right') => {
      const registration = panelRegistrationsRef.current.get(panelId);
      const currentTabGroups = activeStore.getTabGroups();
      const currentGroupKey = getGroupForPanel(currentTabGroups, panelId);

      if (currentGroupKey) {
        const nextTabGroups = removePanelFromGroup(currentTabGroups, panelId, activationPreference);
        const nextActivePanelId = getGroupTabs(nextTabGroups, currentGroupKey)?.activeTab ?? null;

        // Commit membership before invoking the content owner’s close callback.
        activeStore.setTabGroups(() => nextTabGroups);
        reconcileLastFocusedGroup(nextTabGroups);
        if (nextActivePanelId) {
          window.setTimeout(() => {
            activeStore.focusPanelById(nextActivePanelId);
            focusDockableTab(nextActivePanelId);
          }, 0);
        }
      } else {
        // Panel is not grouped; still clear any stale membership defensively.
        activeStore.setTabGroups((prev) => {
          const next = removePanelFromGroup(prev, panelId);
          reconcileLastFocusedGroup(next);
          return next;
        });
      }

      // Prefer external close handler, but fall back to directly closing the panel.
      if (registration?.onClose) {
        registration.onClose();
        return;
      }
      activeStore.setPanelOpenById(panelId, false);
    },
    [activeStore, reconcileLastFocusedGroup]
  );

  // -----------------------------------------------------------------------
  // closeTab -- validates close intent and lets a native owner authorize it.
  // -----------------------------------------------------------------------
  const closeTab = useCallback(
    (panelId: string, activationPreference: AdjacentTabActivationPreference = 'right') => {
      const blocker = lifecycleGuards?.firstBlocker([panelId]);
      if (blocker) {
        blocker.focus();
        return;
      }
      if (nativeWindowMode && onTabCloseRequest) {
        onTabCloseRequest(panelId);
        return;
      }
      commitTabClose(panelId, activationPreference);
    },
    [commitTabClose, lifecycleGuards, nativeWindowMode, onTabCloseRequest]
  );

  // -----------------------------------------------------------------------
  // reorderTabInGroup -- move a tab to a new index within the same group.
  // -----------------------------------------------------------------------
  const reorderTabInGroup = useCallback(
    (groupKey: GroupKey, panelId: string, newIndex: number) => {
      activeStore.setTabGroups((prev) => reorderTab(prev, groupKey, panelId, newIndex));
    },
    [activeStore]
  );

  // -----------------------------------------------------------------------
  // movePanelBetweenGroups -- move a panel to a different group.
  // -----------------------------------------------------------------------
  const movePanelBetweenGroups = useCallback(
    (panelId: string, targetGroupKey: GroupKey, insertIndex?: number) => {
      if (targetGroupKey !== 'floating') {
        activeStore.setTabGroups((prev) =>
          movePanelToGroup(prev, panelId, targetGroupKey, insertIndex)
        );
        setLastFocusedGroupKey(targetGroupKey);
        return;
      }
      if (!onGroupMoveRequest) {
        return;
      }
      const sourceGroupKey = getGroupForPanel(activeStore.getTabGroups(), panelId);
      if (!sourceGroupKey) {
        return;
      }
      const sourceGroup = getGroupTabs(activeStore.getTabGroups(), sourceGroupKey);
      if (sourceGroup) {
        onGroupMoveRequest(
          { groupKey: sourceGroupKey, tabs: sourceGroup.tabs, activeTab: sourceGroup.activeTab },
          'floating'
        );
      }
    },
    [activeStore, onGroupMoveRequest, setLastFocusedGroupKey]
  );

  // -----------------------------------------------------------------------
  // movePanel -- adapter called by DockableTabBar's useTabDropTarget onDrop.
  // Dispatches between the existing `reorderTabInGroup` (same group) and
  // `movePanelBetweenGroups` (cross group) functions. Applies shift
  // compensation for same-group reorders so a forward drop lands at the
  // intended visual position after the source tab is removed first.
  //
  // Reads the authoritative tabs list via `activeStore.getTabGroups()` (not via
  // state snapshot in closure) to avoid stale reads when multiple drops fire in
  // rapid succession. Uses `getGroupTabs` from tabGroupState.ts to handle
  // the asymmetric TabGroupState shape: `right` and `bottom` are keyed
  // children, but `floating` is an array keyed by `groupId`.
  // -----------------------------------------------------------------------
  const movePanel = useCallback(
    (panelId: string, sourceGroupId: string, targetGroupId: string, insertIndex: number) => {
      if (sourceGroupId === targetGroupId) {
        const groupTabs =
          getGroupTabs(activeStore.getTabGroups(), targetGroupId as GroupKey)?.tabs ?? [];
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
    [activeStore, reorderTabInGroup, movePanelBetweenGroups]
  );

  const createDockableTabDragPayload = useCallback(
    (
      panelId: string,
      sourceGroupId: string
    ): Extract<TabDragPayload, { kind: 'dockable-tab' }> => ({
      kind: 'dockable-tab',
      panelId,
      sourceGroupId,
      sourceWindowName: tabDragIdentity?.windowName,
      sourceWindowGroupId: tabDragIdentity?.nativeGroupId ?? sourceGroupId,
      clusterId: tabDragIdentity?.clusterId,
      tab: tabDragIdentity?.getTabSnapshot(panelId),
    }),
    [tabDragIdentity]
  );

  const dropDockableTab = useCallback(
    (
      payload: Extract<TabDragPayload, { kind: 'dockable-tab' }>,
      targetGroupId: string,
      insertIndex: number
    ) => {
      const isExternal =
        !!payload.sourceWindowName &&
        !!tabDragIdentity?.windowName &&
        payload.sourceWindowName !== tabDragIdentity.windowName;
      if (!isExternal) {
        movePanel(payload.panelId, payload.sourceGroupId, targetGroupId, insertIndex);
        return;
      }
      if (!onExternalTabDrop || payload.clusterId !== tabDragIdentity.clusterId || !payload.tab) {
        return;
      }
      onExternalTabDrop(payload, targetGroupId, insertIndex);
    },
    [movePanel, onExternalTabDrop, tabDragIdentity]
  );

  const canStartDockableTabDrag = useCallback(
    (panelId: string) => canStartTabDrag?.(panelId) ?? true,
    [canStartTabDrag]
  );

  const handleTabTearOff = useCallback(
    (payload: TabDragPayload, cursor: { x: number; y: number }) => {
      if (payload.kind === 'dockable-tab') {
        onTabTearOff?.(payload, cursor);
      } else {
        onClusterTabTearOff?.(payload, cursor);
      }
    },
    [onTabTearOff, onClusterTabTearOff]
  );

  // -----------------------------------------------------------------------
  // Shared runtime refs for panel-level coordination inside this provider.
  // -----------------------------------------------------------------------

  // Fan out applyObjectPanelLayoutDefaults to every cluster's store.
  // Called by Settings.tsx when the user changes the default object
  // panel layout — every cluster's open object panels should pick up
  // the new defaults, not just the active cluster's.
  const applyLayoutDefaultsAcrossClusters = useCallback(() => {
    storesRef.current.forEach((store) => {
      store.applyObjectPanelLayoutDefaults();
    });
  }, []);

  const discardPanelLayouts = useCallback((clusterId: string, panelIds: readonly string[]) => {
    const store = storesRef.current.get(clusterId);
    if (!store) {
      return;
    }
    for (const panelId of panelIds) {
      store.clearPanelState(panelId);
    }
  }, []);

  const dockPanelGroup = useCallback(
    (
      clusterId: string,
      panelIds: readonly string[],
      activePanelId: string,
      targetPosition: 'right' | 'bottom',
      insertIndex?: number
    ) => {
      const store = getOrCreateStoreForCluster(clusterId);
      const uniquePanelIds = Array.from(new Set(panelIds));
      store.setTabGroups((previous) => {
        const next = uniquePanelIds.reduce(
          (current, panelId, panelIndex) =>
            addPanelToGroup(
              current,
              panelId,
              targetPosition,
              insertIndex === undefined ? undefined : insertIndex + panelIndex
            ),
          previous
        );
        return uniquePanelIds.includes(activePanelId)
          ? setActiveTab(next, activePanelId, targetPosition)
          : next;
      });
    },
    [getOrCreateStoreForCluster]
  );

  const detachPanelGroup = useCallback((clusterId: string, panelIds: readonly string[]) => {
    const store = storesRef.current.get(clusterId);
    if (!store) {
      return;
    }
    store.setTabGroups((previous) =>
      Array.from(new Set(panelIds)).reduce(
        (current, panelId) => removePanelFromGroup(current, panelId),
        previous
      )
    );
  }, []);

  const moveDockedPanels = useCallback(
    (panelIds: readonly string[], activePanelId: string, targetPosition: 'right' | 'bottom') => {
      dockPanelGroup(selectedClusterId, panelIds, activePanelId, targetPosition);
      setLastFocusedGroupKey(targetPosition);
      activeStore.focusPanelById(activePanelId);
      window.setTimeout(() => focusDockableTab(activePanelId), 0);
    },
    [activeStore, dockPanelGroup, selectedClusterId, setLastFocusedGroupKey]
  );

  const requestGroupMove = useCallback(
    (groupKey: GroupKey, targetPosition: DockPosition): boolean => {
      const group = getGroupTabs(activeStore.getTabGroups(), groupKey);
      if (!group || group.tabs.length === 0) {
        return false;
      }
      const blocker = lifecycleGuards?.firstBlocker(group.tabs);
      if (blocker) {
        blocker.focus();
        return true;
      }
      if (
        onGroupMoveRequest &&
        onGroupMoveRequest(
          { groupKey, tabs: group.tabs, activeTab: group.activeTab },
          targetPosition
        ) !== false
      ) {
        return true;
      }
      if (nativeWindowMode || targetPosition === 'floating') {
        return false;
      }
      moveDockedPanels(group.tabs, group.activeTab ?? group.tabs[0], targetPosition);
      return true;
    },
    [activeStore, lifecycleGuards, onGroupMoveRequest, nativeWindowMode, moveDockedPanels]
  );

  const requestTabMove = useCallback(
    (panelId: string, targetPosition: DockPosition) => {
      const groupKey = getGroupForPanel(activeStore.getTabGroups(), panelId);
      if (!groupKey || (!nativeWindowMode && groupKey === targetPosition)) {
        return;
      }
      const blocker = lifecycleGuards?.firstBlocker([panelId]);
      if (blocker) {
        blocker.focus();
        return;
      }
      if (!nativeWindowMode && targetPosition !== 'floating') {
        moveDockedPanels([panelId], panelId, targetPosition);
        return;
      }
      onTabMoveRequest?.(createDockableTabDragPayload(panelId, groupKey), targetPosition);
    },
    [
      activeStore,
      lifecycleGuards,
      nativeWindowMode,
      moveDockedPanels,
      createDockableTabDragPayload,
      onTabMoveRequest,
    ]
  );

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
      commitTabClose,
      reorderTabInGroup,
      movePanelBetweenGroups,
      dragPreviewRef,
      movePanel,
      createDockableTabDragPayload,
      dropDockableTab,
      canStartDockableTabDrag,
      tabDropScope: tabDragIdentity,
      lastFocusedGroupKey,
      setLastFocusedGroupKey,
      getPreferredOpenGroupKey,
      getLastFocusedPosition,
      focusPanel,
      applyLayoutDefaultsAcrossClusters,
      dockPanelGroup,
      detachPanelGroup,
      discardPanelLayouts,
      getClusterTabGroups,
      requestGroupMove,
      requestTabMove,
      nativeWindowMode,
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
      commitTabClose,
      reorderTabInGroup,
      movePanelBetweenGroups,
      movePanel,
      createDockableTabDragPayload,
      dropDockableTab,
      canStartDockableTabDrag,
      tabDragIdentity,
      lastFocusedGroupKey,
      setLastFocusedGroupKey,
      getPreferredOpenGroupKey,
      getLastFocusedPosition,
      focusPanel,
      applyLayoutDefaultsAcrossClusters,
      dockPanelGroup,
      detachPanelGroup,
      discardPanelLayouts,
      getClusterTabGroups,
      requestGroupMove,
      requestTabMove,
      nativeWindowMode,
    ]
  );

  return (
    <PanelLayoutStoreContext.Provider value={activeStore}>
      <DockablePanelContext.Provider value={value}>
        <TabDragProvider onTearOff={handleTabTearOff}>
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
        </TabDragProvider>
      </DockablePanelContext.Provider>
    </PanelLayoutStoreContext.Provider>
  );
};
