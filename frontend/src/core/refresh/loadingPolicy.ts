export interface PassiveLoadingPolicyInput {
  loading: boolean;
  hasLoaded: boolean;
  isPaused: boolean;
  isManualRefreshActive: boolean;
}

export interface PassiveLoadingPolicyResult {
  loading: boolean;
  hasLoaded: boolean;
  suppressPassiveLoading: boolean;
}

export const applyPassiveLoadingPolicy = ({
  loading,
  hasLoaded,
  isPaused,
  isManualRefreshActive,
}: PassiveLoadingPolicyInput): PassiveLoadingPolicyResult => {
  const suppressPassiveLoading = isPaused && !isManualRefreshActive;
  if (!suppressPassiveLoading) {
    return {
      loading,
      hasLoaded,
      suppressPassiveLoading: false,
    };
  }

  return {
    loading: false,
    hasLoaded,
    suppressPassiveLoading: true,
  };
};
