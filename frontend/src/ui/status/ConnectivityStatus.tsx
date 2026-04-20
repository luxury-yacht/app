/**
 * frontend/src/components/status/ConnectivityStatus.tsx
 *
 * Connectivity status indicator for the app header.
 * Maps cluster health and auth state to shared status states.
 * Click action: refresh cluster connection or retry auth.
 */

import React, { useEffect, useState, useCallback } from 'react';
import StatusIndicator from '@shared/components/status/StatusIndicator';
import { refreshOrchestrator } from '@/core/refresh';
import { useClusterHealthListener } from '@/hooks/useWailsRuntimeEvents';
import { useAuthError, useActiveClusterAuthState } from '@/core/contexts/AuthErrorContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useClusterLifecycle } from '@core/contexts/ClusterLifecycleContext';
import { eventBus } from '@/core/events';
import { getAutoRefreshEnabled } from '@/core/settings/appPreferences';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { buildConnectivityPresentation } from '@/core/connection/connectivityPresentation';

const ConnectivityStatus: React.FC = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const { selectedClusterId, selectedClusterName } = useKubeconfig();
  const { getActiveClusterHealth } = useClusterHealthListener(selectedClusterId);
  const { handleRetry } = useAuthError();
  const authState = useActiveClusterAuthState(selectedClusterId);
  const { getClusterState } = useClusterLifecycle();
  const { namespaceReady } = useNamespace();
  const lifecycleState = selectedClusterId ? getClusterState(selectedClusterId) : '';

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
  const presentation = buildConnectivityPresentation({
    clusterId: selectedClusterId,
    clusterName: selectedClusterName,
    lifecycleState,
    namespaceReady,
    health,
    isPaused,
    isRefreshing,
    authState,
  });

  /** Handle the action button click. */
  const handleAction = useCallback(() => {
    if (authState.hasError && !authState.isRecovering && selectedClusterId) {
      void handleRetry(selectedClusterId);
      return;
    }
    void refreshOrchestrator.triggerManualRefreshForContext();
  }, [authState, selectedClusterId, handleRetry]);

  return (
    <StatusIndicator
      status={presentation.status}
      title="Connectivity"
      message={
        <div className="connectivity-status-message">
          <div className="connectivity-status-summary">{presentation.summary}</div>
          <div className="connectivity-status-detail">{presentation.detail}</div>
        </div>
      }
      actionLabel={presentation.actionLabel}
      onAction={presentation.actionLabel ? handleAction : undefined}
      ariaLabel={`Connectivity: ${presentation.summary}. ${presentation.detail}`}
      tooltipClassName="connectivity-status-popover"
    />
  );
};

export default React.memo(ConnectivityStatus);
