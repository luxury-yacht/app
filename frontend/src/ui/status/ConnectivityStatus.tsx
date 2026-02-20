/**
 * frontend/src/components/status/ConnectivityStatus.tsx
 *
 * Connectivity status indicator for the app header.
 * Maps cluster health and auth state to shared status states.
 * Click action: refresh cluster connection or retry auth.
 */

import React, { useEffect, useState, useCallback } from 'react';
import StatusIndicator, { type StatusState } from '@shared/components/status/StatusIndicator';
import { refreshOrchestrator } from '@/core/refresh';
import { useClusterHealthListener } from '@/hooks/useWailsRuntimeEvents';
import { useAuthError, useActiveClusterAuthState } from '@/core/contexts/AuthErrorContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { eventBus } from '@/core/events';
import { getAutoRefreshEnabled } from '@/core/settings/appPreferences';

const ConnectivityStatus: React.FC = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const { selectedClusterId } = useKubeconfig();
  const { getActiveClusterHealth } = useClusterHealthListener(selectedClusterId);
  const { handleRetry } = useAuthError();
  const authState = useActiveClusterAuthState(selectedClusterId);

  useEffect(() => {
    setIsPaused(!getAutoRefreshEnabled());

    const unsubStart = eventBus.on('refresh:start', () => setIsRefreshing(true));
    const unsubComplete = eventBus.on('refresh:complete', () => setIsRefreshing(false));
    const unsubAutoRefresh = eventBus.on('settings:auto-refresh', (enabled) => {
      setIsPaused(!enabled);
    });

    return () => {
      unsubStart();
      unsubComplete();
      unsubAutoRefresh();
    };
  }, []);

  const health = getActiveClusterHealth();

  /** Map domain state to shared status state. */
  const getStatus = (): StatusState => {
    if (isPaused) return 'inactive';
    if (authState.hasError && authState.isRecovering) return 'degraded';
    if (authState.hasError) return 'unhealthy';
    if (health === 'degraded') return 'degraded';
    if (isRefreshing) return 'refreshing';
    return 'healthy';
  };

  /** Generate the popover message. */
  const getMessage = (): string => {
    if (isPaused) return 'Auto-refresh paused';
    if (authState.hasError && authState.isRecovering) return 'Retrying authentication...';
    if (authState.hasError) return authState.reason || 'Authentication failed';
    if (health === 'degraded') return 'Reconnecting...';
    if (isRefreshing) return 'Refreshing...';
    return 'Connected';
  };

  /** Determine the action button label. */
  const getActionLabel = (): string | undefined => {
    if (isPaused) return undefined;
    if (authState.hasError && !authState.isRecovering) return 'Retry Auth';
    if (authState.hasError && authState.isRecovering) return undefined;
    if (health === 'degraded') return undefined;
    return 'Refresh';
  };

  /** Handle the action button click. */
  const handleAction = useCallback(() => {
    if (authState.hasError && !authState.isRecovering && selectedClusterId) {
      void handleRetry(selectedClusterId);
      return;
    }
    void refreshOrchestrator.triggerManualRefreshForContext();
  }, [authState, selectedClusterId, handleRetry]);

  const status = getStatus();
  const actionLabel = getActionLabel();

  return (
    <StatusIndicator
      status={status}
      title="Connectivity"
      message={getMessage()}
      actionLabel={actionLabel}
      onAction={actionLabel ? handleAction : undefined}
      ariaLabel={`Connectivity: ${getMessage()}`}
    />
  );
};

export default React.memo(ConnectivityStatus);
