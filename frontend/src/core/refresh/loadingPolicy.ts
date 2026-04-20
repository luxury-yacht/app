export interface PassiveLoadingPolicyInput {
  loading: boolean;
  hasLoaded: boolean;
  hasData?: boolean;
  isPaused: boolean;
  isManualRefreshActive: boolean;
}

export interface PassiveLoadingPolicyResult {
  loading: boolean;
  hasLoaded: boolean;
  suppressPassiveLoading: boolean;
  showPausedEmptyState: boolean;
}

export const CLUSTER_DATA_AUTO_REFRESH_DISABLED_MESSAGE = 'Auto-refresh is disabled';

export const applyPassiveLoadingPolicy = ({
  loading,
  hasLoaded,
  hasData = false,
  isPaused,
  isManualRefreshActive,
}: PassiveLoadingPolicyInput): PassiveLoadingPolicyResult => {
  const suppressPassiveLoading = isPaused && !isManualRefreshActive;
  if (!suppressPassiveLoading) {
    return {
      loading,
      hasLoaded,
      suppressPassiveLoading: false,
      showPausedEmptyState: false,
    };
  }

  return {
    loading: false,
    hasLoaded,
    suppressPassiveLoading: true,
    showPausedEmptyState: !hasLoaded && !hasData,
  };
};
