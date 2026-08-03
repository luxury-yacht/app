import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events/eventBus';

const sentryMocks = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  close: vi.fn(),
  getIsolationScope: vi.fn(),
  init: vi.fn(),
  reactErrorHandler: vi.fn(),
  withScope: vi.fn(),
}));

const scopeMocks = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  setContext: vi.fn(),
  setLevel: vi.fn(),
  setTag: vi.fn(),
}));

vi.mock('@sentry/react', () => sentryMocks);

import {
  captureBootstrapError,
  captureUserVisibleError,
  configureErrorReporting,
  configureErrorReportingFromPreferences,
  createReactRootErrorHandlers,
  initializeErrorReporting,
  recordBrokerRequestCompleted,
  recordBrokerRequestStarted,
  resetErrorReportingForTesting,
  runUserAction,
  setActiveNamespaceContext,
  setActiveViewContext,
} from './sentry';

describe('Sentry error reporting', () => {
  beforeEach(() => {
    resetErrorReportingForTesting();
    sentryMocks.init.mockReset();
    sentryMocks.reactErrorHandler.mockReset();
    sentryMocks.close.mockReset();
    sentryMocks.close.mockResolvedValue(true);
    sentryMocks.captureException.mockReset();
    sentryMocks.withScope.mockReset();
    sentryMocks.withScope.mockImplementation((callback: (scope: typeof scopeMocks) => void) => {
      callback(scopeMocks);
    });
    sentryMocks.getIsolationScope.mockReset();
    sentryMocks.getIsolationScope.mockReturnValue(scopeMocks);
    sentryMocks.addBreadcrumb.mockReset();
    Object.values(scopeMocks).forEach((mock) => {
      mock.mockReset();
    });
  });

  it('starts disabled after opt out and follows live preference changes', async () => {
    const available = configureErrorReporting(
      {
        enabled: true,
        dsn: 'https://public@example.com/1',
        environment: 'production',
        release: 'luxury-yacht@v1.2.3',
      },
      false
    );

    expect(available).toBe(true);
    expect(sentryMocks.init).not.toHaveBeenCalled();

    eventBus.emit('settings:error-reporting', true);
    expect(sentryMocks.init).toHaveBeenCalledOnce();

    eventBus.emit('settings:error-reporting', false);
    await vi.waitFor(() => expect(sentryMocks.close).toHaveBeenCalledWith(0));

    eventBus.emit('settings:error-reporting', true);
    expect(sentryMocks.init).toHaveBeenCalledTimes(2);
  });

  it('does not initialize until the persisted preference has loaded', async () => {
    let resolvePreference: ((value: { errorReportingEnabled: boolean }) => void) | undefined;
    const preference = new Promise<{ errorReportingEnabled: boolean }>((resolve) => {
      resolvePreference = resolve;
    });

    const configured = configureErrorReportingFromPreferences(
      {
        enabled: true,
        dsn: 'https://public@example.com/1',
        environment: 'production',
        release: 'luxury-yacht@v1.2.3',
      },
      () => preference
    );

    expect(sentryMocks.init).not.toHaveBeenCalled();
    resolvePreference?.({ errorReportingEnabled: true });

    const result = await configured;
    expect(result.available).toBe(true);
    expect(result.preferences.errorReportingEnabled).toBe(true);
    expect(sentryMocks.init).toHaveBeenCalledOnce();
  });

  it('reports preference hydration failures only after persisted consent is known', async () => {
    const failure = new Error('settings schema unavailable');
    captureBootstrapError(failure, { action: 'loadAppSettingsSchema' });

    expect(sentryMocks.captureException).not.toHaveBeenCalled();
    await configureErrorReportingFromPreferences(
      {
        enabled: true,
        dsn: 'https://public@example.com/1',
        environment: 'production',
      },
      async () => ({ errorReportingEnabled: true })
    );

    expect(scopeMocks.setTag).toHaveBeenCalledWith('error.surface', 'bootstrap');
    expect(scopeMocks.setContext).toHaveBeenCalledWith('operation', {
      id: 'bootstrap-error-1',
      action: 'loadAppSettingsSchema',
    });
    expect(sentryMocks.captureException).toHaveBeenCalledWith(failure);
  });

  it('discards buffered bootstrap failures when persisted consent is disabled', async () => {
    captureBootstrapError(new Error('settings schema unavailable'), {
      action: 'loadAppSettingsSchema',
    });

    await configureErrorReportingFromPreferences(
      {
        enabled: true,
        dsn: 'https://public@example.com/1',
        environment: 'production',
      },
      async () => ({ errorReportingEnabled: false })
    );

    expect(sentryMocks.init).not.toHaveBeenCalled();
    expect(sentryMocks.captureException).not.toHaveBeenCalled();
  });

  it('stays disabled when no DSN is configured', () => {
    expect(
      initializeErrorReporting({
        enabled: true,
        dsn: '   ',
        environment: 'production',
        release: 'luxury-yacht@v1.2.3',
      })
    ).toBe(false);
    expect(sentryMocks.init).not.toHaveBeenCalled();
  });

  it('stays disabled when error reporting is disabled by the build', () => {
    expect(
      initializeErrorReporting({
        enabled: false,
        dsn: 'https://public@example.com/1',
        environment: 'development',
        release: 'luxury-yacht@v1.2.3',
      })
    ).toBe(false);
    expect(sentryMocks.init).not.toHaveBeenCalled();
  });

  it('initializes Sentry with native data collection', () => {
    expect(
      initializeErrorReporting({
        enabled: true,
        dsn: ' https://public@example.com/1 ',
        environment: ' production ',
        release: ' luxury-yacht@v1.2.3 ',
      })
    ).toBe(true);

    expect(sentryMocks.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'https://public@example.com/1',
        environment: 'production',
        release: 'luxury-yacht@v1.2.3',
        dataCollection: {},
      })
    );
  });

  it('initializes the SDK only once while enabled', () => {
    const config = {
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
      release: 'luxury-yacht@v1.2.3',
    };

    expect(initializeErrorReporting(config)).toBe(true);
    expect(initializeErrorReporting(config)).toBe(true);
    expect(sentryMocks.init).toHaveBeenCalledOnce();
  });

  it('installs React 19 root handlers only when reporting is available', () => {
    const handler = vi.fn();
    sentryMocks.reactErrorHandler.mockReturnValue(handler);

    expect(createReactRootErrorHandlers(false)).toEqual({});
    expect(sentryMocks.reactErrorHandler).not.toHaveBeenCalled();

    expect(createReactRootErrorHandlers(true)).toEqual({
      onCaughtError: handler,
      onUncaughtError: handler,
      onRecoverableError: handler,
    });
    expect(sentryMocks.reactErrorHandler).toHaveBeenCalledOnce();
  });

  it('captures a displayed error with a unique operation and allowlisted action context', () => {
    initializeErrorReporting({
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
      release: 'luxury-yacht@v1.2.3',
    });
    const error = new Error('Failed to load pods');

    captureUserVisibleError(error, {
      category: 'UNKNOWN',
      severity: 'error',
      context: {
        action: 'loadPods',
        source: 'object-panel',
        clusterId: 'cluster-a',
        secretValue: 'must-not-be-forwarded',
      },
    });

    expect(sentryMocks.withScope).toHaveBeenCalledOnce();
    expect(scopeMocks.setTag).toHaveBeenCalledWith('error.surface', 'user-visible');
    expect(scopeMocks.setTag).toHaveBeenCalledWith('error.category', 'UNKNOWN');
    expect(scopeMocks.setTag).toHaveBeenCalledWith('ui.action', 'loadPods');
    expect(scopeMocks.setTag).toHaveBeenCalledWith('clusterId', 'cluster-a');
    expect(scopeMocks.setContext).toHaveBeenCalledWith('operation', {
      id: 'ui-error-1',
      action: 'loadPods',
      source: 'object-panel',
    });
    expect(scopeMocks.setContext).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ secretValue: expect.anything() })
    );
    expect(sentryMocks.captureException).toHaveBeenCalledWith(error);
  });

  it('captures event-handler exceptions through the centralized operational boundary', () => {
    configureErrorReporting(
      {
        enabled: true,
        dsn: 'https://public@example.com/1',
        environment: 'production',
      },
      true
    );
    const failure = new Error('subscriber failed');
    const unsubscribe = eventBus.on('app:visibility-hidden', () => {
      throw failure;
    });

    eventBus.emit('app:visibility-hidden');

    expect(scopeMocks.setTag).toHaveBeenCalledWith('error.surface', 'operational');
    expect(scopeMocks.setContext).toHaveBeenCalledWith('operation', {
      id: 'ui-error-1',
      action: 'app:visibility-hidden',
      source: 'EventBus',
    });
    expect(sentryMocks.captureException).toHaveBeenCalledWith(failure);
    unsubscribe();
  });

  it('attaches the active workspace snapshot and records navigation breadcrumbs', () => {
    initializeErrorReporting({
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
      release: 'luxury-yacht@v1.2.3',
    });

    setActiveViewContext({
      view: 'namespace',
      tab: 'workloads',
      clusterId: 'cluster-a',
      objectPanelOpen: true,
    });
    captureUserVisibleError(new Error('Failed to load pods'), {
      category: 'UNKNOWN',
      severity: 'error',
    });

    expect(scopeMocks.setTag).toHaveBeenCalledWith('ui.view', 'namespace');
    expect(scopeMocks.setTag).toHaveBeenCalledWith('ui.tab', 'workloads');
    expect(scopeMocks.setTag).toHaveBeenCalledWith('clusterId', 'cluster-a');
    expect(scopeMocks.setContext).toHaveBeenCalledWith('navigation', {
      view: 'namespace',
      tab: 'workloads',
      clusterId: 'cluster-a',
      objectPanelOpen: true,
    });
    expect(sentryMocks.addBreadcrumb).toHaveBeenCalledWith({
      type: 'navigation',
      category: 'navigation.workspace',
      level: 'info',
      message: 'Entered namespace/workloads',
      data: {
        view: 'namespace',
        tab: 'workloads',
        clusterId: 'cluster-a',
        objectPanelOpen: true,
      },
    });
  });

  it('adds the selected namespace to namespace-workspace events', () => {
    setActiveNamespaceContext('payments');
    setActiveViewContext({
      view: 'namespace',
      tab: 'workloads',
      clusterId: 'cluster-a',
      objectPanelOpen: false,
    });
    initializeErrorReporting({
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
    });

    captureUserVisibleError(new Error('Failed to load deployments'), {
      category: 'UNKNOWN',
      severity: 'error',
    });

    expect(scopeMocks.setContext).toHaveBeenCalledWith('navigation', {
      view: 'namespace',
      tab: 'workloads',
      clusterId: 'cluster-a',
      namespace: 'payments',
      objectPanelOpen: false,
    });
  });

  it('carries one broker request instance from start through a displayed failure', () => {
    initializeErrorReporting({
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
      release: 'luxury-yacht@v1.2.3',
    });
    const request = {
      id: 'broker-read-7',
      broker: 'data-access',
      resource: 'pods',
      adapter: 'refresh-domain',
      reason: 'user',
      label: 'refresh pods',
      scope: 'cluster-a',
    };
    const error = new Error('request payload must stay out of breadcrumb data');

    recordBrokerRequestStarted(request);
    recordBrokerRequestCompleted(request, {
      status: 'error',
      durationMs: 42,
      error,
    });
    captureUserVisibleError(error, {
      category: 'NETWORK',
      severity: 'error',
      context: { action: 'manualRefresh' },
    });

    expect(scopeMocks.setContext).toHaveBeenCalledWith('request', {
      id: 'broker-read-7',
      broker: 'data-access',
      resource: 'pods',
      adapter: 'refresh-domain',
      reason: 'user',
      label: 'refresh pods',
      scope: 'cluster-a',
      status: 'error',
      durationMs: 42,
    });
    expect(scopeMocks.setContext).toHaveBeenCalledWith('operation', {
      id: 'broker-read-7',
      action: 'manualRefresh',
    });
    expect(sentryMocks.addBreadcrumb).toHaveBeenCalledWith({
      type: 'default',
      category: 'request.broker',
      level: 'info',
      message: 'Started data-access request for pods',
      data: request,
    });
    expect(sentryMocks.addBreadcrumb).toHaveBeenCalledWith({
      type: 'default',
      category: 'request.broker',
      level: 'error',
      message: 'Failed data-access request for pods',
      data: {
        ...request,
        status: 'error',
        durationMs: 42,
      },
    });
  });

  it('labels automatic breadcrumbs with workspace context and removes unrelated activity', () => {
    setActiveViewContext({
      view: 'namespace',
      tab: 'workloads',
      clusterId: 'cluster-a',
      objectPanelOpen: false,
    });
    initializeErrorReporting({
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
    });
    const options = sentryMocks.init.mock.calls[0]?.[0] as {
      beforeBreadcrumb: (breadcrumb: Record<string, unknown>) => Record<string, unknown>;
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
    };

    expect(
      options.beforeBreadcrumb({
        category: 'ui.click',
        data: { target: 'button.save' },
      })
    ).toEqual({
      category: 'ui.click',
      data: {
        target: 'button.save',
        'ui.view': 'namespace',
        'ui.tab': 'workloads',
        clusterId: 'cluster-a',
      },
    });

    const filtered = options.beforeSend({
      contexts: {
        navigation: {
          view: 'namespace',
          tab: 'workloads',
          clusterId: 'cluster-a',
          namespace: 'payments',
        },
        request: { id: 'broker-read-2' },
      },
      breadcrumbs: [
        {
          message: 'current click',
          data: {
            'ui.view': 'namespace',
            'ui.tab': 'workloads',
            clusterId: 'cluster-a',
            'request.ids': ['broker-read-2'],
          },
        },
        {
          message: 'same workspace, other request',
          data: {
            'ui.view': 'namespace',
            'ui.tab': 'workloads',
            clusterId: 'cluster-a',
            'request.ids': ['broker-read-9'],
          },
        },
        {
          message: 'different tab',
          data: { 'ui.view': 'namespace', 'ui.tab': 'events', clusterId: 'cluster-a' },
        },
        {
          message: 'different namespace',
          data: {
            'ui.view': 'namespace',
            'ui.tab': 'workloads',
            clusterId: 'cluster-a',
            namespace: 'inventory',
          },
        },
        {
          category: 'request.broker',
          message: 'matching request',
          data: {
            id: 'broker-read-2',
            'ui.view': 'namespace',
            'ui.tab': 'workloads',
            clusterId: 'cluster-a',
          },
        },
        {
          category: 'request.broker',
          message: 'other request',
          data: {
            id: 'broker-read-1',
            'ui.view': 'namespace',
            'ui.tab': 'workloads',
            clusterId: 'cluster-a',
          },
        },
      ],
    }) as { breadcrumbs: Array<{ message: string }> };

    expect(filtered.breadcrumbs.map((breadcrumb) => breadcrumb.message)).toEqual([
      'current click',
      'matching request',
    ]);
  });

  it('does not guess that the latest browser interaction caused a non-request failure', () => {
    initializeErrorReporting({
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
    });
    const options = sentryMocks.init.mock.calls[0]?.[0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
    };

    const filtered = options.beforeSend({
      tags: { 'error.surface': 'user-visible' },
      contexts: { operation: { id: 'ui-error-7', action: 'saveFavorite' } },
      breadcrumbs: [
        { category: 'ui.click', message: 'older action' },
        { category: 'console', message: 'older work' },
        { category: 'ui.click', message: 'save button' },
        { category: 'console', message: 'save started' },
        {
          category: 'ui.error.presented',
          message: 'save failed',
          data: { operationId: 'ui-error-7' },
        },
      ],
    }) as { breadcrumbs: Array<{ message: string }> };

    expect(filtered.breadcrumbs.map((breadcrumb) => breadcrumb.message)).toEqual(['save failed']);
  });

  it('correlates an async failure to its exact user-action instance', async () => {
    initializeErrorReporting({
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
    });
    const failure = new Error('save failed');
    let rejectSave: ((error: Error) => void) | undefined;
    const save = runUserAction(
      'saveFavorite',
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        })
    ).catch((error: unknown) => {
      captureUserVisibleError(error, {
        category: 'UNKNOWN',
        severity: 'error',
        context: { action: 'saveFavorite' },
      });
    });

    await runUserAction('openSettings', async () => undefined);
    rejectSave?.(failure);
    await save;

    expect(scopeMocks.setContext).toHaveBeenLastCalledWith('operation', {
      id: 'user-action-1',
      action: 'saveFavorite',
    });
    expect(sentryMocks.captureException).toHaveBeenCalledWith(failure);
    expect(sentryMocks.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'ui.action.failed',
        data: { operationId: 'user-action-1', action: 'saveFavorite' },
      })
    );
  });

  it('keeps only the matching operation breadcrumb for background handled failures', () => {
    initializeErrorReporting({
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
    });
    const options = sentryMocks.init.mock.calls[0]?.[0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
    };

    const filtered = options.beforeSend({
      tags: { 'error.surface': 'operational' },
      contexts: { operation: { id: 'ui-error-8', action: 'persistTableState' } },
      breadcrumbs: [
        { category: 'console', message: 'unrelated cluster work' },
        {
          category: 'ui.error.handled',
          message: 'other handled error',
          data: { operationId: 'ui-error-7' },
        },
        {
          category: 'ui.error.handled',
          message: 'matching handled error',
          data: { operationId: 'ui-error-8' },
        },
      ],
    }) as { breadcrumbs: Array<{ message: string }> };

    expect(filtered.breadcrumbs.map((breadcrumb) => breadcrumb.message)).toEqual([
      'matching handled error',
    ]);
  });
});
