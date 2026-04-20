import type { StatusState } from '@shared/components/status/StatusIndicator';
import type { ClusterAuthState } from '@/core/contexts/AuthErrorContext';
import type { ClusterHealthStatus } from '@/hooks/useWailsRuntimeEvents';

export interface ConnectivityPresentation {
  status: StatusState;
  summary: string;
  detail: string;
  actionLabel?: string;
}

export interface ConnectivityPresentationInput {
  clusterId?: string;
  clusterName?: string;
  lifecycleState: string;
  namespaceReady: boolean;
  health: ClusterHealthStatus;
  isPaused: boolean;
  isRefreshing: boolean;
  authState: ClusterAuthState;
}

export const formatClusterLabel = (clusterName?: string, clusterId?: string): string => {
  const name = clusterName?.trim();
  if (name) {
    return name;
  }
  const id = clusterId?.trim();
  return id || 'the selected cluster';
};

export const buildConnectivityPresentation = ({
  clusterId,
  clusterName,
  lifecycleState,
  namespaceReady,
  health,
  isPaused,
  isRefreshing,
  authState,
}: ConnectivityPresentationInput): ConnectivityPresentation => {
  const clusterLabel = formatClusterLabel(clusterName || authState.clusterName, clusterId);

  if (isPaused) {
    return {
      status: 'inactive',
      summary: 'Auto-refresh paused',
      detail: `Background updates for ${clusterLabel} are paused until auto-refresh is re-enabled.`,
    };
  }

  if (!lifecycleState) {
    return {
      status: 'inactive',
      summary: 'No cluster selected',
      detail: 'Select a cluster to connect and load Kubernetes data.',
    };
  }

  if (lifecycleState === 'auth_failed') {
    return {
      status: 'unhealthy',
      summary: 'Authentication failed',
      detail: authState.reason
        ? `${clusterLabel} could not authenticate: ${authState.reason}`
        : `${clusterLabel} could not authenticate. Retry authentication to continue.`,
      actionLabel: 'Retry Auth',
    };
  }

  if (authState.hasError && authState.isRecovering) {
    const attemptLabel =
      authState.currentAttempt > 0 && authState.maxAttempts > 0
        ? ` Attempt ${authState.currentAttempt} of ${authState.maxAttempts}.`
        : '';
    const retryLabel =
      authState.secondsUntilRetry > 0
        ? ` Next retry in ${authState.secondsUntilRetry}s.`
        : ' Retrying now.';
    return {
      status: 'degraded',
      summary: 'Retrying authentication',
      detail: `${clusterLabel} is recovering from an authentication failure.${attemptLabel}${retryLabel}`,
    };
  }

  if (lifecycleState === 'disconnected') {
    return {
      status: 'unhealthy',
      summary: 'Cluster disconnected',
      detail: `The app lost its connection to ${clusterLabel}. Refresh to try again.`,
      actionLabel: 'Refresh',
    };
  }

  if (lifecycleState === 'reconnecting') {
    return {
      status: 'degraded',
      summary: 'Reconnecting',
      detail: `The app is trying to restore its connection to ${clusterLabel}.`,
    };
  }

  if (lifecycleState === 'connecting') {
    return {
      status: 'refreshing',
      summary: 'Connecting to cluster',
      detail: `Building Kubernetes clients for ${clusterLabel}.`,
    };
  }

  if (lifecycleState === 'connected' || lifecycleState === 'loading') {
    return {
      status: 'refreshing',
      summary: 'Starting data services',
      detail: `The app is warming refresh services and loading initial data for ${clusterLabel}.`,
    };
  }

  if (lifecycleState === 'loading_slow') {
    return {
      status: 'degraded',
      summary: 'Still loading cluster data',
      detail: `Initial data for ${clusterLabel} is taking longer than expected to become usable.`,
      actionLabel: 'Refresh',
    };
  }

  if (lifecycleState === 'ready' && !namespaceReady) {
    return {
      status: 'refreshing',
      summary: 'Loading namespaces',
      detail: `${clusterLabel} is connected, but the namespace list is not ready to render yet.`,
    };
  }

  if (authState.hasError) {
    return {
      status: 'unhealthy',
      summary: 'Authentication failed',
      detail: authState.reason
        ? `${clusterLabel} reported an authentication error: ${authState.reason}`
        : `${clusterLabel} is not authenticated.`,
      actionLabel: 'Retry Auth',
    };
  }

  if (health === 'degraded') {
    return {
      status: 'degraded',
      summary: 'Connection degraded',
      detail: `${clusterLabel} is usable, but background health checks are reconnecting.`,
      actionLabel: 'Refresh',
    };
  }

  if (isRefreshing) {
    return {
      status: 'refreshing',
      summary: 'Refreshing cluster data',
      detail: `The app is syncing the latest cluster state for ${clusterLabel}.`,
    };
  }

  return {
    status: 'healthy',
    summary: 'Ready',
    detail: `${clusterLabel} is connected and its namespace list is ready to use.`,
    actionLabel: 'Refresh',
  };
};
