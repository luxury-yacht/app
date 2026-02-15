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
} from 'react';
import type { TabGroupState, TabDragState, GroupKey, PanelRegistration } from './tabGroupTypes';
import type { DockPosition } from './useDockablePanelState';
import { focusPanelById, setPanelOpenById, setPanelPositionById } from './useDockablePanelState';
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
  // True only when a real provider is mounted (false for fallback defaults).
  isProviderActive: boolean;
  // Tab group state
  tabGroups: TabGroupState;

  // Panel registrations (metadata like title, callbacks)
  panelRegistrations: Map<string, PanelRegistration>;

  // Register/unregister panels -- called by DockablePanel components
  registerPanel: (registration: PanelRegistration) => void;
  unregisterPanel: (panelId: string) => void;
  // Keep tab-group membership aligned with an open panel's current dock position.
  syncPanelGroup: (panelId: string, position: DockPosition) => void;
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
  addPanelToExistingFloatingGroup: (panelId: string, groupId: string, insertIndex?: number) => void;

  // Drag state
  dragState: TabDragState | null;
  setDragState: (state: TabDragState | null) => void;

  // Content registry -- allows the group leader to render other panels' body content.
  panelContentRefsMap: React.MutableRefObject<Map<string, React.MutableRefObject<React.ReactNode>>>;
  notifyContentChange: () => void;
  subscribeContentChange: (fn: () => void) => () => void;

  // Last-focused group -- tracks which panel group was most recently interacted with,
  // so new panels (e.g. object tabs) can open in the same group.
  lastFocusedGroupKey: GroupKey | null;
  setLastFocusedGroupKey: (key: GroupKey) => void;
  getLastFocusedPosition: () => DockPosition;

  // Focus a panel by ID -- activates its tab and brings the panel to front.
  focusPanel: (panelId: string) => void;

  // Legacy compat -- derived from tabGroups for backward compatibility
  dockedPanels: { right: string[]; bottom: string[] };
  getAdjustedDimensions: () => { rightOffset: number; bottomOffset: number };
}

const defaultDockablePanelContext: DockablePanelContextValue = {
  isProviderActive: false,
  tabGroups: createInitialTabGroupState(),
  panelRegistrations: new Map(),
  registerPanel: () => {},
  unregisterPanel: () => {},
  syncPanelGroup: () => {},
  removePanelFromGroups: () => {},
  switchTab: () => {},
  closeTab: () => {},
  reorderTabInGroup: () => {},
  movePanelBetweenGroups: () => {},
  addPanelToExistingFloatingGroup: () => {},
  dragState: null,
  setDragState: () => {},
  panelContentRefsMap: { current: new Map() },
  notifyContentChange: () => {},
  subscribeContentChange: () => () => {},
  lastFocusedGroupKey: null,
  setLastFocusedGroupKey: () => {},
  getLastFocusedPosition: () => 'right',
  focusPanel: () => {},
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
  // Tab group state -- the primary model for which panels live where.
  const [tabGroups, setTabGroups] = useState<TabGroupState>(() => createInitialTabGroupState());

  // Panel registrations stored in a ref so that adding/removing registrations
  // doesn't cause the whole tree to re-render. A bump counter forces a
  // re-render when we need consumers to see updated registrations.
  const panelRegistrationsRef = useRef<Map<string, PanelRegistration>>(new Map());
  const [, setRegistrationBump] = useState(0);

  // Drag state for tab dragging (Phase 5).
  const [dragState, setDragState] = useState<TabDragState | null>(null);

  // Keep CSS variables in sync so the drag preview can follow the cursor
  // without relying on inline styles.
  useLayoutEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    if (!dragState) {
      root.style.removeProperty('--dockable-tab-drag-x');
      root.style.removeProperty('--dockable-tab-drag-y');
      return;
    }
    root.style.setProperty('--dockable-tab-drag-x', `${Math.round(dragState.cursorPosition.x + 14)}px`);
    root.style.setProperty('--dockable-tab-drag-y', `${Math.round(dragState.cursorPosition.y + 16)}px`);
  }, [dragState]);

  useLayoutEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }
    const root = document.documentElement;
    return () => {
      root.style.removeProperty('--dockable-tab-drag-x');
      root.style.removeProperty('--dockable-tab-drag-y');
    };
  }, []);

  // Last-focused group -- tracks which panel group the user most recently interacted with.
  // New panels open in this group's dock position. Defaults to 'right' if null.
  const [lastFocusedGroupKey, setLastFocusedGroupKey] = useState<GroupKey | null>(null);

  /** Map the last-focused group key to a DockPosition for new panels.
   *  If the focused group still has tabs, use its position.
   *  Otherwise scan for any group with open tabs so new panels join it.
   *  Falls back to 'right' only when no panels are open at all. */
  const getLastFocusedPosition = useCallback((): DockPosition => {
    // Helper: map a group key to a DockPosition.
    const keyToPosition = (key: GroupKey): DockPosition => {
      if (key === 'right') return 'right';
      if (key === 'bottom') return 'bottom';
      return 'floating';
    };

    // If we have a valid last-focused group with tabs, use it.
    if (lastFocusedGroupKey) {
      const group = getGroupTabs(tabGroups, lastFocusedGroupKey);
      if (group && group.tabs.length > 0) {
        return keyToPosition(lastFocusedGroupKey);
      }
    }

    // No valid focused group — find any group that has open tabs.
    if (tabGroups.right.tabs.length > 0) return 'right';
    if (tabGroups.bottom.tabs.length > 0) return 'bottom';
    if (tabGroups.floating.length > 0 && tabGroups.floating[0].tabs.length > 0) return 'floating';

    // Nothing open — default to right.
    return 'right';
  }, [lastFocusedGroupKey, tabGroups]);

  // Focus a panel by ID: activate its tab in the group and bring it to front.
  const focusPanel = useCallback((panelId: string) => {
    setTabGroups((prev) => {
      const groupKey = getGroupForPanel(prev, panelId);
      if (!groupKey) return prev;
      return setActiveTab(prev, panelId, groupKey);
    });
    focusPanelById(panelId);
  }, []);

  // -----------------------------------------------------------------------
  // registerPanel stores panel metadata only.
  // Group membership is handled by explicit tab-group actions.
  // -----------------------------------------------------------------------
  const registerPanel = useCallback((registration: PanelRegistration) => {
    // Store the registration metadata.
    panelRegistrationsRef.current.set(registration.panelId, registration);

    // Bump the counter so consumers see the new registration.
    setRegistrationBump((n) => n + 1);
  }, []);

  // -----------------------------------------------------------------------
  // unregisterPanel removes panel metadata only.
  // -----------------------------------------------------------------------
  const unregisterPanel = useCallback((panelId: string) => {
    panelRegistrationsRef.current.delete(panelId);

    // Bump the counter so consumers see the removal.
    setRegistrationBump((n) => n + 1);
  }, []);

  // -----------------------------------------------------------------------
  // syncPanelGroup -- align one panel with its declared dock position.
  // -----------------------------------------------------------------------
  const syncPanelGroup = useCallback((panelId: string, position: DockPosition) => {
    setTabGroups((prev) => {
      const currentGroup = getGroupForPanel(prev, panelId);
      const alreadyInDesiredGroup =
        (position === 'right' && currentGroup === 'right') ||
        (position === 'bottom' && currentGroup === 'bottom') ||
        (position === 'floating' &&
          currentGroup !== null &&
          currentGroup !== 'right' &&
          currentGroup !== 'bottom');

      if (alreadyInDesiredGroup) {
        return prev;
      }

      return addPanelToGroup(prev, panelId, position);
    });
  }, []);

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

      // Keep panel-state position aligned with tab-group destination.
      const targetPosition: DockPosition =
        targetGroupKey === 'right' || targetGroupKey === 'bottom' ? targetGroupKey : 'floating';
      setPanelPositionById(panelId, targetPosition);
    },
    []
  );

  // -----------------------------------------------------------------------
  // addPanelToExistingFloatingGroup -- move a panel into an existing
  // floating group, optionally at a given index.
  // -----------------------------------------------------------------------
  const addPanelToExistingFloatingGroup = useCallback(
    (panelId: string, groupId: string, insertIndex?: number) => {
      setTabGroups((prev) => addPanelToFloatingGroup(prev, panelId, groupId, insertIndex));
      setPanelPositionById(panelId, 'floating');
    },
    []
  );

  // -----------------------------------------------------------------------
  // Content registry -- allows the group leader to render other panels' body
  // content. Each panel stores its children in a ref so the leader can
  // access it without requiring a re-render of the provider.
  // -----------------------------------------------------------------------
  const panelContentRefsMap = useRef(new Map<string, React.MutableRefObject<React.ReactNode>>());
  const contentChangeListeners = useRef(new Set<() => void>());

  const notifyContentChange = useCallback(() => {
    contentChangeListeners.current.forEach((fn) => fn());
  }, []);

  const subscribeContentChange = useCallback((fn: () => void) => {
    contentChangeListeners.current.add(fn);
    return () => {
      contentChangeListeners.current.delete(fn);
    };
  }, []);

  // -----------------------------------------------------------------------
  // Legacy backward compatibility: derive dockedPanels from tabGroups.
  // -----------------------------------------------------------------------
  const dockedPanels = {
    right: tabGroups.right.tabs,
    bottom: tabGroups.bottom.tabs,
  };

  const getAdjustedDimensions = useCallback(() => {
    return {
      rightOffset: tabGroups.right.tabs.length > 0 ? 400 : 0, // Default panel width
      bottomOffset: tabGroups.bottom.tabs.length > 0 ? 300 : 0, // Default panel height
    };
  }, [tabGroups.right.tabs.length, tabGroups.bottom.tabs.length]);

  const value: DockablePanelContextValue = {
    isProviderActive: true,
    tabGroups,
    panelRegistrations: panelRegistrationsRef.current,
    registerPanel,
    unregisterPanel,
    syncPanelGroup,
    removePanelFromGroups,
    switchTab,
    closeTab,
    reorderTabInGroup,
    movePanelBetweenGroups,
    addPanelToExistingFloatingGroup,
    dragState,
    setDragState,
    panelContentRefsMap,
    notifyContentChange,
    subscribeContentChange,
    lastFocusedGroupKey,
    setLastFocusedGroupKey,
    getLastFocusedPosition,
    focusPanel,
    dockedPanels,
    getAdjustedDimensions,
  };

  const dragPreviewRegistration = dragState
    ? panelRegistrationsRef.current.get(dragState.panelId)
    : null;
  const dragPreviewTitle = dragPreviewRegistration?.title ?? dragState?.panelId ?? '';
  const dragPreviewKindClass = dragPreviewRegistration?.tabKindClass;

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
      if (globalHostNode === node) {
        globalHostNode = null;
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
    <DockablePanelContext.Provider value={value}>
      <DockablePanelHostContext.Provider value={hostNode}>
        {children}
        {dragState ? (
          <div className="dockable-tab-drag-preview" aria-hidden="true">
            {dragPreviewKindClass ? (
              <span className={`dockable-tab-drag-preview__kind kind-badge ${dragPreviewKindClass}`} />
            ) : null}
            <span className="dockable-tab-drag-preview__label">{dragPreviewTitle}</span>
          </div>
        ) : null}
      </DockablePanelHostContext.Provider>
    </DockablePanelContext.Provider>
  );
};
