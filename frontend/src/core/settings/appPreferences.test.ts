/**
 * frontend/src/core/settings/appPreferences.test.ts
 *
 * Test suite for appPreferences hydration and persistence helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getAccentColor,
  getAppearanceModePreference,
  getAutoRefreshEnabled,
  getBackgroundRefreshEnabled,
  getDimInactiveNamespaces,
  getExclusiveNamespaces,
  getGridTablePersistenceMode,
  getKubernetesClientBurst,
  getKubernetesClientQPS,
  getObjPanelLogsApiTimestampFormat,
  getObjPanelLogsApiTimestampUseLocalTimeZone,
  getObjPanelLogsBufferMaxSize,
  getMaxTableRows,
  getObjPanelLogsTargetGlobalLimit,
  getObjPanelLogsTargetPerScopeLimit,
  getMetricsRefreshIntervalMs,
  getPaletteTint,
  getPermissionSSRRFetchConcurrency,
  getUseShortResourceNames,
  hydrateAppPreferences,
  KUBERNETES_CLIENT_BURST_DEFAULT,
  KUBERNETES_CLIENT_BURST_MAX,
  KUBERNETES_CLIENT_BURST_MIN,
  KUBERNETES_CLIENT_QPS_DEFAULT,
  KUBERNETES_CLIENT_QPS_MAX,
  KUBERNETES_CLIENT_QPS_MIN,
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
  PERMISSION_SSRR_FETCH_CONCURRENCY_DEFAULT,
  PERMISSION_SSRR_FETCH_CONCURRENCY_MAX,
  PERMISSION_SSRR_FETCH_CONCURRENCY_MIN,
  resetAppPreferencesCacheForTesting,
  setAccentColor,
  setAppearanceModePreference,
  setAutoRefreshEnabled,
  setBackgroundRefreshEnabled,
  setDimInactiveNamespaces,
  setExclusiveNamespaces,
  setGridTablePersistenceMode,
  setKubernetesClientBurst,
  setKubernetesClientQPS,
  setObjPanelLogsApiTimestampFormat,
  setObjPanelLogsApiTimestampUseLocalTimeZone,
  setObjPanelLogsBufferMaxSize,
  setMaxTableRows,
  setObjPanelLogsTargetGlobalLimit,
  setObjPanelLogsTargetPerScopeLimit,
  setPaletteTint,
  setPermissionSSRRFetchConcurrency,
  setUseShortResourceNames,
  validateThemeClusterPattern,
} from './appPreferences';

const appMocks = vi.hoisted(() => ({
  GetAppSettings: vi.fn(),
  SetAppearanceMode: vi.fn(),
  SetDimInactiveNamespaces: vi.fn(),
  SetExclusiveNamespaces: vi.fn(),
  SetUseShortResourceNames: vi.fn(),
  SetObjPanelLogsAPITimestampFormat: vi.fn(),
  SetObjPanelLogsAPITimestampUseLocalTimeZone: vi.fn(),
  SetMaxTableRows: vi.fn(),
  SetObjPanelLogsBufferMaxSize: vi.fn(),
  SetObjPanelLogsTargetPerScopeLimit: vi.fn(),
  SetObjPanelLogsTargetGlobalLimit: vi.fn(),
  SetKubernetesClientQPS: vi.fn(),
  SetKubernetesClientBurst: vi.fn(),
  SetPermissionSSRRFetchConcurrency: vi.fn(),
  ValidateThemeClusterPattern: vi.fn(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  GetAppSettings: (...args: unknown[]) => appMocks.GetAppSettings(...args),
  SetAppearanceMode: (...args: unknown[]) => appMocks.SetAppearanceMode(...args),
  SetDimInactiveNamespaces: (...args: unknown[]) => appMocks.SetDimInactiveNamespaces(...args),
  SetExclusiveNamespaces: (...args: unknown[]) => appMocks.SetExclusiveNamespaces(...args),
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
  SetKubernetesClientQPS: (...args: unknown[]) => appMocks.SetKubernetesClientQPS(...args),
  SetKubernetesClientBurst: (...args: unknown[]) => appMocks.SetKubernetesClientBurst(...args),
  SetPermissionSSRRFetchConcurrency: (...args: unknown[]) =>
    appMocks.SetPermissionSSRRFetchConcurrency(...args),
  ValidateThemeClusterPattern: (...args: unknown[]) =>
    appMocks.ValidateThemeClusterPattern(...args),
}));

describe('appPreferences', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    appMocks.GetAppSettings.mockReset();
    appMocks.SetAppearanceMode.mockReset();
    appMocks.SetDimInactiveNamespaces.mockReset();
    appMocks.SetExclusiveNamespaces.mockReset();
    appMocks.SetUseShortResourceNames.mockReset();
    appMocks.SetObjPanelLogsAPITimestampFormat.mockReset();
    appMocks.SetObjPanelLogsAPITimestampUseLocalTimeZone.mockReset();
    appMocks.SetMaxTableRows.mockReset();
    appMocks.SetObjPanelLogsBufferMaxSize.mockReset();
    appMocks.SetObjPanelLogsTargetPerScopeLimit.mockReset();
    appMocks.SetObjPanelLogsTargetGlobalLimit.mockReset();
    appMocks.SetKubernetesClientQPS.mockReset();
    appMocks.SetKubernetesClientBurst.mockReset();
    appMocks.SetPermissionSSRRFetchConcurrency.mockReset();
    appMocks.ValidateThemeClusterPattern.mockReset();
    appMocks.SetObjPanelLogsAPITimestampFormat.mockResolvedValue(undefined);
    appMocks.SetObjPanelLogsAPITimestampUseLocalTimeZone.mockResolvedValue(undefined);
    appMocks.SetMaxTableRows.mockResolvedValue(undefined);
    appMocks.SetObjPanelLogsBufferMaxSize.mockResolvedValue(undefined);
    appMocks.SetObjPanelLogsTargetPerScopeLimit.mockResolvedValue(undefined);
    appMocks.SetObjPanelLogsTargetGlobalLimit.mockResolvedValue(undefined);
    appMocks.SetKubernetesClientQPS.mockResolvedValue(undefined);
    appMocks.SetKubernetesClientBurst.mockResolvedValue(undefined);
    appMocks.SetPermissionSSRRFetchConcurrency.mockResolvedValue(undefined);
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
          SetKubernetesClientQPS: vi.fn().mockResolvedValue(undefined),
          SetKubernetesClientBurst: vi.fn().mockResolvedValue(undefined),
          SetPermissionSSRRFetchConcurrency: vi.fn().mockResolvedValue(undefined),
          SetPaletteTint: vi.fn().mockResolvedValue(undefined),
          SetAccentColor: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
  });

  it('validates theme cluster patterns through the backend', async () => {
    appMocks.ValidateThemeClusterPattern.mockResolvedValue({
      valid: false,
      message: 'Invalid cluster pattern: missing closing bracket.',
    });

    await expect(validateThemeClusterPattern('prod-[')).resolves.toEqual({
      valid: false,
      message: 'Invalid cluster pattern: missing closing bracket.',
    });
    expect(appMocks.ValidateThemeClusterPattern).toHaveBeenCalledWith('prod-[');
  });

  afterEach(() => {
    delete (window as any).go;
  });

  it('hydrates preferences from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'light',
      useShortResourceNames: true,
      dimInactiveNamespaces: false,
      exclusiveNamespaces: false,
      autoRefreshEnabled: false,
      refreshBackgroundClustersEnabled: false,
      metricsRefreshIntervalMs: 7000,
      maxTableRows: 2500,
      kubernetesClientQPS: 250,
      kubernetesClientBurst: 500,
      permissionSSRRFetchConcurrency: 16,
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
      accentColorLight: '#326ce5',
      accentColorDark: '#f59e0b',
    });

    await hydrateAppPreferences({ force: true });

    expect(getAppearanceModePreference()).toBe('light');
    expect(getUseShortResourceNames()).toBe(true);
    expect(getDimInactiveNamespaces()).toBe(false);
    expect(getExclusiveNamespaces()).toBe(false);
    expect(getAutoRefreshEnabled()).toBe(false);
    expect(getBackgroundRefreshEnabled()).toBe(false);
    expect(getMetricsRefreshIntervalMs()).toBe(7000);
    expect(getMaxTableRows()).toBe(2500);
    expect(getKubernetesClientQPS()).toBe(250);
    expect(getKubernetesClientBurst()).toBe(500);
    expect(getPermissionSSRRFetchConcurrency()).toBe(16);
    expect(getObjPanelLogsApiTimestampFormat()).toBe('HH:mm:ss.SSS');
    expect(getObjPanelLogsApiTimestampUseLocalTimeZone()).toBe(true);
    expect(getObjPanelLogsTargetPerScopeLimit()).toBe(144);
    expect(getObjPanelLogsTargetGlobalLimit()).toBe(180);
    expect(getGridTablePersistenceMode()).toBe('namespaced');
    expect(getPaletteTint('light')).toEqual({ hue: 220, saturation: 50, brightness: -15 });
    expect(getPaletteTint('dark')).toEqual({ hue: 120, saturation: 40, brightness: 10 });
    expect(getAccentColor('light')).toBe('#326ce5');
    expect(getAccentColor('dark')).toBe('#f59e0b');
  });

  it('defaults palette hue, saturation, and brightness to 0 when not present', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
    });

    await hydrateAppPreferences({ force: true });

    expect(getPaletteTint('light')).toEqual({ hue: 0, saturation: 0, brightness: 0 });
    expect(getPaletteTint('dark')).toEqual({ hue: 0, saturation: 0, brightness: 0 });
    expect(getAccentColor('light')).toBe('');
    expect(getAccentColor('dark')).toBe('');
    expect(getDimInactiveNamespaces()).toBe(true);
    expect(getExclusiveNamespaces()).toBe(true);
  });

  it('normalizes an invalid persisted Object Panel Logs Tab API timestamp format back to the default', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      objPanelLogsApiTimestampFormat: 'foo',
    });

    await hydrateAppPreferences({ force: true });

    expect(getObjPanelLogsApiTimestampFormat()).toBe('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
  });

  it('persists preference updates and updates the cache', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      useShortResourceNames: false,
      dimInactiveNamespaces: true,
      exclusiveNamespaces: true,
      autoRefreshEnabled: true,
      refreshBackgroundClustersEnabled: true,
      metricsRefreshIntervalMs: 6000,
      gridTablePersistenceMode: 'shared',
    });

    await hydrateAppPreferences({ force: true });

    await setAppearanceModePreference('dark');
    await setUseShortResourceNames(true);
    await setDimInactiveNamespaces(false);
    await setExclusiveNamespaces(false);
    setObjPanelLogsApiTimestampFormat('HH:mm:ss.SSS');
    setObjPanelLogsApiTimestampUseLocalTimeZone(true);
    setMaxTableRows(2500);
    setKubernetesClientQPS(250);
    setKubernetesClientBurst(500);
    setPermissionSSRRFetchConcurrency(16);
    setAutoRefreshEnabled(false);
    setBackgroundRefreshEnabled(false);
    setGridTablePersistenceMode('namespaced');

    expect(appMocks.SetAppearanceMode).toHaveBeenCalledWith('dark');
    expect(appMocks.SetUseShortResourceNames).toHaveBeenCalledWith(true);
    expect(appMocks.SetDimInactiveNamespaces).toHaveBeenCalledWith(false);
    expect(appMocks.SetExclusiveNamespaces).toHaveBeenCalledWith(false);
    expect(appMocks.SetObjPanelLogsAPITimestampFormat).toHaveBeenCalledWith('HH:mm:ss.SSS');
    expect(appMocks.SetObjPanelLogsAPITimestampUseLocalTimeZone).toHaveBeenCalledWith(true);
    expect(appMocks.SetMaxTableRows).toHaveBeenCalledWith(2500);
    expect(appMocks.SetKubernetesClientQPS).toHaveBeenCalledWith(250);
    expect(appMocks.SetKubernetesClientBurst).toHaveBeenCalledWith(500);
    expect(appMocks.SetPermissionSSRRFetchConcurrency).toHaveBeenCalledWith(16);
    expect((window as any).go.backend.App.SetAutoRefreshEnabled).toHaveBeenCalledWith(false);
    expect((window as any).go.backend.App.SetBackgroundRefreshEnabled).toHaveBeenCalledWith(false);
    expect((window as any).go.backend.App.SetGridTablePersistenceMode).toHaveBeenCalledWith(
      'namespaced'
    );

    expect(getAppearanceModePreference()).toBe('dark');
    expect(getUseShortResourceNames()).toBe(true);
    expect(getDimInactiveNamespaces()).toBe(false);
    expect(getExclusiveNamespaces()).toBe(false);
    expect(getObjPanelLogsApiTimestampFormat()).toBe('HH:mm:ss.SSS');
    expect(getObjPanelLogsApiTimestampUseLocalTimeZone()).toBe(true);
    expect(getMaxTableRows()).toBe(2500);
    expect(getKubernetesClientQPS()).toBe(250);
    expect(getKubernetesClientBurst()).toBe(500);
    expect(getPermissionSSRRFetchConcurrency()).toBe(16);
    expect(getAutoRefreshEnabled()).toBe(false);
    expect(getBackgroundRefreshEnabled()).toBe(false);
    expect(getMetricsRefreshIntervalMs()).toBe(6000);
    expect(getGridTablePersistenceMode()).toBe('namespaced');
  });

  it('rejects invalid Object Panel Logs Tab API timestamp formats before persisting', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    expect(() => setObjPanelLogsApiTimestampFormat('foo')).toThrow(/Unsupported token/);
    expect(appMocks.SetObjPanelLogsAPITimestampFormat).not.toHaveBeenCalled();
  });

  it('setPaletteTint updates cache and calls backend for the specified mode', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
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
    // Dark mode should remain at defaults.
    expect(getPaletteTint('dark')).toEqual({ hue: 0, saturation: 0, brightness: 0 });
    expect((window as any).go.backend.App.SetPaletteTint).toHaveBeenCalledWith(
      'light',
      180,
      75,
      -25
    );

    setPaletteTint('dark', 300, 60, 20);

    expect(getPaletteTint('dark')).toEqual({ hue: 300, saturation: 60, brightness: 20 });
    // Light mode should be unchanged.
    expect(getPaletteTint('light')).toEqual({ hue: 180, saturation: 75, brightness: -25 });
    expect((window as any).go.backend.App.SetPaletteTint).toHaveBeenCalledWith('dark', 300, 60, 20);
  });

  it('setAccentColor updates cache and calls backend for the specified mode', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      accentColorLight: '',
      accentColorDark: '',
    });

    await hydrateAppPreferences({ force: true });

    setAccentColor('light', '#326ce5');

    expect(getAccentColor('light')).toBe('#326ce5');
    // Dark mode should remain at default.
    expect(getAccentColor('dark')).toBe('');
    expect((window as any).go.backend.App.SetAccentColor).toHaveBeenCalledWith('light', '#326ce5');

    setAccentColor('dark', '#f59e0b');

    expect(getAccentColor('dark')).toBe('#f59e0b');
    // Light mode should be unchanged.
    expect(getAccentColor('light')).toBe('#326ce5');
    expect((window as any).go.backend.App.SetAccentColor).toHaveBeenCalledWith('dark', '#f59e0b');
  });

  it('setAccentColor resets to empty string', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      accentColorLight: '#326ce5',
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
      appearanceMode: 'system',
      objPanelLogsBufferMaxSize: 2500,
    });
    await hydrateAppPreferences({ force: true });
    expect(getObjPanelLogsBufferMaxSize()).toBe(2500);
  });

  it('hydrates maxTableRows from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      maxTableRows: 2500,
    });
    await hydrateAppPreferences({ force: true });
    expect(getMaxTableRows()).toBe(2500);
  });

  it('defaults maxTableRows when the backend payload is missing the field', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    expect(getMaxTableRows()).toBe(MAX_TABLE_ROWS_DEFAULT);
  });

  it('setMaxTableRows round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      maxTableRows: MAX_TABLE_ROWS_DEFAULT,
    });
    await hydrateAppPreferences({ force: true });

    setMaxTableRows(2500);
    expect(getMaxTableRows()).toBe(2500);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetMaxTableRows).toHaveBeenCalledWith(2500);
  });

  it('setMaxTableRows clamps values outside the allowed range', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setMaxTableRows(1);
    expect(getMaxTableRows()).toBe(MAX_TABLE_ROWS_MIN);

    setMaxTableRows(999_999);
    expect(getMaxTableRows()).toBe(MAX_TABLE_ROWS_MAX);
  });

  it('defaults Kubernetes API settings when backend payload is missing the fields', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    expect(getKubernetesClientQPS()).toBe(KUBERNETES_CLIENT_QPS_DEFAULT);
    expect(getKubernetesClientBurst()).toBe(KUBERNETES_CLIENT_BURST_DEFAULT);
    expect(getPermissionSSRRFetchConcurrency()).toBe(PERMISSION_SSRR_FETCH_CONCURRENCY_DEFAULT);
  });

  it('setKubernetesClientQPS round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setKubernetesClientQPS(250);
    expect(getKubernetesClientQPS()).toBe(250);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetKubernetesClientQPS).toHaveBeenCalledWith(250);
  });

  it('setKubernetesClientQPS clamps values outside the allowed range', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setKubernetesClientQPS(0);
    expect(getKubernetesClientQPS()).toBe(KUBERNETES_CLIENT_QPS_DEFAULT);

    setKubernetesClientQPS(-1);
    expect(getKubernetesClientQPS()).toBe(KUBERNETES_CLIENT_QPS_DEFAULT);

    setKubernetesClientQPS(999_999);
    expect(getKubernetesClientQPS()).toBe(KUBERNETES_CLIENT_QPS_MAX);

    setKubernetesClientQPS(KUBERNETES_CLIENT_QPS_MIN - 0.1);
    expect(getKubernetesClientQPS()).toBe(KUBERNETES_CLIENT_QPS_MIN);
  });

  it('setKubernetesClientBurst round-trips and clamps values', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setKubernetesClientBurst(500);
    expect(getKubernetesClientBurst()).toBe(500);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetKubernetesClientBurst).toHaveBeenCalledWith(500);

    setKubernetesClientBurst(0);
    expect(getKubernetesClientBurst()).toBe(KUBERNETES_CLIENT_BURST_DEFAULT);

    setKubernetesClientBurst(999_999);
    expect(getKubernetesClientBurst()).toBe(KUBERNETES_CLIENT_BURST_MAX);

    setKubernetesClientBurst(KUBERNETES_CLIENT_BURST_MIN - 0.1);
    expect(getKubernetesClientBurst()).toBe(KUBERNETES_CLIENT_BURST_MIN);
  });

  it('setPermissionSSRRFetchConcurrency round-trips and clamps values', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setPermissionSSRRFetchConcurrency(16);
    expect(getPermissionSSRRFetchConcurrency()).toBe(16);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetPermissionSSRRFetchConcurrency).toHaveBeenCalledWith(16);

    setPermissionSSRRFetchConcurrency(0);
    expect(getPermissionSSRRFetchConcurrency()).toBe(PERMISSION_SSRR_FETCH_CONCURRENCY_DEFAULT);

    setPermissionSSRRFetchConcurrency(999_999);
    expect(getPermissionSSRRFetchConcurrency()).toBe(PERMISSION_SSRR_FETCH_CONCURRENCY_MAX);

    setPermissionSSRRFetchConcurrency(PERMISSION_SSRR_FETCH_CONCURRENCY_MIN - 0.1);
    expect(getPermissionSSRRFetchConcurrency()).toBe(PERMISSION_SSRR_FETCH_CONCURRENCY_MIN);
  });

  it('defaults Object Panel Logs Tab buffer size when the backend payload is missing the field', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    expect(getObjPanelLogsBufferMaxSize()).toBe(OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE);
  });

  it('defaults Object Panel Logs Tab buffer size when the backend payload reports zero (unset)', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      objPanelLogsBufferMaxSize: 0,
    });
    await hydrateAppPreferences({ force: true });
    expect(getObjPanelLogsBufferMaxSize()).toBe(OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE);
  });

  it('setObjPanelLogsBufferMaxSize round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
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
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    setObjPanelLogsBufferMaxSize(1);
    expect(getObjPanelLogsBufferMaxSize()).toBe(OBJ_PANEL_LOGS_BUFFER_MIN_SIZE);
  });

  it('setObjPanelLogsBufferMaxSize clamps values above the maximum', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    setObjPanelLogsBufferMaxSize(999_999);
    expect(getObjPanelLogsBufferMaxSize()).toBe(OBJ_PANEL_LOGS_BUFFER_MAX_SIZE);
  });

  it('hydrates Object Panel Logs Tab target limits from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      objPanelLogsTargetPerScopeLimit: 144,
      objPanelLogsTargetGlobalLimit: 180,
    });
    await hydrateAppPreferences({ force: true });
    expect(getObjPanelLogsTargetPerScopeLimit()).toBe(144);
    expect(getObjPanelLogsTargetGlobalLimit()).toBe(180);
  });

  it('defaults Object Panel Logs Tab target limits when the backend payload is missing the fields', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    expect(getObjPanelLogsTargetPerScopeLimit()).toBe(OBJ_PANEL_LOGS_TARGET_PER_SCOPE_DEFAULT);
    expect(getObjPanelLogsTargetGlobalLimit()).toBe(OBJ_PANEL_LOGS_TARGET_GLOBAL_DEFAULT);
  });

  it('setObjPanelLogsTargetPerScopeLimit round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsTargetPerScopeLimit(144);
    expect(getObjPanelLogsTargetPerScopeLimit()).toBe(144);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetObjPanelLogsTargetPerScopeLimit).toHaveBeenCalledWith(144);
  });

  it('setObjPanelLogsTargetPerScopeLimit defaults zero and clamps large values', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsTargetPerScopeLimit(0);
    expect(getObjPanelLogsTargetPerScopeLimit()).toBe(OBJ_PANEL_LOGS_TARGET_PER_SCOPE_DEFAULT);

    setObjPanelLogsTargetPerScopeLimit(999_999);
    expect(getObjPanelLogsTargetPerScopeLimit()).toBe(OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX);
  });

  it('setObjPanelLogsTargetGlobalLimit round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsTargetGlobalLimit(180);
    expect(getObjPanelLogsTargetGlobalLimit()).toBe(180);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.SetObjPanelLogsTargetGlobalLimit).toHaveBeenCalledWith(180);
  });

  it('setObjPanelLogsTargetGlobalLimit defaults zero and clamps large values', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsTargetGlobalLimit(0);
    expect(getObjPanelLogsTargetGlobalLimit()).toBe(OBJ_PANEL_LOGS_TARGET_GLOBAL_DEFAULT);

    setObjPanelLogsTargetGlobalLimit(999_999);
    expect(getObjPanelLogsTargetGlobalLimit()).toBe(OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX);
  });
});
