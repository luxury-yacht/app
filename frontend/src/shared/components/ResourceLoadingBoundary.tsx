/**
 * frontend/src/shared/components/ResourceLoadingBoundary.tsx
 *
 * UI component for ResourceLoadingBoundary.
 * Handles rendering and interactions for the shared components.
 */

import React, { useEffect } from 'react';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import LoadingSpinner from './LoadingSpinner';
import ClusterDataPausedState from './ClusterDataPausedState';
import './ResourceLoadingBoundary.css';

interface ResourceLoadingBoundaryProps {
  loading: boolean;
  dataLength: number;
  hasLoaded?: boolean;
  spinnerMessage?: string;
  allowPartial?: boolean;
  suppressEmptyWarning?: boolean;
  children: React.ReactNode;
}

const ResourceLoadingBoundary: React.FC<ResourceLoadingBoundaryProps> = ({
  loading,
  dataLength,
  hasLoaded = false,
  spinnerMessage,
  allowPartial = false,
  suppressEmptyWarning = false,
  children,
}) => {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  const passiveLoadingState = applyPassiveLoadingPolicy({
    loading,
    hasLoaded,
    hasData: dataLength > 0,
    isPaused,
    isManualRefreshActive,
  });
  const effectiveLoading = passiveLoadingState.loading;
  const shouldShowPausedMessage = passiveLoadingState.showPausedEmptyState;
  // Compute inline to avoid memo overhead for a simple boolean.
  const shouldShowSpinner = (() => {
    if (shouldShowPausedMessage) {
      return false;
    }
    if (!allowPartial) {
      return !hasLoaded || (effectiveLoading && dataLength === 0);
    }

    const hasAnyData = dataLength > 0;
    const initialLoadComplete = hasLoaded || hasAnyData;
    return !initialLoadComplete;
  })();

  useEffect(() => {
    if (!allowPartial || suppressEmptyWarning || !import.meta.env.DEV) {
      return;
    }

    if (
      !effectiveLoading &&
      dataLength === 0 &&
      !hasLoaded &&
      !passiveLoadingState.suppressPassiveLoading
    ) {
      console.warn(
        '[ResourceLoadingBoundary] allowPartial is enabled but the dataset is empty after loading completed. Set hasLoaded=true when the empty state is intentional to avoid a persistent spinner.'
      );
    }
  }, [
    allowPartial,
    effectiveLoading,
    dataLength,
    hasLoaded,
    passiveLoadingState.suppressPassiveLoading,
    suppressEmptyWarning,
  ]);

  if (shouldShowSpinner) {
    return <LoadingSpinner message={spinnerMessage ?? 'Loading resources...'} />;
  }

  if (shouldShowPausedMessage) {
    return (
      <div className="resource-loading-boundary-paused">
        <ClusterDataPausedState />
      </div>
    );
  }

  return <>{children}</>;
};

export default ResourceLoadingBoundary;
