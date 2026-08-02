import * as Sentry from '@sentry/react';
import type { RootOptions } from 'react-dom/client';
import { eventBus } from '@/core/events/eventBus';

export interface SentryRuntimeConfig {
  enabled: boolean;
  dsn?: string;
  environment?: string;
  release?: string;
}

let configuredRuntime: SentryRuntimeConfig | null = null;
let reportingInitialized = false;
let unsubscribePreference: (() => void) | null = null;

export function initializeErrorReporting(config: SentryRuntimeConfig): boolean {
  if (!config.enabled) {
    return false;
  }

  const dsn = config.dsn?.trim();
  if (!dsn) {
    return false;
  }

  if (reportingInitialized) {
    return true;
  }

  Sentry.init({
    dsn,
    environment: config.environment?.trim() || undefined,
    release: config.release?.trim() || undefined,
    dataCollection: {},
  });

  reportingInitialized = true;

  return true;
}

const disableErrorReporting = async (): Promise<void> => {
  if (!reportingInitialized) {
    return;
  }
  reportingInitialized = false;
  await Sentry.close(0);
};

const applyErrorReportingPreference = (enabled: boolean): void => {
  if (!configuredRuntime) {
    return;
  }
  if (enabled) {
    initializeErrorReporting({ ...configuredRuntime, enabled: configuredRuntime.enabled });
    return;
  }
  void disableErrorReporting();
};

// configureErrorReporting keeps the build configuration separate from the
// persisted opt-in state. It returns whether reporting is available in this
// build so React root handlers can remain installed across live preference
// changes without sending anything while the SDK is disabled.
export function configureErrorReporting(
  config: SentryRuntimeConfig,
  preferenceEnabled: boolean
): boolean {
  unsubscribePreference?.();
  configuredRuntime = { ...config };
  const available = Boolean(config.enabled && config.dsn?.trim());
  if (available && preferenceEnabled) {
    initializeErrorReporting(config);
  } else {
    void disableErrorReporting();
  }
  unsubscribePreference = eventBus.on('settings:error-reporting', applyErrorReportingPreference);
  return available;
}

export async function configureErrorReportingFromPreferences<
  TPreferences extends { errorReportingEnabled: boolean },
>(
  config: SentryRuntimeConfig,
  loadPreferences: () => Promise<TPreferences>
): Promise<{ available: boolean; preferences: TPreferences }> {
  const preferences = await loadPreferences();
  return {
    available: configureErrorReporting(config, preferences.errorReportingEnabled),
    preferences,
  };
}

export function resetErrorReportingForTesting(): void {
  unsubscribePreference?.();
  unsubscribePreference = null;
  configuredRuntime = null;
  reportingInitialized = false;
}

export function createReactRootErrorHandlers(enabled: boolean): RootOptions {
  if (!enabled) {
    return {};
  }

  const handler = Sentry.reactErrorHandler();
  return {
    onCaughtError: handler,
    onUncaughtError: handler,
    onRecoverableError: handler,
  };
}
