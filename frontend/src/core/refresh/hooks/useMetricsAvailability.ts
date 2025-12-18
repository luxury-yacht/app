import { useEffect } from 'react';
import { refreshOrchestrator, useRefreshDomain } from '@/core/refresh';
import type { ClusterOverviewMetrics } from '@/core/refresh/types';

export const useClusterMetricsAvailability = (): ClusterOverviewMetrics | null => {
  const overviewDomain = useRefreshDomain('cluster-overview');

  useEffect(() => {
    refreshOrchestrator.setDomainEnabled('cluster-overview', true);

    if (!overviewDomain.data && overviewDomain.status === 'idle') {
      void refreshOrchestrator.triggerManualRefresh('cluster-overview', { suppressSpinner: true });
    }
  }, [overviewDomain.data, overviewDomain.status]);

  return overviewDomain.data?.metrics ?? null;
};
