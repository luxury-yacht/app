/**
 * frontend/src/core/refresh/hooks/useMetricsAvailability.ts
 *
 * React hook for useMetricsAvailability.
 * Encapsulates state and side effects for the core layer.
 */

import { useEffect, useMemo } from 'react';
import { requestRefreshDomain } from '@/core/data-access';
import { refreshOrchestrator, useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { canActivateClusterOverviewRefresh } from '@/core/refresh/clusterOverviewLifecycle';
import { useViewState } from '@/core/contexts/ViewStateContext';
import type { ClusterOverviewMetrics } from '@/core/refresh/types';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';

export const useClusterMetricsAvailability = (): ClusterOverviewMetrics | null => {
  const { selectedClusterId } = useKubeconfig();
  const { viewType } = useViewState();
  const { getClusterState } = useClusterLifecycle();
  const lifecycleState = selectedClusterId ? getClusterState(selectedClusterId) : '';
  const canActivateOverviewRefresh = canActivateClusterOverviewRefresh(lifecycleState);

  // Metrics for foreground UI should follow the active cluster only.
  const overviewScope = useMemo(
    () => buildClusterScope(selectedClusterId ?? undefined, ''),
    [selectedClusterId]
  );

  const overviewDomain = useRefreshScopedDomain('cluster-overview', overviewScope);

  useEffect(() => {
    // Skip scoped calls when no clusters are connected (scope is empty).
    if (!overviewScope) {
      return;
    }

    // Keep cluster-overview running for all active views so diagnostics and background
    // metrics stay current regardless of which view type is selected.
    const shouldEnable =
      (viewType === 'overview' || viewType === 'namespace' || viewType === 'cluster') &&
      canActivateOverviewRefresh;
    refreshOrchestrator.setScopedDomainEnabled('cluster-overview', overviewScope, shouldEnable);

    const shouldTrigger = shouldEnable && viewType !== 'overview';
    // ClusterOverview handles its own initial refresh; only prime from non-overview views.
    if (shouldTrigger && !overviewDomain.data && overviewDomain.status === 'idle') {
      void requestRefreshDomain({
        domain: 'cluster-overview',
        scope: overviewScope,
        reason: 'startup',
      });
    }
  }, [
    canActivateOverviewRefresh,
    overviewDomain.data,
    overviewDomain.status,
    overviewScope,
    viewType,
  ]);

  const metricsByCluster = overviewDomain.data?.metricsByCluster;
  if (metricsByCluster) {
    return selectedClusterId ? (metricsByCluster[selectedClusterId] ?? null) : null;
  }
  return overviewDomain.data?.metrics ?? null;
};
