import type { ClusterLifecycleState } from '@core/contexts/clusterLifecycleState';

const clusterOverviewRefreshableStates = new Set<ClusterLifecycleState>([
  'loading',
  'loading_slow',
  'ready',
]);

export const canActivateClusterOverviewRefresh = (
  lifecycleState: ClusterLifecycleState | undefined
): boolean => {
  return lifecycleState !== undefined && clusterOverviewRefreshableStates.has(lifecycleState);
};

export const shouldSuppressClusterOverviewUnavailableError = (
  lifecycleState: ClusterLifecycleState | undefined,
  error?: string | null
): boolean => {
  if (!error?.includes('no active clusters available')) {
    return false;
  }

  return lifecycleState !== 'ready';
};
