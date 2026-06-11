import { describe, expect, it } from 'vitest';
import { buildConnectivityPresentation } from './connectivityPresentation';

describe('buildConnectivityPresentation', () => {
  it('keeps ready copy stable while a connected cluster is refreshing', () => {
    const presentation = buildConnectivityPresentation({
      clusterId: 'cluster-a',
      clusterName: 'alpha',
      lifecycleState: 'ready',
      namespaceReady: true,
      health: 'healthy',
      isPaused: false,
      isRefreshing: true,
      authState: {
        hasError: false,
        isRecovering: false,
        reason: '',
        clusterName: '',
        currentAttempt: 0,
        maxAttempts: 0,
        secondsUntilRetry: 0,
        errorClass: '',
      },
    });

    expect(presentation.status).toBe('refreshing');
    expect(presentation.summary).toBe('Ready');
    expect(presentation.detail).toBe('alpha is connected is ready to use.');
    expect(presentation.actionLabel).toBe('Refresh Now');
  });

  it('presents a recovering cluster with a connectivity verdict as reconnecting', () => {
    const presentation = buildConnectivityPresentation({
      clusterId: 'cluster-a',
      clusterName: 'alpha',
      lifecycleState: 'ready',
      namespaceReady: true,
      health: 'degraded',
      isPaused: false,
      isRefreshing: false,
      authState: {
        hasError: true,
        isRecovering: true,
        reason: '401 Unauthorized',
        clusterName: 'alpha',
        currentAttempt: 1,
        maxAttempts: 4,
        secondsUntilRetry: 15,
        errorClass: 'connectivity',
      },
    });

    expect(presentation.status).toBe('degraded');
    expect(presentation.summary).toBe('Reconnecting');
    expect(presentation.detail).toContain('unreachable');
  });

  it('presents a recovering cluster with an auth verdict as retrying authentication', () => {
    const presentation = buildConnectivityPresentation({
      clusterId: 'cluster-a',
      clusterName: 'alpha',
      lifecycleState: 'ready',
      namespaceReady: true,
      health: 'degraded',
      isPaused: false,
      isRefreshing: false,
      authState: {
        hasError: true,
        isRecovering: true,
        reason: '401 Unauthorized',
        clusterName: 'alpha',
        currentAttempt: 2,
        maxAttempts: 4,
        secondsUntilRetry: 5,
        errorClass: 'auth',
      },
    });

    expect(presentation.status).toBe('degraded');
    expect(presentation.summary).toBe('Retrying authentication');
  });
});
