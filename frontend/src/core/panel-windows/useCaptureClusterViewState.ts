import { useCallback } from 'react';
import { useSidebarState } from '@/core/contexts/SidebarStateContext';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { useNamespace } from '@/modules/namespace/contexts/NamespaceContext';
import { captureClusterTableState } from '@/shared/components/tables/persistence/gridTablePersistence';
import type { ClusterViewState } from './clusterViewState';

export function useCaptureClusterViewState() {
  const { getClusterNavigationState } = useViewState();
  const { getClusterSidebarSelection } = useSidebarState();
  const { getClusterNamespace } = useNamespace();
  return useCallback(
    async (clusterId: string): Promise<ClusterViewState> => ({
      clusterId,
      navigation: getClusterNavigationState(clusterId),
      sidebar: getClusterSidebarSelection(clusterId),
      namespace: getClusterNamespace(clusterId),
      tables: await captureClusterTableState(clusterId),
    }),
    [getClusterNavigationState, getClusterSidebarSelection, getClusterNamespace]
  );
}
