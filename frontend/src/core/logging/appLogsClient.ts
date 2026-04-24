/**
 * frontend/src/core/logging/appLogsClient.ts
 *
 * Helpers for sending frontend logs to the backend Application Logs.
 */

type AppLogsLevel = 'debug' | 'info' | 'warn' | 'error';

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

const logToAppLogs = (level: AppLogsLevel, message: string, source?: string): void => {
  if (typeof window === 'undefined') {
    return;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }
  const api = (window as any)?.go?.backend?.App;
  if (!api || typeof api.LogAppLogsFromFrontend !== 'function') {
    return;
  }
  const safeSource = (source ?? '').trim() || 'Frontend';
  try {
    void api.LogAppLogsFromFrontend(normalizeLevel(level), trimmed, safeSource);
  } catch (_err) {
    // Ignore logging failures to avoid cascading errors.
  }
};

export const logAppLogsDebug = (message: string, source?: string): void => {
  logToAppLogs('debug', message, source);
};

export const logAppLogsInfo = (message: string, source?: string): void => {
  logToAppLogs('info', message, source);
};

export const logAppLogsWarn = (message: string, source?: string): void => {
  logToAppLogs('warn', message, source);
};

export const subscribeAppLogsAdded = (handler: AppLogsAddedHandler): (() => void) => {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const runtime = window.runtime;
  if (!runtime?.EventsOn) {
    return () => {};
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
