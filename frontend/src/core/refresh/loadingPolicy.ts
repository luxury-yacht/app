import { isMacPlatform } from '@/utils/platform';

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

export const getAutoRefreshShortcutLabel = (): string => {
  return isMacPlatform() ? 'cmd+R' : 'ctrl+R';
};

export const getClusterDataAutoRefreshDisabledMessage = (): string => {
  return `Auto-refresh is disabled. Enable it to load data automatically, or press ${getAutoRefreshShortcutLabel()} to refresh manually.`;
};

export const CLUSTER_DATA_AUTO_REFRESH_DISABLED_MESSAGE =
  getClusterDataAutoRefreshDisabledMessage();

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
