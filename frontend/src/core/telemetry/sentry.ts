import type { Breadcrumb, ErrorEvent } from '@sentry/react';
import * as Sentry from '@sentry/react';
import type { RootOptions } from 'react-dom/client';
import { eventBus } from '@/core/events/eventBus';

export interface SentryRuntimeConfig {
  enabled: boolean;
  dsn?: string;
  environment?: string;
  release?: string;
}

export interface UserVisibleErrorCapture {
  category: string;
  severity: string;
  surface?: 'operational' | 'user-visible';
  context?: Record<string, unknown>;
}

export interface ActiveViewContext {
  view: string;
  tab?: string;
  clusterId?: string;
  objectPanelOpen: boolean;
}

export interface BrokerRequestContext {
  id: string;
  broker: string;
  resource: string;
  adapter: string;
  reason?: string;
  label?: string;
  scope?: string;
}

interface CompletedBrokerRequestContext extends BrokerRequestContext {
  status: 'success' | 'error' | 'blocked';
  durationMs: number;
}

interface PendingBootstrapError {
  error: unknown;
  action: string;
  operationId: string;
}

interface UserActionContext {
  id: string;
  action: string;
}

let configuredRuntime: SentryRuntimeConfig | null = null;
let reportingInitialized = false;
let unsubscribePreference: (() => void) | null = null;
let operationSequence = 0;
let userActionSequence = 0;
let activeViewContext: ActiveViewContext | null = null;
let activeNamespaceContext: string | undefined;
let activeBrokerRequestIds = new Set<string>();
let requestByError = new WeakMap<object, CompletedBrokerRequestContext>();
let userActionByError = new WeakMap<object, UserActionContext>();
let bootstrapPreferenceResolved = false;
let bootstrapErrorSequence = 0;
let pendingBootstrapErrors: PendingBootstrapError[] = [];

const maxPendingBootstrapErrors = 10;

const contextString = (
  context: Record<string, unknown> | undefined,
  key: string
): string | undefined => {
  const value = context?.[key];
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

const normalizeOptionalString = (value?: string): string | undefined => {
  const trimmed = value?.trim();
  return trimmed || undefined;
};

const getActiveNavigationContext = (): (ActiveViewContext & { namespace?: string }) | null => {
  if (!activeViewContext) {
    return null;
  }
  return {
    ...activeViewContext,
    ...(activeViewContext.view === 'namespace' && activeNamespaceContext
      ? { namespace: activeNamespaceContext }
      : {}),
  };
};

const applyActiveViewContext = (): void => {
  const navigation = getActiveNavigationContext();
  if (!reportingInitialized || !navigation) {
    return;
  }
  const scope = Sentry.getIsolationScope();
  scope.setTag('ui.view', navigation.view);
  if (navigation.tab) {
    scope.setTag('ui.tab', navigation.tab);
  } else {
    scope.setTag('ui.tab', undefined);
  }
  if (navigation.clusterId) {
    scope.setTag('clusterId', navigation.clusterId);
  } else {
    scope.setTag('clusterId', undefined);
  }
  if (navigation.namespace) {
    scope.setTag('namespace', navigation.namespace);
  } else {
    scope.setTag('namespace', undefined);
  }
  scope.setContext('navigation', { ...navigation });
};

const breadcrumbWorkspaceData = (): Record<string, unknown> => {
  const navigation = getActiveNavigationContext();
  return {
    ...(navigation
      ? {
          'ui.view': navigation.view,
          ...(navigation.tab ? { 'ui.tab': navigation.tab } : {}),
          ...(navigation.clusterId ? { clusterId: navigation.clusterId } : {}),
          ...(navigation.namespace ? { namespace: navigation.namespace } : {}),
        }
      : {}),
    ...(activeBrokerRequestIds.size === 1
      ? { 'request.ids': Array.from(activeBrokerRequestIds) }
      : {}),
  };
};

const beforeBreadcrumb = (breadcrumb: Breadcrumb): Breadcrumb => ({
  ...breadcrumb,
  data: {
    ...breadcrumb.data,
    ...breadcrumbWorkspaceData(),
  },
});

const recordContext = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

const beforeSend = (event: ErrorEvent): ErrorEvent => {
  const navigation = recordContext(event.contexts?.navigation);
  const request = recordContext(event.contexts?.request);
  const operation = recordContext(event.contexts?.operation);
  const eventView = typeof navigation.view === 'string' ? navigation.view : undefined;
  const eventTab = typeof navigation.tab === 'string' ? navigation.tab : undefined;
  const eventClusterId =
    typeof event.tags?.clusterId === 'string'
      ? event.tags.clusterId
      : typeof navigation.clusterId === 'string'
        ? navigation.clusterId
        : undefined;
  const eventNamespace =
    typeof event.tags?.namespace === 'string'
      ? event.tags.namespace
      : typeof navigation.namespace === 'string'
        ? navigation.namespace
        : undefined;
  const eventRequestId = typeof request.id === 'string' ? request.id : undefined;
  const eventOperationId = typeof operation.id === 'string' ? operation.id : undefined;

  const workspaceBreadcrumbs = event.breadcrumbs?.filter((breadcrumb) => {
    const data = breadcrumb.data ?? {};
    if (breadcrumb.category === 'request.broker') {
      return Boolean(eventRequestId && data.id === eventRequestId);
    }
    if (eventView && data['ui.view'] && data['ui.view'] !== eventView) {
      return false;
    }
    if (eventTab && data['ui.tab'] && data['ui.tab'] !== eventTab) {
      return false;
    }
    if (eventClusterId && data.clusterId && data.clusterId !== eventClusterId) {
      return false;
    }
    if (eventNamespace && data.namespace && data.namespace !== eventNamespace) {
      return false;
    }
    return true;
  });

  let breadcrumbs = workspaceBreadcrumbs;
  if (eventRequestId) {
    breadcrumbs = workspaceBreadcrumbs?.filter((breadcrumb) => {
      const data = breadcrumb.data ?? {};
      if (breadcrumb.category === 'request.broker') {
        return data.id === eventRequestId;
      }
      if (breadcrumb.category?.startsWith('navigation.')) {
        return true;
      }
      if (breadcrumb.category === 'ui.error.presented') {
        return data.requestId === eventRequestId;
      }
      const requestIds = data['request.ids'];
      return Array.isArray(requestIds) && requestIds.includes(eventRequestId);
    });
  } else if (event.tags?.['error.surface'] === 'user-visible' && workspaceBreadcrumbs) {
    breadcrumbs = workspaceBreadcrumbs.filter(
      (breadcrumb) => breadcrumb.data?.operationId === eventOperationId
    );
  } else if (event.tags?.['error.surface'] === 'operational' && workspaceBreadcrumbs) {
    breadcrumbs = workspaceBreadcrumbs.filter(
      (breadcrumb) =>
        breadcrumb.category === 'ui.error.handled' &&
        breadcrumb.data?.operationId === eventOperationId
    );
  }

  return {
    ...event,
    breadcrumbs,
  };
};

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
    beforeBreadcrumb,
    beforeSend,
  });

  reportingInitialized = true;
  applyActiveViewContext();

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

const sendBootstrapError = ({ error, action, operationId }: PendingBootstrapError): void => {
  if (!reportingInitialized) {
    return;
  }
  const exception = error instanceof Error ? error : new Error(String(error));
  Sentry.withScope((scope) => {
    scope.setLevel('error');
    scope.setTag('error.surface', 'bootstrap');
    scope.setContext('operation', { id: operationId, action });
    Sentry.captureException(exception);
  });
};

const flushBootstrapErrors = (): void => {
  const errors = pendingBootstrapErrors;
  pendingBootstrapErrors = [];
  errors.forEach(sendBootstrapError);
};

// Bootstrap preference reads happen before the SDK may be initialized. Keep a
// small in-memory queue only until persisted consent is known; opt-out drops it.
export function captureBootstrapError(error: unknown, context: { action: string }): void {
  console.error(`Bootstrap failure (${context.action}):`, error);
  bootstrapErrorSequence += 1;
  const pending = {
    error,
    action: context.action,
    operationId: `bootstrap-error-${bootstrapErrorSequence}`,
  };
  if (reportingInitialized) {
    sendBootstrapError(pending);
    return;
  }
  if (bootstrapPreferenceResolved) {
    return;
  }
  pendingBootstrapErrors.push(pending);
  if (pendingBootstrapErrors.length > maxPendingBootstrapErrors) {
    pendingBootstrapErrors = pendingBootstrapErrors.slice(-maxPendingBootstrapErrors);
  }
}

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
  bootstrapPreferenceResolved = true;
  const available = Boolean(config.enabled && config.dsn?.trim());
  if (available && preferenceEnabled) {
    initializeErrorReporting(config);
    flushBootstrapErrors();
  } else {
    pendingBootstrapErrors = [];
    void disableErrorReporting();
  }
  eventBus.setHandlerErrorReporter((error, event) => {
    captureUserVisibleError(error, {
      category: 'UNKNOWN',
      severity: 'error',
      surface: 'operational',
      context: { source: 'EventBus', action: String(event) },
    });
  });
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
  operationSequence = 0;
  userActionSequence = 0;
  activeViewContext = null;
  activeNamespaceContext = undefined;
  activeBrokerRequestIds = new Set<string>();
  requestByError = new WeakMap<object, CompletedBrokerRequestContext>();
  userActionByError = new WeakMap<object, UserActionContext>();
  bootstrapPreferenceResolved = false;
  bootstrapErrorSequence = 0;
  pendingBootstrapErrors = [];
  eventBus.setHandlerErrorReporter(null);
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

export function setActiveViewContext(context: ActiveViewContext): void {
  const next: ActiveViewContext = {
    view: context.view.trim() || 'unknown',
    ...(normalizeOptionalString(context.tab) ? { tab: context.tab?.trim() } : {}),
    ...(normalizeOptionalString(context.clusterId) ? { clusterId: context.clusterId?.trim() } : {}),
    objectPanelOpen: context.objectPanelOpen,
  };
  if (JSON.stringify(activeViewContext) === JSON.stringify(next)) {
    return;
  }
  activeViewContext = next;
  if (!reportingInitialized) {
    return;
  }

  applyActiveViewContext();
  const navigation = getActiveNavigationContext() ?? next;
  Sentry.addBreadcrumb({
    type: 'navigation',
    category: 'navigation.workspace',
    level: 'info',
    message: `Entered ${next.tab ? `${next.view}/${next.tab}` : next.view}`,
    data: navigation,
  });
}

export function setActiveNamespaceContext(namespace?: string): void {
  const next = normalizeOptionalString(namespace);
  if (activeNamespaceContext === next) {
    return;
  }
  activeNamespaceContext = next;
  if (!reportingInitialized || activeViewContext?.view !== 'namespace') {
    return;
  }

  applyActiveViewContext();
  const navigation = getActiveNavigationContext();
  Sentry.addBreadcrumb({
    type: 'navigation',
    category: 'navigation.namespace',
    level: 'info',
    message: next ? `Selected namespace ${next}` : 'Cleared namespace selection',
    ...(navigation ? { data: navigation } : {}),
  });
}

export function recordBrokerRequestStarted(request: BrokerRequestContext): void {
  if (!reportingInitialized) {
    return;
  }
  activeBrokerRequestIds.add(request.id);
  if (request.reason !== 'user') {
    return;
  }
  Sentry.addBreadcrumb({
    type: 'default',
    category: 'request.broker',
    level: 'info',
    message: `Started ${request.broker} request for ${request.resource}`,
    data: request,
  });
}

export function recordBrokerRequestCompleted(
  request: BrokerRequestContext,
  outcome: {
    status: CompletedBrokerRequestContext['status'];
    durationMs: number;
    error?: unknown;
  }
): void {
  const completed: CompletedBrokerRequestContext = {
    ...request,
    status: outcome.status,
    durationMs: Math.max(0, outcome.durationMs),
  };
  if (
    outcome.error !== null &&
    outcome.error !== undefined &&
    (typeof outcome.error === 'object' || typeof outcome.error === 'function')
  ) {
    requestByError.set(outcome.error, completed);
  }
  if (reportingInitialized && (outcome.status === 'error' || request.reason === 'user')) {
    const failed = outcome.status === 'error';
    Sentry.addBreadcrumb({
      type: 'default',
      category: 'request.broker',
      level: failed ? 'error' : 'info',
      message: `${failed ? 'Failed' : 'Completed'} ${request.broker} request for ${request.resource}`,
      data: completed,
    });
  }
  activeBrokerRequestIds.delete(request.id);
}

const recordUserActionBreadcrumb = (
  userAction: UserActionContext,
  status: 'started' | 'completed' | 'failed'
): void => {
  if (!reportingInitialized) {
    return;
  }
  Sentry.addBreadcrumb({
    type: 'user',
    category: `ui.action.${status}`,
    level: status === 'failed' ? 'error' : 'info',
    message: `${status === 'started' ? 'Started' : status === 'failed' ? 'Failed' : 'Completed'} ${userAction.action}`,
    data: {
      operationId: userAction.id,
      action: userAction.action,
    },
  });
};

/**
 * Runs one user-initiated operation and binds a rejected Error to that exact
 * action instance. Callers can report the rethrown error through errorHandler;
 * captureUserVisibleError will recover the action id without using timing.
 */
export async function runUserAction<T>(action: string, work: () => T | Promise<T>): Promise<T> {
  userActionSequence += 1;
  const userAction = {
    id: `user-action-${userActionSequence}`,
    action: action.trim() || 'unknown',
  };
  recordUserActionBreadcrumb(userAction, 'started');
  try {
    const result = await work();
    recordUserActionBreadcrumb(userAction, 'completed');
    return result;
  } catch (error) {
    if (
      error !== null &&
      error !== undefined &&
      (typeof error === 'object' || typeof error === 'function')
    ) {
      userActionByError.set(error, userAction);
    }
    recordUserActionBreadcrumb(userAction, 'failed');
    throw error;
  }
}

export function captureUserVisibleError(error: unknown, details: UserVisibleErrorCapture): void {
  if (!reportingInitialized) {
    return;
  }

  const exception = error instanceof Error ? error : new Error(String(error));
  const request =
    error !== null &&
    error !== undefined &&
    (typeof error === 'object' || typeof error === 'function')
      ? requestByError.get(error)
      : undefined;
  const userAction =
    error !== null &&
    error !== undefined &&
    (typeof error === 'object' || typeof error === 'function')
      ? userActionByError.get(error)
      : undefined;
  operationSequence += 1;
  const operationId = request?.id ?? userAction?.id ?? `ui-error-${operationSequence}`;
  const action = contextString(details.context, 'action') ?? userAction?.action;
  const source = contextString(details.context, 'source');
  const operationClusterId = contextString(details.context, 'clusterId');
  const operationNamespace = contextString(details.context, 'namespace');
  const navigation = getActiveNavigationContext();
  const surface = details.surface ?? 'user-visible';

  Sentry.withScope((scope) => {
    scope.setLevel(details.severity === 'critical' ? 'fatal' : 'error');
    scope.setTag('error.surface', surface);
    scope.setTag('error.category', details.category);
    if (action) {
      scope.setTag('ui.action', action);
    }
    if (userAction) {
      scope.setTag('ui.action.id', userAction.id);
    }
    if (navigation) {
      scope.setTag('ui.view', navigation.view);
      if (navigation.tab) {
        scope.setTag('ui.tab', navigation.tab);
      }
      if (navigation.clusterId) {
        scope.setTag('clusterId', navigation.clusterId);
      }
      if (navigation.namespace) {
        scope.setTag('namespace', navigation.namespace);
      }
      scope.setContext('navigation', { ...navigation });
    }
    if (operationClusterId) {
      scope.setTag('clusterId', operationClusterId);
    }
    if (operationNamespace) {
      scope.setTag('namespace', operationNamespace);
    }
    if (request) {
      scope.setTag('request.broker', request.broker);
      scope.setTag('request.resource', request.resource);
      if (request.reason) {
        scope.setTag('request.reason', request.reason);
      }
      scope.setContext('request', { ...request });
    }
    scope.setContext('operation', {
      id: operationId,
      ...(action ? { action } : {}),
      ...(source ? { source } : {}),
    });
    scope.addBreadcrumb({
      type: 'error',
      category: surface === 'user-visible' ? 'ui.error.presented' : 'ui.error.handled',
      level: 'error',
      message: `${surface === 'user-visible' ? 'Presented' : 'Handled'} ${details.category} error`,
      data: {
        operationId,
        ...(action ? { action } : {}),
        ...(request ? { requestId: request.id } : {}),
      },
    });
    Sentry.captureException(exception);
  });
}
