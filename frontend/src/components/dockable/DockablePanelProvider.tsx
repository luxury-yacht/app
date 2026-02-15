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
import {
  createInitialTabGroupState,
  addPanelToGroup,
  removePanelFromGroup,
  setActiveTab,
  reorderTab,
  movePanelToGroup,
  addPanelToFloatingGroup,
} from './tabGroupState';

interface DockablePanelContextValue {
  // Tab group state
  tabGroups: TabGroupState;

  // Panel registrations (metadata like title, callbacks)
  panelRegistrations: Map<string, PanelRegistration>;

  // Register/unregister panels -- called by DockablePanel components
  registerPanel: (registration: PanelRegistration) => void;
  unregisterPanel: (panelId: string) => void;

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

  // Legacy compat -- derived from tabGroups for backward compatibility
  dockedPanels: { right: string[]; bottom: string[] };
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
  panelContentRefsMap: { current: new Map() },
  notifyContentChange: () => {},
  subscribeContentChange: () => () => {},
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

  // -----------------------------------------------------------------------
  // registerPanel -- called by DockablePanel when it mounts / becomes open.
  // Accepts a PanelRegistration object with panelId, position, title, etc.
  // -----------------------------------------------------------------------
  const registerPanel = useCallback((registration: PanelRegistration) => {
    // Store the registration metadata.
    panelRegistrationsRef.current.set(registration.panelId, registration);

    // Add the panel to the appropriate tab group.
    setTabGroups((prev) => addPanelToGroup(prev, registration.panelId, registration.position));

    // Bump the counter so consumers see the new registration.
    setRegistrationBump((n) => n + 1);
  }, []);

  // -----------------------------------------------------------------------
  // unregisterPanel -- called by DockablePanel when it unmounts / closes.
  // -----------------------------------------------------------------------
  const unregisterPanel = useCallback((panelId: string) => {
    panelRegistrationsRef.current.delete(panelId);

    // Remove the panel from whichever tab group it belongs to.
    setTabGroups((prev) => removePanelFromGroup(prev, panelId));

    // Bump the counter so consumers see the removal.
    setRegistrationBump((n) => n + 1);
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

    // Fire the panel's onClose callback if it has one.
    registration?.onClose?.();
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
    tabGroups,
    panelRegistrations: panelRegistrationsRef.current,
    registerPanel,
    unregisterPanel,
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
    dockedPanels,
    getAdjustedDimensions,
  };

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
      </DockablePanelHostContext.Provider>
    </DockablePanelContext.Provider>
  );
};
