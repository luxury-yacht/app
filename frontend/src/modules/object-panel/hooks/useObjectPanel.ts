/**
 * frontend/src/modules/object-panel/hooks/useObjectPanel.ts
 *
 * Combines dockable panel UI state with object panel business logic from context.
 * Supports the multi-panel model: each object opens as its own tab.
 *
 * Also provides CurrentObjectPanelContext so child components inside an ObjectPanel
 * instance can access the correct objectData for their specific panel.
 */
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import { useDockablePanelContext } from '@ui/dockable';
import { useObjectPanelState } from '@/core/contexts/ObjectPanelStateContext';
import { assertObjectRefHasGVK, type KubernetesObjectReference } from '@/types/view-state';
import { getGroupForPanel } from '@ui/dockable/tabGroupState';
import type { ViewType } from '@modules/object-panel/components/ObjectPanel/types';

export interface OpenWithObjectOptions {
  /**
   * Sub-tab to activate after the panel opens. Used by callers like
   * the workloads "Object Map" right-click action that want to land on
   * a specific tab instead of Details.
   */
  initialTab?: ViewType;
}

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
// closeObjectPanelGlobal  (test-only)
// ---------------------------------------------------------------------------

// Module-level callback used by closeObjectPanelGlobal(). In a multi-panel
// scenario only the last-mounted useObjectPanel() instance sets this, so
// it is NOT safe for production use with concurrent panels. It exists
// solely to allow tests to close the panel from outside the React tree.
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
    setObjectPanelActiveTab,
  } = useObjectPanelState();
  const { tabGroups, focusPanel } = useDockablePanelContext();

  // Per-instance object data (only set when called inside an ObjectPanel tree).
  const { objectData, panelId: currentPanelId } = useCurrentObjectPanel();
  const pendingFocusPanelIdRef = useRef<string | null>(null);

  // Keep the close callback updated for closeObjectPanelGlobal (test-only).
  // Last mount wins — not safe for concurrent multi-panel production use.
  const closeRef = useRef(onCloseObjectPanel);
  closeRef.current = onCloseObjectPanel;

  useEffect(() => {
    closeCallback = () => closeRef.current();
    return () => {
      closeCallback = null;
    };
  }, []);

  useEffect(() => {
    const pendingPanelId = pendingFocusPanelIdRef.current;
    if (!pendingPanelId) {
      return;
    }
    if (!getGroupForPanel(tabGroups, pendingPanelId)) {
      return;
    }
    pendingFocusPanelIdRef.current = null;
    focusPanel(pendingPanelId);
  }, [tabGroups, focusPanel]);

  const openWithObject = useCallback(
    (obj: KubernetesObjectReference, options?: OpenWithObjectOptions) => {
      const enriched = hydrateClusterMeta(obj);
      // Runtime defense for the kind-only-objects bug. Catches programmatic
      // ref constructions (helpers, mappers, destructure-and-rebuild) that
      // the openWithObjectAudit literal-walker can't see. Throws loudly
      // with a stack trace at the panel's entry point — much earlier than
      // the backend hard-errors at object_detail_provider.go,
      // app_capabilities.go, and app_permissions.go would surface it.
      assertObjectRefHasGVK(enriched);
      const panelId = onRowClick(enriched);

      // Set the requested initial tab BEFORE focusing so the panel
      // mounts on the right tab instead of flashing Details first. The
      // active-tab map is per-panel sticky state, so calling this for
      // a re-opened panel will also override the user's last selection
      // — which is what we want for "right-click → Object Map".
      if (options?.initialTab) {
        setObjectPanelActiveTab(panelId, options.initialTab);
      }

      // If the panel already exists in the dockable system, activate its tab
      // and bring the panel to the front. Newly-created panels join the
      // dockable group after their component mounts, so focus them from the
      // tabGroups effect above once the tab actually exists.
      const groupKey = getGroupForPanel(tabGroups, panelId);
      if (groupKey) {
        pendingFocusPanelIdRef.current = null;
        focusPanel(panelId);
      } else {
        pendingFocusPanelIdRef.current = panelId;
      }
    },
    [onRowClick, hydrateClusterMeta, tabGroups, focusPanel, setObjectPanelActiveTab]
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
 * Used by tests to reset panel state.
 */
export function closeObjectPanelGlobal() {
  closeCallback?.();
}
