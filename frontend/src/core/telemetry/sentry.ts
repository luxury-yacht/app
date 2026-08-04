import type { Breadcrumb, ErrorEvent } from '@sentry/react';
import * as Sentry from '@sentry/react';
import type { RootOptions } from 'react-dom/client';
import { eventBus } from '@/core/events/eventBus';

export interface SentryRuntimeConfig {
  enabled: boolean;
  dsn?: string;
  environment?: string;
  release?: string;
  anonymizedId?: string;
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

type PrivacyBrokerRequestContext = Omit<BrokerRequestContext, 'label' | 'scope'> &
  Partial<Pick<CompletedBrokerRequestContext, 'status' | 'durationMs'>>;

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
let activeBrokerRequests = new Map<string, BrokerRequestContext>();
let requestByError = new WeakMap<object, CompletedBrokerRequestContext>();
let userActionByError = new WeakMap<object, UserActionContext>();
let bootstrapPreferenceResolved = false;
let bootstrapErrorSequence = 0;
let pendingBootstrapErrors: PendingBootstrapError[] = [];
let clusterAliasSequence = 0;
let namespaceAliasSequence = 0;
let clusterAliases = new Map<string, string>();
let namespaceAliases = new Map<string, string>();

const maxPendingBootstrapErrors = 10;

const privacyDataCollection = {
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
};

const allowedBreadcrumbFields: Record<string, ReadonlySet<string>> = {
  'navigation.workspace': new Set([
    'view',
    'tab',
    'cluster.alias',
    'namespace.alias',
    'objectPanelOpen',
  ]),
  'navigation.namespace': new Set([
    'view',
    'tab',
    'cluster.alias',
    'namespace.alias',
    'objectPanelOpen',
  ]),
  'request.broker': new Set([
    'id',
    'broker',
    'resource',
    'adapter',
    'reason',
    'status',
    'durationMs',
    'request.ids',
    'ui.view',
    'ui.tab',
    'cluster.alias',
    'namespace.alias',
  ]),
  'ui.action.started': new Set([
    'operationId',
    'action',
    'request.ids',
    'ui.view',
    'ui.tab',
    'cluster.alias',
    'namespace.alias',
  ]),
  'ui.action.completed': new Set([
    'operationId',
    'action',
    'request.ids',
    'ui.view',
    'ui.tab',
    'cluster.alias',
    'namespace.alias',
  ]),
  'ui.action.failed': new Set([
    'operationId',
    'action',
    'request.ids',
    'ui.view',
    'ui.tab',
    'cluster.alias',
    'namespace.alias',
  ]),
  'ui.error.presented': new Set([
    'operationId',
    'action',
    'requestId',
    'request.ids',
    'ui.view',
    'ui.tab',
    'cluster.alias',
    'namespace.alias',
  ]),
  'ui.error.handled': new Set([
    'operationId',
    'action',
    'requestId',
    'request.ids',
    'ui.view',
    'ui.tab',
    'cluster.alias',
    'namespace.alias',
  ]),
};

const privateTelemetryKeys = new Set([
  'authorization',
  'body',
  'clusterid',
  'clustername',
  'cookie',
  'cookies',
  'credential',
  'headers',
  'hostname',
  'namespace',
  'password',
  'query',
  'querystring',
  'requestbody',
  'resourcename',
  'secret',
  'servername',
  'token',
  'username',
  'vars',
]);

const normalizeTelemetryKey = (key: string): string => key.toLowerCase().replace(/[_\-.]/gu, '');

const isPrivateTelemetryKey = (key: string): boolean =>
  privateTelemetryKeys.has(normalizeTelemetryKey(key));

const aliasForCluster = (clusterId?: string): string | undefined => {
  const normalized = normalizeOptionalString(clusterId);
  if (!normalized) {
    return undefined;
  }
  const existing = clusterAliases.get(normalized);
  if (existing) {
    return existing;
  }
  clusterAliasSequence += 1;
  const alias = `cluster-${clusterAliasSequence}`;
  clusterAliases.set(normalized, alias);
  return alias;
};

const aliasForNamespace = (namespace?: string): string | undefined => {
  const normalized = normalizeOptionalString(namespace);
  if (!normalized) {
    return undefined;
  }
  const existing = namespaceAliases.get(normalized);
  if (existing) {
    return existing;
  }
  namespaceAliasSequence += 1;
  const alias = `namespace-${namespaceAliasSequence}`;
  namespaceAliases.set(normalized, alias);
  return alias;
};

const replaceKnownIdentifiers = (value: string): string => {
  const replacements = [...clusterAliases.entries(), ...namespaceAliases.entries()].sort(
    ([left], [right]) => right.length - left.length
  );
  return replacements.reduce(
    (sanitized, [privateValue, alias]) => sanitized.split(privateValue).join(alias),
    value
  );
};

const sanitizeTelemetryText = (rawValue: string): string => {
  let value = replaceKnownIdentifiers(rawValue);
  value = value.replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/giu, '[url]');
  value = value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu, '[email]');
  value = value.replace(
    /\b(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(?:\.(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}\b/gu,
    '[ip]'
  );
  value = value.replace(/(?:\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b|\b::1\b)/giu, '[ip]');
  value = value.replace(
    /\b(cluster|namespace|pod|deployment|statefulset|daemonset|service|secret|configmap|job|cronjob|node)s?(?:\.[a-z0-9.-]+)?\s+["'][^"']+["']/giu,
    '$1 "[resource]"'
  );
  value = value.replace(
    /\b(cluster|namespace|pod|deployment|statefulset|daemonset|service|secret|configmap|job|cronjob|node)s?(?:\.[a-z0-9.-]+)?\s+(?:[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*\b/giu,
    '$1 [resource]'
  );
  value = value.replace(
    /\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+(?:com|net|org|io|dev|cloud|local|internal|test|cluster|lan)\b/giu,
    '[host]'
  );
  value = value.replace(/(?:\/Users|\/home)\/[^\s"'<>]+/gu, '[local-path]');
  value = value.replace(/[A-Z]:\\Users\\[^\s"'<>]+/giu, '[local-path]');
  value = value.replace(
    /\b(authorization|access[_-]?key|api[_-]?key|cookie|credential|password|passwd|secret|session|token)\b\s*(?::=|=|:)\s*(?:bearer\s+)?["']?[^\s"',;]+["']?/giu,
    '$1=[redacted]'
  );
  value = value.replace(/\bbearer\s+[^\s"',;]+/giu, '[redacted]');
  return value;
};

const canonicalBundleIdentity = (rawValue: string): string => {
  const normalized = replaceKnownIdentifiers(rawValue).replace(/\\/gu, '/');
  let pathname = normalized;
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(normalized)) {
    try {
      pathname = new URL(normalized).pathname;
    } catch {
      return '[bundle]';
    }
  } else {
    pathname = pathname.split(/[?#]/u, 1)[0] ?? '';
  }

  const assetsMarker = '/assets/';
  const assetsIndex = pathname.lastIndexOf(assetsMarker);
  const pathnameSegments = pathname.split('/');
  const relativePath =
    assetsIndex >= 0
      ? pathname.slice(assetsIndex + 1)
      : (pathnameSegments[pathnameSegments.length - 1] ?? '');
  const segments = relativePath.split('/').filter(Boolean);
  if (
    segments.length === 0 ||
    segments.some(
      (segment: string) =>
        segment === '.' || segment === '..' || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,200}$/u.test(segment)
    )
  ) {
    return '[bundle]';
  }
  return `app:///${segments.join('/')}`;
};

const isBundleIdentityField = (key: string, path: readonly string[]): boolean => {
  if (key === 'code_file') {
    return path[0] === 'debug_meta' && path.includes('images');
  }
  if (key !== 'filename' && key !== 'abs_path') {
    return false;
  }
  return (
    path.includes('frames') &&
    (path[0] === 'exception' || path[0] === 'threads' || path[0] === 'stacktrace')
  );
};

const sanitizeTelemetryValue = (
  value: unknown,
  key = '',
  path: readonly string[] = key ? [key] : []
): unknown => {
  if (isPrivateTelemetryKey(key)) {
    return key === 'vars' ? undefined : '[redacted]';
  }
  if (typeof value === 'string') {
    if (isBundleIdentityField(key, path)) {
      return canonicalBundleIdentity(value);
    }
    return sanitizeTelemetryText(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeTelemetryValue(item, '', path));
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([childKey, childValue]) => [
        childKey,
        sanitizeTelemetryValue(childValue, childKey, [...path, childKey]),
      ])
      .filter(([, childValue]) => childValue !== undefined)
  );
};

const allowlistedBreadcrumb = (breadcrumb: Breadcrumb): Breadcrumb | null => {
  const category = breadcrumb.category;
  const allowedFields = category ? allowedBreadcrumbFields[category] : undefined;
  if (!allowedFields || !category) {
    return null;
  }
  const data = Object.fromEntries(
    Object.entries(breadcrumb.data ?? {})
      .filter(([key]) => allowedFields.has(key))
      .map(([key, value]) => [key, sanitizeTelemetryValue(value, key)])
  );
  return {
    ...breadcrumb,
    message: sanitizeTelemetryText(breadcrumb.message ?? ''),
    data,
  };
};

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

const normalizeAnonymizedId = (value?: string): string | undefined => {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  return normalized &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(normalized)
    ? normalized
    : undefined;
};

const privacyBrokerRequestContext = (
  request: BrokerRequestContext | CompletedBrokerRequestContext
): PrivacyBrokerRequestContext => ({
  id: request.id,
  broker: request.broker,
  resource: request.resource,
  adapter: request.adapter,
  ...(request.reason ? { reason: request.reason } : {}),
  ...('status' in request ? { status: request.status } : {}),
  ...('durationMs' in request ? { durationMs: request.durationMs } : {}),
});

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

const getPrivacyNavigationContext = (): Record<string, unknown> | null => {
  const navigation = getActiveNavigationContext();
  if (!navigation) {
    return null;
  }
  return {
    view: navigation.view,
    ...(navigation.tab ? { tab: navigation.tab } : {}),
    ...(aliasForCluster(navigation.clusterId)
      ? { 'cluster.alias': aliasForCluster(navigation.clusterId) }
      : {}),
    ...(aliasForNamespace(navigation.namespace)
      ? { 'namespace.alias': aliasForNamespace(navigation.namespace) }
      : {}),
    objectPanelOpen: navigation.objectPanelOpen,
  };
};

const applyActiveViewContext = (): void => {
  const navigation = getPrivacyNavigationContext();
  if (!reportingInitialized || !navigation) {
    return;
  }
  const scope = Sentry.getIsolationScope();
  scope.setTag('ui.view', String(navigation.view));
  if (navigation.tab) {
    scope.setTag('ui.tab', String(navigation.tab));
  } else {
    scope.setTag('ui.tab', undefined);
  }
  if (navigation['cluster.alias']) {
    scope.setTag('cluster.alias', String(navigation['cluster.alias']));
  } else {
    scope.setTag('cluster.alias', undefined);
  }
  if (navigation['namespace.alias']) {
    scope.setTag('namespace.alias', String(navigation['namespace.alias']));
  } else {
    scope.setTag('namespace.alias', undefined);
  }
  scope.setContext('navigation', { ...navigation });
};

const breadcrumbWorkspaceData = (): Record<string, unknown> => {
  const navigation = getPrivacyNavigationContext();
  return {
    ...(navigation
      ? {
          'ui.view': navigation.view,
          ...(navigation.tab ? { 'ui.tab': navigation.tab } : {}),
          ...(navigation['cluster.alias'] ? { 'cluster.alias': navigation['cluster.alias'] } : {}),
          ...(navigation['namespace.alias']
            ? { 'namespace.alias': navigation['namespace.alias'] }
            : {}),
        }
      : {}),
    ...(activeBrokerRequests.size === 1
      ? { 'request.ids': Array.from(activeBrokerRequests.keys()) }
      : {}),
  };
};

const beforeBreadcrumb = (breadcrumb: Breadcrumb): Breadcrumb | null =>
  allowlistedBreadcrumb({
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
  const eventClusterAlias =
    typeof event.tags?.['cluster.alias'] === 'string'
      ? event.tags['cluster.alias']
      : typeof navigation['cluster.alias'] === 'string'
        ? navigation['cluster.alias']
        : undefined;
  const eventNamespaceAlias =
    typeof event.tags?.['namespace.alias'] === 'string'
      ? event.tags['namespace.alias']
      : typeof navigation['namespace.alias'] === 'string'
        ? navigation['namespace.alias']
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
    if (eventClusterAlias && data['cluster.alias'] && data['cluster.alias'] !== eventClusterAlias) {
      return false;
    }
    if (
      eventNamespaceAlias &&
      data['namespace.alias'] &&
      data['namespace.alias'] !== eventNamespaceAlias
    ) {
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

  const privacyBreadcrumbs = breadcrumbs
    ?.map((breadcrumb) => allowlistedBreadcrumb(breadcrumb))
    .filter((breadcrumb): breadcrumb is Breadcrumb => breadcrumb !== null);
  const contexts = Object.fromEntries(
    Object.entries(event.contexts ?? {})
      .filter(([key]) => key !== 'culture')
      .map(([key, value]) => [key, sanitizeTelemetryValue(value, key)])
  );
  const userId = normalizeAnonymizedId(
    typeof event.user?.id === 'string' ? event.user.id : undefined
  );
  const sanitized = sanitizeTelemetryValue({
    ...event,
    breadcrumbs: privacyBreadcrumbs,
    contexts: contexts as ErrorEvent['contexts'],
  }) as ErrorEvent;

  return {
    ...sanitized,
    user: userId ? { id: userId } : undefined,
    request: undefined,
    server_name: undefined,
    contexts: contexts as ErrorEvent['contexts'],
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

  const anonymizedId = normalizeAnonymizedId(config.anonymizedId);
  const pageSessionIntegration = Sentry.browserSessionIntegration({ lifecycle: 'page' });

  Sentry.init({
    dsn,
    environment: config.environment?.trim() || undefined,
    release: config.release?.trim() || undefined,
    dataCollection: privacyDataCollection,
    initialScope: anonymizedId ? { user: { id: anonymizedId } } : undefined,
    integrations: (defaultIntegrations) => [
      ...defaultIntegrations.filter(
        (integration) =>
          integration.name !== 'Breadcrumbs' &&
          integration.name !== 'BrowserSession' &&
          integration.name !== 'CultureContext'
      ),
      pageSessionIntegration,
    ],
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
// small in-memory queue only until the persisted preference is known; opt-out drops it.
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
// persisted preference. It returns whether reporting is available in this
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
  TPreferences extends { errorReportingEnabled: boolean; anonymizedId: string },
>(
  config: SentryRuntimeConfig,
  loadPreferences: () => Promise<TPreferences>
): Promise<{ available: boolean; preferences: TPreferences }> {
  const preferences = await loadPreferences();
  const runtimeConfig = { ...config, anonymizedId: preferences.anonymizedId };
  return {
    available: configureErrorReporting(runtimeConfig, preferences.errorReportingEnabled),
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
  activeBrokerRequests = new Map<string, BrokerRequestContext>();
  requestByError = new WeakMap<object, CompletedBrokerRequestContext>();
  userActionByError = new WeakMap<object, UserActionContext>();
  bootstrapPreferenceResolved = false;
  bootstrapErrorSequence = 0;
  pendingBootstrapErrors = [];
  clusterAliasSequence = 0;
  namespaceAliasSequence = 0;
  clusterAliases = new Map<string, string>();
  namespaceAliases = new Map<string, string>();
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
  const navigation = getPrivacyNavigationContext() ?? {
    view: next.view,
    ...(next.tab ? { tab: next.tab } : {}),
    objectPanelOpen: next.objectPanelOpen,
  };
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
  const navigation = getPrivacyNavigationContext();
  const namespaceAlias = aliasForNamespace(next);
  Sentry.addBreadcrumb({
    type: 'navigation',
    category: 'navigation.namespace',
    level: 'info',
    message: namespaceAlias ? `Selected ${namespaceAlias}` : 'Cleared namespace selection',
    ...(navigation ? { data: navigation } : {}),
  });
}

export function recordBrokerRequestStarted(request: BrokerRequestContext): void {
  if (!reportingInitialized) {
    return;
  }
  activeBrokerRequests.set(request.id, request);
  if (request.reason !== 'user') {
    return;
  }
  Sentry.addBreadcrumb({
    type: 'default',
    category: 'request.broker',
    level: 'info',
    message: `Started ${request.broker} request for ${request.resource}`,
    data: privacyBrokerRequestContext(request),
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
      data: privacyBrokerRequestContext(completed),
    });
  }
  activeBrokerRequests.delete(request.id);
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
  const completedRequest =
    error !== null &&
    error !== undefined &&
    (typeof error === 'object' || typeof error === 'function')
      ? requestByError.get(error)
      : undefined;
  const explicitOperationId = contextString(details.context, 'operationId');
  const request =
    completedRequest ??
    (explicitOperationId ? activeBrokerRequests.get(explicitOperationId) : undefined);
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
  const navigation = getPrivacyNavigationContext();
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
      scope.setTag('ui.view', String(navigation.view));
      if (navigation.tab) {
        scope.setTag('ui.tab', String(navigation.tab));
      }
      if (navigation['cluster.alias']) {
        scope.setTag('cluster.alias', String(navigation['cluster.alias']));
      }
      if (navigation['namespace.alias']) {
        scope.setTag('namespace.alias', String(navigation['namespace.alias']));
      }
      scope.setContext('navigation', { ...navigation });
    }
    if (operationClusterId) {
      scope.setTag('cluster.alias', aliasForCluster(operationClusterId) ?? 'cluster-unknown');
    }
    if (operationNamespace) {
      scope.setTag('namespace.alias', aliasForNamespace(operationNamespace) ?? 'namespace-unknown');
    }
    if (request) {
      scope.setTag('request.broker', request.broker);
      scope.setTag('request.resource', request.resource);
      if (request.reason) {
        scope.setTag('request.reason', request.reason);
      }
      scope.setContext('request', privacyBrokerRequestContext(request));
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
