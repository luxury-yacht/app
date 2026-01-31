/**
 * frontend/src/components/refresh/RefreshStatusIndicator.tsx
 *
 * UI component for RefreshStatusIndicator.
 * Handles rendering and interactions for the shared components.
 * Shows status for the active cluster only using per-cluster health and auth state.
 */

import React, { useEffect, useState } from 'react';
import { refreshOrchestrator } from '@/core/refresh';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import { useClusterHealthListener } from '@/hooks/useWailsRuntimeEvents';
import { useAuthErrorHandler } from '@/hooks/useAuthErrorHandler';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { eventBus } from '@/core/events';
import { getAutoRefreshEnabled } from '@/core/settings/appPreferences';
import './RefreshStatusIndicator.css';

const RefreshStatusIndicator: React.FC = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  // Get the active cluster ID from the kubeconfig context.
  const { selectedClusterId } = useKubeconfig();

  // Use per-cluster health and auth state instead of global connection status.
  const { getActiveClusterHealth } = useClusterHealthListener(selectedClusterId);
  const { getActiveClusterAuthState } = useAuthErrorHandler(selectedClusterId);

  const metricsInfo = useClusterMetricsAvailability();

  useEffect(() => {
    setIsPaused(!getAutoRefreshEnabled());

    const handleRefreshStart = () => setIsRefreshing(true);
    const handleRefreshComplete = () => setIsRefreshing(false);

    const unsubStart = eventBus.on('refresh:start', handleRefreshStart);
    const unsubComplete = eventBus.on('refresh:complete', handleRefreshComplete);
    const unsubAutoRefresh = eventBus.on('settings:auto-refresh', (enabled) => {
      setIsPaused(!enabled);
    });

    return () => {
      unsubStart();
      unsubComplete();
      unsubAutoRefresh();
    };
  }, []);

  const metricsUnavailable = Boolean(metricsInfo?.stale) || Boolean(metricsInfo?.lastError);
  const metricsTooltip = metricsInfo?.lastError
    ? metricsInfo.lastError
    : metricsUnavailable
      ? 'Metrics API unavailable'
      : 'Metrics are up to date';

  // Get current auth state and health for the active cluster.
  const authState = getActiveClusterAuthState();
  const health = getActiveClusterHealth();

  // Disable manual refresh when auth has error OR health is degraded.
  const isConnectionRestricted = authState.hasError || health === 'degraded';
  const manualRefreshDisabled = isPaused || isConnectionRestricted;

  /**
   * Determine the status class based on per-cluster state:
   * - If paused: disabled
   * - If auth error and recovering: retrying
   * - If auth error: auth_failed
   * - If health degraded: offline (transport issues)
   * - If refreshing: refreshing
   * - Otherwise: active
   */
  const getStatusClass = () => {
    if (isPaused) return 'status-disabled';
    // Use per-cluster auth state.
    if (authState.hasError && authState.isRecovering) return 'status-retrying';
    if (authState.hasError) return 'status-auth';
    // Use per-cluster health.
    if (health === 'degraded') return 'status-offline';
    if (isRefreshing) return 'status-refreshing';
    return 'status-active';
  };

  /**
   * Generate a human-readable status label for the tooltip.
   */
  const getStatusLabel = () => {
    if (authState.hasError && authState.isRecovering) {
      return 'Retrying authentication';
    }
    if (authState.hasError) {
      return 'Authentication failed';
    }
    if (health === 'degraded') {
      return 'Connection offline';
    }
    if (isRefreshing) {
      return 'Refreshing';
    }
    return 'Connected';
  };

  const getTooltipText = () => {
    if (isPaused) {
      return 'Auto-refresh paused';
    }
    const pieces = [
      getStatusLabel(),
      authState.hasError && authState.reason ? authState.reason : undefined,
      manualRefreshDisabled ? 'Manual refresh unavailable' : 'Click to refresh now (⌘R)',
    ];
    return pieces.filter(Boolean).join(' • ');
  };

  const handleClick = () => {
    if (manualRefreshDisabled) {
      return;
    }
    void refreshOrchestrator.triggerManualRefreshForContext();
  };

  return (
    <div className="refresh-status-wrapper">
      <div
        className={`refresh-status-indicator ${getStatusClass()}`}
        title={getTooltipText()}
        onClick={handleClick}
        style={{ cursor: manualRefreshDisabled ? 'default' : 'pointer' }}
      >
        <div className="status-dot"></div>
      </div>
      {metricsUnavailable && (
        <div className="metrics-status-indicator" title={metricsTooltip}>
          <div className="status-dot"></div>
        </div>
      )}
    </div>
  );
};

export default RefreshStatusIndicator;
