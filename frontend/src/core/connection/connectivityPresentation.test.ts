import { describe, expect, it } from 'vitest';
import {
  buildConnectivityPresentation,
  type ConnectivityPresentationInput,
} from './connectivityPresentation';

type InputOverrides = Partial<Omit<ConnectivityPresentationInput, 'authState'>> & {
  authState?: Partial<ConnectivityPresentationInput['authState']>;
};

const createInput = (overrides: InputOverrides = {}): ConnectivityPresentationInput => ({
  clusterId: 'cluster-a',
  clusterName: 'alpha',
  lifecycleState: 'ready',
  namespaceReady: true,
  health: 'healthy',
  isPaused: false,
  isRefreshing: false,
  ...overrides,
  authState: {
    hasError: false,
    isRecovering: false,
    reason: '',
    clusterName: '',
    secondsUntilRetry: 0,
    errorClass: '',
    execCommand: '',
    diagnosticKind: '',
    diagnosticSummary: '',
    ...overrides.authState,
  },
});

describe('buildConnectivityPresentation', () => {
  it.each([
    {
      name: 'paused before authentication errors',
      overrides: {
        isPaused: true,
        lifecycleState: 'auth_failed' as const,
        authState: { hasError: true, reason: 'denied' },
      },
      status: 'inactive',
      summary: 'Auto-refresh paused',
    },
    {
      name: 'lifecycle authentication failure',
      overrides: { lifecycleState: 'auth_failed' as const },
      status: 'unhealthy',
      summary: 'Authentication failed',
    },
    {
      name: 'disconnected lifecycle',
      overrides: { lifecycleState: 'disconnected' as const },
      status: 'unhealthy',
      summary: 'Cluster disconnected',
    },
    {
      name: 'reconnecting lifecycle',
      overrides: { lifecycleState: 'reconnecting' as const },
      status: 'degraded',
      summary: 'Reconnecting',
    },
    {
      name: 'connecting lifecycle',
      overrides: { lifecycleState: 'connecting' as const },
      status: 'refreshing',
      summary: 'Connecting to cluster',
    },
    {
      name: 'connected lifecycle startup',
      overrides: { lifecycleState: 'connected' as const },
      status: 'refreshing',
      summary: 'Starting data services',
    },
    {
      name: 'loading lifecycle startup',
      overrides: { lifecycleState: 'loading' as const },
      status: 'refreshing',
      summary: 'Starting data services',
    },
    {
      name: 'slow lifecycle loading',
      overrides: { lifecycleState: 'loading_slow' as const },
      status: 'degraded',
      summary: 'Still loading cluster data',
    },
    {
      name: 'namespace startup after lifecycle readiness',
      overrides: { namespaceReady: false },
      status: 'refreshing',
      summary: 'Loading namespaces',
    },
    {
      name: 'settled authentication error',
      overrides: { authState: { hasError: true, reason: 'token expired' } },
      status: 'unhealthy',
      summary: 'Authentication failed',
    },
    {
      name: 'degraded background health',
      overrides: { health: 'degraded' as const },
      status: 'degraded',
      summary: 'Connection degraded',
    },
    {
      name: 'settled healthy connection',
      overrides: {},
      status: 'healthy',
      summary: 'Ready',
    },
  ])('preserves precedence for $name', ({ overrides, status, summary }) => {
    expect(buildConnectivityPresentation(createInput(overrides))).toMatchObject({
      status,
      summary,
    });
  });

  it('reports an immediate authentication retry without a countdown', () => {
    const presentation = buildConnectivityPresentation(
      createInput({
        authState: {
          hasError: true,
          isRecovering: true,
          errorClass: 'auth',
          secondsUntilRetry: 0,
        },
      })
    );

    expect(presentation.detail).toBe(
      'alpha is recovering from an authentication failure. Rechecking now.'
    );
  });

  it('shows "No cluster selected" when there is no lifecycle state (untracked/none selected)', () => {
    const presentation = buildConnectivityPresentation({
      clusterId: undefined,
      clusterName: undefined,
      lifecycleState: undefined,
      namespaceReady: false,
      health: 'healthy',
      isPaused: false,
      isRefreshing: false,
      authState: {
        hasError: false,
        isRecovering: false,
        reason: '',
        clusterName: '',
        secondsUntilRetry: 0,
        errorClass: '',
        execCommand: '',
        diagnosticKind: '',
        diagnosticSummary: '',
      },
    });

    expect(presentation.status).toBe('inactive');
    expect(presentation.summary).toBe('No cluster selected');
  });

  it('shows restricted access — not perpetual loading — when namespace listing is permission-denied', () => {
    const presentation = buildConnectivityPresentation({
      clusterId: 'cluster-a',
      clusterName: 'alpha',
      lifecycleState: 'ready',
      namespaceReady: false,
      namespacesPermissionDenied: true,
      health: 'healthy',
      isPaused: false,
      isRefreshing: false,
      authState: {
        hasError: false,
        isRecovering: false,
        reason: '',
        clusterName: '',
        secondsUntilRetry: 0,
        errorClass: '',
        execCommand: '',
        diagnosticKind: '',
        diagnosticSummary: '',
      },
    });

    // Permission-denied is a SETTLED, by-design state: connectivity is fine
    // and nothing is loading. "Loading namespaces ... not ready to render
    // yet" (the old copy) misreports it as pending forever.
    expect(presentation.status).toBe('healthy');
    expect(presentation.summary).toBe('Connected — restricted access');
    expect(presentation.detail).toBe(
      'alpha is connected, but you do not have permission to list namespaces. Namespace views are unavailable.'
    );
    expect(presentation.actionLabel).toBeUndefined();
  });
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
        secondsUntilRetry: 0,
        errorClass: '',
        execCommand: '',
        diagnosticKind: '',
        diagnosticSummary: '',
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
        secondsUntilRetry: 15,
        errorClass: 'connectivity',
        execCommand: '',
        diagnosticKind: '',
        diagnosticSummary: '',
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
        secondsUntilRetry: 5,
        errorClass: 'auth',
        execCommand: '',
        diagnosticKind: '',
        diagnosticSummary: '',
      },
    });

    expect(presentation.status).toBe('degraded');
    expect(presentation.summary).toBe('Retrying authentication');
  });
});
