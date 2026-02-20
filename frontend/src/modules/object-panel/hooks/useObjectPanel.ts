/**
 * frontend/src/modules/object-panel/hooks/useObjectPanel.ts
 *
 * Hook for useObjectPanel.
 * Combines dockable panel UI state with object panel business logic from context.
 * Supports the multi-panel model: each object opens as its own tab.
 *
 * Also provides CurrentObjectPanelContext so child components inside an ObjectPanel
 * instance can access the correct objectData for their specific panel.
 */
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { useDockablePanelContext } from '@ui/dockable';
import { useObjectPanelState } from '@/core/contexts/ObjectPanelStateContext';
import type { KubernetesObjectReference } from '@/types/view-state';
import { getGroupForPanel } from '@ui/dockable/tabGroupState';

// ---------------------------------------------------------------------------
// CurrentObjectPanelContext
// ---------------------------------------------------------------------------

/**
 * Per-instance context provided by each ObjectPanel so its children
 * (e.g., Overview components) can access the correct objectData
 * without relying on a single global selected object.
 */
interface CurrentObjectPanelContextValue {
  objectData: KubernetesObjectReference | null;
  panelId: string | null;
}

export const CurrentObjectPanelContext = createContext<CurrentObjectPanelContextValue>({
  objectData: null,
  panelId: null,
});

// Read the current panel's object data. Only meaningful inside a <ObjectPanel> tree.
const useCurrentObjectPanel = () => useContext(CurrentObjectPanelContext);

// ---------------------------------------------------------------------------
// closeObjectPanelGlobal
// ---------------------------------------------------------------------------

// Callback ref for closeObjectPanelGlobal to use
let closeCallback: (() => void) | null = null;

// ---------------------------------------------------------------------------
// useObjectPanel
// ---------------------------------------------------------------------------

/**
 * Hook for controlling the object panel system.
 * In the multi-panel model, this hook provides:
 * - openWithObject: opens a new tab (or activates existing) for a given object
 * - close: closes the current panel (when used inside an ObjectPanel)
 * - objectData: the object for the current panel context (when inside an ObjectPanel)
 * - openPanels: all open panels from context
 */
export function useObjectPanel() {
  const {
    showObjectPanel,
    openPanels,
    onRowClick,
    closePanel,
    onCloseObjectPanel,
    hydrateClusterMeta,
  } = useObjectPanelState();
  const { tabGroups, focusPanel } = useDockablePanelContext();

  // Per-instance object data (only set when called inside an ObjectPanel tree).
  const { objectData, panelId: currentPanelId } = useCurrentObjectPanel();

  // Keep the close callback updated for closeObjectPanelGlobal
  const closeRef = useRef(onCloseObjectPanel);
  closeRef.current = onCloseObjectPanel;

  useEffect(() => {
    closeCallback = () => closeRef.current();
    return () => {
      closeCallback = null;
    };
  }, []);

  const openWithObject = useCallback(
    (obj: KubernetesObjectReference) => {
      const enriched = hydrateClusterMeta(obj);
      const panelId = onRowClick(enriched);

      // If the panel already exists in the dockable system, activate its tab
      // and bring the panel to the front.
      const groupKey = getGroupForPanel(tabGroups, panelId);
      if (groupKey) {
        focusPanel(panelId);
      }
    },
    [onRowClick, hydrateClusterMeta, tabGroups, focusPanel]
  );

  const close = useCallback(() => {
    if (currentPanelId) {
      // Close just this panel.
      closePanel(currentPanelId);
    } else {
      // No panel context -- close all panels (legacy behavior).
      onCloseObjectPanel();
    }
  }, [currentPanelId, closePanel, onCloseObjectPanel]);

  return {
    // Object data for the current panel instance (null outside an ObjectPanel tree).
    objectData,
    // Whether any object panel is open.
    isOpen: showObjectPanel,
    // All open panels.
    openPanels,
    // Open or activate a tab for an object.
    openWithObject,
    // Close the current panel (or all panels if outside ObjectPanel tree).
    close,
  };
}

/**
 * Close the object panel from outside of React components.
 * Prefer using the close() method from useObjectPanel() when possible.
 *
 * This is lintignored because it's only used by tests.
 */
/** @lintignore */
export function closeObjectPanelGlobal() {
  closeCallback?.();
}
