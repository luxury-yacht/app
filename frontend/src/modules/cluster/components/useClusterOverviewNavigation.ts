import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import type { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { DEFAULT_GRID_TABLE_FILTER_STATE } from '@shared/components/tables/gridTableFilterState';
import { requestGridTableFilters } from '@shared/components/tables/hooks/useGridTableExternalFilters';
import { useCallback } from 'react';
import type { useViewState } from '@/core/contexts/ViewStateContext';
import type { ClusterViewType } from '@/types/navigation/views';
import { CLUSTER_ATTENTION_FINDING_TYPES } from '../clusterAttentionFindingTypes';
import type { OverviewPodStatusFilter } from './ClusterOverviewView';

const POD_ATTENTION_FINDINGS: Record<Exclude<OverviewPodStatusFilter, 'none'>, string[]> = {
  starting: [CLUSTER_ATTENTION_FINDING_TYPES.podUnhealthy],
  failing: [CLUSTER_ATTENTION_FINDING_TYPES.errorPresentation],
  terminating: [CLUSTER_ATTENTION_FINDING_TYPES.podUnhealthy],
  restarts: [CLUSTER_ATTENTION_FINDING_TYPES.restarts],
  'not-ready': [CLUSTER_ATTENTION_FINDING_TYPES.podNotReady],
};

type OverviewNavigation = Pick<
  ReturnType<typeof useViewState>,
  | 'setActiveNamespaceTab'
  | 'setActiveClusterView'
  | 'setSidebarSelection'
  | 'navigateToClusterView'
  | 'navigateToNamespace'
>;

interface UseClusterOverviewNavigationInput {
  selectedClusterId: string | null;
  setSelectedNamespace: ReturnType<typeof useNamespace>['setSelectedNamespace'];
  navigation: OverviewNavigation;
}

export const useClusterOverviewNavigation = ({
  selectedClusterId,
  setSelectedNamespace,
  navigation,
}: UseClusterOverviewNavigationInput) => {
  const handlePodStatusNavigate = useCallback(
    (filter: OverviewPodStatusFilter, count: number) => {
      if (count <= 0) {
        return;
      }
      if (filter !== 'none') {
        if (selectedClusterId) {
          requestGridTableFilters({
            clusterId: selectedClusterId,
            destinationViewId: 'cluster-attention',
            filters: {
              ...DEFAULT_GRID_TABLE_FILTER_STATE,
              kinds: { mode: 'some', values: ['Pod'] },
              queryFacets: {
                findings: { mode: 'some', values: POD_ATTENTION_FINDINGS[filter] },
              },
            },
          });
        }
        navigation.setActiveClusterView('attention');
        navigation.navigateToClusterView('cluster');
        navigation.setSidebarSelection({ type: 'cluster', value: 'cluster' });
        return;
      }
      setSelectedNamespace(ALL_NAMESPACES_SCOPE);
      navigation.setActiveNamespaceTab('workloads');
      navigation.setSidebarSelection({ type: 'namespace', value: ALL_NAMESPACES_SCOPE });
      navigation.navigateToNamespace();
    },
    [navigation, selectedClusterId, setSelectedNamespace]
  );

  const handleClusterViewNavigate = useCallback(
    (view: ClusterViewType) => {
      navigation.setActiveClusterView(view);
      navigation.navigateToClusterView('cluster');
      navigation.setSidebarSelection({ type: 'cluster', value: 'cluster' });
    },
    [navigation]
  );

  return { handlePodStatusNavigate, handleClusterViewNavigate };
};
