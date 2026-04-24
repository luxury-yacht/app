/**
 * frontend/src/core/settings/appPreferences.ts
 *
 * Centralized preference cache and backend sync for app settings.
 */

import {
  SetTheme,
  SetUseShortResourceNames,
  SaveTheme,
  DeleteTheme,
  ReorderThemes,
  ApplyTheme,
  MatchThemeForCluster,
  SetObjPanelLogsBufferMaxSize as SetObjPanelLogsBufferMaxSizeBackend,
  SetMaxTableRows as SetMaxTableRowsBackend,
  SetObjPanelLogsAPITimestampFormat as SetObjPanelLogsAPITimestampFormatBackend,
  SetObjPanelLogsAPITimestampUseLocalTimeZone as SetObjPanelLogsAPITimestampUseLocalTimeZoneBackend,
  SetObjPanelLogsTargetGlobalLimit as SetObjPanelLogsTargetGlobalLimitBackend,
  SetObjPanelLogsTargetPerScopeLimit as SetObjPanelLogsTargetPerScopeLimitBackend,
} from '@wailsjs/go/backend/App';
import { types } from '@wailsjs/go/models';
import { readAppSettings, readThemes, requestAppState } from '@/core/app-state-access';
import { eventBus } from '@/core/events';
import {
  DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
  getObjPanelLogsApiTimestampFormatValidationError,
  normalizeObjPanelLogsApiTimestampFormat,
} from '@/utils/objPanelLogsApiTimestampFormat';

export type ThemePreference = 'light' | 'dark' | 'system';
export type GridTablePersistenceMode = 'namespaced' | 'shared';
export type ObjectPanelPosition = 'right' | 'bottom' | 'floating';

interface AppPreferences {
  theme: ThemePreference;
  useShortResourceNames: boolean;
  autoRefreshEnabled: boolean;
  refreshBackgroundClustersEnabled: boolean;
  metricsRefreshIntervalMs: number;
  maxTableRows: number;
  objPanelLogsBufferMaxSize: number;
  objPanelLogsApiTimestampFormat: string;
  objPanelLogsApiTimestampUseLocalTimeZone: boolean;
  objPanelLogsTargetPerScopeLimit: number;
  objPanelLogsTargetGlobalLimit: number;
  gridTablePersistenceMode: GridTablePersistenceMode;
  defaultObjectPanelPosition: ObjectPanelPosition;
  objectPanelDockedRightWidth: number;
  objectPanelDockedBottomHeight: number;
  objectPanelFloatingWidth: number;
  objectPanelFloatingHeight: number;
  objectPanelFloatingX: number;
  objectPanelFloatingY: number;
  paletteHueLight: number;
  paletteSaturationLight: number;
  paletteBrightnessLight: number;
  paletteHueDark: number;
  paletteSaturationDark: number;
  paletteBrightnessDark: number;
  accentColorLight: string;
  accentColorDark: string;
  linkColorLight: string;
  linkColorDark: string;
}

interface AppSettingsPayload {
  theme?: string;
  useShortResourceNames?: boolean;
  autoRefreshEnabled?: boolean;
  refreshBackgroundClustersEnabled?: boolean;
  metricsRefreshIntervalMs?: number;
  maxTableRows?: number;
  objPanelLogsBufferMaxSize?: number;
  objPanelLogsApiTimestampFormat?: string;
  objPanelLogsApiTimestampUseLocalTimeZone?: boolean;
  objPanelLogsTargetPerScopeLimit?: number;
  objPanelLogsTargetGlobalLimit?: number;
  gridTablePersistenceMode?: string;
  defaultObjectPanelPosition?: string;
  objectPanelDockedRightWidth?: number;
  objectPanelDockedBottomHeight?: number;
  objectPanelFloatingWidth?: number;
  objectPanelFloatingHeight?: number;
  objectPanelFloatingX?: number;
  objectPanelFloatingY?: number;
  // Migration: old single-value fields.
  paletteHue?: number;
  paletteSaturation?: number;
  paletteBrightness?: number;
  // Per-theme palette fields.
  paletteHueLight?: number;
  paletteSaturationLight?: number;
  paletteBrightnessLight?: number;
  paletteHueDark?: number;
  paletteSaturationDark?: number;
  paletteBrightnessDark?: number;
  accentColorLight?: string;
  accentColorDark?: string;
  linkColorLight?: string;
  linkColorDark?: string;
}

const DEFAULT_METRICS_REFRESH_INTERVAL_MS = 5000;

// ObjPanelLogs buffer bounds — keep in lockstep with backend/app_settings.go so
// the client and server agree on the clamp range.
export const OBJ_PANEL_LOGS_BUFFER_MIN_SIZE = 100;
export const OBJ_PANEL_LOGS_BUFFER_MAX_SIZE = 10000;
export const OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE = 1000;
export const MAX_TABLE_ROWS_MIN = 100;
export const MAX_TABLE_ROWS_MAX = 10000;
export const MAX_TABLE_ROWS_DEFAULT = 1000;
export const OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MIN = 1;
export const OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX = 1000;
export const OBJ_PANEL_LOGS_TARGET_PER_SCOPE_DEFAULT = 100;
export const OBJ_PANEL_LOGS_TARGET_GLOBAL_MIN = 1;
export const OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX = 1000;
export const OBJ_PANEL_LOGS_TARGET_GLOBAL_DEFAULT = 200;

const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'system',
  useShortResourceNames: false,
  autoRefreshEnabled: true,
  refreshBackgroundClustersEnabled: true,
  metricsRefreshIntervalMs: DEFAULT_METRICS_REFRESH_INTERVAL_MS,
  maxTableRows: MAX_TABLE_ROWS_DEFAULT,
  objPanelLogsBufferMaxSize: OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE,
  objPanelLogsApiTimestampFormat: DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
  objPanelLogsApiTimestampUseLocalTimeZone: false,
  objPanelLogsTargetPerScopeLimit: OBJ_PANEL_LOGS_TARGET_PER_SCOPE_DEFAULT,
  objPanelLogsTargetGlobalLimit: OBJ_PANEL_LOGS_TARGET_GLOBAL_DEFAULT,
  paletteHueLight: 0,
  paletteSaturationLight: 0,
  paletteBrightnessLight: 0,
  paletteHueDark: 0,
  paletteSaturationDark: 0,
  paletteBrightnessDark: 0,
  accentColorLight: '',
  accentColorDark: '',
  linkColorLight: '',
  linkColorDark: '',

  // make sure these match the defaults in backend/app_settings.go
  gridTablePersistenceMode: 'shared',
  defaultObjectPanelPosition: 'right',
  objectPanelDockedRightWidth: 600,
  objectPanelDockedBottomHeight: 400,
  objectPanelFloatingWidth: 500,
  objectPanelFloatingHeight: 400,
  objectPanelFloatingX: 100,
  objectPanelFloatingY: 100,
};

let preferenceCache: AppPreferences = { ...DEFAULT_PREFERENCES };
let hydrated = false;

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

const normalizeObjectPanelPosition = (value: string | undefined): ObjectPanelPosition => {
  if (value === 'right' || value === 'bottom' || value === 'floating') {
    return value;
  }
  return DEFAULT_PREFERENCES.defaultObjectPanelPosition;
};

const normalizeMetricsIntervalMs = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return DEFAULT_METRICS_REFRESH_INTERVAL_MS;
  }
  return Math.floor(value);
};

const normalizeMaxTableRows = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return MAX_TABLE_ROWS_DEFAULT;
  }
  const floored = Math.floor(value);
  if (floored < MAX_TABLE_ROWS_MIN) return MAX_TABLE_ROWS_MIN;
  if (floored > MAX_TABLE_ROWS_MAX) return MAX_TABLE_ROWS_MAX;
  return floored;
};

// Clamp to [OBJ_PANEL_LOGS_BUFFER_MIN_SIZE, OBJ_PANEL_LOGS_BUFFER_MAX_SIZE]. A zero/undefined
// value from an old settings file (before this preference existed) maps
// to the default, not to zero — otherwise an upgrade would wipe every
// Object Panel Logs Tab to empty.
const normalizeObjPanelLogsBufferMaxSize = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE;
  }
  const floored = Math.floor(value);
  if (floored < OBJ_PANEL_LOGS_BUFFER_MIN_SIZE) return OBJ_PANEL_LOGS_BUFFER_MIN_SIZE;
  if (floored > OBJ_PANEL_LOGS_BUFFER_MAX_SIZE) return OBJ_PANEL_LOGS_BUFFER_MAX_SIZE;
  return floored;
};

const normalizeObjPanelLogsTargetPerScopeLimit = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return OBJ_PANEL_LOGS_TARGET_PER_SCOPE_DEFAULT;
  }
  const floored = Math.floor(value);
  if (floored < OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MIN) return OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MIN;
  if (floored > OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX) return OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX;
  return floored;
};

const normalizeObjPanelLogsTargetGlobalLimit = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return OBJ_PANEL_LOGS_TARGET_GLOBAL_DEFAULT;
  }
  const floored = Math.floor(value);
  if (floored < OBJ_PANEL_LOGS_TARGET_GLOBAL_MIN) return OBJ_PANEL_LOGS_TARGET_GLOBAL_MIN;
  if (floored > OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX) return OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX;
  return floored;
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
  if (previous.maxTableRows !== next.maxTableRows) {
    eventBus.emit('settings:max-table-rows', next.maxTableRows);
  }
  if (previous.objPanelLogsBufferMaxSize !== next.objPanelLogsBufferMaxSize) {
    eventBus.emit('settings:obj-panel-logs-buffer-size', next.objPanelLogsBufferMaxSize);
  }
  if (previous.objPanelLogsApiTimestampFormat !== next.objPanelLogsApiTimestampFormat) {
    eventBus.emit(
      'settings:obj-panel-logs-api-timestamp-format',
      next.objPanelLogsApiTimestampFormat
    );
  }
  if (
    previous.objPanelLogsApiTimestampUseLocalTimeZone !==
    next.objPanelLogsApiTimestampUseLocalTimeZone
  ) {
    eventBus.emit(
      'settings:obj-panel-logs-api-timestamp-use-local-time-zone',
      next.objPanelLogsApiTimestampUseLocalTimeZone
    );
  }
  if (previous.objPanelLogsTargetPerScopeLimit !== next.objPanelLogsTargetPerScopeLimit) {
    eventBus.emit(
      'settings:obj-panel-logs-target-per-scope-limit',
      next.objPanelLogsTargetPerScopeLimit
    );
  }
  if (previous.objPanelLogsTargetGlobalLimit !== next.objPanelLogsTargetGlobalLimit) {
    eventBus.emit(
      'settings:obj-panel-logs-target-global-limit',
      next.objPanelLogsTargetGlobalLimit
    );
  }
  if (previous.gridTablePersistenceMode !== next.gridTablePersistenceMode) {
    eventBus.emit('gridtable:persistence-mode', next.gridTablePersistenceMode);
  }
  // Emit per-theme palette changes separately for light and dark.
  if (
    previous.paletteHueLight !== next.paletteHueLight ||
    previous.paletteSaturationLight !== next.paletteSaturationLight ||
    previous.paletteBrightnessLight !== next.paletteBrightnessLight
  ) {
    eventBus.emit('settings:palette-tint', {
      theme: 'light',
      hue: next.paletteHueLight,
      saturation: next.paletteSaturationLight,
      brightness: next.paletteBrightnessLight,
    });
  }
  if (
    previous.paletteHueDark !== next.paletteHueDark ||
    previous.paletteSaturationDark !== next.paletteSaturationDark ||
    previous.paletteBrightnessDark !== next.paletteBrightnessDark
  ) {
    eventBus.emit('settings:palette-tint', {
      theme: 'dark',
      hue: next.paletteHueDark,
      saturation: next.paletteSaturationDark,
      brightness: next.paletteBrightnessDark,
    });
  }
  if (previous.accentColorLight !== next.accentColorLight) {
    eventBus.emit('settings:accent-color', { theme: 'light', color: next.accentColorLight });
  }
  if (previous.accentColorDark !== next.accentColorDark) {
    eventBus.emit('settings:accent-color', { theme: 'dark', color: next.accentColorDark });
  }
  if (previous.linkColorLight !== next.linkColorLight) {
    eventBus.emit('settings:link-color', { theme: 'light', color: next.linkColorLight });
  }
  if (previous.linkColorDark !== next.linkColorDark) {
    eventBus.emit('settings:link-color', { theme: 'dark', color: next.linkColorDark });
  }
};

const updatePreferenceCache = (updates: Partial<AppPreferences>): void => {
  const next = { ...preferenceCache, ...updates };
  const previous = preferenceCache;
  preferenceCache = next;
  emitPreferenceChanges(previous, next);
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

const persistObjectPanelPosition = async (position: ObjectPanelPosition): Promise<void> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  const setter = runtimeApp?.SetDefaultObjectPanelPosition;
  if (typeof setter !== 'function') {
    throw new Error('SetDefaultObjectPanelPosition is not available');
  }
  await setter(position);
};

const fetchAppSettings = async (): Promise<AppSettingsPayload | null> => {
  try {
    const settings = (await requestAppState({
      resource: 'app-settings',
      read: () => readAppSettings(),
    })) as AppSettingsPayload | null;
    return settings ?? null;
  } catch {
    return null;
  }
};

export const hydrateAppPreferences = async (options?: {
  force?: boolean;
}): Promise<AppPreferences> => {
  if (hydrated && !options?.force) {
    return { ...preferenceCache };
  }

  const backendSettings = await fetchAppSettings();
  const preferences: AppPreferences = {
    theme: normalizeTheme(backendSettings?.theme),
    useShortResourceNames:
      backendSettings?.useShortResourceNames ?? DEFAULT_PREFERENCES.useShortResourceNames,
    autoRefreshEnabled:
      backendSettings?.autoRefreshEnabled ?? DEFAULT_PREFERENCES.autoRefreshEnabled,
    refreshBackgroundClustersEnabled:
      backendSettings?.refreshBackgroundClustersEnabled ??
      DEFAULT_PREFERENCES.refreshBackgroundClustersEnabled,
    metricsRefreshIntervalMs: normalizeMetricsIntervalMs(backendSettings?.metricsRefreshIntervalMs),
    maxTableRows: normalizeMaxTableRows(backendSettings?.maxTableRows),
    objPanelLogsBufferMaxSize: normalizeObjPanelLogsBufferMaxSize(
      backendSettings?.objPanelLogsBufferMaxSize
    ),
    objPanelLogsApiTimestampFormat: normalizeObjPanelLogsApiTimestampFormat(
      backendSettings?.objPanelLogsApiTimestampFormat
    ),
    objPanelLogsApiTimestampUseLocalTimeZone:
      backendSettings?.objPanelLogsApiTimestampUseLocalTimeZone ??
      DEFAULT_PREFERENCES.objPanelLogsApiTimestampUseLocalTimeZone,
    objPanelLogsTargetPerScopeLimit: normalizeObjPanelLogsTargetPerScopeLimit(
      backendSettings?.objPanelLogsTargetPerScopeLimit
    ),
    objPanelLogsTargetGlobalLimit: normalizeObjPanelLogsTargetGlobalLimit(
      backendSettings?.objPanelLogsTargetGlobalLimit
    ),
    gridTablePersistenceMode: normalizeGridTableMode(backendSettings?.gridTablePersistenceMode),
    defaultObjectPanelPosition: normalizeObjectPanelPosition(
      backendSettings?.defaultObjectPanelPosition
    ),
    // Panel layout: backend stores 0 when unset (Go zero value), so treat
    // 0 as "use default" for all fields. This means a user who explicitly
    // sets a position to 0 will see it revert to the default on restart,
    // which is acceptable since the default is close to 0 anyway.
    objectPanelDockedRightWidth:
      backendSettings?.objectPanelDockedRightWidth ||
      DEFAULT_PREFERENCES.objectPanelDockedRightWidth,
    objectPanelDockedBottomHeight:
      backendSettings?.objectPanelDockedBottomHeight ||
      DEFAULT_PREFERENCES.objectPanelDockedBottomHeight,
    objectPanelFloatingWidth:
      backendSettings?.objectPanelFloatingWidth || DEFAULT_PREFERENCES.objectPanelFloatingWidth,
    objectPanelFloatingHeight:
      backendSettings?.objectPanelFloatingHeight || DEFAULT_PREFERENCES.objectPanelFloatingHeight,
    objectPanelFloatingX:
      backendSettings?.objectPanelFloatingX || DEFAULT_PREFERENCES.objectPanelFloatingX,
    objectPanelFloatingY:
      backendSettings?.objectPanelFloatingY || DEFAULT_PREFERENCES.objectPanelFloatingY,
    paletteHueLight: backendSettings?.paletteHueLight ?? DEFAULT_PREFERENCES.paletteHueLight,
    paletteSaturationLight:
      backendSettings?.paletteSaturationLight ?? DEFAULT_PREFERENCES.paletteSaturationLight,
    paletteBrightnessLight:
      backendSettings?.paletteBrightnessLight ?? DEFAULT_PREFERENCES.paletteBrightnessLight,
    paletteHueDark: backendSettings?.paletteHueDark ?? DEFAULT_PREFERENCES.paletteHueDark,
    paletteSaturationDark:
      backendSettings?.paletteSaturationDark ?? DEFAULT_PREFERENCES.paletteSaturationDark,
    paletteBrightnessDark:
      backendSettings?.paletteBrightnessDark ?? DEFAULT_PREFERENCES.paletteBrightnessDark,
    accentColorLight: backendSettings?.accentColorLight ?? DEFAULT_PREFERENCES.accentColorLight,
    accentColorDark: backendSettings?.accentColorDark ?? DEFAULT_PREFERENCES.accentColorDark,
    linkColorLight: backendSettings?.linkColorLight ?? DEFAULT_PREFERENCES.linkColorLight,
    linkColorDark: backendSettings?.linkColorDark ?? DEFAULT_PREFERENCES.linkColorDark,
  };

  hydrated = true;
  updatePreferenceCache(preferences);

  return { ...preferenceCache };
};

export const getThemePreference = (): ThemePreference => {
  return preferenceCache.theme;
};

export const getUseShortResourceNames = (): boolean => {
  return preferenceCache.useShortResourceNames;
};

export const getAutoRefreshEnabled = (): boolean => {
  return preferenceCache.autoRefreshEnabled;
};

export const getBackgroundRefreshEnabled = (): boolean => {
  return preferenceCache.refreshBackgroundClustersEnabled;
};

export const getMetricsRefreshIntervalMs = (): number => {
  return preferenceCache.metricsRefreshIntervalMs;
};

export const getMaxTableRows = (): number => {
  return preferenceCache.maxTableRows;
};

export const getObjPanelLogsBufferMaxSize = (): number => {
  return preferenceCache.objPanelLogsBufferMaxSize;
};

export const getObjPanelLogsApiTimestampFormat = (): string => {
  return preferenceCache.objPanelLogsApiTimestampFormat;
};

export const getObjPanelLogsApiTimestampUseLocalTimeZone = (): boolean => {
  return preferenceCache.objPanelLogsApiTimestampUseLocalTimeZone;
};

export const getObjPanelLogsTargetPerScopeLimit = (): number => {
  return preferenceCache.objPanelLogsTargetPerScopeLimit;
};

export const getObjPanelLogsTargetGlobalLimit = (): number => {
  return preferenceCache.objPanelLogsTargetGlobalLimit;
};

export const getGridTablePersistenceMode = (): GridTablePersistenceMode => {
  return preferenceCache.gridTablePersistenceMode;
};

export const getDefaultObjectPanelPosition = (): ObjectPanelPosition => {
  return preferenceCache.defaultObjectPanelPosition;
};

export interface ObjectPanelLayoutDefaults {
  dockedRightWidth: number;
  dockedBottomHeight: number;
  floatingWidth: number;
  floatingHeight: number;
  floatingX: number;
  floatingY: number;
}

export const getObjectPanelLayoutDefaults = (): ObjectPanelLayoutDefaults => ({
  dockedRightWidth: preferenceCache.objectPanelDockedRightWidth,
  dockedBottomHeight: preferenceCache.objectPanelDockedBottomHeight,
  floatingWidth: preferenceCache.objectPanelFloatingWidth,
  floatingHeight: preferenceCache.objectPanelFloatingHeight,
  floatingX: preferenceCache.objectPanelFloatingX,
  floatingY: preferenceCache.objectPanelFloatingY,
});

// Returns palette tint values for the specified theme.
export const getPaletteTint = (
  theme: 'light' | 'dark'
): { hue: number; saturation: number; brightness: number } => {
  if (theme === 'light') {
    return {
      hue: preferenceCache.paletteHueLight,
      saturation: preferenceCache.paletteSaturationLight,
      brightness: preferenceCache.paletteBrightnessLight,
    };
  }
  return {
    hue: preferenceCache.paletteHueDark,
    saturation: preferenceCache.paletteSaturationDark,
    brightness: preferenceCache.paletteBrightnessDark,
  };
};

// Returns the custom accent color hex for the specified theme (empty = default).
export const getAccentColor = (theme: 'light' | 'dark'): string => {
  return theme === 'light' ? preferenceCache.accentColorLight : preferenceCache.accentColorDark;
};

// Persist accent color for a specific theme to backend via fire-and-forget.
export const setAccentColor = (theme: 'light' | 'dark', color: string): void => {
  hydrated = true;
  if (theme === 'light') {
    updatePreferenceCache({ accentColorLight: color });
  } else {
    updatePreferenceCache({ accentColorDark: color });
  }
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  const setter = runtimeApp?.SetAccentColor;
  if (typeof setter !== 'function') {
    return;
  }
  void setter(theme, color).catch((error: unknown) => {
    console.error('Failed to persist accent color:', error);
  });
};

// Returns the custom link color hex for the specified theme (empty = default).
export const getLinkColor = (theme: 'light' | 'dark'): string => {
  return theme === 'light' ? preferenceCache.linkColorLight : preferenceCache.linkColorDark;
};

// Persist link color for a specific theme to backend via fire-and-forget.
export const setLinkColor = (theme: 'light' | 'dark', color: string): void => {
  hydrated = true;
  if (theme === 'light') {
    updatePreferenceCache({ linkColorLight: color });
  } else {
    updatePreferenceCache({ linkColorDark: color });
  }
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  const setter = runtimeApp?.SetLinkColor;
  if (typeof setter !== 'function') {
    return;
  }
  void setter(theme, color).catch((error: unknown) => {
    console.error('Failed to persist link color:', error);
  });
};

export const setThemePreference = async (theme: ThemePreference): Promise<void> => {
  const normalized = normalizeTheme(theme);
  await SetTheme(normalized);
  hydrated = true;
  updatePreferenceCache({ theme: normalized });
};

export const setUseShortResourceNames = async (useShort: boolean): Promise<void> => {
  await SetUseShortResourceNames(useShort);
  hydrated = true;
  updatePreferenceCache({ useShortResourceNames: useShort });
};

export const setAutoRefreshEnabled = (enabled: boolean): void => {
  hydrated = true;
  updatePreferenceCache({ autoRefreshEnabled: enabled });
  void persistBooleanPreference('SetAutoRefreshEnabled', enabled).catch((error) => {
    console.error('Failed to persist auto-refresh preference:', error);
  });
};

export const setBackgroundRefreshEnabled = (enabled: boolean): void => {
  hydrated = true;
  updatePreferenceCache({ refreshBackgroundClustersEnabled: enabled });
  void persistBooleanPreference('SetBackgroundRefreshEnabled', enabled).catch((error) => {
    console.error('Failed to persist background refresh preference:', error);
  });
};

// Fire-and-forget persistence for Object Panel Logs Tab buffer size. Skips the backend
// call when Wails isn't present (unit tests) so the cache update still
// lands in the event bus.
const persistObjPanelLogsBufferMaxSize = async (size: number): Promise<void> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  await SetObjPanelLogsBufferMaxSizeBackend(size);
};

const persistMaxTableRows = async (size: number): Promise<void> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  await SetMaxTableRowsBackend(size);
};

const persistObjPanelLogsApiTimestampFormat = async (format: string): Promise<void> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  await SetObjPanelLogsAPITimestampFormatBackend(format);
};

const persistObjPanelLogsApiTimestampUseLocalTimeZone = async (enabled: boolean): Promise<void> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  await SetObjPanelLogsAPITimestampUseLocalTimeZoneBackend(enabled);
};

const persistObjPanelLogsTargetPerScopeLimit = async (limit: number): Promise<void> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  await SetObjPanelLogsTargetPerScopeLimitBackend(limit);
};

const persistObjPanelLogsTargetGlobalLimit = async (limit: number): Promise<void> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  await SetObjPanelLogsTargetGlobalLimitBackend(limit);
};

export const setObjPanelLogsBufferMaxSize = (size: number): void => {
  const normalized = normalizeObjPanelLogsBufferMaxSize(size);
  hydrated = true;
  updatePreferenceCache({ objPanelLogsBufferMaxSize: normalized });
  void persistObjPanelLogsBufferMaxSize(normalized).catch((error) => {
    console.error('Failed to persist Object Panel Logs Tab buffer max size:', error);
  });
};

export const setMaxTableRows = (size: number): void => {
  const normalized = normalizeMaxTableRows(size);
  hydrated = true;
  updatePreferenceCache({ maxTableRows: normalized });
  void persistMaxTableRows(normalized).catch((error) => {
    console.error('Failed to persist max table rows:', error);
  });
};

export const setObjPanelLogsApiTimestampFormat = (format: string): void => {
  const validationError = getObjPanelLogsApiTimestampFormatValidationError(format);
  if (validationError) {
    throw new Error(validationError);
  }
  const normalized = format.trim();
  hydrated = true;
  updatePreferenceCache({ objPanelLogsApiTimestampFormat: normalized });
  void persistObjPanelLogsApiTimestampFormat(normalized).catch((error) => {
    console.error('Failed to persist Object Panel Logs Tab API timestamp format:', error);
  });
};

export const setObjPanelLogsApiTimestampUseLocalTimeZone = (enabled: boolean): void => {
  hydrated = true;
  updatePreferenceCache({ objPanelLogsApiTimestampUseLocalTimeZone: enabled });
  void persistObjPanelLogsApiTimestampUseLocalTimeZone(enabled).catch((error) => {
    console.error(
      'Failed to persist Object Panel Logs Tab API timestamp local timezone setting:',
      error
    );
  });
};

export const setObjPanelLogsTargetPerScopeLimit = (limit: number): void => {
  const normalized = normalizeObjPanelLogsTargetPerScopeLimit(limit);
  hydrated = true;
  updatePreferenceCache({ objPanelLogsTargetPerScopeLimit: normalized });
  void persistObjPanelLogsTargetPerScopeLimit(normalized).catch((error) => {
    console.error('Failed to persist Object Panel Logs Tab target per-scope limit:', error);
  });
};

export const setObjPanelLogsTargetGlobalLimit = (limit: number): void => {
  const normalized = normalizeObjPanelLogsTargetGlobalLimit(limit);
  hydrated = true;
  updatePreferenceCache({ objPanelLogsTargetGlobalLimit: normalized });
  void persistObjPanelLogsTargetGlobalLimit(normalized).catch((error) => {
    console.error('Failed to persist Object Panel Logs Tab target global limit:', error);
  });
};

export const setGridTablePersistenceMode = (mode: GridTablePersistenceMode): void => {
  const normalized = normalizeGridTableMode(mode);
  hydrated = true;
  updatePreferenceCache({ gridTablePersistenceMode: normalized });
  void persistGridTableMode(normalized).catch((error) => {
    console.error('Failed to persist grid table persistence mode:', error);
  });
};

export const setDefaultObjectPanelPosition = (position: ObjectPanelPosition): void => {
  const normalized = normalizeObjectPanelPosition(position);
  hydrated = true;
  updatePreferenceCache({ defaultObjectPanelPosition: normalized });
  void persistObjectPanelPosition(normalized).catch((error) => {
    console.error('Failed to persist default object panel position:', error);
  });
};

const persistObjectPanelLayout = async (layout: ObjectPanelLayoutDefaults): Promise<void> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  const setter = runtimeApp?.SetObjectPanelLayout;
  if (typeof setter !== 'function') {
    throw new Error('SetObjectPanelLayout is not available');
  }
  await setter(
    layout.dockedRightWidth,
    layout.dockedBottomHeight,
    layout.floatingWidth,
    layout.floatingHeight,
    layout.floatingX,
    layout.floatingY
  );
};

export const setObjectPanelLayoutDefaults = (layout: ObjectPanelLayoutDefaults): void => {
  hydrated = true;
  updatePreferenceCache({
    objectPanelDockedRightWidth: layout.dockedRightWidth,
    objectPanelDockedBottomHeight: layout.dockedBottomHeight,
    objectPanelFloatingWidth: layout.floatingWidth,
    objectPanelFloatingHeight: layout.floatingHeight,
    objectPanelFloatingX: layout.floatingX,
    objectPanelFloatingY: layout.floatingY,
  });
  void persistObjectPanelLayout(layout).catch((error) => {
    console.error('Failed to persist object panel layout defaults:', error);
  });
};

// Persist palette tint for a specific theme to backend via fire-and-forget.
export const setPaletteTint = (
  theme: 'light' | 'dark',
  hue: number,
  saturation: number,
  brightness: number = 0
): void => {
  hydrated = true;
  if (theme === 'light') {
    updatePreferenceCache({
      paletteHueLight: hue,
      paletteSaturationLight: saturation,
      paletteBrightnessLight: brightness,
    });
  } else {
    updatePreferenceCache({
      paletteHueDark: hue,
      paletteSaturationDark: saturation,
      paletteBrightnessDark: brightness,
    });
  }
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  const setter = runtimeApp?.SetPaletteTint;
  if (typeof setter !== 'function') {
    return;
  }
  void setter(theme, hue, saturation, brightness).catch((error: unknown) => {
    console.error('Failed to persist palette tint:', error);
  });
};

// --- Theme library helpers ---

// Fetches all saved themes from the backend.
export const getThemes = async (): Promise<types.Theme[]> => {
  const result = await requestAppState({
    resource: 'themes',
    read: () => readThemes(),
  });
  return result || [];
};

// Persists a new or updated theme to the backend.
export const saveTheme = async (theme: types.Theme): Promise<void> => {
  await SaveTheme(theme);
};

// Deletes a theme by its ID from the backend.
export const deleteTheme = async (id: string): Promise<void> => {
  await DeleteTheme(id);
};

// Reorders themes in the backend by the given ordered list of IDs.
export const reorderThemes = async (ids: string[]): Promise<void> => {
  await ReorderThemes(ids);
};

// Applies a saved theme's palette/accent values as the active settings.
export const applyTheme = async (id: string): Promise<void> => {
  await ApplyTheme(id);
};

// Returns the best-matching theme for a cluster context name, or null if none match.
export const matchThemeForCluster = async (contextName: string): Promise<types.Theme | null> => {
  try {
    const result = await MatchThemeForCluster(contextName);
    return result || null;
  } catch {
    return null;
  }
};

// Test helper to reset cached values between test runs.
export const resetAppPreferencesCacheForTesting = (): void => {
  preferenceCache = { ...DEFAULT_PREFERENCES };
  hydrated = false;
};

// Test helper to set preferences directly for testing.
export const setAppPreferencesForTesting = (prefs: Partial<AppPreferences>): void => {
  preferenceCache = { ...preferenceCache, ...prefs };
  hydrated = true;
};
