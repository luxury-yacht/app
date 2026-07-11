/**
 * frontend/src/core/logging/appLogsClient.ts
 *
 * Helpers for sending frontend logs to the backend Application Logs.
 */

type AppLogsLevel = 'debug' | 'info' | 'warn' | 'error';

export interface AppLogsClusterMeta {
  clusterId?: string;
  clusterName?: string;
}

export const APP_LOG_SOURCES = {
  BackgroundClusterRefresher: 'BackgroundClusterRefresher',
  CatalogDiagnostics: 'CatalogDiagnostics',
  CatalogStream: 'CatalogStream',
  Frontend: 'Frontend',
  RefreshOrchestrator: 'RefreshOrchestrator',
  ResourceStream: 'ResourceStream',
} as const;

export interface AppLogsAddedEvent {
  sequence?: number;
}

export type AppLogsAddedHandler = (event?: AppLogsAddedEvent) => void;

const normalizeLevel = (level: AppLogsLevel): AppLogsLevel => {
  if (level === 'warn') {
    return 'warn';
  }
  return level;
};

const logToAppLogs = (
  level: AppLogsLevel,
  message: string,
  source?: string,
  cluster?: AppLogsClusterMeta
): void => {
  if (typeof window === 'undefined') {
    return;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }
  const api = window.go?.backend?.App;
  if (!api || typeof api.LogAppLogsFromFrontend !== 'function') {
    return;
  }
  const safeSource = (source ?? '').trim() || APP_LOG_SOURCES.Frontend;
  const clusterId = cluster?.clusterId?.trim() ?? '';
  const clusterName = cluster?.clusterName?.trim() ?? '';
  try {
    if ((clusterId || clusterName) && typeof api.LogAppLogsFromFrontendWithCluster === 'function') {
      void api.LogAppLogsFromFrontendWithCluster(
        normalizeLevel(level),
        trimmed,
        safeSource,
        clusterId,
        clusterName
      );
      return;
    }
    void api.LogAppLogsFromFrontend(normalizeLevel(level), trimmed, safeSource);
  } catch (_err) {
    // Ignore logging failures to avoid cascading errors.
  }
};

export const logAppLogsDebug = (
  message: string,
  source?: string,
  cluster?: AppLogsClusterMeta
): void => {
  logToAppLogs('debug', message, source, cluster);
};

export const logAppLogsInfo = (
  message: string,
  source?: string,
  cluster?: AppLogsClusterMeta
): void => {
  logToAppLogs('info', message, source, cluster);
};

export const logAppLogsWarn = (
  message: string,
  source?: string,
  cluster?: AppLogsClusterMeta
): void => {
  logToAppLogs('warn', message, source, cluster);
};

export const logAppLogsError = (
  message: string,
  source?: string,
  cluster?: AppLogsClusterMeta
): void => {
  logToAppLogs('error', message, source, cluster);
};

export const subscribeAppLogsAdded = (handler: AppLogsAddedHandler): (() => void) => {
  if (typeof window === 'undefined') {
    return () => undefined;
  }

  const runtime = window.runtime;
  if (!runtime?.EventsOn) {
    return () => undefined;
  }

  const eventHandler = (event?: unknown) => {
    handler(typeof event === 'object' && event !== null ? (event as AppLogsAddedEvent) : undefined);
  };

  const dispose = runtime.EventsOn('app-logs:added', eventHandler);
  if (typeof dispose === 'function') {
    return dispose;
  }

  return () => {
    runtime.EventsOff?.('app-logs:added', eventHandler);
  };
};
