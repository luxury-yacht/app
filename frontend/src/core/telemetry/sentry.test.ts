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

  it('initializes Sentry with native data collection', () => {
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
      dataCollection: {},
    });
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
});
