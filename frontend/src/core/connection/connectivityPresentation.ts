import type { StatusState } from '@shared/components/status/StatusIndicator';
import type { ClusterAuthState } from '@/core/contexts/AuthErrorContext';
import type { ClusterLifecycleState } from '@/core/contexts/clusterLifecycleState';
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
  /** Current lifecycle state; undefined when no cluster is selected/tracked. */
  lifecycleState: ClusterLifecycleState | undefined;
  namespaceReady: boolean;
  // The backend refused the namespace list for lack of RBAC permission — a
  // settled, by-design state (checked once per session), NOT a loading state.
  namespacesPermissionDenied?: boolean;
  health: ClusterHealthStatus;
  isPaused: boolean;
  isRefreshing: boolean;
  authState: ClusterAuthState;
}

const formatClusterLabel = (clusterName?: string, clusterId?: string): string => {
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
  namespacesPermissionDenied,
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

  if (authState.hasError && authState.isRecovering && authState.errorClass !== 'auth') {
    // Recovery is waiting on reachability, not on credentials: the latest
    // probe verdict is connectivity (or no verdict exists yet). The backend
    // keeps probing and reconnects on its own once the cluster responds.
    return {
      status: 'degraded',
      summary: 'Reconnecting',
      detail: `${clusterLabel} is unreachable. The app will reconnect automatically when the cluster responds.`,
    };
  }

  if (authState.hasError && authState.isRecovering) {
    const retryLabel =
      authState.secondsUntilRetry > 0
        ? ` Next retry in ${authState.secondsUntilRetry}s.`
        : ' Rechecking now.';
    return {
      status: 'degraded',
      summary: 'Retrying authentication',
      detail: `${clusterLabel} is recovering from an authentication failure.${retryLabel}`,
    };
  }

  if (lifecycleState === 'disconnected') {
    return {
      status: 'unhealthy',
      summary: 'Cluster disconnected',
      detail: `The app lost its connection to ${clusterLabel}. Refresh to try again.`,
      actionLabel: 'Refresh Now',
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
      detail: `The app is loading initial data for ${clusterLabel}.`,
    };
  }

  if (lifecycleState === 'loading_slow') {
    return {
      status: 'degraded',
      summary: 'Still loading cluster data',
      detail: `Initial data for ${clusterLabel} is taking longer than expected to become usable.`,
      actionLabel: 'Refresh Now',
    };
  }

  if (lifecycleState === 'ready' && namespacesPermissionDenied) {
    return {
      status: 'healthy',
      summary: 'Connected — restricted access',
      detail: `${clusterLabel} is connected, but you do not have permission to list namespaces. Namespace views are unavailable.`,
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
      actionLabel: 'Refresh Now',
    };
  }

  if (isRefreshing) {
    return {
      status: 'refreshing',
      summary: 'Ready',
      detail: `${clusterLabel} is connected is ready to use.`,
      actionLabel: 'Refresh Now',
    };
  }

  return {
    status: 'healthy',
    summary: 'Ready',
    detail: `${clusterLabel} is connected is ready to use.`,
    actionLabel: 'Refresh Now',
  };
};
