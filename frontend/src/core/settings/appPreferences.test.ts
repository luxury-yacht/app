/**
 * frontend/src/core/settings/appPreferences.test.ts
 *
 * Test suite for appPreferences hydration and persistence helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { installWindowProperty } from '@/test-utils/windowProperty';
import {
  type AppPreferenceKey,
  commitIntegerPreferenceInput,
  createPaletteTintPreferenceWorkflow,
  getAccentColor,
  getAppearanceModePreference,
  getAutoRefreshEnabled,
  getBackgroundRefreshEnabled,
  getDefaultObjectPanelPosition,
  getDefaultTablePageSize,
  getDimInactiveNamespaces,
  getExclusiveNamespaces,
  getGridTablePersistenceMode,
  getIntegerPreferenceMetadata,
  getKubernetesClientBurst,
  getKubernetesClientQPS,
  getLinkColor,
  getObjectPanelLayoutDefaults,
  getObjPanelLogsApiTimestampFormat,
  getObjPanelLogsApiTimestampUseLocalTimeZone,
  getObjPanelLogsBufferMaxSize,
  getObjPanelLogsTargetGlobalLimit,
  getObjPanelLogsTargetPerScopeLimit,
  getPaletteTint,
  getPermissionSSRRFetchConcurrency,
  getPreferenceMetadata,
  getUseShortResourceNames,
  hydrateAppPreferences,
  KUBERNETES_CLIENT_BURST_DEFAULT,
  KUBERNETES_CLIENT_BURST_MAX,
  KUBERNETES_CLIENT_BURST_MIN,
  KUBERNETES_CLIENT_QPS_DEFAULT,
  KUBERNETES_CLIENT_QPS_MAX,
  KUBERNETES_CLIENT_QPS_MIN,
  normalizeIntegerPreferenceValue,
  OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE,
  OBJ_PANEL_LOGS_BUFFER_MAX_SIZE,
  OBJ_PANEL_LOGS_BUFFER_MIN_SIZE,
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
  setDefaultTablePageSize,
  setDimInactiveNamespaces,
  setExclusiveNamespaces,
  setGridTablePersistenceMode,
  setKubernetesClientBurst,
  setKubernetesClientQPS,
  setLinkColor,
  setObjectPanelLayoutDefaults,
  setObjPanelLogsApiTimestampFormat,
  setObjPanelLogsApiTimestampUseLocalTimeZone,
  setObjPanelLogsBufferMaxSize,
  setObjPanelLogsTargetGlobalLimit,
  setObjPanelLogsTargetPerScopeLimit,
  setPaletteTint,
  setPermissionSSRRFetchConcurrency,
  setUseShortResourceNames,
  validateThemeClusterPattern,
} from './appPreferences';

const appMocks = vi.hoisted(() => ({
  GetAppSettings: vi.fn(),
  GetAppSettingsSchema: vi.fn(),
  UpdateAppPreferences: vi.fn(),
  ValidateThemeClusterPattern: vi.fn(),
}));

const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const preferenceSchema = (overrides: Record<string, Partial<Record<string, unknown>>> = {}) => {
  const definitions: Array<{
    key: string;
    type: string;
    defaultValue: unknown;
    currentValue: unknown;
    min?: number;
    max?: number;
    enumOptions?: string[];
    validation?: string;
    runtimeSideEffect: boolean;
  }> = [
    {
      key: 'appearanceMode',
      type: 'enum',
      defaultValue: 'system',
      currentValue: 'system',
      enumOptions: ['light', 'dark', 'system'],
      runtimeSideEffect: true,
    },
    {
      key: 'useShortResourceNames',
      type: 'boolean',
      defaultValue: false,
      currentValue: false,
      runtimeSideEffect: false,
    },
    {
      key: 'dimInactiveNamespaces',
      type: 'boolean',
      defaultValue: true,
      currentValue: true,
      runtimeSideEffect: false,
    },
    {
      key: 'exclusiveNamespaces',
      type: 'boolean',
      defaultValue: true,
      currentValue: true,
      runtimeSideEffect: false,
    },
    {
      key: 'autoRefreshEnabled',
      type: 'boolean',
      defaultValue: true,
      currentValue: true,
      runtimeSideEffect: true,
    },
    {
      key: 'refreshBackgroundClustersEnabled',
      type: 'boolean',
      defaultValue: true,
      currentValue: true,
      runtimeSideEffect: true,
    },
    {
      key: 'metricsRefreshIntervalMs',
      type: 'integer',
      defaultValue: 5000,
      currentValue: 5000,
      min: 1,
      runtimeSideEffect: true,
    },
    {
      key: 'kubernetesClientQPS',
      type: 'integer',
      defaultValue: 200,
      currentValue: 200,
      min: 1,
      max: 5000,
      runtimeSideEffect: true,
    },
    {
      key: 'kubernetesClientBurst',
      type: 'integer',
      defaultValue: 500,
      currentValue: 500,
      min: 1,
      max: 10000,
      runtimeSideEffect: true,
    },
    {
      key: 'permissionSSRRFetchConcurrency',
      type: 'integer',
      defaultValue: 32,
      currentValue: 32,
      min: 1,
      max: 256,
      runtimeSideEffect: false,
    },
    {
      key: 'objPanelLogsBufferMaxSize',
      type: 'integer',
      defaultValue: 1000,
      currentValue: 1000,
      min: 100,
      max: 10000,
      runtimeSideEffect: false,
    },
    {
      key: 'objPanelLogsApiTimestampFormat',
      type: 'string',
      defaultValue: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
      currentValue: 'YYYY-MM-DDTHH:mm:ss.SSS[Z]',
      validation: 'dayjs-format',
      runtimeSideEffect: false,
    },
    {
      key: 'objPanelLogsApiTimestampUseLocalTimeZone',
      type: 'boolean',
      defaultValue: false,
      currentValue: false,
      runtimeSideEffect: false,
    },
    {
      key: 'objPanelLogsTargetPerScopeLimit',
      type: 'integer',
      defaultValue: 100,
      currentValue: 100,
      min: 1,
      max: 1000,
      runtimeSideEffect: true,
    },
    {
      key: 'objPanelLogsTargetGlobalLimit',
      type: 'integer',
      defaultValue: 200,
      currentValue: 200,
      min: 1,
      max: 1000,
      runtimeSideEffect: true,
    },
    {
      key: 'gridTablePersistenceMode',
      type: 'enum',
      defaultValue: 'shared',
      currentValue: 'shared',
      enumOptions: ['shared', 'namespaced'],
      runtimeSideEffect: false,
    },
    {
      key: 'defaultObjectPanelPosition',
      type: 'enum',
      defaultValue: 'right',
      currentValue: 'right',
      enumOptions: ['right', 'bottom', 'floating'],
      runtimeSideEffect: false,
    },
    {
      key: 'objectPanelDockedRightWidth',
      type: 'integer',
      defaultValue: 600,
      currentValue: 600,
      min: 500,
      max: 9999,
      runtimeSideEffect: false,
    },
    {
      key: 'objectPanelDockedBottomHeight',
      type: 'integer',
      defaultValue: 400,
      currentValue: 400,
      min: 200,
      max: 9999,
      runtimeSideEffect: false,
    },
    {
      key: 'objectPanelFloatingWidth',
      type: 'integer',
      defaultValue: 500,
      currentValue: 500,
      min: 450,
      max: 9999,
      runtimeSideEffect: false,
    },
    {
      key: 'objectPanelFloatingHeight',
      type: 'integer',
      defaultValue: 400,
      currentValue: 400,
      min: 200,
      max: 9999,
      runtimeSideEffect: false,
    },
    {
      key: 'objectPanelFloatingX',
      type: 'integer',
      defaultValue: 100,
      currentValue: 100,
      min: 1,
      max: 9999,
      runtimeSideEffect: false,
    },
    {
      key: 'objectPanelFloatingY',
      type: 'integer',
      defaultValue: 100,
      currentValue: 100,
      min: 1,
      max: 9999,
      runtimeSideEffect: false,
    },
    {
      key: 'paletteHueLight',
      type: 'integer',
      defaultValue: 0,
      currentValue: 0,
      min: 0,
      max: 360,
      runtimeSideEffect: false,
    },
    {
      key: 'paletteSaturationLight',
      type: 'integer',
      defaultValue: 0,
      currentValue: 0,
      min: 0,
      max: 100,
      runtimeSideEffect: false,
    },
    {
      key: 'paletteBrightnessLight',
      type: 'integer',
      defaultValue: 0,
      currentValue: 0,
      min: -50,
      max: 50,
      runtimeSideEffect: false,
    },
    {
      key: 'paletteHueDark',
      type: 'integer',
      defaultValue: 0,
      currentValue: 0,
      min: 0,
      max: 360,
      runtimeSideEffect: false,
    },
    {
      key: 'paletteSaturationDark',
      type: 'integer',
      defaultValue: 0,
      currentValue: 0,
      min: 0,
      max: 100,
      runtimeSideEffect: false,
    },
    {
      key: 'paletteBrightnessDark',
      type: 'integer',
      defaultValue: 0,
      currentValue: 0,
      min: -50,
      max: 50,
      runtimeSideEffect: false,
    },
    {
      key: 'accentColorLight',
      type: 'color',
      defaultValue: '',
      currentValue: '',
      validation: '#rrggbb-or-empty',
      runtimeSideEffect: false,
    },
    {
      key: 'accentColorDark',
      type: 'color',
      defaultValue: '',
      currentValue: '',
      validation: '#rrggbb-or-empty',
      runtimeSideEffect: false,
    },
    {
      key: 'linkColorLight',
      type: 'color',
      defaultValue: '',
      currentValue: '',
      validation: '#rrggbb-or-empty',
      runtimeSideEffect: false,
    },
    {
      key: 'linkColorDark',
      type: 'color',
      defaultValue: '',
      currentValue: '',
      validation: '#rrggbb-or-empty',
      runtimeSideEffect: false,
    },
  ];

  return {
    preferences: definitions.map((definition) => ({
      ...definition,
      ...overrides[definition.key],
    })),
  };
};

vi.mock('@wailsjs/go/backend/App', () => ({
  GetAppSettings: (...args: unknown[]) => appMocks.GetAppSettings(...args),
  GetAppSettingsSchema: (...args: unknown[]) => appMocks.GetAppSettingsSchema(...args),
  UpdateAppPreferences: (...args: unknown[]) => appMocks.UpdateAppPreferences(...args),
  ValidateThemeClusterPattern: (...args: unknown[]) =>
    appMocks.ValidateThemeClusterPattern(...args),
}));

describe('appPreferences', () => {
  let restoreGo: () => void;

  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    appMocks.GetAppSettings.mockReset();
    appMocks.GetAppSettingsSchema.mockReset();
    appMocks.UpdateAppPreferences.mockReset();
    appMocks.ValidateThemeClusterPattern.mockReset();
    appMocks.GetAppSettingsSchema.mockResolvedValue(null);
    appMocks.UpdateAppPreferences.mockResolvedValue({ settings: {}, changedKeys: [] });
    restoreGo = installWindowProperty('go', {
      backend: {
        App: {
          UpdateAppPreferences: vi.fn().mockResolvedValue({ settings: {}, changedKeys: [] }),
        },
      },
    });
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
    vi.useRealTimers();
    restoreGo();
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

  it('hydrates preferences from backend schema when available', async () => {
    appMocks.GetAppSettingsSchema.mockResolvedValue({
      preferences: [
        { key: 'appearanceMode', type: 'enum', defaultValue: 'system', currentValue: 'dark' },
        { key: 'retiredPreference', type: 'integer', defaultValue: 1000, currentValue: 5000 },
        {
          key: 'defaultObjectPanelPosition',
          type: 'enum',
          defaultValue: 'right',
          currentValue: 'bottom',
        },
        {
          key: 'objectPanelDockedRightWidth',
          type: 'integer',
          defaultValue: 600,
          currentValue: 720,
        },
      ],
    });

    await hydrateAppPreferences({ force: true });

    expect(appMocks.GetAppSettings).not.toHaveBeenCalled();
    expect(getAppearanceModePreference()).toBe('dark');
    expect(getDefaultObjectPanelPosition()).toBe('bottom');
  });

  it('exposes typed preference metadata from the backend schema', async () => {
    appMocks.GetAppSettingsSchema.mockResolvedValue(
      preferenceSchema({
        kubernetesClientQPS: { defaultValue: 150, currentValue: 5000, min: 50, max: 9000 },
        appearanceMode: { defaultValue: 'system', currentValue: 'dark' },
      })
    );

    await hydrateAppPreferences({ force: true });

    expect(getPreferenceMetadata('appearanceMode')).toMatchObject({
      key: 'appearanceMode',
      type: 'enum',
      defaultValue: 'system',
      currentValue: 'dark',
      enumOptions: ['light', 'dark', 'system'],
      runtimeSideEffect: true,
    });
    expect(getIntegerPreferenceMetadata('kubernetesClientQPS')).toMatchObject({
      key: 'kubernetesClientQPS',
      type: 'integer',
      defaultValue: 150,
      currentValue: 5000,
      min: 50,
      max: 9000,
    });
    expect(normalizeIntegerPreferenceValue('kubernetesClientQPS', 10)).toBe(50);
    expect(normalizeIntegerPreferenceValue('kubernetesClientQPS', 99999)).toBe(9000);
  });

  it('tracks schema metadata for every appPreferences key', async () => {
    const schema = preferenceSchema();
    appMocks.GetAppSettingsSchema.mockResolvedValue(schema);

    await hydrateAppPreferences({ force: true });

    const keys = schema.preferences.map((entry) => entry.key);
    for (const key of keys) {
      expect(getPreferenceMetadata(key as AppPreferenceKey)).toMatchObject({
        key,
      });
    }
    expect(keys).not.toContain('selectedKubeconfigs');
    expect(keys).not.toContain('themes');
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

  it('hydrates the default table page size and snaps off-list values to the default', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ defaultTablePageSize: 250 });
    await hydrateAppPreferences({ force: true });
    expect(getDefaultTablePageSize()).toBe(250);

    resetAppPreferencesCacheForTesting();
    appMocks.GetAppSettings.mockResolvedValue({ defaultTablePageSize: 333 });
    await hydrateAppPreferences({ force: true });
    expect(getDefaultTablePageSize()).toBe(50);
  });

  it('persists the default table page size and emits its change event', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ defaultTablePageSize: 50 });
    await hydrateAppPreferences({ force: true });

    const events: number[] = [];
    const unsubscribe = eventBus.on('settings:default-table-page-size', (value) =>
      events.push(value)
    );

    setDefaultTablePageSize(100);

    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'defaultTablePageSize', value: 100 }],
    });
    expect(getDefaultTablePageSize()).toBe(100);
    expect(events).toEqual([100]);

    unsubscribe();
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
    setKubernetesClientQPS(250);
    setKubernetesClientBurst(500);
    setPermissionSSRRFetchConcurrency(16);
    setAutoRefreshEnabled(false);
    setBackgroundRefreshEnabled(false);
    setGridTablePersistenceMode('namespaced');

    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'appearanceMode', value: 'dark' }],
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'useShortResourceNames', value: true }],
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'dimInactiveNamespaces', value: false }],
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'exclusiveNamespaces', value: false }],
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'objPanelLogsApiTimestampFormat', value: 'HH:mm:ss.SSS' }],
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'objPanelLogsApiTimestampUseLocalTimeZone', value: true }],
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'kubernetesClientQPS', value: 250 }],
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'kubernetesClientBurst', value: 500 }],
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'permissionSSRRFetchConcurrency', value: 16 }],
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'autoRefreshEnabled', value: false }],
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'refreshBackgroundClustersEnabled', value: false }],
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'gridTablePersistenceMode', value: 'namespaced' }],
    });

    expect(getAppearanceModePreference()).toBe('dark');
    expect(getUseShortResourceNames()).toBe(true);
    expect(getDimInactiveNamespaces()).toBe(false);
    expect(getExclusiveNamespaces()).toBe(false);
    expect(getObjPanelLogsApiTimestampFormat()).toBe('HH:mm:ss.SSS');
    expect(getObjPanelLogsApiTimestampUseLocalTimeZone()).toBe(true);
    expect(getKubernetesClientQPS()).toBe(250);
    expect(getKubernetesClientBurst()).toBe(500);
    expect(getPermissionSSRRFetchConcurrency()).toBe(16);
    expect(getAutoRefreshEnabled()).toBe(false);
    expect(getBackgroundRefreshEnabled()).toBe(false);
    expect(getGridTablePersistenceMode()).toBe('namespaced');
  });

  it('normalizes Object Panel layout updates from schema metadata', async () => {
    appMocks.GetAppSettingsSchema.mockResolvedValue(preferenceSchema());
    await hydrateAppPreferences({ force: true });

    setObjectPanelLayoutDefaults({
      dockedRightWidth: 1,
      dockedBottomHeight: 20_000,
      floatingWidth: 1,
      floatingHeight: 20_000,
      floatingX: -5,
      floatingY: 20_000,
    });

    expect(getObjectPanelLayoutDefaults()).toEqual({
      dockedRightWidth: 500,
      dockedBottomHeight: 9999,
      floatingWidth: 450,
      floatingHeight: 9999,
      floatingX: 100,
      floatingY: 9999,
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [
        { key: 'objectPanelDockedRightWidth', value: 500 },
        { key: 'objectPanelDockedBottomHeight', value: 9999 },
        { key: 'objectPanelFloatingWidth', value: 450 },
        { key: 'objectPanelFloatingHeight', value: 9999 },
        { key: 'objectPanelFloatingX', value: 100 },
        { key: 'objectPanelFloatingY', value: 9999 },
      ],
    });
  });

  it('persists link color updates through the shared update path', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      linkColorLight: '',
      linkColorDark: '',
    });

    await hydrateAppPreferences({ force: true });

    setLinkColor('light', '#326ce5');

    expect(getLinkColor('light')).toBe('#326ce5');
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'linkColorLight', value: '#326ce5' }],
    });
  });

  it('rolls back optimistic runtime preference state and events when persistence fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events: boolean[] = [];
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      autoRefreshEnabled: true,
    });
    await hydrateAppPreferences({ force: true });
    const unsubscribe = eventBus.on('settings:auto-refresh', (enabled) => events.push(enabled));
    appMocks.UpdateAppPreferences.mockRejectedValueOnce(new Error('forced failure'));

    setAutoRefreshEnabled(false);
    expect(getAutoRefreshEnabled()).toBe(false);
    await flushPromises();

    expect(getAutoRefreshEnabled()).toBe(true);
    expect(events).toEqual([false, true]);
    unsubscribe();
    consoleError.mockRestore();
  });

  it('rolls back appearance localStorage mirrors when persistence fails', async () => {
    localStorage.setItem('app-appearance-mode-preference', 'system');
    localStorage.setItem('app-appearance-bootstrap-v1', '{"light":{},"dark":{}}');
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    localStorage.setItem('app-appearance-mode-preference', 'system');
    localStorage.setItem('app-appearance-bootstrap-v1', 'previous-bootstrap');
    appMocks.UpdateAppPreferences.mockRejectedValueOnce(new Error('forced failure'));

    await expect(setAppearanceModePreference('dark')).rejects.toThrow('forced failure');

    expect(getAppearanceModePreference()).toBe('system');
    expect(localStorage.getItem('app-appearance-mode-preference')).toBe('system');
    expect(localStorage.getItem('app-appearance-bootstrap-v1')).toBe('previous-bootstrap');
  });

  it('rejects invalid Object Panel Logs Tab API timestamp formats before persisting', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    expect(() => setObjPanelLogsApiTimestampFormat('foo')).toThrow(/Unsupported token/);
    expect(appMocks.UpdateAppPreferences).not.toHaveBeenCalled();
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
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [
        { key: 'paletteHueLight', value: 180 },
        { key: 'paletteSaturationLight', value: 75 },
        { key: 'paletteBrightnessLight', value: -25 },
      ],
    });

    setPaletteTint('dark', 300, 60, 20);

    expect(getPaletteTint('dark')).toEqual({ hue: 300, saturation: 60, brightness: 20 });
    // Light mode should be unchanged.
    expect(getPaletteTint('light')).toEqual({ hue: 180, saturation: 75, brightness: -25 });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [
        { key: 'paletteHueDark', value: 300 },
        { key: 'paletteSaturationDark', value: 60 },
        { key: 'paletteBrightnessDark', value: 20 },
      ],
    });
  });

  it('debounces workflow preference commits and persists only the latest value', async () => {
    vi.useFakeTimers();
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      paletteHueLight: 0,
      paletteSaturationLight: 0,
      paletteBrightnessLight: 0,
    });

    await hydrateAppPreferences({ force: true });
    const workflow = createPaletteTintPreferenceWorkflow({ debounceMs: 50 });

    workflow.commitDebounced({ mode: 'light', hue: 20, saturation: 25, brightness: 5 });
    workflow.commitDebounced({ mode: 'light', hue: 40, saturation: 50, brightness: -5 });

    expect(getPaletteTint('light')).toEqual({ hue: 0, saturation: 0, brightness: 0 });
    expect(appMocks.UpdateAppPreferences).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    await vi.runAllTimersAsync();

    expect(getPaletteTint('light')).toEqual({ hue: 40, saturation: 50, brightness: -5 });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledTimes(1);
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [
        { key: 'paletteHueLight', value: 40 },
        { key: 'paletteSaturationLight', value: 50 },
        { key: 'paletteBrightnessLight', value: -5 },
      ],
    });
    vi.useRealTimers();
  });

  it('commits integer preference inputs through schema-backed normalization', async () => {
    appMocks.GetAppSettingsSchema.mockResolvedValue(
      preferenceSchema({
        kubernetesClientQPS: { defaultValue: 750, currentValue: 1000, min: 50, max: 9000 },
      })
    );
    await hydrateAppPreferences({ force: true });
    const persisted: number[] = [];

    const normalized = commitIntegerPreferenceInput(
      'kubernetesClientQPS',
      '99999',
      (value) => persisted.push(value),
      { defaultOnNonPositive: true }
    );

    expect(normalized).toBe(9000);
    expect(persisted).toEqual([9000]);
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
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'accentColorLight', value: '#326ce5' }],
    });

    setAccentColor('dark', '#f59e0b');

    expect(getAccentColor('dark')).toBe('#f59e0b');
    // Light mode should be unchanged.
    expect(getAccentColor('light')).toBe('#326ce5');
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'accentColorDark', value: '#f59e0b' }],
    });
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
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'kubernetesClientQPS', value: 250 }],
    });
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
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'kubernetesClientBurst', value: 500 }],
    });

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
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'permissionSSRRFetchConcurrency', value: 16 }],
    });

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
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'objPanelLogsBufferMaxSize', value: 3500 }],
    });
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
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'objPanelLogsTargetPerScopeLimit', value: 144 }],
    });
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
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'objPanelLogsTargetGlobalLimit', value: 180 }],
    });
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
