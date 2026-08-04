import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events/eventBus';

const sentryMocks = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  browserSessionIntegration: vi.fn(),
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
    sentryMocks.browserSessionIntegration.mockReset();
    sentryMocks.browserSessionIntegration.mockReturnValue({ name: 'PageBrowserSession' });
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
    let resolvePreference:
      | ((value: { errorReportingEnabled: boolean; anonymizedId: string }) => void)
      | undefined;
    const preference = new Promise<{ errorReportingEnabled: boolean; anonymizedId: string }>(
      (resolve) => {
        resolvePreference = resolve;
      }
    );

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
    resolvePreference?.({
      errorReportingEnabled: true,
      anonymizedId: '123e4567-e89b-42d3-a456-426614174000',
    });

    const result = await configured;
    expect(result.available).toBe(true);
    expect(result.preferences.errorReportingEnabled).toBe(true);
    expect(sentryMocks.init).toHaveBeenCalledOnce();
  });

  it('reports preference hydration failures only after the persisted preference is known', async () => {
    const failure = new Error('settings schema unavailable');
    captureBootstrapError(failure, { action: 'loadAppSettingsSchema' });

    expect(sentryMocks.captureException).not.toHaveBeenCalled();
    await configureErrorReportingFromPreferences(
      {
        enabled: true,
        dsn: 'https://public@example.com/1',
        environment: 'production',
      },
      async () => ({
        errorReportingEnabled: true,
        anonymizedId: '123e4567-e89b-42d3-a456-426614174000',
      })
    );

    expect(scopeMocks.setTag).toHaveBeenCalledWith('error.surface', 'bootstrap');
    expect(scopeMocks.setContext).toHaveBeenCalledWith('operation', {
      id: 'bootstrap-error-1',
      action: 'loadAppSettingsSchema',
    });
    expect(sentryMocks.captureException).toHaveBeenCalledWith(failure);
  });

  it('discards buffered bootstrap failures when persisted reporting is disabled', async () => {
    captureBootstrapError(new Error('settings schema unavailable'), {
      action: 'loadAppSettingsSchema',
    });

    await configureErrorReportingFromPreferences(
      {
        enabled: true,
        dsn: 'https://public@example.com/1',
        environment: 'production',
      },
      async () => ({
        errorReportingEnabled: false,
        anonymizedId: '123e4567-e89b-42d3-a456-426614174000',
      })
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

  it('initializes Sentry with privacy-first data collection', () => {
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
        dataCollection: {
          userInfo: false,
          cookies: false,
          httpHeaders: { request: false, response: false },
          httpBodies: [],
          urlQueryParams: false,
          graphQL: { document: false, variables: false },
          genAI: { inputs: false, outputs: false },
          databaseQueryData: false,
          stackFrameVariables: false,
          frameContextLines: 5,
        },
      })
    );
  });

  it('identifies release sessions by anonymizedId and creates one session per app load', () => {
    expect(
      initializeErrorReporting({
        enabled: true,
        dsn: 'https://public@example.com/1',
        environment: 'production',
        release: 'luxury-yacht@v1.2.3',
        anonymizedId: ' 123e4567-e89b-42d3-a456-426614174000 ',
      })
    ).toBe(true);

    const options = sentryMocks.init.mock.calls[0]?.[0];
    expect(options).toEqual(
      expect.objectContaining({
        initialScope: {
          user: { id: '123e4567-e89b-42d3-a456-426614174000' },
        },
      })
    );
    expect(sentryMocks.browserSessionIntegration).toHaveBeenCalledWith({ lifecycle: 'page' });
    expect(
      options.integrations([
        { name: 'Breadcrumbs' },
        { name: 'BrowserSession' },
        { name: 'CultureContext' },
        { name: 'GlobalHandlers' },
      ])
    ).toEqual([{ name: 'GlobalHandlers' }, { name: 'PageBrowserSession' }]);
  });

  it('does not send a malformed installation identifier as Sentry user data', () => {
    expect(
      initializeErrorReporting({
        enabled: true,
        dsn: 'https://public@example.com/1',
        environment: 'production',
        anonymizedId: 'john@example.test',
      })
    ).toBe(true);

    expect(sentryMocks.init.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ initialScope: undefined })
    );
  });

  it('removes request, network identity, and free-form secrets before transport', () => {
    initializeErrorReporting({
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
      anonymizedId: '123e4567-e89b-42d3-a456-426614174000',
    });
    const options = sentryMocks.init.mock.calls[0]?.[0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
    };

    const filtered = options.beforeSend({
      message:
        'GET https://internal.example.test/pods?token=top-secret from 10.20.30.40 or fd00::1234 via internal-api.local at /Users/john/.kube/config: Deployment.apps "private-workload-7" is invalid; deployment payments/private-workload-8 failed',
      user: {
        id: '123e4567-e89b-42d3-a456-426614174000',
        email: 'john@example.test',
        ip_address: '10.20.30.40',
        username: 'john',
      },
      request: {
        url: 'https://internal.example.test/pods?token=top-secret',
        headers: { authorization: 'Bearer top-secret' },
        data: '{"password":"top-secret"}',
      },
      server_name: 'johns-macbook',
      exception: {
        values: [
          {
            type: 'Error',
            value: 'authorization=Bearer top-secret at /home/john/project/file.ts',
            stacktrace: {
              frames: [
                {
                  abs_path: '/Users/john/git/luxury-yacht/app/file.ts',
                  vars: { token: 'top-secret' },
                },
              ],
            },
          },
        ],
      },
      contexts: {
        os: { name: 'macOS', version: '15.0' },
        culture: { locale: 'en-US', timezone: 'America/Denver' },
      },
      breadcrumbs: [
        {
          category: 'ui.error.presented',
          message: 'token=top-secret',
          data: { authorization: 'Bearer top-secret', operationId: 'ui-error-1' },
        },
      ],
    });

    expect(filtered).toEqual(
      expect.objectContaining({
        user: { id: '123e4567-e89b-42d3-a456-426614174000' },
        request: undefined,
        server_name: undefined,
        contexts: {
          os: { name: 'macOS', version: '15.0' },
        },
      })
    );
    const payload = JSON.stringify(filtered);
    for (const sensitive of [
      'john@example.test',
      '10.20.30.40',
      'fd00::1234',
      'top-secret',
      'internal.example.test',
      'internal-api.local',
      'private-workload-7',
      'payments/private-workload-8',
      '/Users/john',
      '/home/john',
      'America/Denver',
    ]) {
      expect(payload).not.toContain(sensitive);
    }
    expect(payload).toContain('[url]');
    expect(payload).toContain('[local-path]');
  });

  it('keeps matching sanitized bundle identities for stack frames and source maps', () => {
    initializeErrorReporting({
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
    });
    const options = sentryMocks.init.mock.calls[0]?.[0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown>;
    };

    const filtered = options.beforeSend({
      exception: {
        values: [
          {
            type: 'Error',
            value: 'boom',
            stacktrace: {
              frames: [
                {
                  filename: 'http://wails.localhost/assets/index-a1b2c3.js?token=top-secret',
                  abs_path: '/Users/john/git/luxury-yacht/app/frontend/dist/assets/index-a1b2c3.js',
                },
                {
                  filename: 'http://wails.localhost/assets/vendor-d4e5f6.js',
                  abs_path: 'http://wails.localhost/assets/vendor-d4e5f6.js',
                },
              ],
            },
          },
        ],
      },
      debug_meta: {
        images: [
          {
            type: 'sourcemap',
            code_file: 'app:///assets/index-a1b2c3.js',
          },
          {
            type: 'sourcemap',
            code_file: 'http://wails.localhost/assets/vendor-d4e5f6.js',
          },
        ],
      },
    }) as {
      exception: {
        values: Array<{
          stacktrace: { frames: Array<{ filename: string; abs_path: string }> };
        }>;
      };
      debug_meta: { images: Array<{ code_file: string }> };
    };

    const frames = filtered.exception.values[0]?.stacktrace.frames ?? [];
    expect(frames[0]).toEqual(
      expect.objectContaining({
        filename: 'app:///assets/index-a1b2c3.js',
        abs_path: 'app:///assets/index-a1b2c3.js',
      })
    );
    expect(frames[1]).toEqual(
      expect.objectContaining({
        filename: 'app:///assets/vendor-d4e5f6.js',
        abs_path: 'app:///assets/vendor-d4e5f6.js',
      })
    );
    expect(filtered.debug_meta.images.map((image) => image.code_file)).toEqual([
      'app:///assets/index-a1b2c3.js',
      'app:///assets/vendor-d4e5f6.js',
    ]);
    const payload = JSON.stringify(filtered);
    expect(payload).not.toContain('wails.localhost');
    expect(payload).not.toContain('/Users/john');
    expect(payload).not.toContain('top-secret');
  });

  it('carries anonymizedId from preference hydration through live re-enablement', async () => {
    await configureErrorReportingFromPreferences(
      {
        enabled: true,
        dsn: 'https://public@example.com/1',
        environment: 'production',
      },
      async () => ({
        errorReportingEnabled: true,
        anonymizedId: '123e4567-e89b-42d3-a456-426614174000',
      })
    );

    eventBus.emit('settings:error-reporting', false);
    await vi.waitFor(() => expect(sentryMocks.close).toHaveBeenCalledWith(0));
    eventBus.emit('settings:error-reporting', true);

    expect(sentryMocks.init).toHaveBeenCalledTimes(2);
    expect(sentryMocks.init.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({
        initialScope: {
          user: { id: '123e4567-e89b-42d3-a456-426614174000' },
        },
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
    expect(scopeMocks.setTag).toHaveBeenCalledWith('cluster.alias', 'cluster-1');
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
    expect(scopeMocks.setTag).toHaveBeenCalledWith('cluster.alias', 'cluster-1');
    expect(scopeMocks.setContext).toHaveBeenCalledWith('navigation', {
      view: 'namespace',
      tab: 'workloads',
      'cluster.alias': 'cluster-1',
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
        'cluster.alias': 'cluster-1',
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
      'cluster.alias': 'cluster-1',
      'namespace.alias': 'namespace-1',
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
      data: {
        id: 'broker-read-7',
        broker: 'data-access',
        resource: 'pods',
        adapter: 'refresh-domain',
        reason: 'user',
      },
    });
    expect(sentryMocks.addBreadcrumb).toHaveBeenCalledWith({
      type: 'default',
      category: 'request.broker',
      level: 'error',
      message: 'Failed data-access request for pods',
      data: {
        id: 'broker-read-7',
        broker: 'data-access',
        resource: 'pods',
        adapter: 'refresh-domain',
        reason: 'user',
        status: 'error',
        durationMs: 42,
      },
    });
  });

  it('correlates a refresh error reported before its broker request completes', () => {
    initializeErrorReporting({
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
    });
    const request = {
      id: 'broker-read-17',
      broker: 'data-access',
      resource: 'cluster-config',
      adapter: 'refresh-domain',
      reason: 'background',
      scope: 'cluster-a',
    };

    recordBrokerRequestStarted(request);
    captureUserVisibleError(new Error('refresh failed before broker completion'), {
      category: 'NETWORK',
      severity: 'error',
      context: {
        source: 'refresh-orchestrator',
        operationId: request.id,
      },
    });

    expect(scopeMocks.setContext).toHaveBeenCalledWith('request', {
      id: 'broker-read-17',
      broker: 'data-access',
      resource: 'cluster-config',
      adapter: 'refresh-domain',
      reason: 'background',
    });
    expect(scopeMocks.setContext).toHaveBeenCalledWith('operation', {
      id: 'broker-read-17',
      source: 'refresh-orchestrator',
    });
    expect(scopeMocks.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          operationId: 'broker-read-17',
          requestId: 'broker-read-17',
        }),
      })
    );
  });

  it('rejects automatic breadcrumbs and keeps only allowlisted correlated activity', () => {
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
      options.beforeBreadcrumb({ category: 'ui.click', data: { target: 'button.save' } })
    ).toBe(null);
    expect(
      options.beforeBreadcrumb({
        category: 'request.broker',
        message: 'Started data-access request for pods',
        data: { id: 'broker-read-2', label: 'private label' },
      })
    ).toEqual({
      category: 'request.broker',
      message: 'Started data-access request for pods',
      data: {
        id: 'broker-read-2',
        'ui.view': 'namespace',
        'ui.tab': 'workloads',
        'cluster.alias': 'cluster-1',
      },
    });

    const filtered = options.beforeSend({
      contexts: {
        navigation: {
          view: 'namespace',
          tab: 'workloads',
          'cluster.alias': 'cluster-1',
          'namespace.alias': 'namespace-1',
        },
        request: { id: 'broker-read-2' },
      },
      breadcrumbs: [
        {
          category: 'ui.action.started',
          message: 'current click',
          data: {
            'ui.view': 'namespace',
            'ui.tab': 'workloads',
            'cluster.alias': 'cluster-1',
            'request.ids': ['broker-read-2'],
          },
        },
        {
          category: 'ui.action.started',
          message: 'same workspace, other request',
          data: {
            'ui.view': 'namespace',
            'ui.tab': 'workloads',
            'cluster.alias': 'cluster-1',
            'request.ids': ['broker-read-9'],
          },
        },
        {
          category: 'ui.action.started',
          message: 'different tab',
          data: {
            'ui.view': 'namespace',
            'ui.tab': 'events',
            'cluster.alias': 'cluster-1',
          },
        },
        {
          category: 'ui.action.started',
          message: 'different namespace',
          data: {
            'ui.view': 'namespace',
            'ui.tab': 'workloads',
            'cluster.alias': 'cluster-1',
            'namespace.alias': 'namespace-2',
          },
        },
        {
          category: 'request.broker',
          message: 'matching request',
          data: {
            id: 'broker-read-2',
            'ui.view': 'namespace',
            'ui.tab': 'workloads',
            'cluster.alias': 'cluster-1',
          },
        },
        {
          category: 'request.broker',
          message: 'other request',
          data: {
            id: 'broker-read-1',
            'ui.view': 'namespace',
            'ui.tab': 'workloads',
            'cluster.alias': 'cluster-1',
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
