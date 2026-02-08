/**
 * frontend/src/core/settings/appPreferences.ts
 *
 * Centralized preference cache and backend sync for app settings.
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
  paletteHueLight: number;
  paletteSaturationLight: number;
  paletteBrightnessLight: number;
  paletteHueDark: number;
  paletteSaturationDark: number;
  paletteBrightnessDark: number;
  accentColorLight: string;
  accentColorDark: string;
}

interface AppSettingsPayload {
  theme?: string;
  useShortResourceNames?: boolean;
  autoRefreshEnabled?: boolean;
  refreshBackgroundClustersEnabled?: boolean;
  metricsRefreshIntervalMs?: number;
  gridTablePersistenceMode?: string;
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
}

const DEFAULT_METRICS_REFRESH_INTERVAL_MS = 5000;

const DEFAULT_PREFERENCES: AppPreferences = {
  theme: 'system',
  useShortResourceNames: false,
  autoRefreshEnabled: true,
  refreshBackgroundClustersEnabled: true,
  metricsRefreshIntervalMs: DEFAULT_METRICS_REFRESH_INTERVAL_MS,
  gridTablePersistenceMode: 'shared',
  paletteHueLight: 0,
  paletteSaturationLight: 0,
  paletteBrightnessLight: 0,
  paletteHueDark: 0,
  paletteSaturationDark: 0,
  paletteBrightnessDark: 0,
  accentColorLight: '',
  accentColorDark: '',
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

const normalizeMetricsIntervalMs = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return DEFAULT_METRICS_REFRESH_INTERVAL_MS;
  }
  return Math.floor(value);
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
    gridTablePersistenceMode: normalizeGridTableMode(backendSettings?.gridTablePersistenceMode),
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

export const getGridTablePersistenceMode = (): GridTablePersistenceMode => {
  return preferenceCache.gridTablePersistenceMode;
};

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

export const setGridTablePersistenceMode = (mode: GridTablePersistenceMode): void => {
  const normalized = normalizeGridTableMode(mode);
  hydrated = true;
  updatePreferenceCache({ gridTablePersistenceMode: normalized });
  void persistGridTableMode(normalized).catch((error) => {
    console.error('Failed to persist grid table persistence mode:', error);
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
