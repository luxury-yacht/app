/**
 * frontend/src/modules/object-panel/hooks/useObjectPanel.ts
 *
 * Combines dockable panel UI state with object panel business logic from context.
 * Supports the multi-panel model: each object opens as its own tab.
 *
 * Also provides CurrentObjectPanelContext so child components inside an ObjectPanel
 * instance can access the correct objectData for their specific panel.
 */

import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import type { ViewType } from '@modules/object-panel/components/ObjectPanel/types';
import { useObjectPanelState } from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { type ObjectPanelRef, objectPanelId } from '@modules/object-panel/objectPanelRef';
import { assertObjectRefHasRequiredIdentity } from '@shared/utils/objectIdentity';
import { useDockablePanelContext } from '@ui/dockable';
import { getGroupForPanel } from '@ui/dockable/tabGroupState';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';
import type { panelwindow } from '@/core/backend-api/models';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { openPanelWorkspaceObject } from '@/core/panel-windows';
import { usePanelWindowRole } from '@/core/panel-windows/PanelWindowRoleContext';
import { objectPanelTabSnapshot } from '@/core/panel-windows/tabTransfer';
import { getDefaultObjectPanelPosition } from '@/core/settings/appPreferences';
import type { KubernetesObjectReference } from '@/types/view-state';
import { reportOperationalError } from '@/utils/errorHandler';

export interface OpenWithObjectOptions {
  /**
   * Sub-tab to activate after the panel opens. Used by callers like
   * the workloads "Map" right-click action that want to land on
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
  objectData: ObjectPanelRef | null;
  panelId: string | null;
  // Object creation time (RFC3339 UTC) for the current object. The shared
  // ResourceHeader formats it into Age for every kind. Empty/absent when the
  // backend can't determine it.
  creationTimestamp?: string | null;
  // Relative "last modified" time for the current object (managedFields-derived,
  // same format as Age). Empty/absent when the backend can't determine it.
  lastModified?: string | null;
}

export const CurrentObjectPanelContext = createContext<CurrentObjectPanelContextValue>({
  objectData: null,
  panelId: null,
  creationTimestamp: null,
  lastModified: null,
});

// Read the current panel's object data. Only meaningful inside a <ObjectPanel> tree.
export const useCurrentObjectPanel = () => useContext(CurrentObjectPanelContext);

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
    getOwnedPanel,
  } = useObjectPanelState();
  const { selectedClusterId, selectedKubeconfigs, getClusterMeta, setActiveKubeconfig } =
    useKubeconfig();
  const { tabGroups, focusPanel, requestGroupMove } = useDockablePanelContext();
  const panelWindowRole = usePanelWindowRole();

  // Per-instance object data (only set when called inside an ObjectPanel tree).
  const {
    objectData,
    panelId: currentPanelId,
    creationTimestamp,
    lastModified,
  } = useCurrentObjectPanel();
  const pendingFocusPanelIdRef = useRef<string | null>(null);
  const pendingFloatPanelIdRef = useRef<string | null>(null);

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

  useEffect(() => {
    const panelId = pendingFloatPanelIdRef.current;
    if (!panelId) {
      return;
    }
    const groupKey = getGroupForPanel(tabGroups, panelId);
    if (!groupKey || !requestGroupMove?.(groupKey, 'floating')) {
      return;
    }
    pendingFloatPanelIdRef.current = null;
  }, [requestGroupMove, tabGroups]);

  const activateObjectCluster = useCallback(
    (clusterId: string): boolean => {
      if (clusterId !== selectedClusterId) {
        const targetSelection = selectedKubeconfigs.find(
          (selection) => getClusterMeta(selection).id === clusterId
        );
        if (!targetSelection) {
          reportOperationalError(new Error(`Object panel cluster is not open: ${clusterId}`), {
            source: 'useObjectPanel',
            action: 'activate-object-panel-cluster',
            clusterId,
          });
          return false;
        }
        setActiveKubeconfig(targetSelection);
      }

      return true;
    },
    [selectedClusterId, selectedKubeconfigs, getClusterMeta, setActiveKubeconfig]
  );

  const focusOpenedPanel = useCallback(
    (panelId: string) => {
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
    [tabGroups, focusPanel]
  );

  const updateExistingPanelView = useCallback(
    (clusterId: string, panelId: string, initialTab?: ViewType) => {
      if (initialTab) {
        setObjectPanelActiveTab(clusterId, panelId, initialTab);
      }
    },
    [setObjectPanelActiveTab]
  );

  const mountSharedPanel = useCallback(
    (
      tab: panelwindow.TabSnapshot,
      enriched: KubernetesObjectReference,
      shouldAutoFloat: boolean,
      requestedView?: ViewType
    ) => {
      const panelId = objectPanelId(enriched);
      if (!activateObjectCluster(tab.objectRef.clusterId)) {
        return;
      }
      onRowClick({ ...enriched, ...tab.objectRef }, { pendingNativeOpen: shouldAutoFloat });
      // Set the requested initial tab in the same React batch as the open so
      // the panel mounts on that tab instead of flashing Details first.
      setObjectPanelActiveTab(
        tab.objectRef.clusterId,
        panelId,
        (requestedView ?? tab.activeView) as ViewType
      );
      if (shouldAutoFloat) {
        pendingFloatPanelIdRef.current = panelId;
      }

      focusOpenedPanel(panelId);
    },
    [activateObjectCluster, onRowClick, setObjectPanelActiveTab, focusOpenedPanel]
  );

  const openWithObject = useCallback(
    (obj: KubernetesObjectReference, options?: OpenWithObjectOptions) => {
      const enriched = hydrateClusterMeta(obj);
      // Runtime defense for incomplete object refs. Catches programmatic ref
      // constructions that the openWithObjectAudit literal walker can't see.
      assertObjectRefHasRequiredIdentity(enriched);
      const panelId = objectPanelId(enriched);
      const ownedPanel = getOwnedPanel(enriched.clusterId, panelId);
      const requestedView = options?.initialTab;
      const shouldAutoFloat =
        !panelWindowRole && ownedPanel === null && getDefaultObjectPanelPosition() === 'floating';

      void openPanelWorkspaceObject(
        getWindowIdentity(),
        objectPanelTabSnapshot(panelId, enriched, options?.initialTab ?? 'details')
      )
        .then((result) => {
          if (!result.render) {
            if (ownedPanel) {
              updateExistingPanelView(enriched.clusterId, panelId, requestedView);
            }
            return;
          }

          mountSharedPanel(result.panel.tab, enriched, shouldAutoFloat, requestedView);
        })
        .catch((error) =>
          reportOperationalError(error, {
            source: 'useObjectPanel',
            action: 'open-shared-cluster-panel',
            clusterId: enriched.clusterId,
          })
        );
    },
    [hydrateClusterMeta, getOwnedPanel, panelWindowRole, updateExistingPanelView, mountSharedPanel]
  );

  const close = useCallback(() => {
    if (currentPanelId && objectData?.clusterId) {
      // Close just this panel.
      closePanel(objectData.clusterId, currentPanelId);
    } else {
      // No panel context -- close all panels (legacy behavior).
      onCloseObjectPanel();
    }
  }, [currentPanelId, objectData?.clusterId, closePanel, onCloseObjectPanel]);

  return {
    // Object data for the current panel instance (null outside an ObjectPanel tree).
    objectData,
    panelId: currentPanelId,
    // Object creation time (RFC3339 UTC) for the current object (when available);
    // the shared ResourceHeader formats it into Age.
    creationTimestamp,
    // Relative "last modified" time for the current object (when available).
    lastModified,
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
