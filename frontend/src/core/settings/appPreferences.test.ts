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
  getObjPanelLogsApiTimestampFormat,
  getObjPanelLogsApiTimestampUseLocalTimeZone,
  getObjPanelLogsBufferMaxSize,
  getMaxTableRows,
  getObjPanelLogsTargetGlobalLimit,
  getObjPanelLogsTargetPerScopeLimit,
  getMetricsRefreshIntervalMs,
  getPaletteTint,
  getThemePreference,
  getUseShortResourceNames,
  hydrateAppPreferences,
  OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE,
  OBJ_PANEL_LOGS_BUFFER_MAX_SIZE,
  OBJ_PANEL_LOGS_BUFFER_MIN_SIZE,
  MAX_TABLE_ROWS_DEFAULT,
  MAX_TABLE_ROWS_MAX,
  MAX_TABLE_ROWS_MIN,
  OBJ_PANEL_LOGS_TARGET_GLOBAL_DEFAULT,
  OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX,
  OBJ_PANEL_LOGS_TARGET_PER_SCOPE_DEFAULT,
  OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX,
  resetAppPreferencesCacheForTesting,
  setAccentColor,
  setAutoRefreshEnabled,
  setBackgroundRefreshEnabled,
  setGridTablePersistenceMode,
  setObjPanelLogsApiTimestampFormat,
  setObjPanelLogsApiTimestampUseLocalTimeZone,
  setObjPanelLogsBufferMaxSize,
  setMaxTableRows,
  setObjPanelLogsTargetGlobalLimit,
  setObjPanelLogsTargetPerScopeLimit,
  setPaletteTint,
  setThemePreference,
  setUseShortResourceNames,
} from './appPreferences';

const appMocks = vi.hoisted(() => ({
  GetAppSettings: vi.fn(),
  SetTheme: vi.fn(),
  SetUseShortResourceNames: vi.fn(),
  SetObjPanelLogsAPITimestampFormat: vi.fn(),
  SetObjPanelLogsAPITimestampUseLocalTimeZone: vi.fn(),
  SetMaxTableRows: vi.fn(),
  SetObjPanelLogsBufferMaxSize: vi.fn(),
  SetObjPanelLogsTargetPerScopeLimit: vi.fn(),
  SetObjPanelLogsTargetGlobalLimit: vi.fn(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetAppSettings: (...args: unknown[]) => appMocks.GetAppSettings(...args),
  SetTheme: (...args: unknown[]) => appMocks.SetTheme(...args),
  SetUseShortResourceNames: (...args: unknown[]) => appMocks.SetUseShortResourceNames(...args),
  SetObjPanelLogsAPITimestampFormat: (...args: unknown[]) =>
    appMocks.SetObjPanelLogsAPITimestampFormat(...args),
  SetObjPanelLogsAPITimestampUseLocalTimeZone: (...args: unknown[]) =>
    appMocks.SetObjPanelLogsAPITimestampUseLocalTimeZone(...args),
  SetMaxTableRows: (...args: unknown[]) => appMocks.SetMaxTableRows(...args),
  SetObjPanelLogsBufferMaxSize: (...args: unknown[]) =>
    appMocks.SetObjPanelLogsBufferMaxSize(...args),
  SetObjPanelLogsTargetPerScopeLimit: (...args: unknown[]) =>
    appMocks.SetObjPanelLogsTargetPerScopeLimit(...args),
  SetObjPanelLogsTargetGlobalLimit: (...args: unknown[]) =>
    appMocks.SetObjPanelLogsTargetGlobalLimit(...args),
}));

describe('appPreferences', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    appMocks.GetAppSettings.mockReset();
    appMocks.SetTheme.mockReset();
    appMocks.SetUseShortResourceNames.mockReset();
    appMocks.SetObjPanelLogsAPITimestampFormat.mockReset();
    appMocks.SetObjPanelLogsAPITimestampUseLocalTimeZone.mockReset();
    appMocks.SetMaxTableRows.mockReset();
    appMocks.SetObjPanelLogsBufferMaxSize.mockReset();
    appMocks.SetObjPanelLogsTargetPerScopeLimit.mockReset();
    appMocks.SetObjPanelLogsTargetGlobalLimit.mockReset();
    appMocks.SetObjPanelLogsAPITimestampFormat.mockResolvedValue(undefined);
    appMocks.SetObjPanelLogsAPITimestampUseLocalTimeZone.mockResolvedValue(undefined);
    appMocks.SetMaxTableRows.mockResolvedValue(undefined);
    appMocks.SetObjPanelLogsBufferMaxSize.mockResolvedValue(undefined);
    appMocks.SetObjPanelLogsTargetPerScopeLimit.mockResolvedValue(undefined);
    appMocks.SetObjPanelLogsTargetGlobalLimit.mockResolvedValue(undefined);
    (window as any).go = {
      backend: {
        App: {
          SetAutoRefreshEnabled: vi.fn().mockResolvedValue(undefined),
          SetBackgroundRefreshEnabled: vi.fn().mockResolvedValue(undefined),
          SetGridTablePersistenceMode: vi.fn().mockResolvedValue(undefined),
          SetObjPanelLogsAPITimestampFormat: vi.fn().mockResolvedValue(undefined),
          SetObjPanelLogsAPITimestampUseLocalTimeZone: vi.fn().mockResolvedValue(undefined),
          SetMaxTableRows: vi.fn().mockResolvedValue(undefined),
          SetObjPanelLogsBufferMaxSize: vi.fn().mockResolvedValue(undefined),
          SetObjPanelLogsTargetPerScopeLimit: vi.fn().mockResolvedValue(undefined),
          SetObjPanelLogsTargetGlobalLimit: vi.fn().mockResolvedValue(undefined),
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
      objPanelLogsApiTimestampFormat: 'HH:mm:ss.SSS',
      objPanelLogsApiTimestampUseLocalTimeZone: true,
      objPanelLogsTargetPerScopeLimit: 144,
      objPanelLogsTargetGlobalLimit: 180,
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
    expect(getObjPanelLogsApiTimestampFormat()).toBe('HH:mm:ss.SSS');
    expect(getObjPanelLogsApiTimestampUseLocalTimeZone()).toBe(true);
    expect(getObjPanelLogsTargetPerScopeLimit()).toBe(144);
    expect(getObjPanelLogsTargetGlobalLimit()).toBe(180);
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

  it('normalizes an invalid persisted Object Panel Logs Tab API timestamp format back to the default', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      objPanelLogsApiTimestampFormat: 'foo',
    });

    await hydrateAppPreferences({ force: true });

    expect(getObjPanelLogsApiTimestampFormat()).toBe('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
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
    setObjPanelLogsApiTimestampFormat('HH:mm:ss.SSS');
    setObjPanelLogsApiTimestampUseLocalTimeZone(true);
    setMaxTableRows(2500);
    setAutoRefreshEnabled(false);
    setBackgroundRefreshEnabled(false);
    setGridTablePersistenceMode('namespaced');

    expect(appMocks.SetTheme).toHaveBeenCalledWith('dark');
    expect(appMocks.SetUseShortResourceNames).toHaveBeenCalledWith(true);
    expect(appMocks.SetObjPanelLogsAPITimestampFormat).toHaveBeenCalledWith('HH:mm:ss.SSS');
    expect(appMocks.SetObjPanelLogsAPITimestampUseLocalTimeZone).toHaveBeenCalledWith(true);
    expect(appMocks.SetMaxTableRows).toHaveBeenCalledWith(2500);
    expect((window as any).go.backend.App.SetAutoRefreshEnabled).toHaveBeenCalledWith(false);
    expect((window as any).go.backend.App.SetBackgroundRefreshEnabled).toHaveBeenCalledWith(false);
    expect((window as any).go.backend.App.SetGridTablePersistenceMode).toHaveBeenCalledWith(
      'namespaced'
    );

    expect(getThemePreference()).toBe('dark');
    expect(getUseShortResourceNames()).toBe(true);
    expect(getObjPanelLogsApiTimestampFormat()).toBe('HH:mm:ss.SSS');
    expect(getObjPanelLogsApiTimestampUseLocalTimeZone()).toBe(true);
    expect(getMaxTableRows()).toBe(2500);
    expect(getAutoRefreshEnabled()).toBe(false);
    expect(getBackgroundRefreshEnabled()).toBe(false);
    expect(getMetricsRefreshIntervalMs()).toBe(6000);
    expect(getGridTablePersistenceMode()).toBe('namespaced');
  });

  it('rejects invalid Object Panel Logs Tab API timestamp formats before persisting', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });

    expect(() => setObjPanelLogsApiTimestampFormat('foo')).toThrow(/Unsupported token/);
    expect(appMocks.SetObjPanelLogsAPITimestampFormat).not.toHaveBeenCalled();
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
  // Object Panel Logs Tab buffer size. Must
  // hydrate from the backend payload, round-trip through the setter, and
  // clamp out-of-range values in the normalizer.
  // ---------------------------------------------------------------------

  it('hydrates Object Panel Logs Tab buffer size from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      objPanelLogsBufferMaxSize: 2500,
    });
    await hydrateAppPreferences({ force: true });
    expect(getObjPanelLogsBufferMaxSize()).toBe(2500);
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

  it('defaults Object Panel Logs Tab buffer size when the backend payload is missing the field', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });
    expect(getObjPanelLogsBufferMaxSize()).toBe(OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE);
  });

  it('defaults Object Panel Logs Tab buffer size when the backend payload reports zero (unset)', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system', objPanelLogsBufferMaxSize: 0 });
    await hydrateAppPreferences({ force: true });
    expect(getObjPanelLogsBufferMaxSize()).toBe(OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE);
  });

  it('setObjPanelLogsBufferMaxSize round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      objPanelLogsBufferMaxSize: OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE,
    });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsBufferMaxSize(3500);
    expect(getObjPanelLogsBufferMaxSize()).toBe(3500);
    // Allow the fire-and-forget persist promise to resolve before we
    // assert the backend call landed. The setter calls the imported
    // Wails binding (mocked via appMocks), not window.go.backend.App
    // directly — the window object is only read to check that the
    // runtime is present.
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetObjPanelLogsBufferMaxSize).toHaveBeenCalledWith(3500);
  });

  it('setObjPanelLogsBufferMaxSize clamps values below the minimum', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });
    setObjPanelLogsBufferMaxSize(1);
    expect(getObjPanelLogsBufferMaxSize()).toBe(OBJ_PANEL_LOGS_BUFFER_MIN_SIZE);
  });

  it('setObjPanelLogsBufferMaxSize clamps values above the maximum', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });
    setObjPanelLogsBufferMaxSize(999_999);
    expect(getObjPanelLogsBufferMaxSize()).toBe(OBJ_PANEL_LOGS_BUFFER_MAX_SIZE);
  });

  it('hydrates Object Panel Logs Tab target limits from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      theme: 'system',
      objPanelLogsTargetPerScopeLimit: 144,
      objPanelLogsTargetGlobalLimit: 180,
    });
    await hydrateAppPreferences({ force: true });
    expect(getObjPanelLogsTargetPerScopeLimit()).toBe(144);
    expect(getObjPanelLogsTargetGlobalLimit()).toBe(180);
  });

  it('defaults Object Panel Logs Tab target limits when the backend payload is missing the fields', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });
    expect(getObjPanelLogsTargetPerScopeLimit()).toBe(OBJ_PANEL_LOGS_TARGET_PER_SCOPE_DEFAULT);
    expect(getObjPanelLogsTargetGlobalLimit()).toBe(OBJ_PANEL_LOGS_TARGET_GLOBAL_DEFAULT);
  });

  it('setObjPanelLogsTargetPerScopeLimit round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsTargetPerScopeLimit(144);
    expect(getObjPanelLogsTargetPerScopeLimit()).toBe(144);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetObjPanelLogsTargetPerScopeLimit).toHaveBeenCalledWith(144);
  });

  it('setObjPanelLogsTargetPerScopeLimit defaults zero and clamps large values', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsTargetPerScopeLimit(0);
    expect(getObjPanelLogsTargetPerScopeLimit()).toBe(OBJ_PANEL_LOGS_TARGET_PER_SCOPE_DEFAULT);

    setObjPanelLogsTargetPerScopeLimit(999_999);
    expect(getObjPanelLogsTargetPerScopeLimit()).toBe(OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX);
  });

  it('setObjPanelLogsTargetGlobalLimit round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsTargetGlobalLimit(180);
    expect(getObjPanelLogsTargetGlobalLimit()).toBe(180);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetObjPanelLogsTargetGlobalLimit).toHaveBeenCalledWith(180);
  });

  it('setObjPanelLogsTargetGlobalLimit defaults zero and clamps large values', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ theme: 'system' });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsTargetGlobalLimit(0);
    expect(getObjPanelLogsTargetGlobalLimit()).toBe(OBJ_PANEL_LOGS_TARGET_GLOBAL_DEFAULT);

    setObjPanelLogsTargetGlobalLimit(999_999);
    expect(getObjPanelLogsTargetGlobalLimit()).toBe(OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX);
  });
});
