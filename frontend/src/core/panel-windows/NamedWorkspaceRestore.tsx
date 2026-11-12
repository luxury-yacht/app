import { useCallback, useEffect, useRef, useState } from 'react';
import { AcknowledgeNamedWorkspaceRestore } from '@/core/backend-api';
import type { panelwindow } from '@/core/backend-api/models';
import { useSidebarState } from '@/core/contexts/SidebarStateContext';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { getWindowIdentity, onEvent } from '@/core/desktop-runtime';
import { restoreWindowClusterTabOrder } from '@/core/persistence/clusterTabOrder';
import { GLOBAL_TABLE_OWNERS } from '@/modules/global/globalTableOwner';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@/modules/namespace/contexts/NamespaceContext';
import { useObjectPanelState } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import {
  restoreClusterTableState,
  restoreWorkspaceTableState,
} from '@/shared/components/tables/persistence/gridTablePersistence';
import { parseGlobalViewType } from '@/types/navigation/views';
import { useDockablePanelContext } from '@/ui/dockable';
import { reportOperationalError } from '@/utils/errorHandler';
import { decodeClusterViewState } from './clusterViewState';
import { workspaceFailureReason } from './useNamedWorkspaceCapture';
import { useNamedWorkspaceNotice } from './useNamedWorkspaceNotice';
import { useRestoreWorkspacePanels } from './useRestoreWorkspacePanels';

type SavedWindow = panelwindow.NamedWorkspaceAppWindow;

async function restoreTables(saved: SavedWindow) {
  const states = (saved.clusterTabs ?? []).map((tab) =>
    decodeClusterViewState(JSON.stringify(tab.viewState), tab.clusterId)
  );
  // Each cluster's tables are restored independently of the others.
  await Promise.all(states.map((state) => restoreClusterTableState(state.clusterId, state.tables)));
  if (saved.globalView) {
    await restoreWorkspaceTableState(
      Object.values(GLOBAL_TABLE_OWNERS).map(({ identity }) => identity),
      saved.globalView.tables ?? {}
    );
  }
  return states;
}

export function NamedWorkspaceRestore() {
  const name = getWindowIdentity();
  useNamedWorkspaceNotice(name);
  const { getClusterMeta, selectedKubeconfigs, setActiveKubeconfig } = useKubeconfig();
  const { restoreClusterNavigationState, navigateToGlobal } = useViewState();
  const { setSidebarSelectionForCluster } = useSidebarState();
  const { setSelectedNamespace } = useNamespace();
  const { updateClusterGroupLayout } = useDockablePanelContext();
  const { panelIdsForCluster } = useObjectPanelState();
  const restorePanels = useRestoreWorkspacePanels();
  const [mounted, setMounted] = useState<SavedWindow | null>(null);
  const started = useRef(false);
  const restoreDock = useCallback(
    (dock: panelwindow.NamedWorkspaceDockedGroup) => {
      const { group, width, height } = dock;
      const edge = group.groupId === 'bottom' ? 'bottom' : 'right';
      restorePanels(group, edge);
      updateClusterGroupLayout(group.clusterId, edge, {
        ...(edge === 'right'
          ? { rightSize: { width, height } }
          : { bottomSize: { width, height } }),
        isMaximized: dock.maximized,
        isInitialized: true,
      });
    },
    [restorePanels, updateClusterGroupLayout]
  );
  const apply = useCallback(
    async (saved: SavedWindow) => {
      const states = await restoreTables(saved);
      const selectionById = new Map(
        selectedKubeconfigs.map((selection) => [getClusterMeta(selection).id, selection])
      );
      const order = states.map(({ clusterId }) => {
        const selection = selectionById.get(clusterId);
        if (!selection) {
          throw new Error(`Saved cluster ${clusterId} could not be opened`);
        }
        return selection;
      });
      restoreWindowClusterTabOrder(order);
      for (const state of states) {
        restoreClusterNavigationState(state.clusterId, state.navigation);
        setSidebarSelectionForCluster(state.clusterId, state.sidebar);
        if (state.namespace !== undefined) {
          setSelectedNamespace(state.namespace, state.clusterId);
        }
      }
      const active = selectionById.get(saved.selectedClusterId ?? '');
      if (active) {
        setActiveKubeconfig(active);
      }
      const globalView = saved.globalView && parseGlobalViewType(saved.globalView.view);
      if (globalView) {
        navigateToGlobal(globalView);
      }
      for (const dock of saved.dockedGroups ?? []) {
        restoreDock(dock);
      }
      setMounted(saved);
    },
    [
      getClusterMeta,
      navigateToGlobal,
      restoreClusterNavigationState,
      restoreDock,
      selectedKubeconfigs,
      setActiveKubeconfig,
      setSelectedNamespace,
      setSidebarSelectionForCluster,
    ]
  );

  useEffect(
    () =>
      onEvent('named-workspace:restore', (event) => {
        if (event.windowName !== name || started.current) {
          return;
        }
        started.current = true;
        void apply(event.window)
          .catch((error) => AcknowledgeNamedWorkspaceRestore(name, workspaceFailureReason(error)))
          .catch((error) =>
            reportOperationalError(error, { source: 'NamedWorkspace', action: 'restore' })
          );
      }),
    [apply, name]
  );

  useEffect(() => {
    if (!mounted) {
      return;
    }
    const panelsReady = (mounted.dockedGroups ?? []).every(({ group }) => {
      const ids = panelIdsForCluster(group.clusterId);
      return (group.tabs ?? []).every(({ panelId }) => ids.includes(panelId));
    });
    if (!panelsReady) {
      return;
    }
    setMounted(null);
    void AcknowledgeNamedWorkspaceRestore(name, '').catch((error) =>
      reportOperationalError(error, { source: 'NamedWorkspace', action: 'acknowledgeRestore' })
    );
  }, [mounted, name, panelIdsForCluster]);

  return null;
}
