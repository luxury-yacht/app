import type { ErrorEvent, EventHint, StackFrame } from '@sentry/react';
import * as Sentry from '@sentry/react';
import type { RootOptions } from 'react-dom/client';
import { eventBus } from '@/core/events/eventBus';

export interface SentryRuntimeConfig {
  enabled: boolean;
  dsn?: string;
  environment?: string;
  release?: string;
}

const ANONYMOUS_FRONTEND_ERROR_MESSAGE = 'Frontend error';

let configuredRuntime: SentryRuntimeConfig | null = null;
let reportingInitialized = false;
let unsubscribePreference: (() => void) | null = null;

const anonymousCodeFile = (value?: string): string | undefined => {
  if (!value) {
    return undefined;
  }
  const normalized = value.replace(/\\/g, '/').split(/[?#]/, 1)[0];
  const pathSegments = normalized.split('/').filter(Boolean);
  const filename = pathSegments[pathSegments.length - 1];
  return filename ? `app:///${filename}` : undefined;
};

const sanitizeStackFrame = (frame: StackFrame): StackFrame => ({
  filename: anonymousCodeFile(frame.filename),
  function: frame.function,
  module: frame.module,
  lineno: frame.lineno,
  colno: frame.colno,
  in_app: frame.in_app,
  debug_id: frame.debug_id,
});

// Keep only build and stack-layout diagnostics. Error text and runtime context
// can contain kubeconfig names, object names, paths, URLs, or other identifiers.
export function sanitizeFrontendEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent {
  event.message = ANONYMOUS_FRONTEND_ERROR_MESSAGE;
  event.logentry = undefined;
  event.start_timestamp = undefined;
  event.server_name = undefined;
  event.dist = undefined;
  event.request = undefined;
  event.transaction = undefined;
  event.modules = undefined;
  event.fingerprint = undefined;
  event.breadcrumbs = undefined;
  event.contexts = undefined;
  event.extra = undefined;
  event.user = undefined;
  event.type = undefined;
  event.spans = undefined;
  event.measurements = undefined;
  event.sdkProcessingMetadata = undefined;
  event.transaction_info = undefined;
  event.threads = undefined;
  event.tags = {
    'app.surface': 'frontend',
    runtime: 'wails-webview',
  };

  for (const exception of event.exception?.values ?? []) {
    exception.type = 'Error';
    exception.value = ANONYMOUS_FRONTEND_ERROR_MESSAGE;
    exception.module = undefined;
    exception.thread_id = undefined;
    exception.mechanism = undefined;
    if (exception.stacktrace?.frames) {
      exception.stacktrace.frames = exception.stacktrace.frames.map(sanitizeStackFrame);
    }
  }

  const sourceMapImages = event.debug_meta?.images
    ?.filter((image) => image.type === 'sourcemap')
    .map((image) => ({
      type: 'sourcemap' as const,
      code_file: anonymousCodeFile(image.code_file) ?? 'app:///bundle.js',
      debug_id: image.debug_id,
    }));
  event.debug_meta = sourceMapImages?.length ? { images: sourceMapImages } : undefined;

  if (hint?.attachments) {
    hint.attachments = [];
  }
  return event;
}

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
    attachStacktrace: true,
    beforeSend: sanitizeFrontendEvent,
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
