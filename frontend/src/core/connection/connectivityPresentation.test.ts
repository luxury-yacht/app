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
      },
    });

    expect(presentation.status).toBe('refreshing');
    expect(presentation.summary).toBe('Ready');
    expect(presentation.detail).toContain('alpha is connected');
    expect(presentation.detail).toContain('namespace list is ready to use');
  });
});
