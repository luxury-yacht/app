/**
 * frontend/src/core/refresh/hooks/useMetricsAvailability.ts
 *
 * React hook for useMetricsAvailability.
 * Encapsulates state and side effects for the core layer.
 */

import { useEffect } from 'react';
import { refreshOrchestrator, useRefreshDomain } from '@/core/refresh';
import type { ClusterOverviewMetrics } from '@/core/refresh/types';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';

export const useClusterMetricsAvailability = (): ClusterOverviewMetrics | null => {
  const overviewDomain = useRefreshDomain('cluster-overview');
  const { selectedClusterId } = useKubeconfig();

  useEffect(() => {
    refreshOrchestrator.setDomainEnabled('cluster-overview', true);

    if (!overviewDomain.data && overviewDomain.status === 'idle') {
      void refreshOrchestrator.triggerManualRefresh('cluster-overview', { suppressSpinner: true });
    }
  }, [overviewDomain.data, overviewDomain.status]);

  const metricsByCluster = overviewDomain.data?.metricsByCluster;
  if (metricsByCluster && selectedClusterId) {
    return metricsByCluster[selectedClusterId] ?? overviewDomain.data?.metrics ?? null;
  }
  return overviewDomain.data?.metrics ?? null;
};
