import type { TabDragPayload, TabDragScope } from '@shared/components/tabs/dragCoordinator';
import type React from 'react';
import { createContext, useContext } from 'react';
import type { DockPosition } from './panelLayoutStore';
import type { AdjacentTabActivationPreference } from './tabGroupState';
import type { GroupKey, PanelRegistration, TabGroupState } from './tabGroupTypes';

export interface DockablePanelContextValue {
  // Tab group state
  tabGroups: TabGroupState;

  // Panel registrations (metadata like title, callbacks)
  panelRegistrations: Map<string, PanelRegistration>;

  // Register/unregister panels -- called by DockablePanel components
  registerPanel: (registration: PanelRegistration) => void;
  unregisterPanel: (panelId: string) => void;
  // Keep tab-group membership aligned with an open panel's current dock position.
  syncPanelGroup: (panelId: string, position: DockPosition, preferredGroupKey?: GroupKey) => void;
  // Remove tab-group membership for closed/unmounted panels.
  removePanelFromGroups: (panelId: string) => void;

  // Tab actions
  switchTab: (groupKey: GroupKey, panelId: string) => void;
  closeTab: (panelId: string, activationPreference?: AdjacentTabActivationPreference) => void;
  commitTabClose: (panelId: string, activationPreference?: AdjacentTabActivationPreference) => void;
  reorderTabInGroup: (groupKey: GroupKey, panelId: string, newIndex: number) => void;
  movePanelBetweenGroups: (panelId: string, targetGroupKey: GroupKey, insertIndex?: number) => void;
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
  createDockableTabDragPayload: (
    panelId: string,
    sourceGroupId: string
  ) => Extract<TabDragPayload, { kind: 'dockable-tab' }>;
  dropDockableTab: (
    payload: Extract<TabDragPayload, { kind: 'dockable-tab' }>,
    targetGroupId: string,
    insertIndex: number
  ) => void;
  canStartDockableTabDrag: (panelId: string) => boolean;
  tabDropScope?: TabDragScope;
  // Last-focused group -- tracks which panel group was most recently interacted with,
  // so new panels (e.g. object tabs) can open in the same group.
  lastFocusedGroupKey: GroupKey | null;
  setLastFocusedGroupKey: (key: GroupKey) => void;
  // Resolve the concrete group key new panels should target.
  getPreferredOpenGroupKey: (fallbackPosition?: DockPosition) => GroupKey;
  getLastFocusedPosition: () => DockPosition;

  // Focus a panel by ID -- activates its tab and brings the panel to front.
  focusPanel: (panelId: string, clusterId?: string) => void;

  // Fan out applyObjectPanelLayoutDefaults to every cluster's store.
  applyLayoutDefaultsAcrossClusters: () => void;
  // Move a native panel group to the requested owner dock before it remounts.
  dockPanelGroup: (
    clusterId: string,
    panelIds: readonly string[],
    activePanelId: string,
    targetPosition: 'right' | 'bottom',
    insertIndex?: number
  ) => void;
  // Remove a group transferred to a native window while retaining its layout state.
  detachPanelGroup: (clusterId: string, panelIds: readonly string[]) => void;
  // Remove closed native-panel layout and group state from its owning cluster.
  discardPanelLayouts: (clusterId: string, panelIds: readonly string[]) => void;
  getClusterTabGroups: (clusterId: string) => TabGroupState;
  requestGroupMove?: (groupKey: GroupKey, targetPosition: DockPosition) => boolean;
  requestTabMove: (panelId: string, targetPosition: DockPosition) => void;
  nativeWindowMode: boolean;
}

export const DockablePanelContext = createContext<DockablePanelContextValue | null>(null);
export const useDockablePanelContext = () => {
  const context = useContext(DockablePanelContext);
  if (!context) {
    throw new Error('useDockablePanelContext must be used within DockablePanelProvider');
  }
  return context;
};
