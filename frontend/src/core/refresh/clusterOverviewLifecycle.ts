import {
  type ClusterLifecycleState,
  isClusterOperationalState,
} from '@core/contexts/clusterLifecycleState';
import type { RefreshFailure } from './refreshFailure';

const clusterOverviewRefreshableStates = new Set<ClusterLifecycleState>([
  'loading',
  'loading_slow',
  'degraded',
  'ready',
]);

export const canActivateClusterOverviewRefresh = (
  lifecycleState: ClusterLifecycleState | undefined
): boolean => {
  return lifecycleState !== undefined && clusterOverviewRefreshableStates.has(lifecycleState);
};

// The backend answers ClusterNotReady while the cluster's refresh subsystem
// is still starting; until the cluster is operational that is warm-up.
export const shouldSuppressClusterOverviewUnavailableError = (
  lifecycleState: ClusterLifecycleState | undefined,
  failure?: RefreshFailure | null
): boolean =>
  failure?.kind === 'backend' &&
  failure.status.reason === 'ClusterNotReady' &&
  !isClusterOperationalState(lifecycleState);
