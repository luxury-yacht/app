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

const SAFE_FRONTEND_EXCEPTION_TYPES = new Set([
  'AggregateError',
  'DOMException',
  'Error',
  'EvalError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'TypeError',
  'URIError',
]);

const SAFE_FRONTEND_MECHANISM_TYPES = new Set([
  'auto.browser.browserapierrors.addEventListener',
  'auto.browser.browserapierrors.requestAnimationFrame',
  'auto.browser.browserapierrors.setInterval',
  'auto.browser.browserapierrors.setTimeout',
  'auto.browser.browserapierrors.xhr',
  'auto.browser.global_handlers.onerror',
  'auto.browser.global_handlers.onunhandledrejection',
  'auto.function.react.error_handler',
  'chained',
  'generic',
]);

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

const sanitizeStackFrame = (frame: StackFrame): StackFrame => {
  const codeFile = anonymousCodeFile(frame.abs_path ?? frame.filename);
  return {
    filename: codeFile,
    abs_path: codeFile,
    lineno: frame.lineno,
    colno: frame.colno,
    in_app: frame.in_app,
    debug_id: frame.debug_id,
  };
};

const anonymousExceptionType = (value?: string): string => {
  if (value && SAFE_FRONTEND_EXCEPTION_TYPES.has(value)) {
    return value;
  }
  return 'Error';
};

// Keep only build and stack-layout diagnostics. Error text and runtime context
// can contain kubeconfig names, object names, paths, URLs, or other identifiers.
export function sanitizeFrontendEvent(event: ErrorEvent, hint?: EventHint): ErrorEvent {
  const exceptionValues = event.exception?.values?.map((exception) => {
    const mechanism = exception.mechanism;
    const frames = exception.stacktrace?.frames?.map(sanitizeStackFrame);
    return {
      type: anonymousExceptionType(exception.type),
      value: ANONYMOUS_FRONTEND_ERROR_MESSAGE,
      mechanism: mechanism
        ? {
            type: SAFE_FRONTEND_MECHANISM_TYPES.has(mechanism.type) ? mechanism.type : 'generic',
            handled: mechanism.handled,
            synthetic: mechanism.synthetic,
            exception_id: mechanism.exception_id,
            parent_id: mechanism.parent_id,
            is_exception_group: mechanism.is_exception_group,
          }
        : undefined,
      stacktrace: frames ? { frames } : undefined,
    };
  });

  const sourceMapImages = event.debug_meta?.images
    ?.filter((image) => image.type === 'sourcemap')
    .map((image) => ({
      type: 'sourcemap' as const,
      code_file: anonymousCodeFile(image.code_file) ?? 'app:///bundle.js',
      debug_id: image.debug_id,
    }));

  if (hint?.attachments) {
    hint.attachments = [];
  }

  return {
    type: undefined,
    event_id: event.event_id,
    timestamp: event.timestamp,
    message: ANONYMOUS_FRONTEND_ERROR_MESSAGE,
    level: event.level,
    platform: event.platform,
    release: event.release,
    environment: event.environment,
    tags: {
      'app.surface': 'frontend',
      runtime: 'wails-webview',
    },
    exception: exceptionValues?.length ? { values: exceptionValues } : undefined,
    debug_meta: sourceMapImages?.length ? { images: sourceMapImages } : undefined,
  };
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
    integrations: (defaults) =>
      defaults.filter((integration) => integration.name !== 'BrowserSession'),
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
