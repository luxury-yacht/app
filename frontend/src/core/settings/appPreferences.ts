/**
 * frontend/src/core/settings/appPreferences.ts
 *
 * Centralized preference cache and backend sync for app settings.
 */

import {
  SaveTheme,
  DeleteTheme,
  ReorderThemes,
  ApplyTheme,
  MatchThemeForCluster,
  ValidateThemeClusterPattern,
  UpdateAppPreferences,
} from '@wailsjs/go/backend/App';
import { types } from '@wailsjs/go/models';
import {
  readAppSettings,
  readAppSettingsSchema,
  readThemes,
  requestAppState,
} from '@/core/app-state-access';
import { eventBus } from '@/core/events';
import {
  APPEARANCE_BOOTSTRAP_STORAGE_KEY,
  saveAppearanceBootstrapToLocalStorage,
} from '@/utils/appearanceBootstrap';
import {
  DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
  getObjPanelLogsApiTimestampFormatValidationError,
  normalizeObjPanelLogsApiTimestampFormat,
} from '@/utils/objPanelLogsApiTimestampFormat';

export type AppearanceMode = 'light' | 'dark' | 'system';
export type GridTablePersistenceMode = 'namespaced' | 'shared';
export type ObjectPanelPosition = 'right' | 'bottom' | 'floating';

interface AppPreferences {
  appearanceMode: AppearanceMode;
  useShortResourceNames: boolean;
  dimInactiveNamespaces: boolean;
  exclusiveNamespaces: boolean;
  autoRefreshEnabled: boolean;
  refreshBackgroundClustersEnabled: boolean;
  metricsRefreshIntervalMs: number;
  maxTableRows: number;
  kubernetesClientQPS: number;
  kubernetesClientBurst: number;
  permissionSSRRFetchConcurrency: number;
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
  appearanceMode?: string;
  useShortResourceNames?: boolean;
  dimInactiveNamespaces?: boolean;
  exclusiveNamespaces?: boolean;
  autoRefreshEnabled?: boolean;
  refreshBackgroundClustersEnabled?: boolean;
  metricsRefreshIntervalMs?: number;
  maxTableRows?: number;
  kubernetesClientQPS?: number;
  kubernetesClientBurst?: number;
  permissionSSRRFetchConcurrency?: number;
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
  // Per-mode palette fields.
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
export const KUBERNETES_CLIENT_QPS_MIN = 1;
export const KUBERNETES_CLIENT_QPS_MAX = 5000;
export const KUBERNETES_CLIENT_QPS_DEFAULT = 200;
export const KUBERNETES_CLIENT_BURST_MIN = 1;
export const KUBERNETES_CLIENT_BURST_MAX = 10000;
export const KUBERNETES_CLIENT_BURST_DEFAULT = 500;
export const PERMISSION_SSRR_FETCH_CONCURRENCY_MIN = 1;
export const PERMISSION_SSRR_FETCH_CONCURRENCY_MAX = 256;
export const PERMISSION_SSRR_FETCH_CONCURRENCY_DEFAULT = 32;
export const OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MIN = 1;
export const OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX = 1000;
export const OBJ_PANEL_LOGS_TARGET_PER_SCOPE_DEFAULT = 100;
export const OBJ_PANEL_LOGS_TARGET_GLOBAL_MIN = 1;
export const OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX = 1000;
export const OBJ_PANEL_LOGS_TARGET_GLOBAL_DEFAULT = 200;

const DEFAULT_PREFERENCES: AppPreferences = {
  appearanceMode: 'system',
  useShortResourceNames: false,
  dimInactiveNamespaces: true,
  exclusiveNamespaces: true,
  autoRefreshEnabled: true,
  refreshBackgroundClustersEnabled: true,
  metricsRefreshIntervalMs: DEFAULT_METRICS_REFRESH_INTERVAL_MS,
  maxTableRows: MAX_TABLE_ROWS_DEFAULT,
  kubernetesClientQPS: KUBERNETES_CLIENT_QPS_DEFAULT,
  kubernetesClientBurst: KUBERNETES_CLIENT_BURST_DEFAULT,
  permissionSSRRFetchConcurrency: PERMISSION_SSRR_FETCH_CONCURRENCY_DEFAULT,
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
let preferenceSchemaByKey = new Map<string, types.AppPreferenceSchema>();

const APPEARANCE_MODE_STORAGE_KEY = 'app-appearance-mode-preference';
const OLD_APPEARANCE_MODE_STORAGE_KEY = 'app-theme-preference';

const persistAppearanceModeToLocalStorage = (mode: AppearanceMode): void => {
  try {
    localStorage.setItem(APPEARANCE_MODE_STORAGE_KEY, mode);
    localStorage.removeItem(OLD_APPEARANCE_MODE_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in tests, private browsing, or locked-down environments.
  }
};

const persistAppearanceBootstrapToLocalStorage = (): void => {
  saveAppearanceBootstrapToLocalStorage({
    light: {
      paletteHue: preferenceCache.paletteHueLight,
      paletteSaturation: preferenceCache.paletteSaturationLight,
      paletteBrightness: preferenceCache.paletteBrightnessLight,
      accentColor: preferenceCache.accentColorLight,
      linkColor: preferenceCache.linkColorLight,
    },
    dark: {
      paletteHue: preferenceCache.paletteHueDark,
      paletteSaturation: preferenceCache.paletteSaturationDark,
      paletteBrightness: preferenceCache.paletteBrightnessDark,
      accentColor: preferenceCache.accentColorDark,
      linkColor: preferenceCache.linkColorDark,
    },
  });
};

const normalizeAppearanceMode = (value: string | undefined): AppearanceMode => {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return schemaDefault('appearanceMode', DEFAULT_PREFERENCES.appearanceMode);
};

const normalizeGridTableMode = (value: string | undefined): GridTablePersistenceMode => {
  if (value === 'shared' || value === 'namespaced') {
    return value;
  }
  return schemaDefault('gridTablePersistenceMode', DEFAULT_PREFERENCES.gridTablePersistenceMode);
};

const normalizeObjectPanelPosition = (value: string | undefined): ObjectPanelPosition => {
  if (value === 'right' || value === 'bottom' || value === 'floating') {
    return value;
  }
  return schemaDefault(
    'defaultObjectPanelPosition',
    DEFAULT_PREFERENCES.defaultObjectPanelPosition
  );
};

const normalizeMetricsIntervalMs = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return schemaDefault('metricsRefreshIntervalMs', DEFAULT_METRICS_REFRESH_INTERVAL_MS);
  }
  return Math.floor(value);
};

const normalizeMaxTableRows = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return schemaDefault('maxTableRows', MAX_TABLE_ROWS_DEFAULT);
  }
  const floored = Math.floor(value);
  if (floored < schemaMin('maxTableRows', MAX_TABLE_ROWS_MIN)) {
    return schemaMin('maxTableRows', MAX_TABLE_ROWS_MIN);
  }
  if (floored > schemaMax('maxTableRows', MAX_TABLE_ROWS_MAX)) {
    return schemaMax('maxTableRows', MAX_TABLE_ROWS_MAX);
  }
  return floored;
};

const normalizeKubernetesClientQPS = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return schemaDefault('kubernetesClientQPS', KUBERNETES_CLIENT_QPS_DEFAULT);
  }
  const floored = Math.floor(value);
  if (floored < schemaMin('kubernetesClientQPS', KUBERNETES_CLIENT_QPS_MIN)) {
    return schemaMin('kubernetesClientQPS', KUBERNETES_CLIENT_QPS_MIN);
  }
  if (floored > schemaMax('kubernetesClientQPS', KUBERNETES_CLIENT_QPS_MAX)) {
    return schemaMax('kubernetesClientQPS', KUBERNETES_CLIENT_QPS_MAX);
  }
  return floored;
};

const normalizeKubernetesClientBurst = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return schemaDefault('kubernetesClientBurst', KUBERNETES_CLIENT_BURST_DEFAULT);
  }
  const floored = Math.floor(value);
  if (floored < schemaMin('kubernetesClientBurst', KUBERNETES_CLIENT_BURST_MIN)) {
    return schemaMin('kubernetesClientBurst', KUBERNETES_CLIENT_BURST_MIN);
  }
  if (floored > schemaMax('kubernetesClientBurst', KUBERNETES_CLIENT_BURST_MAX)) {
    return schemaMax('kubernetesClientBurst', KUBERNETES_CLIENT_BURST_MAX);
  }
  return floored;
};

const normalizePermissionSSRRFetchConcurrency = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return schemaDefault(
      'permissionSSRRFetchConcurrency',
      PERMISSION_SSRR_FETCH_CONCURRENCY_DEFAULT
    );
  }
  const floored = Math.floor(value);
  if (
    floored < schemaMin('permissionSSRRFetchConcurrency', PERMISSION_SSRR_FETCH_CONCURRENCY_MIN)
  ) {
    return schemaMin('permissionSSRRFetchConcurrency', PERMISSION_SSRR_FETCH_CONCURRENCY_MIN);
  }
  if (
    floored > schemaMax('permissionSSRRFetchConcurrency', PERMISSION_SSRR_FETCH_CONCURRENCY_MAX)
  ) {
    return schemaMax('permissionSSRRFetchConcurrency', PERMISSION_SSRR_FETCH_CONCURRENCY_MAX);
  }
  return floored;
};

// Clamp to [OBJ_PANEL_LOGS_BUFFER_MIN_SIZE, OBJ_PANEL_LOGS_BUFFER_MAX_SIZE]. A zero/undefined
// value from an old settings file (before this preference existed) maps
// to the default, not to zero — otherwise an upgrade would wipe every
// Object Panel Logs Tab to empty.
const normalizeObjPanelLogsBufferMaxSize = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return schemaDefault('objPanelLogsBufferMaxSize', OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE);
  }
  const floored = Math.floor(value);
  if (floored < schemaMin('objPanelLogsBufferMaxSize', OBJ_PANEL_LOGS_BUFFER_MIN_SIZE)) {
    return schemaMin('objPanelLogsBufferMaxSize', OBJ_PANEL_LOGS_BUFFER_MIN_SIZE);
  }
  if (floored > schemaMax('objPanelLogsBufferMaxSize', OBJ_PANEL_LOGS_BUFFER_MAX_SIZE)) {
    return schemaMax('objPanelLogsBufferMaxSize', OBJ_PANEL_LOGS_BUFFER_MAX_SIZE);
  }
  return floored;
};

const normalizeObjPanelLogsTargetPerScopeLimit = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return schemaDefault(
      'objPanelLogsTargetPerScopeLimit',
      OBJ_PANEL_LOGS_TARGET_PER_SCOPE_DEFAULT
    );
  }
  const floored = Math.floor(value);
  if (floored < schemaMin('objPanelLogsTargetPerScopeLimit', OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MIN)) {
    return schemaMin('objPanelLogsTargetPerScopeLimit', OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MIN);
  }
  if (floored > schemaMax('objPanelLogsTargetPerScopeLimit', OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX)) {
    return schemaMax('objPanelLogsTargetPerScopeLimit', OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX);
  }
  return floored;
};

const normalizeObjPanelLogsTargetGlobalLimit = (value?: number): number => {
  if (value == null || Number.isNaN(value) || value <= 0) {
    return schemaDefault('objPanelLogsTargetGlobalLimit', OBJ_PANEL_LOGS_TARGET_GLOBAL_DEFAULT);
  }
  const floored = Math.floor(value);
  if (floored < schemaMin('objPanelLogsTargetGlobalLimit', OBJ_PANEL_LOGS_TARGET_GLOBAL_MIN)) {
    return schemaMin('objPanelLogsTargetGlobalLimit', OBJ_PANEL_LOGS_TARGET_GLOBAL_MIN);
  }
  if (floored > schemaMax('objPanelLogsTargetGlobalLimit', OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX)) {
    return schemaMax('objPanelLogsTargetGlobalLimit', OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX);
  }
  return floored;
};

const emitPreferenceChanges = (previous: AppPreferences, next: AppPreferences): void => {
  if (previous.appearanceMode !== next.appearanceMode) {
    eventBus.emit('settings:appearance-mode', next.appearanceMode);
  }
  if (previous.useShortResourceNames !== next.useShortResourceNames) {
    eventBus.emit('settings:short-names', next.useShortResourceNames);
  }
  if (previous.dimInactiveNamespaces !== next.dimInactiveNamespaces) {
    eventBus.emit('settings:dim-inactive-namespaces', next.dimInactiveNamespaces);
  }
  if (previous.exclusiveNamespaces !== next.exclusiveNamespaces) {
    eventBus.emit('settings:exclusive-namespaces', next.exclusiveNamespaces);
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
  if (previous.kubernetesClientQPS !== next.kubernetesClientQPS) {
    eventBus.emit('settings:kubernetes-client-qps', next.kubernetesClientQPS);
  }
  if (previous.kubernetesClientBurst !== next.kubernetesClientBurst) {
    eventBus.emit('settings:kubernetes-client-burst', next.kubernetesClientBurst);
  }
  if (previous.permissionSSRRFetchConcurrency !== next.permissionSSRRFetchConcurrency) {
    eventBus.emit(
      'settings:permission-ssrr-fetch-concurrency',
      next.permissionSSRRFetchConcurrency
    );
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
  // Emit per-mode palette changes separately for light and dark.
  if (
    previous.paletteHueLight !== next.paletteHueLight ||
    previous.paletteSaturationLight !== next.paletteSaturationLight ||
    previous.paletteBrightnessLight !== next.paletteBrightnessLight
  ) {
    eventBus.emit('settings:palette-tint', {
      mode: 'light',
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
      mode: 'dark',
      hue: next.paletteHueDark,
      saturation: next.paletteSaturationDark,
      brightness: next.paletteBrightnessDark,
    });
  }
  if (previous.accentColorLight !== next.accentColorLight) {
    eventBus.emit('settings:accent-color', { mode: 'light', color: next.accentColorLight });
  }
  if (previous.accentColorDark !== next.accentColorDark) {
    eventBus.emit('settings:accent-color', { mode: 'dark', color: next.accentColorDark });
  }
  if (previous.linkColorLight !== next.linkColorLight) {
    eventBus.emit('settings:link-color', { mode: 'light', color: next.linkColorLight });
  }
  if (previous.linkColorDark !== next.linkColorDark) {
    eventBus.emit('settings:link-color', { mode: 'dark', color: next.linkColorDark });
  }
};

const updatePreferenceCache = (updates: Partial<AppPreferences>): void => {
  const next = { ...preferenceCache, ...updates };
  const previous = preferenceCache;
  preferenceCache = next;
  emitPreferenceChanges(previous, next);
};

const wailsRuntimeAvailable = (): boolean => {
  return Boolean((window as any)?.go?.backend?.App);
};

interface LocalStorageSnapshot {
  appearanceMode: string | null;
  appearanceBootstrap: string | null;
}

const captureLocalStorageSnapshot = (): LocalStorageSnapshot => {
  try {
    return {
      appearanceMode: localStorage.getItem(APPEARANCE_MODE_STORAGE_KEY),
      appearanceBootstrap: localStorage.getItem(APPEARANCE_BOOTSTRAP_STORAGE_KEY),
    };
  } catch {
    return { appearanceMode: null, appearanceBootstrap: null };
  }
};

const restoreLocalStorageValue = (key: string, value: string | null): void => {
  try {
    if (value == null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Storage can be unavailable in tests, private browsing, or locked-down environments.
  }
};

const restoreLocalStorageSnapshot = (snapshot: LocalStorageSnapshot): void => {
  restoreLocalStorageValue(APPEARANCE_MODE_STORAGE_KEY, snapshot.appearanceMode);
  restoreLocalStorageValue(APPEARANCE_BOOTSTRAP_STORAGE_KEY, snapshot.appearanceBootstrap);
};

const persistPreferenceChanges = async (
  changes: Array<{ key: keyof AppPreferences; value: unknown }>
): Promise<void> => {
  if (!wailsRuntimeAvailable()) {
    return;
  }
  await UpdateAppPreferences({
    changes: changes.map((change) => ({ key: change.key, value: change.value })),
  } as types.UpdateAppPreferencesRequest);
};

const optimisticPreferenceUpdate = async (
  updates: Partial<AppPreferences>,
  changes: Array<{ key: keyof AppPreferences; value: unknown }>,
  options?: { persistAppearanceMode?: AppearanceMode; persistAppearanceBootstrap?: boolean }
): Promise<void> => {
  const previousPreferences = { ...preferenceCache };
  const previousStorage = captureLocalStorageSnapshot();

  hydrated = true;
  updatePreferenceCache(updates);
  if (options?.persistAppearanceMode) {
    persistAppearanceModeToLocalStorage(options.persistAppearanceMode);
  }
  if (options?.persistAppearanceBootstrap) {
    persistAppearanceBootstrapToLocalStorage();
  }

  try {
    await persistPreferenceChanges(changes);
  } catch (error) {
    updatePreferenceCache(previousPreferences);
    restoreLocalStorageSnapshot(previousStorage);
    throw error;
  }
};

const fireAndForgetPreferenceUpdate = (
  label: string,
  updates: Partial<AppPreferences>,
  changes: Array<{ key: keyof AppPreferences; value: unknown }>,
  options?: { persistAppearanceMode?: AppearanceMode; persistAppearanceBootstrap?: boolean }
): void => {
  void optimisticPreferenceUpdate(updates, changes, options).catch((error) => {
    console.error(label, error);
  });
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

const fetchAppSettingsSchema = async (): Promise<types.AppSettingsSchema | null> => {
  try {
    const schema = (await requestAppState({
      resource: 'app-settings-schema',
      read: () => readAppSettingsSchema(),
    })) as types.AppSettingsSchema | null;
    return schema ?? null;
  } catch {
    return null;
  }
};

const schemaPayloadFromPreferences = (
  schema: types.AppSettingsSchema | null
): AppSettingsPayload | null => {
  if (!schema?.preferences) {
    return null;
  }
  preferenceSchemaByKey = new Map(schema.preferences.map((entry) => [entry.key, entry]));
  return schema.preferences.reduce<AppSettingsPayload>((payload, entry) => {
    (payload as Record<string, unknown>)[entry.key] = entry.currentValue ?? entry.defaultValue;
    return payload;
  }, {});
};

const schemaDefault = <T>(key: keyof AppPreferences, fallback: T): T => {
  const entry = preferenceSchemaByKey.get(key);
  return (entry?.defaultValue ?? fallback) as T;
};

const schemaMin = (key: keyof AppPreferences, fallback: number): number => {
  return preferenceSchemaByKey.get(key)?.min ?? fallback;
};

const schemaMax = (key: keyof AppPreferences, fallback: number): number => {
  return preferenceSchemaByKey.get(key)?.max ?? fallback;
};

export const hydrateAppPreferences = async (options?: {
  force?: boolean;
}): Promise<AppPreferences> => {
  if (hydrated && !options?.force) {
    return { ...preferenceCache };
  }

  const backendSchema = await fetchAppSettingsSchema();
  const backendSettings = schemaPayloadFromPreferences(backendSchema) ?? (await fetchAppSettings());
  const preferences: AppPreferences = {
    appearanceMode: normalizeAppearanceMode(backendSettings?.appearanceMode),
    useShortResourceNames:
      backendSettings?.useShortResourceNames ?? DEFAULT_PREFERENCES.useShortResourceNames,
    dimInactiveNamespaces:
      backendSettings?.dimInactiveNamespaces ?? DEFAULT_PREFERENCES.dimInactiveNamespaces,
    exclusiveNamespaces:
      backendSettings?.exclusiveNamespaces ?? DEFAULT_PREFERENCES.exclusiveNamespaces,
    autoRefreshEnabled:
      backendSettings?.autoRefreshEnabled ?? DEFAULT_PREFERENCES.autoRefreshEnabled,
    refreshBackgroundClustersEnabled:
      backendSettings?.refreshBackgroundClustersEnabled ??
      DEFAULT_PREFERENCES.refreshBackgroundClustersEnabled,
    metricsRefreshIntervalMs: normalizeMetricsIntervalMs(backendSettings?.metricsRefreshIntervalMs),
    maxTableRows: normalizeMaxTableRows(backendSettings?.maxTableRows),
    kubernetesClientQPS: normalizeKubernetesClientQPS(backendSettings?.kubernetesClientQPS),
    kubernetesClientBurst: normalizeKubernetesClientBurst(backendSettings?.kubernetesClientBurst),
    permissionSSRRFetchConcurrency: normalizePermissionSSRRFetchConcurrency(
      backendSettings?.permissionSSRRFetchConcurrency
    ),
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
  persistAppearanceModeToLocalStorage(preferences.appearanceMode);
  persistAppearanceBootstrapToLocalStorage();

  return { ...preferenceCache };
};

export const getAppearanceModePreference = (): AppearanceMode => {
  return preferenceCache.appearanceMode;
};

export const getUseShortResourceNames = (): boolean => {
  return preferenceCache.useShortResourceNames;
};

export const getDimInactiveNamespaces = (): boolean => {
  return preferenceCache.dimInactiveNamespaces;
};

export const getExclusiveNamespaces = (): boolean => {
  return preferenceCache.exclusiveNamespaces;
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

export const getKubernetesClientQPS = (): number => {
  return preferenceCache.kubernetesClientQPS;
};

export const getKubernetesClientBurst = (): number => {
  return preferenceCache.kubernetesClientBurst;
};

export const getPermissionSSRRFetchConcurrency = (): number => {
  return preferenceCache.permissionSSRRFetchConcurrency;
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

// Returns palette tint values for the specified resolved appearance mode.
export const getPaletteTint = (
  mode: 'light' | 'dark'
): { hue: number; saturation: number; brightness: number } => {
  if (mode === 'light') {
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

// Returns the custom accent color hex for the specified resolved appearance mode (empty = default).
export const getAccentColor = (mode: 'light' | 'dark'): string => {
  return mode === 'light' ? preferenceCache.accentColorLight : preferenceCache.accentColorDark;
};

// Persist accent color for a specific resolved appearance mode to backend via fire-and-forget.
export const setAccentColor = (mode: 'light' | 'dark', color: string): void => {
  const key = mode === 'light' ? 'accentColorLight' : 'accentColorDark';
  fireAndForgetPreferenceUpdate(
    'Failed to persist accent color:',
    { [key]: color },
    [{ key, value: color }],
    { persistAppearanceBootstrap: true }
  );
};

// Returns the custom link color hex for the specified resolved appearance mode (empty = default).
export const getLinkColor = (mode: 'light' | 'dark'): string => {
  return mode === 'light' ? preferenceCache.linkColorLight : preferenceCache.linkColorDark;
};

// Persist link color for a specific resolved appearance mode to backend via fire-and-forget.
export const setLinkColor = (mode: 'light' | 'dark', color: string): void => {
  const key = mode === 'light' ? 'linkColorLight' : 'linkColorDark';
  fireAndForgetPreferenceUpdate(
    'Failed to persist link color:',
    { [key]: color },
    [{ key, value: color }],
    { persistAppearanceBootstrap: true }
  );
};

export const setAppearanceModePreference = async (mode: AppearanceMode): Promise<void> => {
  const normalized = normalizeAppearanceMode(mode);
  await optimisticPreferenceUpdate(
    { appearanceMode: normalized },
    [{ key: 'appearanceMode', value: normalized }],
    { persistAppearanceMode: normalized }
  );
};

export const setUseShortResourceNames = async (useShort: boolean): Promise<void> => {
  await optimisticPreferenceUpdate({ useShortResourceNames: useShort }, [
    { key: 'useShortResourceNames', value: useShort },
  ]);
};

export const setDimInactiveNamespaces = async (enabled: boolean): Promise<void> => {
  await optimisticPreferenceUpdate({ dimInactiveNamespaces: enabled }, [
    { key: 'dimInactiveNamespaces', value: enabled },
  ]);
};

export const setExclusiveNamespaces = async (enabled: boolean): Promise<void> => {
  await optimisticPreferenceUpdate({ exclusiveNamespaces: enabled }, [
    { key: 'exclusiveNamespaces', value: enabled },
  ]);
};

export const setAutoRefreshEnabled = (enabled: boolean): void => {
  fireAndForgetPreferenceUpdate(
    'Failed to persist auto-refresh preference:',
    { autoRefreshEnabled: enabled },
    [{ key: 'autoRefreshEnabled', value: enabled }]
  );
};

export const setBackgroundRefreshEnabled = (enabled: boolean): void => {
  fireAndForgetPreferenceUpdate(
    'Failed to persist background refresh preference:',
    { refreshBackgroundClustersEnabled: enabled },
    [{ key: 'refreshBackgroundClustersEnabled', value: enabled }]
  );
};

export const setObjPanelLogsBufferMaxSize = (size: number): void => {
  const normalized = normalizeObjPanelLogsBufferMaxSize(size);
  fireAndForgetPreferenceUpdate(
    'Failed to persist Object Panel Logs Tab buffer max size:',
    { objPanelLogsBufferMaxSize: normalized },
    [{ key: 'objPanelLogsBufferMaxSize', value: normalized }]
  );
};

export const setMaxTableRows = (size: number): void => {
  const normalized = normalizeMaxTableRows(size);
  fireAndForgetPreferenceUpdate('Failed to persist max table rows:', { maxTableRows: normalized }, [
    { key: 'maxTableRows', value: normalized },
  ]);
};

export const setKubernetesClientQPS = (qps: number): void => {
  const normalized = normalizeKubernetesClientQPS(qps);
  fireAndForgetPreferenceUpdate(
    'Failed to persist Kubernetes client QPS:',
    { kubernetesClientQPS: normalized },
    [{ key: 'kubernetesClientQPS', value: normalized }]
  );
};

export const setKubernetesClientBurst = (burst: number): void => {
  const normalized = normalizeKubernetesClientBurst(burst);
  fireAndForgetPreferenceUpdate(
    'Failed to persist Kubernetes client burst:',
    { kubernetesClientBurst: normalized },
    [{ key: 'kubernetesClientBurst', value: normalized }]
  );
};

export const setPermissionSSRRFetchConcurrency = (limit: number): void => {
  const normalized = normalizePermissionSSRRFetchConcurrency(limit);
  fireAndForgetPreferenceUpdate(
    'Failed to persist permission SSRR fetch concurrency:',
    { permissionSSRRFetchConcurrency: normalized },
    [{ key: 'permissionSSRRFetchConcurrency', value: normalized }]
  );
};

export const setObjPanelLogsApiTimestampFormat = (format: string): void => {
  const validationError = getObjPanelLogsApiTimestampFormatValidationError(format);
  if (validationError) {
    throw new Error(validationError);
  }
  const normalized = format.trim();
  fireAndForgetPreferenceUpdate(
    'Failed to persist Object Panel Logs Tab API timestamp format:',
    { objPanelLogsApiTimestampFormat: normalized },
    [{ key: 'objPanelLogsApiTimestampFormat', value: normalized }]
  );
};

export const setObjPanelLogsApiTimestampUseLocalTimeZone = (enabled: boolean): void => {
  fireAndForgetPreferenceUpdate(
    'Failed to persist Object Panel Logs Tab API timestamp local timezone setting:',
    { objPanelLogsApiTimestampUseLocalTimeZone: enabled },
    [{ key: 'objPanelLogsApiTimestampUseLocalTimeZone', value: enabled }]
  );
};

export const setObjPanelLogsTargetPerScopeLimit = (limit: number): void => {
  const normalized = normalizeObjPanelLogsTargetPerScopeLimit(limit);
  fireAndForgetPreferenceUpdate(
    'Failed to persist Object Panel Logs Tab target per-scope limit:',
    { objPanelLogsTargetPerScopeLimit: normalized },
    [{ key: 'objPanelLogsTargetPerScopeLimit', value: normalized }]
  );
};

export const setObjPanelLogsTargetGlobalLimit = (limit: number): void => {
  const normalized = normalizeObjPanelLogsTargetGlobalLimit(limit);
  fireAndForgetPreferenceUpdate(
    'Failed to persist Object Panel Logs Tab target global limit:',
    { objPanelLogsTargetGlobalLimit: normalized },
    [{ key: 'objPanelLogsTargetGlobalLimit', value: normalized }]
  );
};

export const setGridTablePersistenceMode = (mode: GridTablePersistenceMode): void => {
  const normalized = normalizeGridTableMode(mode);
  fireAndForgetPreferenceUpdate(
    'Failed to persist grid table persistence mode:',
    { gridTablePersistenceMode: normalized },
    [{ key: 'gridTablePersistenceMode', value: normalized }]
  );
};

export const setDefaultObjectPanelPosition = (position: ObjectPanelPosition): void => {
  const normalized = normalizeObjectPanelPosition(position);
  fireAndForgetPreferenceUpdate(
    'Failed to persist default object panel position:',
    { defaultObjectPanelPosition: normalized },
    [{ key: 'defaultObjectPanelPosition', value: normalized }]
  );
};

export const setObjectPanelLayoutDefaults = (layout: ObjectPanelLayoutDefaults): void => {
  fireAndForgetPreferenceUpdate(
    'Failed to persist object panel layout defaults:',
    {
      objectPanelDockedRightWidth: layout.dockedRightWidth,
      objectPanelDockedBottomHeight: layout.dockedBottomHeight,
      objectPanelFloatingWidth: layout.floatingWidth,
      objectPanelFloatingHeight: layout.floatingHeight,
      objectPanelFloatingX: layout.floatingX,
      objectPanelFloatingY: layout.floatingY,
    },
    [
      { key: 'objectPanelDockedRightWidth', value: layout.dockedRightWidth },
      { key: 'objectPanelDockedBottomHeight', value: layout.dockedBottomHeight },
      { key: 'objectPanelFloatingWidth', value: layout.floatingWidth },
      { key: 'objectPanelFloatingHeight', value: layout.floatingHeight },
      { key: 'objectPanelFloatingX', value: layout.floatingX },
      { key: 'objectPanelFloatingY', value: layout.floatingY },
    ]
  );
};

// Persist palette tint for a specific resolved appearance mode to backend via fire-and-forget.
export const setPaletteTint = (
  mode: 'light' | 'dark',
  hue: number,
  saturation: number,
  brightness: number = 0
): void => {
  const updates =
    mode === 'light'
      ? {
          paletteHueLight: hue,
          paletteSaturationLight: saturation,
          paletteBrightnessLight: brightness,
        }
      : {
          paletteHueDark: hue,
          paletteSaturationDark: saturation,
          paletteBrightnessDark: brightness,
        };
  const changes =
    mode === 'light'
      ? [
          { key: 'paletteHueLight' as const, value: hue },
          { key: 'paletteSaturationLight' as const, value: saturation },
          { key: 'paletteBrightnessLight' as const, value: brightness },
        ]
      : [
          { key: 'paletteHueDark' as const, value: hue },
          { key: 'paletteSaturationDark' as const, value: saturation },
          { key: 'paletteBrightnessDark' as const, value: brightness },
        ];
  fireAndForgetPreferenceUpdate('Failed to persist palette tint:', updates, changes, {
    persistAppearanceBootstrap: true,
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

export const validateThemeClusterPattern = async (
  pattern: string
): Promise<types.ThemeClusterPatternValidationResult> => {
  return ValidateThemeClusterPattern(pattern);
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
  preferenceSchemaByKey = new Map();
  hydrated = false;
};

// Test helper to set preferences directly for testing.
export const setAppPreferencesForTesting = (prefs: Partial<AppPreferences>): void => {
  preferenceCache = { ...preferenceCache, ...prefs };
  hydrated = true;
};
