import { useCallback } from 'react';
import type { panelwindow } from '@/core/backend-api/models';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { getClusterTabOrder, mergeClusterTabOrder } from '@/core/persistence/clusterTabOrder';
import { GLOBAL_TABLE_OWNERS } from '@/modules/global/globalTableOwner';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import { captureClusterTableState } from '@/shared/components/tables/persistence/gridTablePersistence';
import { useDockablePanelContext } from '@/ui/dockable';
import { useCaptureClusterViewState } from './useCaptureClusterViewState';
import { useNamedWorkspaceCapture } from './useNamedWorkspaceCapture';
import { usePanelWorkspaceSync } from './WorkspacePanelSync';

async function captureGlobalTables() {
  const snapshots = await Promise.all(
    Object.values(GLOBAL_TABLE_OWNERS).map(({ identity }) => captureClusterTableState(identity))
  );
  return Object.assign({}, ...snapshots);
}

export function NamedWorkspaceCapture() {
  const { selectedKubeconfigs, selectedClusterId, getClusterMeta } = useKubeconfig();
  const { viewType, activeGlobalTab } = useViewState();
  const { getClusterGroupLayout } = useDockablePanelContext();
  const captureCluster = useCaptureClusterViewState();
  const sync = usePanelWorkspaceSync();
  const capture = useCallback(async (): Promise<panelwindow.NamedWorkspaceAppView> => {
    await sync.flush();
    const ordered = mergeClusterTabOrder(selectedKubeconfigs, getClusterTabOrder());
    const clusterIds = ordered.map((selection) => getClusterMeta(selection).id);
    const clusterTabs = await Promise.all(
      clusterIds.map(async (clusterId) => ({
        clusterId,
        viewState: await captureCluster(clusterId),
      }))
    );
    const dockedGroups = clusterIds.flatMap((clusterId) =>
      sync.groupsForCluster(clusterId).map((group) => {
        const dock = group.groupId === 'bottom' ? 'bottom' : 'right';
        const layout = getClusterGroupLayout(clusterId, dock);
        const size = dock === 'bottom' ? layout.bottomSize : layout.rightSize;
        return { group, ...size, maximized: layout.isMaximized };
      })
    );
    const globalView =
      viewType === 'global'
        ? { view: activeGlobalTab, tables: await captureGlobalTables() }
        : undefined;
    return { selectedClusterId, clusterTabs, dockedGroups, globalView };
  }, [
    activeGlobalTab,
    captureCluster,
    getClusterGroupLayout,
    getClusterMeta,
    selectedClusterId,
    selectedKubeconfigs,
    sync,
    viewType,
  ]);
  useNamedWorkspaceCapture(getWindowIdentity(), capture);
  return null;
}
