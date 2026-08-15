/**
 * frontend/src/core/logging/appLogsClient.ts
 *
 * Helpers for sending frontend logs to the backend Application Logs.
 */

import { LogAppLogsFromFrontend, LogAppLogsFromFrontendWithCluster } from '@/core/backend-api';
import { type DesktopEventPayload, desktopRuntimeAvailable, onEvent } from '@/core/desktop-runtime';

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

export type AppLogsAddedEvent = DesktopEventPayload<'app-logs:added'>;

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
  if (!desktopRuntimeAvailable()) {
    return;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }
  const safeSource = (source ?? '').trim() || APP_LOG_SOURCES.Frontend;
  const clusterId = cluster?.clusterId?.trim() ?? '';
  const clusterName = cluster?.clusterName?.trim() ?? '';
  try {
    if (clusterId || clusterName) {
      void LogAppLogsFromFrontendWithCluster(
        normalizeLevel(level),
        trimmed,
        safeSource,
        clusterId,
        clusterName
      );
      return;
    }
    void LogAppLogsFromFrontend(normalizeLevel(level), trimmed, safeSource);
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
  if (!desktopRuntimeAvailable()) {
    return () => undefined;
  }

  const eventHandler = (event: AppLogsAddedEvent) => {
    handler(typeof event === 'object' && event !== null ? event : undefined);
  };

  return onEvent('app-logs:added', eventHandler);
};
