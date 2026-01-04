/**
 * frontend/src/core/refresh/hooks/useMetricsAvailability.ts
 *
 * React hook for useMetricsAvailability.
 * Encapsulates state and side effects for the core layer.
 */

import { useEffect } from 'react';
import { refreshOrchestrator, useRefreshDomain } from '@/core/refresh';
import { useViewState } from '@/core/contexts/ViewStateContext';
import type { ClusterOverviewMetrics } from '@/core/refresh/types';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

export const useClusterMetricsAvailability = (): ClusterOverviewMetrics | null => {
  const overviewDomain = useRefreshDomain('cluster-overview');
  const { selectedClusterId } = useKubeconfig();
  const { viewType } = useViewState();

  useEffect(() => {
    const shouldEnable = viewType === 'overview' || viewType === 'namespace';
    // Gate overview metrics refreshes to views that surface metrics to avoid background polling.
    refreshOrchestrator.setDomainEnabled('cluster-overview', shouldEnable);

    const shouldTrigger = shouldEnable && viewType !== 'overview';
    // ClusterOverview handles its own initial refresh; only prime from non-overview views.
    if (shouldTrigger && !overviewDomain.data && overviewDomain.status === 'idle') {
      void refreshOrchestrator.triggerManualRefresh('cluster-overview', { suppressSpinner: true });
    }
  }, [overviewDomain.data, overviewDomain.status, viewType]);

  const metricsByCluster = overviewDomain.data?.metricsByCluster;
  if (metricsByCluster) {
    return selectedClusterId ? (metricsByCluster[selectedClusterId] ?? null) : null;
  }
  return overviewDomain.data?.metrics ?? null;
};
