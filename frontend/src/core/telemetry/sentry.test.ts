import { beforeEach, describe, expect, it, vi } from 'vitest';

const sentryMocks = vi.hoisted(() => ({
  init: vi.fn(),
  reactErrorHandler: vi.fn(),
}));

vi.mock('@sentry/react', () => sentryMocks);

import { createReactRootErrorHandlers, initializeErrorReporting } from './sentry';

describe('Sentry error reporting', () => {
  beforeEach(() => {
    sentryMocks.init.mockReset();
    sentryMocks.reactErrorHandler.mockReset();
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
});
