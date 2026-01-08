/**
 * frontend/src/core/settings/appPreferences.ts
 *
 * Centralized preference cache and backend sync for app settings.
 * Keeps legacy localStorage reads for hydration until migration is complete.
 */

import { GetAppSettings, SetTheme, SetUseShortResourceNames } from '@wailsjs/go/backend/App';
import { eventBus } from '@/core/events';

export type ThemePreference = 'light' | 'dark' | 'system';
export type GridTablePersistenceMode = 'namespaced' | 'shared';

interface AppPreferences {
  theme: ThemePreference;
  useShortResourceNames: boolean;
  autoRefreshEnabled: boolean;
  refreshBackgroundClustersEnabled: boolean;
  metricsRefreshIntervalMs: number;
  gridTablePersistenceMode: GridTablePersistenceMode;
}

interface AppSettingsPayload {
  theme?: string;
  useShortResourceNames?: boolean;
  autoRefreshEnabled?: boolean;
  refreshBackgroundClustersEnabled?: boolean;
  metricsRefreshIntervalMs?: number;
  gridTablePersistenceMode?: string;
}

const DEFAULT_METRICS_REFRESH_INTERVAL_MS = 5000;

const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'system',
  useShortResourceNames: false,
  autoRefreshEnabled: true,
  refreshBackgroundClustersEnabled: true,
  metricsRefreshIntervalMs: DEFAULT_METRICS_REFRESH_INTERVAL_MS,
  gridTablePersistenceMode: 'shared',
};

const LEGACY_KEYS = {
  theme: 'app-theme-preference',
  shortNames: 'useShortResourceNames',
  autoRefresh: 'autoRefreshEnabled',
  backgroundRefresh: 'refreshBackgroundClustersEnabled',
  gridTablePersistence: 'gridtable:persistenceMode',
};

let preferenceCache: AppPreferences = { ...DEFAULT_PREFERENCES };
let hydrated = false;

const readLegacyTheme = (): ThemePreference | undefined => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return undefined;
  }
  const raw = window.localStorage.getItem(LEGACY_KEYS.theme);
  if (raw === 'light' || raw === 'dark' || raw === 'system') {
    return raw;
  }
  return undefined;
};

const readLegacyBoolean = (key: string): boolean | undefined => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return undefined;
  }
  const raw = window.localStorage.getItem(key);
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  return undefined;
};

const readLegacyGridTableMode = (): GridTablePersistenceMode | undefined => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return undefined;
  }
  const raw = window.localStorage.getItem(LEGACY_KEYS.gridTablePersistence);
  if (raw === 'shared' || raw === 'namespaced') {
    return raw;
  }
  return undefined;
};

const normalizeTheme = (value: string | undefined): ThemePreference => {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return DEFAULT_PREFERENCES.theme;
};

const normalizeGridTableMode = (value: string | undefined): GridTablePersistenceMode => {
  if (value === 'shared' || value === 'namespaced') {
    return value;
  }
  return DEFAULT_PREFERENCES.gridTablePersistenceMode;
};

const normalizeMetricsIntervalMs = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return DEFAULT_METRICS_REFRESH_INTERVAL_MS;
  }
  return Math.floor(value);
};

const resolvePreference = <T>(backendValue: T, legacyValue: T | undefined, defaultValue: T): T => {
  // Prefer backend values unless they are still default and legacy has a non-default override.
  if (legacyValue === undefined) {
    return backendValue;
  }
  if (backendValue !== defaultValue) {
    return backendValue;
  }
  if (legacyValue !== defaultValue) {
    return legacyValue;
  }
  return backendValue;
};

const emitPreferenceChanges = (previous: AppPreferences, next: AppPreferences): void => {
  if (previous.theme !== next.theme) {
    eventBus.emit('settings:theme', next.theme);
  }
  if (previous.useShortResourceNames !== next.useShortResourceNames) {
    eventBus.emit('settings:short-names', next.useShortResourceNames);
  }
  if (previous.autoRefreshEnabled !== next.autoRefreshEnabled) {
    eventBus.emit('settings:auto-refresh', next.autoRefreshEnabled);
  }
  if (previous.refreshBackgroundClustersEnabled !== next.refreshBackgroundClustersEnabled) {
    eventBus.emit('settings:refresh-background', next.refreshBackgroundClustersEnabled);
  }
  if (previous.metricsRefreshIntervalMs !== next.metricsRefreshIntervalMs) {
    eventBus.emit('settings:metrics-interval', next.metricsRefreshIntervalMs);
  }
  if (previous.gridTablePersistenceMode !== next.gridTablePersistenceMode) {
    eventBus.emit('gridtable:persistence-mode', next.gridTablePersistenceMode);
  }
};

const updatePreferenceCache = (updates: Partial<AppPreferences>): void => {
  const next = { ...preferenceCache, ...updates };
  const previous = preferenceCache;
  preferenceCache = next;
  emitPreferenceChanges(previous, next);
};

const clearLegacyKey = (key: string): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
};

// Skip persistence if the Wails runtime isn't available (e.g., unit tests).
const persistBooleanPreference = async (name: string, value: boolean): Promise<void> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  const setter = runtimeApp?.[name];
  if (typeof setter !== 'function') {
    throw new Error(`${name} is not available`);
  }
  await setter(value);
};

// Skip persistence if the Wails runtime isn't available (e.g., unit tests).
const persistGridTableMode = async (mode: GridTablePersistenceMode): Promise<void> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  const setter = runtimeApp?.SetGridTablePersistenceMode;
  if (typeof setter !== 'function') {
    throw new Error('SetGridTablePersistenceMode is not available');
  }
  await setter(mode);
};

const fetchAppSettings = async (): Promise<AppSettingsPayload | null> => {
  try {
    const settings = (await GetAppSettings()) as AppSettingsPayload | null;
    return settings ?? null;
  } catch {
    return null;
  }
};

export const hydrateAppPreferences = async (options?: {
  force?: boolean;
}): Promise<AppPreferences> => {
  // Merge backend preferences with legacy storage to avoid losing existing settings pre-migration.
  if (hydrated && !options?.force) {
    return { ...preferenceCache };
  }

  const legacyTheme = readLegacyTheme();
  const legacyShortNames = readLegacyBoolean(LEGACY_KEYS.shortNames);
  const legacyAutoRefresh = readLegacyBoolean(LEGACY_KEYS.autoRefresh);
  const legacyBackgroundRefresh = readLegacyBoolean(LEGACY_KEYS.backgroundRefresh);
  const legacyGridTableMode = readLegacyGridTableMode();

  const backendSettings = await fetchAppSettings();
  const backendPreferences: AppPreferences = {
    theme: normalizeTheme(backendSettings?.theme),
    useShortResourceNames:
      backendSettings?.useShortResourceNames ?? DEFAULT_PREFERENCES.useShortResourceNames,
    autoRefreshEnabled:
      backendSettings?.autoRefreshEnabled ?? DEFAULT_PREFERENCES.autoRefreshEnabled,
    refreshBackgroundClustersEnabled:
      backendSettings?.refreshBackgroundClustersEnabled ??
      DEFAULT_PREFERENCES.refreshBackgroundClustersEnabled,
    metricsRefreshIntervalMs: normalizeMetricsIntervalMs(backendSettings?.metricsRefreshIntervalMs),
    gridTablePersistenceMode: normalizeGridTableMode(backendSettings?.gridTablePersistenceMode),
  };

  const resolved: AppPreferences = {
    theme: resolvePreference(backendPreferences.theme, legacyTheme, DEFAULT_PREFERENCES.theme),
    useShortResourceNames: resolvePreference(
      backendPreferences.useShortResourceNames,
      legacyShortNames,
      DEFAULT_PREFERENCES.useShortResourceNames
    ),
    autoRefreshEnabled: resolvePreference(
      backendPreferences.autoRefreshEnabled,
      legacyAutoRefresh,
      DEFAULT_PREFERENCES.autoRefreshEnabled
    ),
    refreshBackgroundClustersEnabled: resolvePreference(
      backendPreferences.refreshBackgroundClustersEnabled,
      legacyBackgroundRefresh,
      DEFAULT_PREFERENCES.refreshBackgroundClustersEnabled
    ),
    metricsRefreshIntervalMs: backendPreferences.metricsRefreshIntervalMs,
    gridTablePersistenceMode: resolvePreference(
      backendPreferences.gridTablePersistenceMode,
      legacyGridTableMode,
      DEFAULT_PREFERENCES.gridTablePersistenceMode
    ),
  };

  hydrated = true;
  updatePreferenceCache(resolved);

  return { ...preferenceCache };
};

export const getThemePreference = (): ThemePreference => {
  if (!hydrated) {
    return readLegacyTheme() ?? preferenceCache.theme;
  }
  return preferenceCache.theme;
};

export const getUseShortResourceNames = (): boolean => {
  if (!hydrated) {
    return readLegacyBoolean(LEGACY_KEYS.shortNames) ?? preferenceCache.useShortResourceNames;
  }
  return preferenceCache.useShortResourceNames;
};

export const getAutoRefreshEnabled = (): boolean => {
  if (!hydrated) {
    return readLegacyBoolean(LEGACY_KEYS.autoRefresh) ?? preferenceCache.autoRefreshEnabled;
  }
  return preferenceCache.autoRefreshEnabled;
};

export const getBackgroundRefreshEnabled = (): boolean => {
  if (!hydrated) {
    return (
      readLegacyBoolean(LEGACY_KEYS.backgroundRefresh) ??
      preferenceCache.refreshBackgroundClustersEnabled
    );
  }
  return preferenceCache.refreshBackgroundClustersEnabled;
};

export const getMetricsRefreshIntervalMs = (): number => {
  if (!hydrated) {
    return preferenceCache.metricsRefreshIntervalMs;
  }
  return preferenceCache.metricsRefreshIntervalMs;
};

export const getGridTablePersistenceMode = (): GridTablePersistenceMode => {
  if (!hydrated) {
    return readLegacyGridTableMode() ?? preferenceCache.gridTablePersistenceMode;
  }
  return preferenceCache.gridTablePersistenceMode;
};

export const setThemePreference = async (theme: ThemePreference): Promise<void> => {
  const normalized = normalizeTheme(theme);
  await SetTheme(normalized);
  hydrated = true;
  updatePreferenceCache({ theme: normalized });
  clearLegacyKey(LEGACY_KEYS.theme);
};

export const setUseShortResourceNames = async (useShort: boolean): Promise<void> => {
  await SetUseShortResourceNames(useShort);
  hydrated = true;
  updatePreferenceCache({ useShortResourceNames: useShort });
  clearLegacyKey(LEGACY_KEYS.shortNames);
};

export const setAutoRefreshEnabled = (enabled: boolean): void => {
  hydrated = true;
  updatePreferenceCache({ autoRefreshEnabled: enabled });
  void persistBooleanPreference('SetAutoRefreshEnabled', enabled)
    .then(() => clearLegacyKey(LEGACY_KEYS.autoRefresh))
    .catch((error) => {
      console.error('Failed to persist auto-refresh preference:', error);
    });
};

export const setBackgroundRefreshEnabled = (enabled: boolean): void => {
  hydrated = true;
  updatePreferenceCache({ refreshBackgroundClustersEnabled: enabled });
  void persistBooleanPreference('SetBackgroundRefreshEnabled', enabled)
    .then(() => clearLegacyKey(LEGACY_KEYS.backgroundRefresh))
    .catch((error) => {
      console.error('Failed to persist background refresh preference:', error);
    });
};

export const setGridTablePersistenceMode = (mode: GridTablePersistenceMode): void => {
  const normalized = normalizeGridTableMode(mode);
  hydrated = true;
  updatePreferenceCache({ gridTablePersistenceMode: normalized });
  void persistGridTableMode(normalized)
    .then(() => clearLegacyKey(LEGACY_KEYS.gridTablePersistence))
    .catch((error) => {
      console.error('Failed to persist grid table persistence mode:', error);
    });
};

// Test helper to reset cached values between test runs.
export const resetAppPreferencesCacheForTesting = (): void => {
  preferenceCache = { ...DEFAULT_PREFERENCES };
  hydrated = false;
};
