/**
 * frontend/src/core/refresh/hooks/useMetricsAvailability.ts
 *
 * React hook for useMetricsAvailability.
 * Encapsulates state and side effects for the core layer.
 */

import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useEffect, useMemo } from 'react';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { requestRefreshDomain, useScopedRefreshDomainLifecycle } from '@/core/data-access';
import { useRefreshScopedDomain } from '@/core/refresh';
import { canActivateClusterOverviewRefresh } from '@/core/refresh/clusterOverviewLifecycle';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { ClusterOverviewMetrics } from '@/core/refresh/types';

export const useClusterMetricsAvailability = (): ClusterOverviewMetrics | null => {
  const { selectedClusterId } = useKubeconfig();
  const { viewType } = useViewState();
  const { getClusterState } = useClusterLifecycle();
  const lifecycleState = selectedClusterId ? getClusterState(selectedClusterId) : undefined;
  const canActivateOverviewRefresh = canActivateClusterOverviewRefresh(lifecycleState);

  // Metrics for foreground UI should follow the active cluster only.
  const overviewScope = useMemo(
    () => buildClusterRefreshScope('cluster-overview', selectedClusterId),
    [selectedClusterId]
  );

  const overviewDomain = useRefreshScopedDomain('cluster-overview', overviewScope);

  // Keep cluster-overview running for all active views so diagnostics and background
  // metrics stay current regardless of which view type is selected. preserveState keeps
  // the retained overview painted when the lease moves between clusters.
  const shouldEnable =
    (viewType === 'overview' || viewType === 'namespace' || viewType === 'cluster') &&
    canActivateOverviewRefresh;
  useScopedRefreshDomainLifecycle({
    domain: 'cluster-overview',
    scope: overviewScope,
    enabled: shouldEnable,
    preserveState: true,
  });

  useEffect(() => {
    // ClusterOverview handles its own initial refresh; only prime from non-overview views.
    const shouldTrigger = Boolean(overviewScope) && shouldEnable && viewType !== 'overview';
    if (shouldTrigger && !overviewDomain.data && overviewDomain.status === 'idle') {
      void requestRefreshDomain({
        domain: 'cluster-overview',
        scope: overviewScope,
        reason: 'startup',
      });
    }
  }, [overviewDomain.data, overviewDomain.status, overviewScope, shouldEnable, viewType]);

  return overviewDomain.data?.metrics ?? null;
};
