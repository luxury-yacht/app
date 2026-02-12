/**
 * frontend/src/core/refresh/hooks/useMetricsAvailability.ts
 *
 * React hook for useMetricsAvailability.
 * Encapsulates state and side effects for the core layer.
 */

import { useEffect, useMemo } from 'react';
import { refreshOrchestrator, useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterScopeList } from '@/core/refresh/clusterScope';
import { useViewState } from '@/core/contexts/ViewStateContext';
import type { ClusterOverviewMetrics } from '@/core/refresh/types';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

export const useClusterMetricsAvailability = (): ClusterOverviewMetrics | null => {
  const { selectedClusterId, selectedClusterIds } = useKubeconfig();
  const { viewType } = useViewState();

  // Build scope covering all connected clusters for the cluster-overview domain.
  const overviewScope = useMemo(
    () => buildClusterScopeList(selectedClusterIds, ''),
    [selectedClusterIds]
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
      viewType === 'overview' || viewType === 'namespace' || viewType === 'cluster';
    refreshOrchestrator.setScopedDomainEnabled('cluster-overview', overviewScope, shouldEnable);

    const shouldTrigger = shouldEnable && viewType !== 'overview';
    // ClusterOverview handles its own initial refresh; only prime from non-overview views.
    if (shouldTrigger && !overviewDomain.data && overviewDomain.status === 'idle') {
      void refreshOrchestrator.fetchScopedDomain('cluster-overview', overviewScope, { isManual: true });
    }
  }, [overviewDomain.data, overviewDomain.status, overviewScope, viewType]);

  const metricsByCluster = overviewDomain.data?.metricsByCluster;
  if (metricsByCluster) {
    return selectedClusterId ? (metricsByCluster[selectedClusterId] ?? null) : null;
  }
  return overviewDomain.data?.metrics ?? null;
};
