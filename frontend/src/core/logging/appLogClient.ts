/**
 * frontend/src/core/logging/appLogClient.ts
 *
 * Helpers for sending frontend logs to the backend Application Logs panel.
 */

type AppLogLevel = 'debug' | 'info' | 'warn' | 'error';

const normalizeLevel = (level: AppLogLevel): AppLogLevel => {
  if (level === 'warn') {
    return 'warn';
  }
  return level;
};

const logToApp = (level: AppLogLevel, message: string, source?: string): void => {
  if (typeof window === 'undefined') {
    return;
  }
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }
  const api = (window as any)?.go?.backend?.App;
  if (!api || typeof api.LogFrontend !== 'function') {
    return;
  }
  const safeSource = (source ?? '').trim() || 'Frontend';
  try {
    void api.LogFrontend(normalizeLevel(level), trimmed, safeSource);
  } catch (_err) {
    // Ignore logging failures to avoid cascading errors.
  }
};

export const logAppDebug = (message: string, source?: string): void => {
  logToApp('debug', message, source);
};

export const logAppInfo = (message: string, source?: string): void => {
  logToApp('info', message, source);
};

export const logAppWarn = (message: string, source?: string): void => {
  logToApp('warn', message, source);
};

export const logAppError = (message: string, source?: string): void => {
  logToApp('error', message, source);
};
