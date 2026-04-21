import type { ClusterLifecycleState } from '@core/contexts/ClusterLifecycleContext';

const clusterOverviewRefreshableStates = new Set<ClusterLifecycleState>([
  'loading',
  'loading_slow',
  'ready',
]);

export const canActivateClusterOverviewRefresh = (
  lifecycleState: ClusterLifecycleState
): boolean => {
  return clusterOverviewRefreshableStates.has(lifecycleState);
};

export const shouldSuppressClusterOverviewUnavailableError = (
  lifecycleState: ClusterLifecycleState,
  error?: string | null
): boolean => {
  if (!error?.includes('no active clusters available')) {
    return false;
  }

  return lifecycleState !== 'ready';
};
