import { beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events/eventBus';

const sentryMocks = vi.hoisted(() => ({
  close: vi.fn(),
  init: vi.fn(),
  reactErrorHandler: vi.fn(),
}));

vi.mock('@sentry/react', () => sentryMocks);

import {
  configureErrorReporting,
  configureErrorReportingFromPreferences,
  createReactRootErrorHandlers,
  initializeErrorReporting,
  resetErrorReportingForTesting,
  sanitizeFrontendEvent,
} from './sentry';

describe('Sentry error reporting', () => {
  beforeEach(() => {
    resetErrorReportingForTesting();
    sentryMocks.init.mockReset();
    sentryMocks.reactErrorHandler.mockReset();
    sentryMocks.close.mockReset();
    sentryMocks.close.mockResolvedValue(true);
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

  it('initializes errors-only reporting with automatic sensitive data disabled', () => {
    expect(
      initializeErrorReporting({
        enabled: true,
        dsn: ' https://public@example.com/1 ',
        environment: ' production ',
        release: ' luxury-yacht@v1.2.3 ',
      })
    ).toBe(true);

    expect(sentryMocks.init).toHaveBeenCalledWith({
      dsn: 'https://public@example.com/1',
      environment: 'production',
      release: 'luxury-yacht@v1.2.3',
      attachStacktrace: true,
      beforeSend: sanitizeFrontendEvent,
      integrations: expect.any(Function),
      enableLogs: false,
      enableMetrics: false,
      sendClientReports: false,
      maxBreadcrumbs: 0,
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
        frameContextLines: 0,
      },
      initialScope: {
        tags: {
          'app.surface': 'frontend',
          runtime: 'wails-webview',
        },
      },
    });
  });

  it('excludes browser sessions so enabling error reporting sends nothing without an error', () => {
    initializeErrorReporting({
      enabled: true,
      dsn: 'https://public@example.com/1',
      environment: 'production',
      release: 'luxury-yacht@v1.2.3',
    });

    const options = sentryMocks.init.mock.calls[0]?.[0] as {
      integrations?: (defaults: Array<{ name: string }>) => Array<{ name: string }>;
    };
    const errorIntegration = { name: 'GlobalHandlers' };
    const sessionIntegration = { name: 'BrowserSession' };

    expect(options.integrations?.([errorIntegration, sessionIntegration])).toEqual([
      errorIntegration,
    ]);
  });

  it('installs React 19 root handlers only when reporting is enabled', () => {
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

  it('removes identifying data while retaining sanitized stack and release diagnostics', () => {
    const hint = {
      attachments: [{ filename: 'customer-kubeconfig', data: 'secret-value' }],
    };
    const event = {
      type: undefined,
      message: 'customer@example.com failed in production-cluster',
      logentry: { message: 'token=secret-value', params: ['customer@example.com'] },
      level: 'error' as const,
      platform: 'javascript',
      release: 'luxury-yacht@v1.2.3',
      environment: 'production',
      server_name: 'alice-workstation',
      transaction: 'production-cluster',
      tags: {
        'app.surface': 'frontend',
        runtime: 'wails-webview',
        clusterId: 'customer-kubeconfig:production',
      },
      request: { url: 'file:///Users/alice/private/index.html?token=secret-value' },
      user: { email: 'customer@example.com', ip_address: '192.0.2.10' },
      contexts: { customer: { email: 'customer@example.com' } },
      extra: { token: 'secret-value' },
      breadcrumbs: [{ message: 'opened production-cluster' }],
      modules: { 'private-module': '1.0.0' },
      fingerprint: ['customer@example.com'],
      exception: {
        values: [
          {
            type: 'CustomerProductionError',
            value: 'token=secret-value',
            mechanism: { type: 'generic', data: { clusterId: 'production-cluster' } },
            stacktrace: {
              frames: [
                {
                  filename: 'file:///Users/alice/private/assets/index-abc123.js',
                  abs_path: 'file:///Users/alice/private/assets/index-abc123.js',
                  function: 'customer@example.com',
                  module: 'customer-kubeconfig:production',
                  lineno: 42,
                  colno: 7,
                  context_line: 'const token = "secret-value";',
                  pre_context: ['customer@example.com'],
                  post_context: ['private.example.com'],
                  vars: { token: 'secret-value' },
                  in_app: true,
                  debug_id: '11111111-2222-3333-4444-555555555555',
                },
              ],
            },
          },
        ],
      },
      debug_meta: {
        images: [
          {
            type: 'sourcemap' as const,
            code_file: 'file:///Users/alice/private/assets/index-abc123.js',
            debug_id: '11111111-2222-3333-4444-555555555555',
          },
        ],
      },
    };

    const sanitized = sanitizeFrontendEvent(event, hint);

    expect(sanitized).not.toBe(event);
    expect(event.message).toBe('customer@example.com failed in production-cluster');
    expect(sanitized).toMatchObject({
      message: 'Frontend error',
      level: 'error',
      platform: 'javascript',
      release: 'luxury-yacht@v1.2.3',
      environment: 'production',
      tags: {
        'app.surface': 'frontend',
        runtime: 'wails-webview',
      },
      exception: {
        values: [
          {
            type: 'Error',
            value: 'Frontend error',
            stacktrace: {
              frames: [
                {
                  filename: 'app:///index-abc123.js',
                  abs_path: 'app:///index-abc123.js',
                  lineno: 42,
                  colno: 7,
                  in_app: true,
                  debug_id: '11111111-2222-3333-4444-555555555555',
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
            code_file: 'app:///index-abc123.js',
            debug_id: '11111111-2222-3333-4444-555555555555',
          },
        ],
      },
    });
    expect(hint.attachments).toEqual([]);

    const payload = JSON.stringify(sanitized);
    for (const identifyingValue of [
      'customer@example.com',
      'customer-kubeconfig:production',
      '192.0.2.10',
      'private.example.com',
      '/Users/alice',
      'secret-value',
      'CustomerProductionError',
      'production-cluster',
    ]) {
      expect(payload).not.toContain(identifyingValue);
    }
  });

  it('retains bounded exception diagnostics without mechanism metadata', () => {
    const event = {
      type: undefined,
      message: 'customer@example.com failed in production-cluster',
      exception: {
        values: [
          {
            type: 'TypeError',
            value: 'customer@example.com failed in production-cluster',
            mechanism: {
              type: 'auto.function.react.error_handler',
              handled: false,
              synthetic: true,
              exception_id: 2,
              parent_id: 1,
              is_exception_group: true,
              description: 'customer@example.com',
              data: { clusterId: 'customer-kubeconfig:production' },
            },
          },
        ],
      },
    };

    const sanitized = sanitizeFrontendEvent(event);

    expect(sanitized.exception?.values?.[0]).toEqual({
      type: 'TypeError',
      value: 'Frontend error',
      mechanism: {
        type: 'auto.function.react.error_handler',
        handled: false,
        synthetic: true,
        exception_id: 2,
        parent_id: 1,
        is_exception_group: true,
      },
    });
    expect(JSON.stringify(sanitized)).not.toContain('customer');
  });

  it('serializes only approved top-level diagnostic fields', () => {
    const event = {
      type: undefined,
      event_id: '0123456789abcdef0123456789abcdef',
      timestamp: 1_700_000_000,
      message: 'customer@example.com failed in production-cluster',
      level: 'error' as const,
      platform: 'javascript',
      release: 'luxury-yacht@v1.2.3',
      environment: 'production',
      sdk: { name: 'sentry.javascript.react', version: '10.69.0' },
      future_sensitive_field: 'customer-kubeconfig:production',
    };

    const payload = JSON.parse(JSON.stringify(sanitizeFrontendEvent(event)));

    expect(payload).toEqual({
      event_id: '0123456789abcdef0123456789abcdef',
      timestamp: 1_700_000_000,
      message: 'Frontend error',
      level: 'error',
      platform: 'javascript',
      release: 'luxury-yacht@v1.2.3',
      environment: 'production',
      tags: {
        'app.surface': 'frontend',
        runtime: 'wails-webview',
      },
    });
  });
});
