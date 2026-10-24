/**
 * frontend/src/core/settings/appPreferences.test.ts
 *
 * Test suite for appPreferences hydration and persistence helpers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import {
  type AppPreferenceKey,
  type AppPreferences,
  applyBroadcastAppearanceModePreference,
  commitIntegerPreferenceInput,
  createPaletteTintPreferenceWorkflow,
  getAccentColor,
  getLinkColor,
  getObjectPanelLayoutDefaults,
  getPaletteTint,
  getPreference,
  getSidebarGroupExpanded,
  hydrateAppPreferences,
  resetAppPreferencesCacheForTesting,
  setAccentColor,
  setAppearanceModePreference,
  setAutoRefreshEnabled,
  setDefaultTablePageSize,
  setDimInactiveNamespaces,
  setErrorReportingEnabled,
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
  setSidebarGroupExpanded,
  setUseShortResourceNames,
  subscribePreference,
  validateThemeClusterPattern,
} from './appPreferences';
import { APP_PREFERENCE_SPECS as SPECS } from './appPreferences.generated';

const appMocks = vi.hoisted(() => ({
  GetAppSettings: vi.fn(),
  UpdateAppPreferences: vi.fn(),
  ValidateThemeClusterPattern: vi.fn(),
}));

const telemetryMocks = vi.hoisted(() => ({
  captureBootstrapError: vi.fn(),
  captureUserVisibleError: vi.fn(),
  recordBrokerRequestCompleted: vi.fn(),
  recordBrokerRequestStarted: vi.fn(),
}));

const desktopRuntimeMocks = vi.hoisted(() => ({
  emitBroadcastEvent: vi.fn(),
}));

vi.mock('@/core/telemetry/sentry', () => telemetryMocks);

const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

vi.mock('@core/backend-api', () => ({
  GetAppSettings: (...args: unknown[]) => appMocks.GetAppSettings(...args),
  UpdateAppPreferences: (...args: unknown[]) => appMocks.UpdateAppPreferences(...args),
  ValidateThemeClusterPattern: (...args: unknown[]) =>
    appMocks.ValidateThemeClusterPattern(...args),
}));

vi.mock('@core/desktop-runtime', () => ({
  desktopRuntimeAvailable: () => true,
  emitBroadcastEvent: (...args: unknown[]) => desktopRuntimeMocks.emitBroadcastEvent(...args),
}));

describe('appPreferences', () => {
  beforeEach(() => {
    resetAppPreferencesCacheForTesting();
    appMocks.GetAppSettings.mockReset();
    appMocks.UpdateAppPreferences.mockReset();
    appMocks.ValidateThemeClusterPattern.mockReset();
    telemetryMocks.captureBootstrapError.mockReset();
    telemetryMocks.captureUserVisibleError.mockReset();
    telemetryMocks.recordBrokerRequestCompleted.mockReset();
    telemetryMocks.recordBrokerRequestStarted.mockReset();
    desktopRuntimeMocks.emitBroadcastEvent.mockReset();
    desktopRuntimeMocks.emitBroadcastEvent.mockResolvedValue(false);
    appMocks.UpdateAppPreferences.mockResolvedValue({ settings: {}, changedKeys: [] });
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
  });

  it('hydrates preferences from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'light',
      useShortResourceNames: true,
      dimInactiveNamespaces: false,
      exclusiveNamespaces: false,
      autoRefreshEnabled: false,
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

    expect(getPreference('appearanceMode')).toBe('light');
    expect(getPreference('useShortResourceNames')).toBe(true);
    expect(getPreference('dimInactiveNamespaces')).toBe(false);
    expect(getPreference('exclusiveNamespaces')).toBe(false);
    expect(getPreference('autoRefreshEnabled')).toBe(false);
    expect(getPreference('kubernetesClientQPS')).toBe(250);
    expect(getPreference('kubernetesClientBurst')).toBe(500);
    expect(getPreference('permissionSSRRFetchConcurrency')).toBe(16);
    expect(getPreference('objPanelLogsApiTimestampFormat')).toBe('HH:mm:ss.SSS');
    expect(getPreference('objPanelLogsApiTimestampUseLocalTimeZone')).toBe(true);
    expect(getPreference('objPanelLogsTargetPerScopeLimit')).toBe(144);
    expect(getPreference('objPanelLogsTargetGlobalLimit')).toBe(180);
    expect(getPreference('gridTablePersistenceMode')).toBe('namespaced');
    expect(getPaletteTint('light')).toEqual({ hue: 220, saturation: 50, brightness: -15 });
    expect(getPaletteTint('dark')).toEqual({ hue: 120, saturation: 40, brightness: 10 });
    expect(getAccentColor('light')).toBe('#326ce5');
    expect(getAccentColor('dark')).toBe('#f59e0b');
  });

  it('notifies hydrated preference changes in the established order', async () => {
    const events: string[] = [];
    const unsubscribers = [
      subscribePreference('autoRefreshEnabled', () => events.push('auto-refresh')),
      subscribePreference('exclusiveNamespaces', () => events.push('exclusive')),
      subscribePreference('dimInactiveNamespaces', () => events.push('dim')),
      subscribePreference('useShortResourceNames', () => events.push('short-names')),
      subscribePreference('appearanceMode', () => events.push('appearance')),
    ];
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'dark',
      useShortResourceNames: true,
      dimInactiveNamespaces: false,
      exclusiveNamespaces: false,
      autoRefreshEnabled: false,
    });

    await hydrateAppPreferences({ force: true });

    expect(events).toEqual(['appearance', 'short-names', 'dim', 'exclusive', 'auto-refresh']);
    unsubscribers.forEach((unsubscribe) => {
      unsubscribe();
    });
  });

  it('defaults error reporting on when the backend settings omit the preference', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      anonymizedId: '123e4567-e89b-42d3-a456-426614174000',
    });

    await hydrateAppPreferences({ force: true });

    expect(getPreference('errorReportingEnabled')).toBe(true);
  });

  it('hydrates anonymizedId from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      anonymizedId: '123e4567-e89b-42d3-a456-426614174000',
      errorReportingEnabled: true,
    });

    const preferences = await hydrateAppPreferences({ force: true });

    expect(preferences.anonymizedId).toBe('123e4567-e89b-42d3-a456-426614174000');
  });

  it('fails error reporting closed when persisted settings cannot be read', async () => {
    const settingsFailure = new Error('settings unavailable');
    appMocks.GetAppSettings.mockRejectedValue(settingsFailure);

    await hydrateAppPreferences({ force: true });

    expect(telemetryMocks.captureBootstrapError).toHaveBeenCalledOnce();
    expect(telemetryMocks.captureBootstrapError).toHaveBeenCalledWith(settingsFailure, {
      action: 'loadAppSettings',
    });
    expect(getPreference('errorReportingEnabled')).toBe(false);
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
    expect(getPreference('dimInactiveNamespaces')).toBe(true);
    expect(getPreference('exclusiveNamespaces')).toBe(true);
  });

  it('normalizes an invalid persisted Object Panel Logs Tab API timestamp format back to the default', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      objPanelLogsApiTimestampFormat: 'foo',
    });

    await hydrateAppPreferences({ force: true });

    expect(getPreference('objPanelLogsApiTimestampFormat')).toBe('YYYY-MM-DDTHH:mm:ss.SSS[Z]');
  });

  // The backend keeps any non-empty format; the frontend's Day.js check is the
  // deliberate stricter rule, so it is tested here rather than by parity.
  it('hydrates a padded Object Panel Logs Tab API timestamp format trimmed', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      objPanelLogsApiTimestampFormat: '  HH:mm:ss  ',
    });

    await hydrateAppPreferences({ force: true });

    expect(getPreference('objPanelLogsApiTimestampFormat')).toBe('HH:mm:ss');
  });

  it('hydrates the default table page size and snaps off-list values to the default', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ defaultTablePageSize: 250 });
    await hydrateAppPreferences({ force: true });
    expect(getPreference('defaultTablePageSize')).toBe(250);

    resetAppPreferencesCacheForTesting();
    appMocks.GetAppSettings.mockResolvedValue({ defaultTablePageSize: 333 });
    await hydrateAppPreferences({ force: true });
    expect(getPreference('defaultTablePageSize')).toBe(50);
  });

  it('persists the default table page size and notifies its subscribers', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ defaultTablePageSize: 50 });
    await hydrateAppPreferences({ force: true });

    const events: number[] = [];
    const unsubscribe = subscribePreference('defaultTablePageSize', (value) => events.push(value));

    setDefaultTablePageSize(100);

    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'defaultTablePageSize', value: 100 }],
    });
    expect(getPreference('defaultTablePageSize')).toBe(100);
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
    setGridTablePersistenceMode('namespaced');
    await flushPromises();

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
      changes: [{ key: 'gridTablePersistenceMode', value: 'namespaced' }],
    });

    expect(getPreference('appearanceMode')).toBe('dark');
    expect(getPreference('useShortResourceNames')).toBe(true);
    expect(getPreference('dimInactiveNamespaces')).toBe(false);
    expect(getPreference('exclusiveNamespaces')).toBe(false);
    expect(getPreference('objPanelLogsApiTimestampFormat')).toBe('HH:mm:ss.SSS');
    expect(getPreference('objPanelLogsApiTimestampUseLocalTimeZone')).toBe(true);
    expect(getPreference('kubernetesClientQPS')).toBe(250);
    expect(getPreference('kubernetesClientBurst')).toBe(500);
    expect(getPreference('permissionSSRRFetchConcurrency')).toBe(16);
    expect(getPreference('autoRefreshEnabled')).toBe(false);
    expect(getPreference('gridTablePersistenceMode')).toBe('namespaced');
  });

  it('broadcasts an appearance mode only after persistence succeeds', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'light' });
    await hydrateAppPreferences({ force: true });

    await setAppearanceModePreference('dark');

    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'appearanceMode', value: 'dark' }],
    });
    expect(desktopRuntimeMocks.emitBroadcastEvent).toHaveBeenCalledWith(
      'settings:appearance-mode-changed',
      { mode: 'dark' }
    );
  });

  it('broadcasts persisted preference changes to peer webviews', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ autoRefreshEnabled: true });
    await hydrateAppPreferences({ force: true });

    setAutoRefreshEnabled(false);
    await flushPromises();

    expect(desktopRuntimeMocks.emitBroadcastEvent).toHaveBeenCalledWith(
      'settings:preferences-changed',
      undefined
    );
  });

  it('applies a valid peer appearance mode to the local cache and storage', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'light' });
    await hydrateAppPreferences({ force: true });
    const modes: string[] = [];
    const unsubscribe = subscribePreference('appearanceMode', (mode) => modes.push(mode));

    applyBroadcastAppearanceModePreference('dark');
    applyBroadcastAppearanceModePreference('invalid');

    expect(getPreference('appearanceMode')).toBe('dark');
    expect(localStorage.getItem('app-appearance-mode-preference')).toBe('dark');
    expect(modes).toEqual(['dark']);
    expect(appMocks.UpdateAppPreferences).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('hydrates, persists, and notifies the error reporting preference', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ errorReportingEnabled: false });
    await hydrateAppPreferences({ force: true });
    expect(getPreference('errorReportingEnabled')).toBe(false);

    const events: boolean[] = [];
    const unsubscribe = subscribePreference('errorReportingEnabled', (enabled) =>
      events.push(enabled)
    );

    await setErrorReportingEnabled(true);

    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'errorReportingEnabled', value: true }],
    });
    expect(getPreference('errorReportingEnabled')).toBe(true);
    expect(events).toEqual([true]);
    unsubscribe();
  });

  it('normalizes Object Panel layout updates to the preference bounds', async () => {
    await hydrateAppPreferences({ force: true });

    setObjectPanelLayoutDefaults({
      dockedRightWidth: 1,
      dockedBottomHeight: 20_000,
      floatingWidth: 1,
      floatingHeight: 20_000,
    });

    expect(getObjectPanelLayoutDefaults()).toEqual({
      dockedRightWidth: 500,
      dockedBottomHeight: 9999,
      floatingWidth: 450,
      floatingHeight: 9999,
    });
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [
        { key: 'objectPanelDockedRightWidth', value: 500 },
        { key: 'objectPanelDockedBottomHeight', value: 9999 },
        { key: 'objectPanelFloatingWidth', value: 450 },
        { key: 'objectPanelFloatingHeight', value: 9999 },
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

  it('rolls back optimistic runtime preference state and subscribers when persistence fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const events: boolean[] = [];
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      autoRefreshEnabled: true,
    });
    await hydrateAppPreferences({ force: true });
    const unsubscribe = subscribePreference('autoRefreshEnabled', (enabled) =>
      events.push(enabled)
    );
    appMocks.UpdateAppPreferences.mockRejectedValueOnce(new Error('forced failure'));

    setAutoRefreshEnabled(false);
    expect(getPreference('autoRefreshEnabled')).toBe(false);
    await flushPromises();

    expect(getPreference('autoRefreshEnabled')).toBe(true);
    expect(events).toEqual([false, true]);
    unsubscribe();
    consoleError.mockRestore();
  });

  it('hydrates sidebar groups, persists toggles and rolls back a failed toggle for subscribers', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      sidebarClusterResourcesExpanded: false,
      sidebarNamespaceExtensionsExpanded: true,
    });
    await hydrateAppPreferences({ force: true });
    expect(getSidebarGroupExpanded('cluster', 'resources')).toBe(false);
    expect(getSidebarGroupExpanded('cluster', 'extensions')).toBe(false);
    // Unsent Resources disclosure falls back to its open default.
    expect(getSidebarGroupExpanded('namespace', 'resources')).toBe(true);
    expect(getSidebarGroupExpanded('namespace', 'extensions')).toBe(true);
    const observed: boolean[] = [];
    const unsubscribe = subscribePreference('sidebarNamespaceExtensionsExpanded', (expanded) => {
      observed.push(expanded);
    });
    try {
      setSidebarGroupExpanded('namespace', 'extensions', false);
      await flushPromises();
      expect(appMocks.UpdateAppPreferences).toHaveBeenLastCalledWith({
        changes: [{ key: 'sidebarNamespaceExtensionsExpanded', value: false }],
      });
      expect(getSidebarGroupExpanded('namespace', 'extensions')).toBe(false);
      expect(desktopRuntimeMocks.emitBroadcastEvent).toHaveBeenCalledWith(
        'settings:preferences-changed',
        undefined
      );

      desktopRuntimeMocks.emitBroadcastEvent.mockClear();
      appMocks.UpdateAppPreferences.mockRejectedValueOnce(new Error('forced persistence failure'));
      setSidebarGroupExpanded('namespace', 'extensions', true);
      expect(getSidebarGroupExpanded('namespace', 'extensions')).toBe(true);
      await flushPromises();
      expect(getSidebarGroupExpanded('namespace', 'extensions')).toBe(false);
      expect(getSidebarGroupExpanded('cluster', 'resources')).toBe(false);
      expect(observed).toEqual([false, true, false]);
      expect(desktopRuntimeMocks.emitBroadcastEvent).not.toHaveBeenCalled();
    } finally {
      unsubscribe();
    }
  });

  it('keeps a later preference edit when an earlier save fails and sends writes in order', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      useShortResourceNames: false,
      dimInactiveNamespaces: true,
    });
    await hydrateAppPreferences({ force: true });
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    appMocks.UpdateAppPreferences.mockReturnValueOnce(first.promise).mockReturnValueOnce(
      second.promise
    );
    const failed = setUseShortResourceNames(true).catch((error) => error);
    const saved = setDimInactiveNamespaces(false);
    const callsBeforeSettlement = appMocks.UpdateAppPreferences.mock.calls.length;
    first.reject(new Error('first save failed'));
    await failed;
    const valueAfterFailure = getPreference('dimInactiveNamespaces');
    second.resolve({});
    await saved;

    expect(valueAfterFailure).toBe(false);
    expect(getPreference('useShortResourceNames')).toBe(false);
    expect(getPreference('dimInactiveNamespaces')).toBe(false);
    expect(callsBeforeSettlement).toBe(1);
    expect(
      appMocks.UpdateAppPreferences.mock.calls.map(([request]) => request.changes[0].key)
    ).toEqual(['useShortResourceNames', 'dimInactiveNamespaces']);
  });

  it('returns to confirmed state when two overlapping edits of the same preference both fail', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ useShortResourceNames: false });
    await hydrateAppPreferences({ force: true });
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    appMocks.UpdateAppPreferences.mockReturnValueOnce(first.promise).mockReturnValueOnce(
      second.promise
    );
    const failedFirst = setUseShortResourceNames(true).catch((error) => error);
    const failedSecond = setUseShortResourceNames(false).catch((error) => error);
    first.reject(new Error('first save failed'));
    await failedFirst;
    second.reject(new Error('second save failed'));
    await failedSecond;
    expect(getPreference('useShortResourceNames')).toBe(false);
  });

  it('preserves a later color edit and its startup mirror when a mode save fails', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system', linkColorLight: '' });
    await hydrateAppPreferences({ force: true });
    const first = deferred<unknown>();
    appMocks.UpdateAppPreferences.mockReturnValueOnce(first.promise);
    const failed = setAppearanceModePreference('dark').catch((error) => error);
    setLinkColor('light', '#326ce5');
    first.reject(new Error('mode save failed'));
    await failed;
    await flushPromises();
    expect(getPreference('appearanceMode')).toBe('system');
    expect(getLinkColor('light')).toBe('#326ce5');
    expect(
      JSON.parse(
        requireValue(
          localStorage.getItem('app-appearance-bootstrap-v1'),
          'appearance bootstrap mirror'
        )
      ).light['--color-object-panel-link']
    ).toBe('#326ce5');
  });

  it('waits for pending preference writes before reading a forced refresh', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ useShortResourceNames: false });
    await hydrateAppPreferences({ force: true });
    appMocks.GetAppSettings.mockClear();
    const write = deferred<unknown>();
    appMocks.UpdateAppPreferences.mockReturnValueOnce(write.promise);
    const saved = setUseShortResourceNames(true);
    const refreshed = hydrateAppPreferences({ force: true });
    await flushPromises();
    const readsBeforeSave = appMocks.GetAppSettings.mock.calls.length;
    const visibleBeforeSave = getPreference('useShortResourceNames');
    appMocks.GetAppSettings.mockResolvedValue({ useShortResourceNames: true });
    write.resolve({});
    await saved;
    const result = await refreshed;
    expect(readsBeforeSave).toBe(0);
    expect(visibleBeforeSave).toBe(true);
    expect(result.useShortResourceNames).toBe(true);
  });

  it('retries a hydration snapshot invalidated by an edit while the read was in flight', async () => {
    const stale = deferred<unknown>();
    appMocks.GetAppSettings.mockReturnValueOnce(stale.promise).mockResolvedValue({
      useShortResourceNames: true,
    });
    const loading = hydrateAppPreferences({ force: true });
    await flushPromises();
    await setUseShortResourceNames(true);
    stale.resolve({ useShortResourceNames: false });
    const result = await loading;
    expect(result.useShortResourceNames).toBe(true);
    expect(getPreference('useShortResourceNames')).toBe(true);
    expect(appMocks.GetAppSettings).toHaveBeenCalledTimes(2);
  });

  it('refreshes again when a peer requests hydration during an older read', async () => {
    const stale = deferred<unknown>();
    appMocks.GetAppSettings.mockReturnValueOnce(stale.promise).mockResolvedValue({
      appearanceMode: 'dark',
    });
    const first = hydrateAppPreferences({ force: true });
    await flushPromises();
    const second = hydrateAppPreferences({ force: true });
    await flushPromises();
    stale.resolve({ appearanceMode: 'light' });
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.appearanceMode)).toEqual(['dark', 'dark']);
    expect(getPreference('appearanceMode')).toBe('dark');
    expect(localStorage.getItem('app-appearance-mode-preference')).toBe('dark');
  });

  it('broadcasts persisted appearance changes in edit order when an earlier notification is delayed', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    const delayed = deferred<boolean>();
    desktopRuntimeMocks.emitBroadcastEvent.mockReturnValueOnce(delayed.promise);
    const first = setAppearanceModePreference('dark');
    await flushPromises();
    const second = setAppearanceModePreference('light');
    await flushPromises();
    delayed.resolve(false);
    await Promise.all([first, second]);
    expect(
      desktopRuntimeMocks.emitBroadcastEvent.mock.calls
        .filter(([event]) => event === 'settings:appearance-mode-changed')
        .map(([, value]) => value.mode)
    ).toEqual(['dark', 'light']);
  });

  it.each(['settings:preferences-changed', 'settings:appearance-mode-changed'])(
    'keeps persisted state and continues queued writes when %s notification fails',
    async (event) => {
      appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
      await hydrateAppPreferences({ force: true });
      desktopRuntimeMocks.emitBroadcastEvent.mockImplementation(async (name) => {
        if (name === event) {
          throw new Error('notification failed');
        }
        return false;
      });
      await Promise.all([setAppearanceModePreference('dark'), setUseShortResourceNames(true)]);
      expect(getPreference('appearanceMode')).toBe('dark');
      expect(localStorage.getItem('app-appearance-mode-preference')).toBe('dark');
      expect(getPreference('useShortResourceNames')).toBe(true);
      expect(appMocks.UpdateAppPreferences).toHaveBeenCalledTimes(2);
    }
  );

  it('finishes persistence when its broadcast triggers a hydration that waits for the write', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ useShortResourceNames: false });
    await hydrateAppPreferences({ force: true });
    let refresh: ReturnType<typeof hydrateAppPreferences> | undefined;
    desktopRuntimeMocks.emitBroadcastEvent.mockImplementation(async () => {
      refresh = hydrateAppPreferences({ force: true });
      return false;
    });
    appMocks.UpdateAppPreferences.mockImplementation(async () => {
      appMocks.GetAppSettings.mockResolvedValue({ useShortResourceNames: true });
      return {};
    });
    await setUseShortResourceNames(true);
    expect((await refresh)?.useShortResourceNames).toBe(true);
    expect(getPreference('useShortResourceNames')).toBe(true);
  });

  it('keeps startup appearance mirrors in sync when a preference subscriber makes another edit', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system', linkColorLight: '' });
    await hydrateAppPreferences({ force: true });
    const unsubscribe = subscribePreference('appearanceMode', () =>
      setLinkColor('light', '#326ce5')
    );
    try {
      await setAppearanceModePreference('light');
      await flushPromises();
      expect(getLinkColor('light')).toBe('#326ce5');
      expect(
        JSON.parse(
          requireValue(
            localStorage.getItem('app-appearance-bootstrap-v1'),
            'appearance bootstrap mirror'
          )
        ).light['--color-object-panel-link']
      ).toBe('#326ce5');
      expect(appMocks.UpdateAppPreferences).toHaveBeenCalledTimes(2);
    } finally {
      unsubscribe();
    }
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

    expect(getPreference('appearanceMode')).toBe('system');
    expect(localStorage.getItem('app-appearance-mode-preference')).toBe('system');
    expect(localStorage.getItem('app-appearance-bootstrap-v1')).toBe('previous-bootstrap');
    expect(desktopRuntimeMocks.emitBroadcastEvent).not.toHaveBeenCalled();
  });

  it('rolls back every palette field and its bootstrap mirror after a failed batch', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      paletteHueLight: 20,
      paletteSaturationLight: 30,
      paletteBrightnessLight: -5,
      paletteHueDark: 210,
    });
    await hydrateAppPreferences({ force: true });
    const bootstrap = localStorage.getItem('app-appearance-bootstrap-v1');
    const observed: string[] = [];
    const unsubscribers = (
      [
        'paletteHueLight',
        'paletteSaturationLight',
        'paletteBrightnessLight',
        'paletteHueDark',
      ] as const
    ).map((key) => subscribePreference(key, (value) => observed.push(`${key}=${value}`)));
    try {
      appMocks.UpdateAppPreferences.mockRejectedValueOnce(new Error('forced failure'));
      setPaletteTint('light', 120, 60, 15);
      expect(getPaletteTint('light')).toEqual({ hue: 120, saturation: 60, brightness: 15 });
      await flushPromises();
      expect(getPaletteTint('light')).toEqual({ hue: 20, saturation: 30, brightness: -5 });
      expect(getPaletteTint('dark')).toEqual({ hue: 210, saturation: 0, brightness: 0 });
      expect(localStorage.getItem('app-appearance-bootstrap-v1')).toBe(bootstrap);
      expect(observed).toEqual([
        'paletteHueLight=120',
        'paletteSaturationLight=60',
        'paletteBrightnessLight=15',
        'paletteHueLight=20',
        'paletteSaturationLight=30',
        'paletteBrightnessLight=-5',
      ]);
      expect(desktopRuntimeMocks.emitBroadcastEvent).not.toHaveBeenCalled();
    } finally {
      unsubscribers.forEach((unsubscribe) => {
        unsubscribe();
      });
    }
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
    await flushPromises();
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

  it('commits integer preference inputs through the preference rules', async () => {
    await hydrateAppPreferences({ force: true });
    const persisted: number[] = [];

    const commit = (raw: string) =>
      commitIntegerPreferenceInput('kubernetesClientQPS', raw, (value) => persisted.push(value));

    expect(commit('99999')).toBe(SPECS.kubernetesClientQPS.max);
    expect(commit('0')).toBe(SPECS.kubernetesClientQPS.defaultValue);
    expect(commit('not a number')).toBe(SPECS.kubernetesClientQPS.defaultValue);
    expect(persisted).toEqual([
      SPECS.kubernetesClientQPS.max,
      SPECS.kubernetesClientQPS.defaultValue,
      SPECS.kubernetesClientQPS.defaultValue,
    ]);
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
    await flushPromises();
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
    expect(getPreference('objPanelLogsBufferMaxSize')).toBe(2500);
  });

  it('defaults Kubernetes API settings when backend payload is missing the fields', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    expect(getPreference('kubernetesClientQPS')).toBe(SPECS.kubernetesClientQPS.defaultValue);
    expect(getPreference('kubernetesClientBurst')).toBe(SPECS.kubernetesClientBurst.defaultValue);
    expect(getPreference('permissionSSRRFetchConcurrency')).toBe(
      SPECS.permissionSSRRFetchConcurrency.defaultValue
    );
  });

  it('setKubernetesClientQPS round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setKubernetesClientQPS(250);
    expect(getPreference('kubernetesClientQPS')).toBe(250);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'kubernetesClientQPS', value: 250 }],
    });
  });

  it('setKubernetesClientQPS clamps values outside the allowed range', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setKubernetesClientQPS(0);
    expect(getPreference('kubernetesClientQPS')).toBe(SPECS.kubernetesClientQPS.defaultValue);

    setKubernetesClientQPS(-1);
    expect(getPreference('kubernetesClientQPS')).toBe(SPECS.kubernetesClientQPS.defaultValue);

    setKubernetesClientQPS(999_999);
    expect(getPreference('kubernetesClientQPS')).toBe(SPECS.kubernetesClientQPS.max);

    setKubernetesClientQPS(SPECS.kubernetesClientQPS.min - 0.1);
    expect(getPreference('kubernetesClientQPS')).toBe(SPECS.kubernetesClientQPS.min);
  });

  it('setKubernetesClientBurst round-trips and clamps values', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setKubernetesClientBurst(500);
    expect(getPreference('kubernetesClientBurst')).toBe(500);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'kubernetesClientBurst', value: 500 }],
    });

    setKubernetesClientBurst(0);
    expect(getPreference('kubernetesClientBurst')).toBe(SPECS.kubernetesClientBurst.defaultValue);

    setKubernetesClientBurst(999_999);
    expect(getPreference('kubernetesClientBurst')).toBe(SPECS.kubernetesClientBurst.max);

    setKubernetesClientBurst(SPECS.kubernetesClientBurst.min - 0.1);
    expect(getPreference('kubernetesClientBurst')).toBe(SPECS.kubernetesClientBurst.min);
  });

  it('setPermissionSSRRFetchConcurrency round-trips and clamps values', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setPermissionSSRRFetchConcurrency(16);
    expect(getPreference('permissionSSRRFetchConcurrency')).toBe(16);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'permissionSSRRFetchConcurrency', value: 16 }],
    });

    setPermissionSSRRFetchConcurrency(0);
    expect(getPreference('permissionSSRRFetchConcurrency')).toBe(
      SPECS.permissionSSRRFetchConcurrency.defaultValue
    );

    setPermissionSSRRFetchConcurrency(999_999);
    expect(getPreference('permissionSSRRFetchConcurrency')).toBe(
      SPECS.permissionSSRRFetchConcurrency.max
    );

    setPermissionSSRRFetchConcurrency(SPECS.permissionSSRRFetchConcurrency.min - 0.1);
    expect(getPreference('permissionSSRRFetchConcurrency')).toBe(
      SPECS.permissionSSRRFetchConcurrency.min
    );
  });

  it('defaults Object Panel Logs Tab buffer size when the backend payload is missing the field', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    expect(getPreference('objPanelLogsBufferMaxSize')).toBe(
      SPECS.objPanelLogsBufferMaxSize.defaultValue
    );
  });

  it('defaults Object Panel Logs Tab buffer size when the backend payload reports zero (unset)', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      objPanelLogsBufferMaxSize: 0,
    });
    await hydrateAppPreferences({ force: true });
    expect(getPreference('objPanelLogsBufferMaxSize')).toBe(
      SPECS.objPanelLogsBufferMaxSize.defaultValue
    );
  });

  it('setObjPanelLogsBufferMaxSize round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      objPanelLogsBufferMaxSize: SPECS.objPanelLogsBufferMaxSize.defaultValue,
    });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsBufferMaxSize(3500);
    expect(getPreference('objPanelLogsBufferMaxSize')).toBe(3500);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'objPanelLogsBufferMaxSize', value: 3500 }],
    });
  });

  it('setObjPanelLogsBufferMaxSize clamps values below the minimum', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    setObjPanelLogsBufferMaxSize(1);
    expect(getPreference('objPanelLogsBufferMaxSize')).toBe(SPECS.objPanelLogsBufferMaxSize.min);
  });

  it('setObjPanelLogsBufferMaxSize clamps values above the maximum', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    setObjPanelLogsBufferMaxSize(999_999);
    expect(getPreference('objPanelLogsBufferMaxSize')).toBe(SPECS.objPanelLogsBufferMaxSize.max);
  });

  it('hydrates Object Panel Logs Tab target limits from backend settings', async () => {
    appMocks.GetAppSettings.mockResolvedValue({
      appearanceMode: 'system',
      objPanelLogsTargetPerScopeLimit: 144,
      objPanelLogsTargetGlobalLimit: 180,
    });
    await hydrateAppPreferences({ force: true });
    expect(getPreference('objPanelLogsTargetPerScopeLimit')).toBe(144);
    expect(getPreference('objPanelLogsTargetGlobalLimit')).toBe(180);
  });

  it('defaults Object Panel Logs Tab target limits when the backend payload is missing the fields', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });
    expect(getPreference('objPanelLogsTargetPerScopeLimit')).toBe(
      SPECS.objPanelLogsTargetPerScopeLimit.defaultValue
    );
    expect(getPreference('objPanelLogsTargetGlobalLimit')).toBe(
      SPECS.objPanelLogsTargetGlobalLimit.defaultValue
    );
  });

  it('setObjPanelLogsTargetPerScopeLimit round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsTargetPerScopeLimit(144);
    expect(getPreference('objPanelLogsTargetPerScopeLimit')).toBe(144);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'objPanelLogsTargetPerScopeLimit', value: 144 }],
    });
  });

  it('setObjPanelLogsTargetPerScopeLimit defaults zero and clamps large values', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsTargetPerScopeLimit(0);
    expect(getPreference('objPanelLogsTargetPerScopeLimit')).toBe(
      SPECS.objPanelLogsTargetPerScopeLimit.defaultValue
    );

    setObjPanelLogsTargetPerScopeLimit(999_999);
    expect(getPreference('objPanelLogsTargetPerScopeLimit')).toBe(
      SPECS.objPanelLogsTargetPerScopeLimit.max
    );
  });

  it('setObjPanelLogsTargetGlobalLimit round-trips an in-range value through the cache and backend', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsTargetGlobalLimit(180);
    expect(getPreference('objPanelLogsTargetGlobalLimit')).toBe(180);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
      changes: [{ key: 'objPanelLogsTargetGlobalLimit', value: 180 }],
    });
  });

  it('setObjPanelLogsTargetGlobalLimit defaults zero and clamps large values', async () => {
    appMocks.GetAppSettings.mockResolvedValue({ appearanceMode: 'system' });
    await hydrateAppPreferences({ force: true });

    setObjPanelLogsTargetGlobalLimit(0);
    expect(getPreference('objPanelLogsTargetGlobalLimit')).toBe(
      SPECS.objPanelLogsTargetGlobalLimit.defaultValue
    );

    setObjPanelLogsTargetGlobalLimit(999_999);
    expect(getPreference('objPanelLogsTargetGlobalLimit')).toBe(
      SPECS.objPanelLogsTargetGlobalLimit.max
    );
  });

  describe('preference subscriptions', () => {
    const record = <K extends AppPreferenceKey>(key: K) => {
      const values: AppPreferences[K][] = [];
      const unsubscribe = subscribePreference(key, (value) => values.push(value));
      return { values, unsubscribe };
    };

    it('notifies only the subscribers of the preference that changed', async () => {
      const shortNames = record('useShortResourceNames');
      const dim = record('dimInactiveNamespaces');

      await setUseShortResourceNames(true);
      await setUseShortResourceNames(true);

      expect(getPreference('useShortResourceNames')).toBe(true);
      expect(shortNames.values).toEqual([true]);
      expect(dim.values).toEqual([]);
      shortNames.unsubscribe();
      dim.unsubscribe();
    });

    it('notifies a palette, accent, or link key only when that mode value changes', async () => {
      const lightHue = record('paletteHueLight');
      const lightSaturation = record('paletteSaturationLight');
      const darkHue = record('paletteHueDark');
      const darkAccent = record('accentColorDark');
      const lightLink = record('linkColorLight');

      setPaletteTint('light', 0, 30, 0);
      setPaletteTint('light', 0, 30, 0);
      setAccentColor('dark', '#112233');
      await flushPromises();

      expect(lightSaturation.values).toEqual([30]);
      expect(lightHue.values).toEqual([]);
      expect(darkHue.values).toEqual([]);
      expect(darkAccent.values).toEqual(['#112233']);
      expect(lightLink.values).toEqual([]);
      for (const subscription of [lightHue, lightSaturation, darkHue, darkAccent, lightLink]) {
        subscription.unsubscribe();
      }
    });

    it('keeps notifying and saving when one subscriber throws', async () => {
      const failure = new Error('subscriber failed');
      const unsubscribeFailing = subscribePreference('autoRefreshEnabled', () => {
        throw failure;
      });
      const healthy = record('autoRefreshEnabled');

      setAutoRefreshEnabled(false);
      await flushPromises();

      expect(healthy.values).toEqual([false]);
      expect(appMocks.UpdateAppPreferences).toHaveBeenCalledWith({
        changes: [{ key: 'autoRefreshEnabled', value: false }],
      });
      expect(telemetryMocks.captureUserVisibleError).toHaveBeenCalledWith(
        failure,
        expect.objectContaining({ surface: 'operational' })
      );
      unsubscribeFailing();
      healthy.unsubscribe();
    });

    it('ends each subscription independently, even for the same listener', async () => {
      const values: boolean[] = [];
      const listener = (value: boolean) => values.push(value);
      const unsubscribeFirst = subscribePreference('exclusiveNamespaces', listener);
      const unsubscribeSecond = subscribePreference('exclusiveNamespaces', listener);

      unsubscribeFirst();
      await setExclusiveNamespaces(false);
      unsubscribeSecond();
      await setExclusiveNamespaces(true);

      expect(values).toEqual([false]);
    });
  });
});
