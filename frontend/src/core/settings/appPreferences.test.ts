/**
 * frontend/src/core/settings/appPreferences.test.ts
 *
 * Test suite for appPreferences hydration and persistence helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAccentColor,
  getAutoRefreshEnabled,
  getBackgroundRefreshEnabled,
  getGridTablePersistenceMode,
  getLogApiTimestampFormat,
  getLogApiTimestampUseLocalTimeZone,
  getLogBufferMaxSize,
  getMaxTableRows,
  getLogTargetGlobalLimit,
  getLogTargetPerScopeLimit,
  getMetricsRefreshIntervalMs,
  getPaletteTint,
  getThemePreference,
  getUseShortResourceNames,
  hydrateAppPreferences,
  LOG_BUFFER_DEFAULT_SIZE,
  LOG_BUFFER_MAX_SIZE,
  LOG_BUFFER_MIN_SIZE,
  MAX_TABLE_ROWS_DEFAULT,
  MAX_TABLE_ROWS_MAX,
  MAX_TABLE_ROWS_MIN,
  LOG_TARGET_GLOBAL_DEFAULT,
  LOG_TARGET_GLOBAL_MAX,
  LOG_TARGET_PER_SCOPE_DEFAULT,
  LOG_TARGET_PER_SCOPE_MAX,
  resetAppPreferencesCacheForTesting,
  setAccentColor,
  setAutoRefreshEnabled,
  setBackgroundRefreshEnabled,
  setGridTablePersistenceMode,
  setLogApiTimestampFormat,
  setLogApiTimestampUseLocalTimeZone,
  setLogBufferMaxSize,
  setMaxTableRows,
  setLogTargetGlobalLimit,
  setLogTargetPerScopeLimit,
  setPaletteTint,
  setThemePreference,
  setUseShortResourceNames,
} from './appPreferences';

const appMocks = vi.hoisted(() => ({
  GetAppSettings: vi.fn(),
  SetTheme: vi.fn(),
  SetUseShortResourceNames: vi.fn(),
  SetLogAPITimestampFormat: vi.fn(),
  SetLogAPITimestampUseLocalTimeZone: vi.fn(),
  SetMaxTableRows: vi.fn(),
  SetLogBufferMaxSize: vi.fn(),
  SetLogTargetPerScopeLimit: vi.fn(),
  SetLogTargetGlobalLimit: vi.fn(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetAppSettings: (...args: unknown[]) => appMocks.GetAppSettings(...args),
  SetTheme: (...args: unknown[]) => appMocks.SetTheme(...args),
  SetUseShortResourceNames: (...args: unknown[]) => appMocks.SetUseShortResourceNames(...args),
  SetLogAPITimestampFormat: (...args: unknown[]) => appMocks.SetLogAPITimestampFormat(...args),
  SetLogAPITimestampUseLocalTimeZone: (...args: unknown[]) =>
    appMocks.SetLogAPITimestampUseLocalTimeZone(...args),
  SetMaxTableRows: (...args: unknown[]) => appMocks.SetMaxTableRows(...args),
  SetLogBufferMaxSize: (...args: unknown[]) => appMocks.SetLogBufferMaxSize(...args),
  SetLogTargetPerScopeLimit: (...args: unknown[]) => appMocks.SetLogTargetPerScopeLimit(...args),
  SetLogTargetGlobalLimit: (...args: unknown[]) => appMocks.SetLogTargetGlobalLimit(...args),
}));

describe('appPreferences', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    appMocks.GetAppSettings.mockReset();
    appMocks.SetTheme.mockReset();
    appMocks.SetUseShortResourceNames.mockReset();
    appMocks.SetLogAPITimestampFormat.mockReset();
    appMocks.SetLogAPITimestampUseLocalTimeZone.mockReset();
    appMocks.SetMaxTableRows.mockReset();
    appMocks.SetLogBufferMaxSize.mockReset();
    appMocks.SetLogTargetPerScopeLimit.mockReset();
    appMocks.SetLogTargetGlobalLimit.mockReset();
    appMocks.SetLogAPITimestampFormat.mockResolvedValue(undefined);
    appMocks.SetLogAPITimestampUseLocalTimeZone.mockResolvedValue(undefined);
    appMocks.SetMaxTableRows.mockResolvedValue(undefined);
    appMocks.SetLogBufferMaxSize.mockResolvedValue(undefined);
    appMocks.SetLogTargetPerScopeLimit.mockResolvedValue(undefined);
    appMocks.SetLogTargetGlobalLimit.mockResolvedValue(undefined);
    (window as any).go = {
      backend: {
        App: {
          SetAutoRefreshEnabled: vi.fn().mockResolvedValue(undefined),
          SetBackgroundRefreshEnabled: vi.fn().mockResolvedValue(undefined),
          SetGridTablePersistenceMode: vi.fn().mockResolvedValue(undefined),
          SetLogAPITimestampFormat: vi.fn().mockResolvedValue(undefined),
          SetLogAPITimestampUseLocalTimeZone: vi.fn().mockResolvedValue(undefined),
          SetMaxTableRows: vi.fn().mockResolvedValue(undefined),
          SetLogBufferMaxSize: vi.fn().mockResolvedValue(undefined),
          SetLogTargetPerScopeLimit: vi.fn().mockResolvedValue(undefined),
          SetLogTargetGlobalLimit: vi.fn().mockResolvedValue(undefined),
          SetPaletteTint: vi.fn().mockResolvedValue(undefined),
          SetAccentColor: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
  });

  afterEach(() => {
    delete (window as any).go;
  });

  it('hydrates preferences from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'light',
      useShortResourceNames: true,
      autoRefreshEnabled: false,
      refreshBackgroundClustersEnabled: false,
      metricsRefreshIntervalMs: 7000,
      maxTableRows: 2500,
      logApiTimestampFormat: 'HH:mm:ss.SSS',
      logApiTimestampUseLocalTimeZone: true,
      logTargetPerScopeLimit: 144,
      logTargetGlobalLimit: 180,
      gridTablePersistenceMode: 'namespaced',
      paletteHueLight: 220,
      paletteSaturationLight: 50,
      paletteBrightnessLight: -15,
      paletteHueDark: 120,
      paletteSaturationDark: 40,
      paletteBrightnessDark: 10,
      accentColorLight: '#0d9488',
      accentColorDark: '#f59e0b',
    });

    await hydrateAppPreferences({ force: true });

    expect(getThemePreference()).toBe('light');
    expect(getUseShortResourceNames()).toBe(true);
    expect(getAutoRefreshEnabled()).toBe(false);
    expect(getBackgroundRefreshEnabled()).toBe(false);
    expect(getMetricsRefreshIntervalMs()).toBe(7000);
    expect(getMaxTableRows()).toBe(2500);
    expect(getLogApiTimestampFormat()).toBe('HH:mm:ss.SSS');
    expect(getLogApiTimestampUseLocalTimeZone()).toBe(true);
    expect(getLogTargetPerScopeLimit()).toBe(144);
    expect(getLogTargetGlobalLimit()).toBe(180);
    expect(getGridTablePersistenceMode()).toBe('namespaced');
    expect(getPaletteTint('light')).toEqual({ hue: 220, saturation: 50, brightness: -15 });
    expect(getPaletteTint('dark')).toEqual({ hue: 120, saturation: 40, brightness: 10 });
    expect(getAccentColor('light')).toBe('#0d9488');
    expect(getAccentColor('dark')).toBe('#f59e0b');
  });

  it('defaults palette hue, saturation, and brightness to 0 when not present', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
    });

    await hydrateAppPreferences({ force: true });

    expect(getPaletteTint('light')).toEqual({ hue: 0, saturation: 0, brightness: 0 });
    expect(getPaletteTint('dark')).toEqual({ hue: 0, saturation: 0, brightness: 0 });
    expect(getAccentColor('light')).toBe('');
    expect(getAccentColor('dark')).toBe('');
  });

  it('normalizes an invalid persisted log API timestamp format back to the default', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      logApiTimestampFormat: 'foo',
    });

    await hydrateAppPreferences({ force: true });

    expect(getLogApiTimestampFormat()).toBe('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
  });

  it('persists preference updates and updates the cache', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      useShortResourceNames: false,
      autoRefreshEnabled: true,
      refreshBackgroundClustersEnabled: true,
      metricsRefreshIntervalMs: 6000,
      gridTablePersistenceMode: 'shared',
    });

    await hydrateAppPreferences({ force: true });

    await setThemePreference('dark');
    await setUseShortResourceNames(true);
    setLogApiTimestampFormat('HH:mm:ss.SSS');
    setLogApiTimestampUseLocalTimeZone(true);
    setMaxTableRows(2500);
    setAutoRefreshEnabled(false);
    setBackgroundRefreshEnabled(false);
    setGridTablePersistenceMode('namespaced');

    expect(appMocks.SetTheme).toHaveBeenCalledWith('dark');
    expect(appMocks.SetUseShortResourceNames).toHaveBeenCalledWith(true);
    expect(appMocks.SetLogAPITimestampFormat).toHaveBeenCalledWith('HH:mm:ss.SSS');
    expect(appMocks.SetLogAPITimestampUseLocalTimeZone).toHaveBeenCalledWith(true);
    expect(appMocks.SetMaxTableRows).toHaveBeenCalledWith(2500);
    expect((window as any).go.backend.App.SetAutoRefreshEnabled).toHaveBeenCalledWith(false);
    expect((window as any).go.backend.App.SetBackgroundRefreshEnabled).toHaveBeenCalledWith(false);
    expect((window as any).go.backend.App.SetGridTablePersistenceMode).toHaveBeenCalledWith(
      'namespaced'
    );

    expect(getThemePreference()).toBe('dark');
    expect(getUseShortResourceNames()).toBe(true);
    expect(getLogApiTimestampFormat()).toBe('HH:mm:ss.SSS');
    expect(getLogApiTimestampUseLocalTimeZone()).toBe(true);
    expect(getMaxTableRows()).toBe(2500);
    expect(getAutoRefreshEnabled()).toBe(false);
    expect(getBackgroundRefreshEnabled()).toBe(false);
    expect(getMetricsRefreshIntervalMs()).toBe(6000);
    expect(getGridTablePersistenceMode()).toBe('namespaced');
  });

  it('rejects invalid log API timestamp formats before persisting', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });

    expect(() => setLogApiTimestampFormat('foo')).toThrow(/Unsupported token/);
    expect(appMocks.SetLogAPITimestampFormat).not.toHaveBeenCalled();
  });

  it('setPaletteTint updates cache and calls backend for the specified theme', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      paletteHueLight: 0,
      paletteSaturationLight: 0,
      paletteBrightnessLight: 0,
      paletteHueDark: 0,
      paletteSaturationDark: 0,
      paletteBrightnessDark: 0,
    });

    await hydrateAppPreferences({ force: true });

    setPaletteTint('light', 180, 75, -25);

    expect(getPaletteTint('light')).toEqual({ hue: 180, saturation: 75, brightness: -25 });
    // Dark theme should remain at defaults.
    expect(getPaletteTint('dark')).toEqual({ hue: 0, saturation: 0, brightness: 0 });
    expect((window as any).go.backend.App.SetPaletteTint).toHaveBeenCalledWith(
      'light',
      180,
      75,
      -25
    );

    setPaletteTint('dark', 300, 60, 20);

    expect(getPaletteTint('dark')).toEqual({ hue: 300, saturation: 60, brightness: 20 });
    // Light theme should be unchanged.
    expect(getPaletteTint('light')).toEqual({ hue: 180, saturation: 75, brightness: -25 });
    expect((window as any).go.backend.App.SetPaletteTint).toHaveBeenCalledWith('dark', 300, 60, 20);
  });

  it('setAccentColor updates cache and calls backend for the specified theme', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      accentColorLight: '',
      accentColorDark: '',
    });

    await hydrateAppPreferences({ force: true });

    setAccentColor('light', '#0d9488');

    expect(getAccentColor('light')).toBe('#0d9488');
    // Dark theme should remain at default.
    expect(getAccentColor('dark')).toBe('');
    expect((window as any).go.backend.App.SetAccentColor).toHaveBeenCalledWith('light', '#0d9488');

    setAccentColor('dark', '#f59e0b');

    expect(getAccentColor('dark')).toBe('#f59e0b');
    // Light theme should be unchanged.
    expect(getAccentColor('light')).toBe('#0d9488');
    expect((window as any).go.backend.App.SetAccentColor).toHaveBeenCalledWith('dark', '#f59e0b');
  });

  it('setAccentColor resets to empty string', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      accentColorLight: '#0d9488',
      accentColorDark: '#f59e0b',
    });

    await hydrateAppPreferences({ force: true });

    setAccentColor('light', '');
    expect(getAccentColor('light')).toBe('');
    expect(getAccentColor('dark')).toBe('#f59e0b');
  });

  // ---------------------------------------------------------------------
  // Log buffer size — user-configurable via Advanced → Pod Logs. Must
  // hydrate from the backend payload, round-trip through the setter, and
  // clamp out-of-range values in the normalizer.
  // ---------------------------------------------------------------------

  it('hydrates logBufferMaxSize from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      logBufferMaxSize: 2500,
    });
    await hydrateAppPreferences({ force: true });
    expect(getLogBufferMaxSize()).toBe(2500);
  });

  it('hydrates maxTableRows from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      maxTableRows: 2500,
    });
    await hydrateAppPreferences({ force: true });
    expect(getMaxTableRows()).toBe(2500);
  });

  it('defaults maxTableRows when the backend payload is missing the field', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });
    expect(getMaxTableRows()).toBe(MAX_TABLE_ROWS_DEFAULT);
  });

  it('setMaxTableRows round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      maxTableRows: MAX_TABLE_ROWS_DEFAULT,
    });
    await hydrateAppPreferences({ force: true });

    setMaxTableRows(2500);
    expect(getMaxTableRows()).toBe(2500);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetMaxTableRows).toHaveBeenCalledWith(2500);
  });

  it('setMaxTableRows clamps values outside the allowed range', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });

    setMaxTableRows(1);
    expect(getMaxTableRows()).toBe(MAX_TABLE_ROWS_MIN);

    setMaxTableRows(999_999);
    expect(getMaxTableRows()).toBe(MAX_TABLE_ROWS_MAX);
  });

  it('defaults logBufferMaxSize when the backend payload is missing the field', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });
    expect(getLogBufferMaxSize()).toBe(LOG_BUFFER_DEFAULT_SIZE);
  });

  it('defaults logBufferMaxSize when the backend payload reports zero (unset)', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system', logBufferMaxSize: 0 });
    await hydrateAppPreferences({ force: true });
    expect(getLogBufferMaxSize()).toBe(LOG_BUFFER_DEFAULT_SIZE);
  });

  it('setLogBufferMaxSize round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      logBufferMaxSize: LOG_BUFFER_DEFAULT_SIZE,
    });
    await hydrateAppPreferences({ force: true });

    setLogBufferMaxSize(3500);
    expect(getLogBufferMaxSize()).toBe(3500);
    // Allow the fire-and-forget persist promise to resolve before we
    // assert the backend call landed. The setter calls the imported
    // Wails binding (mocked via appMocks), not window.go.backend.App
    // directly — the window object is only read to check that the
    // runtime is present.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetLogBufferMaxSize).toHaveBeenCalledWith(3500);
  });

  it('setLogBufferMaxSize clamps values below the minimum', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });
    setLogBufferMaxSize(1);
    expect(getLogBufferMaxSize()).toBe(LOG_BUFFER_MIN_SIZE);
  });

  it('setLogBufferMaxSize clamps values above the maximum', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });
    setLogBufferMaxSize(999_999);
    expect(getLogBufferMaxSize()).toBe(LOG_BUFFER_MAX_SIZE);
  });

  it('hydrates log target limits from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      logTargetPerScopeLimit: 144,
      logTargetGlobalLimit: 180,
    });
    await hydrateAppPreferences({ force: true });
    expect(getLogTargetPerScopeLimit()).toBe(144);
    expect(getLogTargetGlobalLimit()).toBe(180);
  });

  it('defaults log target limits when the backend payload is missing the fields', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });
    expect(getLogTargetPerScopeLimit()).toBe(LOG_TARGET_PER_SCOPE_DEFAULT);
    expect(getLogTargetGlobalLimit()).toBe(LOG_TARGET_GLOBAL_DEFAULT);
  });

  it('setLogTargetPerScopeLimit round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });

    setLogTargetPerScopeLimit(144);
    expect(getLogTargetPerScopeLimit()).toBe(144);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetLogTargetPerScopeLimit).toHaveBeenCalledWith(144);
  });

  it('setLogTargetPerScopeLimit defaults zero and clamps large values', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });

    setLogTargetPerScopeLimit(0);
    expect(getLogTargetPerScopeLimit()).toBe(LOG_TARGET_PER_SCOPE_DEFAULT);

    setLogTargetPerScopeLimit(999_999);
    expect(getLogTargetPerScopeLimit()).toBe(LOG_TARGET_PER_SCOPE_MAX);
  });

  it('setLogTargetGlobalLimit round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });

    setLogTargetGlobalLimit(180);
    expect(getLogTargetGlobalLimit()).toBe(180);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetLogTargetGlobalLimit).toHaveBeenCalledWith(180);
  });

  it('setLogTargetGlobalLimit defaults zero and clamps large values', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });

    setLogTargetGlobalLimit(0);
    expect(getLogTargetGlobalLimit()).toBe(LOG_TARGET_GLOBAL_DEFAULT);

    setLogTargetGlobalLimit(999_999);
    expect(getLogTargetGlobalLimit()).toBe(LOG_TARGET_GLOBAL_MAX);
  });
});
