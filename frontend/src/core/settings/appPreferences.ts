/**
 * frontend/src/core/settings/appPreferences.ts
 *
 * Centralized preference cache and backend sync for app settings.
 */

import type { types } from '@core/backend-api/models';
import {
  DEFAULT_TABLE_PAGE_SIZE,
  normalizeTablePageSize,
  TABLE_PAGE_SIZE_OPTIONS,
  type TablePageSize,
} from '@shared/components/tables/pageSizeOptions';
import {
  readAppSettings,
  readAppSettingsSchema,
  readThemes,
  requestAppState,
} from '@/core/app-state-access';
import {
  ApplyTheme,
  DeleteTheme,
  MatchThemeForCluster,
  ReorderThemes,
  SaveTheme,
  UpdateAppPreferences,
  ValidateThemeClusterPattern,
} from '@/core/backend-api';
import { desktopRuntimeAvailable, emitBroadcastEvent } from '@/core/desktop-runtime';
import { type AppEvents, eventBus } from '@/core/events';
import type { SidebarViewGroupId, ViewScope } from '@/core/navigation/viewRegistry';
import { captureBootstrapError } from '@/core/telemetry/sentry';
import {
  APPEARANCE_BOOTSTRAP_STORAGE_KEY,
  buildAppearanceBootstrapPayload,
} from '@/utils/appearanceBootstrap';
import { reportOperationalError } from '@/utils/errorHandler';
import {
  DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
  getObjPanelLogsApiTimestampFormatValidationError,
  normalizeObjPanelLogsApiTimestampFormat,
} from '@/utils/objPanelLogsApiTimestampFormat';

export type AppearanceMode = 'light' | 'dark' | 'system';
export type GridTablePersistenceMode = 'namespaced' | 'shared';
export type ObjectPanelPosition = 'right' | 'bottom' | 'floating';
export type SidebarGroupScope = Extract<ViewScope, 'cluster' | 'namespace'>;

const sidebarGroupPreferenceKeys = {
  cluster: {
    resources: 'sidebarClusterResourcesExpanded',
    extensions: 'sidebarClusterExtensionsExpanded',
  },
  namespace: {
    resources: 'sidebarNamespaceResourcesExpanded',
    extensions: 'sidebarNamespaceExtensionsExpanded',
  },
} as const satisfies Record<SidebarGroupScope, Record<SidebarViewGroupId, AppPreferenceKey>>;

export interface AppPreferences {
  sidebarClusterResourcesExpanded: boolean;
  sidebarClusterExtensionsExpanded: boolean;
  sidebarNamespaceResourcesExpanded: boolean;
  sidebarNamespaceExtensionsExpanded: boolean;
  appearanceMode: AppearanceMode;
  useShortResourceNames: boolean;
  dimInactiveNamespaces: boolean;
  exclusiveNamespaces: boolean;
  errorReportingEnabled: boolean;
  autoRefreshEnabled: boolean;
  refreshBackgroundClustersEnabled: boolean;
  metricsRefreshIntervalMs: number;
  kubernetesClientQPS: number;
  kubernetesClientBurst: number;
  permissionSSRRFetchConcurrency: number;
  objPanelLogsBufferMaxSize: number;
  objPanelLogsApiTimestampFormat: string;
  objPanelLogsApiTimestampUseLocalTimeZone: boolean;
  objPanelLogsTargetPerScopeLimit: number;
  objPanelLogsTargetGlobalLimit: number;
  gridTablePersistenceMode: GridTablePersistenceMode;
  defaultTablePageSize: TablePageSize;
  defaultObjectPanelPosition: ObjectPanelPosition;
  objectPanelDockedRightWidth: number;
  objectPanelDockedBottomHeight: number;
  objectPanelFloatingWidth: number;
  objectPanelFloatingHeight: number;
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

export interface HydratedAppPreferences extends AppPreferences {
  anonymizedId: string;
}

export type AppPreferenceKey = keyof AppPreferences;

export interface AppPreferenceMetadata<K extends AppPreferenceKey = AppPreferenceKey> {
  key: K;
  type: 'boolean' | 'color' | 'enum' | 'integer' | 'string';
  defaultValue: AppPreferences[K];
  currentValue: AppPreferences[K];
  min?: number;
  max?: number;
  enumOptions?: string[];
  validation?: string;
  runtimeSideEffect: boolean;
}

export type PreferenceChange<K extends AppPreferenceKey = AppPreferenceKey> = {
  key: K;
  value: AppPreferences[K];
};

interface PreferenceMutationOptions {
  persistAppearanceMode?: AppearanceMode;
  persistAppearanceBootstrap?: boolean;
}

interface PreferenceMutation {
  changes: PreferenceChange[];
  options?: PreferenceMutationOptions;
}

export interface PreferenceWorkflow<T> {
  commit: (input: T) => void;
  commitDebounced: (input: T) => void;
  cancelPending: () => void;
}

interface PreferenceWorkflowConfig<T> {
  label: string;
  debounceMs?: number;
  buildMutation: (input: T) => PreferenceMutation;
}

export interface PaletteTintPreferenceInput {
  mode: 'light' | 'dark';
  hue: number;
  saturation: number;
  brightness?: number;
}

export interface ColorPreferenceInput {
  mode: 'light' | 'dark';
  color: string;
}

type AppSettingsPayload = Partial<types.AppSettings>;

const DEFAULT_METRICS_REFRESH_INTERVAL_MS = 5000;
const OBJECT_PANEL_DOCKED_RIGHT_MIN_WIDTH = 500;
const OBJECT_PANEL_DOCKED_BOTTOM_MIN_HEIGHT = 200;
const OBJECT_PANEL_FLOATING_MIN_WIDTH = 450;
const OBJECT_PANEL_FLOATING_MIN_HEIGHT = 200;
const OBJECT_PANEL_LAYOUT_MAX = 9999;
const PALETTE_HUE_MIN = 0;
const PALETTE_HUE_MAX = 360;
const PALETTE_SATURATION_MIN = 0;
const PALETTE_SATURATION_MAX = 100;
const PALETTE_BRIGHTNESS_MIN = -50;
const PALETTE_BRIGHTNESS_MAX = 50;

export const OBJ_PANEL_LOGS_BUFFER_MIN_SIZE = 100;
export const OBJ_PANEL_LOGS_BUFFER_MAX_SIZE = 10000;
export const OBJ_PANEL_LOGS_BUFFER_DEFAULT_SIZE = 1000;
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
  sidebarClusterResourcesExpanded: false,
  sidebarClusterExtensionsExpanded: false,
  sidebarNamespaceResourcesExpanded: false,
  sidebarNamespaceExtensionsExpanded: false,
  appearanceMode: 'system',
  useShortResourceNames: false,
  dimInactiveNamespaces: true,
  exclusiveNamespaces: true,
  errorReportingEnabled: true,
  autoRefreshEnabled: true,
  refreshBackgroundClustersEnabled: true,
  metricsRefreshIntervalMs: DEFAULT_METRICS_REFRESH_INTERVAL_MS,
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

  // Used only before backend schema metadata is available.
  gridTablePersistenceMode: 'shared',
  defaultTablePageSize: DEFAULT_TABLE_PAGE_SIZE,
  defaultObjectPanelPosition: 'right',
  objectPanelDockedRightWidth: 600,
  objectPanelDockedBottomHeight: 600,
  objectPanelFloatingWidth: 600,
  objectPanelFloatingHeight: 800,
};

const createPreferenceMetadata = <K extends AppPreferenceKey>(
  key: K,
  type: AppPreferenceMetadata<K>['type'],
  options: Omit<AppPreferenceMetadata<K>, 'currentValue' | 'defaultValue' | 'key' | 'type'> & {
    defaultValue?: AppPreferences[K];
    currentValue?: AppPreferences[K];
  }
): AppPreferenceMetadata<K> => ({
  key,
  type,
  defaultValue: options.defaultValue ?? DEFAULT_PREFERENCES[key],
  currentValue: options.currentValue ?? DEFAULT_PREFERENCES[key],
  min: options.min,
  max: options.max,
  enumOptions: options.enumOptions,
  validation: options.validation,
  runtimeSideEffect: options.runtimeSideEffect,
});

const FALLBACK_PREFERENCE_METADATA: {
  [K in AppPreferenceKey]: AppPreferenceMetadata<K>;
} = {
  sidebarClusterResourcesExpanded: createPreferenceMetadata(
    'sidebarClusterResourcesExpanded',
    'boolean',
    { runtimeSideEffect: false }
  ),
  sidebarClusterExtensionsExpanded: createPreferenceMetadata(
    'sidebarClusterExtensionsExpanded',
    'boolean',
    { runtimeSideEffect: false }
  ),
  sidebarNamespaceResourcesExpanded: createPreferenceMetadata(
    'sidebarNamespaceResourcesExpanded',
    'boolean',
    { runtimeSideEffect: false }
  ),
  sidebarNamespaceExtensionsExpanded: createPreferenceMetadata(
    'sidebarNamespaceExtensionsExpanded',
    'boolean',
    { runtimeSideEffect: false }
  ),
  appearanceMode: createPreferenceMetadata('appearanceMode', 'enum', {
    enumOptions: ['light', 'dark', 'system'],
    runtimeSideEffect: true,
  }),
  useShortResourceNames: createPreferenceMetadata('useShortResourceNames', 'boolean', {
    runtimeSideEffect: false,
  }),
  dimInactiveNamespaces: createPreferenceMetadata('dimInactiveNamespaces', 'boolean', {
    runtimeSideEffect: false,
  }),
  exclusiveNamespaces: createPreferenceMetadata('exclusiveNamespaces', 'boolean', {
    runtimeSideEffect: false,
  }),
  errorReportingEnabled: createPreferenceMetadata('errorReportingEnabled', 'boolean', {
    runtimeSideEffect: true,
  }),
  autoRefreshEnabled: createPreferenceMetadata('autoRefreshEnabled', 'boolean', {
    runtimeSideEffect: true,
  }),
  refreshBackgroundClustersEnabled: createPreferenceMetadata(
    'refreshBackgroundClustersEnabled',
    'boolean',
    { runtimeSideEffect: true }
  ),
  metricsRefreshIntervalMs: createPreferenceMetadata('metricsRefreshIntervalMs', 'integer', {
    min: 1,
    runtimeSideEffect: true,
  }),
  kubernetesClientQPS: createPreferenceMetadata('kubernetesClientQPS', 'integer', {
    min: KUBERNETES_CLIENT_QPS_MIN,
    max: KUBERNETES_CLIENT_QPS_MAX,
    runtimeSideEffect: true,
  }),
  kubernetesClientBurst: createPreferenceMetadata('kubernetesClientBurst', 'integer', {
    min: KUBERNETES_CLIENT_BURST_MIN,
    max: KUBERNETES_CLIENT_BURST_MAX,
    runtimeSideEffect: true,
  }),
  permissionSSRRFetchConcurrency: createPreferenceMetadata(
    'permissionSSRRFetchConcurrency',
    'integer',
    {
      min: PERMISSION_SSRR_FETCH_CONCURRENCY_MIN,
      max: PERMISSION_SSRR_FETCH_CONCURRENCY_MAX,
      runtimeSideEffect: false,
    }
  ),
  objPanelLogsBufferMaxSize: createPreferenceMetadata('objPanelLogsBufferMaxSize', 'integer', {
    min: OBJ_PANEL_LOGS_BUFFER_MIN_SIZE,
    max: OBJ_PANEL_LOGS_BUFFER_MAX_SIZE,
    runtimeSideEffect: false,
  }),
  objPanelLogsApiTimestampFormat: createPreferenceMetadata(
    'objPanelLogsApiTimestampFormat',
    'string',
    { validation: 'dayjs-format', runtimeSideEffect: false }
  ),
  objPanelLogsApiTimestampUseLocalTimeZone: createPreferenceMetadata(
    'objPanelLogsApiTimestampUseLocalTimeZone',
    'boolean',
    { runtimeSideEffect: false }
  ),
  objPanelLogsTargetPerScopeLimit: createPreferenceMetadata(
    'objPanelLogsTargetPerScopeLimit',
    'integer',
    {
      min: OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MIN,
      max: OBJ_PANEL_LOGS_TARGET_PER_SCOPE_MAX,
      runtimeSideEffect: true,
    }
  ),
  objPanelLogsTargetGlobalLimit: createPreferenceMetadata(
    'objPanelLogsTargetGlobalLimit',
    'integer',
    {
      min: OBJ_PANEL_LOGS_TARGET_GLOBAL_MIN,
      max: OBJ_PANEL_LOGS_TARGET_GLOBAL_MAX,
      runtimeSideEffect: true,
    }
  ),
  gridTablePersistenceMode: createPreferenceMetadata('gridTablePersistenceMode', 'enum', {
    enumOptions: ['shared', 'namespaced'],
    runtimeSideEffect: false,
  }),
  defaultTablePageSize: createPreferenceMetadata('defaultTablePageSize', 'integer', {
    min: 1,
    max: TABLE_PAGE_SIZE_OPTIONS[TABLE_PAGE_SIZE_OPTIONS.length - 1],
    runtimeSideEffect: false,
  }),
  defaultObjectPanelPosition: createPreferenceMetadata('defaultObjectPanelPosition', 'enum', {
    enumOptions: ['right', 'bottom', 'floating'],
    runtimeSideEffect: false,
  }),
  objectPanelDockedRightWidth: createPreferenceMetadata('objectPanelDockedRightWidth', 'integer', {
    min: OBJECT_PANEL_DOCKED_RIGHT_MIN_WIDTH,
    max: OBJECT_PANEL_LAYOUT_MAX,
    runtimeSideEffect: false,
  }),
  objectPanelDockedBottomHeight: createPreferenceMetadata(
    'objectPanelDockedBottomHeight',
    'integer',
    {
      min: OBJECT_PANEL_DOCKED_BOTTOM_MIN_HEIGHT,
      max: OBJECT_PANEL_LAYOUT_MAX,
      runtimeSideEffect: false,
    }
  ),
  objectPanelFloatingWidth: createPreferenceMetadata('objectPanelFloatingWidth', 'integer', {
    min: OBJECT_PANEL_FLOATING_MIN_WIDTH,
    max: OBJECT_PANEL_LAYOUT_MAX,
    runtimeSideEffect: false,
  }),
  objectPanelFloatingHeight: createPreferenceMetadata('objectPanelFloatingHeight', 'integer', {
    min: OBJECT_PANEL_FLOATING_MIN_HEIGHT,
    max: OBJECT_PANEL_LAYOUT_MAX,
    runtimeSideEffect: false,
  }),
  paletteHueLight: createPreferenceMetadata('paletteHueLight', 'integer', {
    min: PALETTE_HUE_MIN,
    max: PALETTE_HUE_MAX,
    runtimeSideEffect: false,
  }),
  paletteSaturationLight: createPreferenceMetadata('paletteSaturationLight', 'integer', {
    min: PALETTE_SATURATION_MIN,
    max: PALETTE_SATURATION_MAX,
    runtimeSideEffect: false,
  }),
  paletteBrightnessLight: createPreferenceMetadata('paletteBrightnessLight', 'integer', {
    min: PALETTE_BRIGHTNESS_MIN,
    max: PALETTE_BRIGHTNESS_MAX,
    runtimeSideEffect: false,
  }),
  paletteHueDark: createPreferenceMetadata('paletteHueDark', 'integer', {
    min: PALETTE_HUE_MIN,
    max: PALETTE_HUE_MAX,
    runtimeSideEffect: false,
  }),
  paletteSaturationDark: createPreferenceMetadata('paletteSaturationDark', 'integer', {
    min: PALETTE_SATURATION_MIN,
    max: PALETTE_SATURATION_MAX,
    runtimeSideEffect: false,
  }),
  paletteBrightnessDark: createPreferenceMetadata('paletteBrightnessDark', 'integer', {
    min: PALETTE_BRIGHTNESS_MIN,
    max: PALETTE_BRIGHTNESS_MAX,
    runtimeSideEffect: false,
  }),
  accentColorLight: createPreferenceMetadata('accentColorLight', 'color', {
    validation: '#rrggbb-or-empty',
    runtimeSideEffect: false,
  }),
  accentColorDark: createPreferenceMetadata('accentColorDark', 'color', {
    validation: '#rrggbb-or-empty',
    runtimeSideEffect: false,
  }),
  linkColorLight: createPreferenceMetadata('linkColorLight', 'color', {
    validation: '#rrggbb-or-empty',
    runtimeSideEffect: false,
  }),
  linkColorDark: createPreferenceMetadata('linkColorDark', 'color', {
    validation: '#rrggbb-or-empty',
    runtimeSideEffect: false,
  }),
};

let preferenceCache: AppPreferences = { ...DEFAULT_PREFERENCES };
let anonymizedIdCache = '';
let hydrated = false;
let preferenceSchemaByKey = new Map<AppPreferenceKey, AppPreferenceMetadata>();
let confirmedPreferences = preferenceCache;
let confirmedStorage: LocalStorageSnapshot;
let pendingMutations: PendingPreferenceMutation[] = [];
let preferenceRevision = 0;
let hydrationPromise: Promise<HydratedAppPreferences> | null = null;

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

const appearanceBootstrap = (preferences: AppPreferences): string =>
  JSON.stringify(
    buildAppearanceBootstrapPayload({
      light: {
        paletteHue: preferences.paletteHueLight,
        paletteSaturation: preferences.paletteSaturationLight,
        paletteBrightness: preferences.paletteBrightnessLight,
        accentColor: preferences.accentColorLight,
        linkColor: preferences.linkColorLight,
      },
      dark: {
        paletteHue: preferences.paletteHueDark,
        paletteSaturation: preferences.paletteSaturationDark,
        paletteBrightness: preferences.paletteBrightnessDark,
        accentColor: preferences.accentColorDark,
        linkColor: preferences.linkColorDark,
      },
    })
  );

const isPreferenceKey = (key: string): key is AppPreferenceKey => key in DEFAULT_PREFERENCES;

const schemaEntryToMetadata = (entry: types.AppPreferenceSchema): AppPreferenceMetadata | null => {
  if (!isPreferenceKey(entry.key)) {
    return null;
  }
  const fallback = FALLBACK_PREFERENCE_METADATA[entry.key];
  return {
    key: entry.key,
    type: (entry.type || fallback.type) as AppPreferenceMetadata['type'],
    defaultValue: (entry.defaultValue ?? fallback.defaultValue) as AppPreferences[AppPreferenceKey],
    currentValue: (entry.currentValue ??
      entry.defaultValue ??
      fallback.defaultValue) as AppPreferences[AppPreferenceKey],
    min: entry.min ?? undefined,
    max: entry.max ?? undefined,
    enumOptions: entry.enumOptions ?? fallback.enumOptions,
    validation: entry.validation ?? fallback.validation,
    runtimeSideEffect: entry.runtimeSideEffect ?? fallback.runtimeSideEffect,
  };
};

export const getPreferenceMetadata = <K extends AppPreferenceKey>(
  key: K
): AppPreferenceMetadata<K> => {
  return (preferenceSchemaByKey.get(key) ??
    FALLBACK_PREFERENCE_METADATA[key]) as AppPreferenceMetadata<K>;
};

export const getIntegerPreferenceMetadata = (
  key: AppPreferenceKey
): AppPreferenceMetadata & {
  min: number;
  max?: number;
  defaultValue: number;
  currentValue: number;
} => {
  const metadata = getPreferenceMetadata(key);
  if (metadata.type !== 'integer') {
    throw new Error(`Preference ${key} is not an integer setting`);
  }
  return {
    ...metadata,
    defaultValue: Number(metadata.defaultValue),
    currentValue: Number(metadata.currentValue),
    min: metadata.min ?? Number.NEGATIVE_INFINITY,
  };
};

export const normalizeIntegerPreferenceValue = (
  key: AppPreferenceKey,
  value?: number,
  options?: { defaultOnNonPositive?: boolean }
): number => {
  const metadata = getIntegerPreferenceMetadata(key);
  if (
    value === null ||
    value === undefined ||
    Number.isNaN(value) ||
    (options?.defaultOnNonPositive && value <= 0)
  ) {
    return metadata.defaultValue;
  }
  const floored = Math.floor(value);
  if (floored < metadata.min) {
    return metadata.min;
  }
  if (metadata.max !== null && metadata.max !== undefined && floored > metadata.max) {
    return metadata.max;
  }
  return floored;
};

export const commitIntegerPreferenceInput = (
  key: AppPreferenceKey,
  raw: string,
  persist: (value: number) => void,
  options?: { defaultOnNonPositive?: boolean }
): number => {
  const normalized = normalizeIntegerPreferenceValue(key, Number.parseInt(raw, 10), options);
  persist(normalized);
  return normalized;
};

const normalizeEnumPreferenceValue = <T extends string>(
  key: AppPreferenceKey,
  value: string | undefined
): T => {
  const metadata = getPreferenceMetadata(key);
  if (typeof value === 'string' && metadata.enumOptions?.includes(value)) {
    return value as T;
  }
  return String(metadata.defaultValue) as T;
};

const normalizeBooleanPreferenceValue = (
  key: AppPreferenceKey,
  value: boolean | undefined
): boolean => value ?? Boolean(getPreferenceMetadata(key).defaultValue);

const validHexColorRe = /^#[0-9a-fA-F]{6}$/;

const normalizeColorPreferenceValue = (
  key: AppPreferenceKey,
  value: string | undefined
): string => {
  if (typeof value === 'string' && (value === '' || validHexColorRe.test(value))) {
    return value;
  }
  return String(getPreferenceMetadata(key).defaultValue);
};

const normalizeAppearanceMode = (value: string | undefined): AppearanceMode =>
  normalizeEnumPreferenceValue<AppearanceMode>('appearanceMode', value);

const isAppearanceMode = (value: string): value is AppearanceMode =>
  value === 'light' || value === 'dark' || value === 'system';

const normalizeGridTableMode = (value: string | undefined): GridTablePersistenceMode =>
  normalizeEnumPreferenceValue<GridTablePersistenceMode>('gridTablePersistenceMode', value);

const normalizeObjectPanelPosition = (value: string | undefined): ObjectPanelPosition =>
  normalizeEnumPreferenceValue<ObjectPanelPosition>('defaultObjectPanelPosition', value);

const normalizeMetricsIntervalMs = (value?: number): number =>
  normalizeIntegerPreferenceValue('metricsRefreshIntervalMs', value, {
    defaultOnNonPositive: true,
  });

const normalizeKubernetesClientQPS = (value?: number): number =>
  normalizeIntegerPreferenceValue('kubernetesClientQPS', value, {
    defaultOnNonPositive: true,
  });

const normalizeKubernetesClientBurst = (value?: number): number =>
  normalizeIntegerPreferenceValue('kubernetesClientBurst', value, {
    defaultOnNonPositive: true,
  });

const normalizePermissionSSRRFetchConcurrency = (value?: number): number =>
  normalizeIntegerPreferenceValue('permissionSSRRFetchConcurrency', value, {
    defaultOnNonPositive: true,
  });

const normalizeObjPanelLogsBufferMaxSize = (value?: number): number =>
  normalizeIntegerPreferenceValue('objPanelLogsBufferMaxSize', value, {
    defaultOnNonPositive: true,
  });

const normalizeObjPanelLogsTargetPerScopeLimit = (value?: number): number =>
  normalizeIntegerPreferenceValue('objPanelLogsTargetPerScopeLimit', value, {
    defaultOnNonPositive: true,
  });

const normalizeObjPanelLogsTargetGlobalLimit = (value?: number): number =>
  normalizeIntegerPreferenceValue('objPanelLogsTargetGlobalLimit', value, {
    defaultOnNonPositive: true,
  });

const emitSelectedPreferenceChange = <T>(
  previous: AppPreferences,
  next: AppPreferences,
  select: (preferences: AppPreferences) => T,
  emit: (value: T) => void,
  areEqual: (previousValue: T, nextValue: T) => boolean = Object.is
): void => {
  const previousValue = select(previous);
  const nextValue = select(next);
  if (!areEqual(previousValue, nextValue)) {
    emit(nextValue);
  }
};

type PaletteTint = AppEvents['settings:palette-tint'];

export const palettePreferenceKeys = {
  light: {
    hue: 'paletteHueLight',
    saturation: 'paletteSaturationLight',
    brightness: 'paletteBrightnessLight',
  },
  dark: {
    hue: 'paletteHueDark',
    saturation: 'paletteSaturationDark',
    brightness: 'paletteBrightnessDark',
  },
} as const;

const selectPaletteValues = (preferences: AppPreferences, mode: 'light' | 'dark') => {
  const keys = palettePreferenceKeys[mode];
  return {
    hue: preferences[keys.hue],
    saturation: preferences[keys.saturation],
    brightness: preferences[keys.brightness],
  };
};

const selectPaletteTint = (preferences: AppPreferences, mode: 'light' | 'dark'): PaletteTint => ({
  mode,
  ...selectPaletteValues(preferences, mode),
});

const paletteTintsEqual = (previous: PaletteTint, next: PaletteTint): boolean =>
  previous.hue === next.hue &&
  previous.saturation === next.saturation &&
  previous.brightness === next.brightness;

type ModeColor = AppEvents['settings:accent-color'];

const selectModeColor = (mode: 'light' | 'dark', color: string): ModeColor => ({ mode, color });

const modeColorsEqual = (previous: ModeColor, next: ModeColor): boolean =>
  previous.color === next.color;

const emitPreferenceChanges = (previous: AppPreferences, next: AppPreferences): void => {
  for (const keys of Object.values(sidebarGroupPreferenceKeys)) {
    for (const key of Object.values(keys)) {
      emitSelectedPreferenceChange(
        previous,
        next,
        (value) => value[key],
        () => eventBus.emit('settings:sidebar-expansion')
      );
    }
  }
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.appearanceMode,
    (value) => eventBus.emit('settings:appearance-mode', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.useShortResourceNames,
    (value) => eventBus.emit('settings:short-names', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.dimInactiveNamespaces,
    (value) => eventBus.emit('settings:dim-inactive-namespaces', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.exclusiveNamespaces,
    (value) => eventBus.emit('settings:exclusive-namespaces', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.errorReportingEnabled,
    (value) => eventBus.emit('settings:error-reporting', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.autoRefreshEnabled,
    (value) => eventBus.emit('settings:auto-refresh', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.refreshBackgroundClustersEnabled,
    (value) => eventBus.emit('settings:refresh-background', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.kubernetesClientQPS,
    (value) => eventBus.emit('settings:kubernetes-client-qps', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.kubernetesClientBurst,
    (value) => eventBus.emit('settings:kubernetes-client-burst', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.permissionSSRRFetchConcurrency,
    (value) => eventBus.emit('settings:permission-ssrr-fetch-concurrency', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.objPanelLogsBufferMaxSize,
    (value) => eventBus.emit('settings:obj-panel-logs-buffer-size', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.objPanelLogsApiTimestampFormat,
    (value) => eventBus.emit('settings:obj-panel-logs-api-timestamp-format', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.objPanelLogsApiTimestampUseLocalTimeZone,
    (value) => eventBus.emit('settings:obj-panel-logs-api-timestamp-use-local-time-zone', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.objPanelLogsTargetPerScopeLimit,
    (value) => eventBus.emit('settings:obj-panel-logs-target-per-scope-limit', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.objPanelLogsTargetGlobalLimit,
    (value) => eventBus.emit('settings:obj-panel-logs-target-global-limit', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.gridTablePersistenceMode,
    (value) => eventBus.emit('gridtable:persistence-mode', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => value.defaultTablePageSize,
    (value) => eventBus.emit('settings:default-table-page-size', value)
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => selectPaletteTint(value, 'light'),
    (value) => eventBus.emit('settings:palette-tint', value),
    paletteTintsEqual
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => selectPaletteTint(value, 'dark'),
    (value) => eventBus.emit('settings:palette-tint', value),
    paletteTintsEqual
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => selectModeColor('light', value.accentColorLight),
    (value) => eventBus.emit('settings:accent-color', value),
    modeColorsEqual
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => selectModeColor('dark', value.accentColorDark),
    (value) => eventBus.emit('settings:accent-color', value),
    modeColorsEqual
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => selectModeColor('light', value.linkColorLight),
    (value) => eventBus.emit('settings:link-color', value),
    modeColorsEqual
  );
  emitSelectedPreferenceChange(
    previous,
    next,
    (value) => selectModeColor('dark', value.linkColorDark),
    (value) => eventBus.emit('settings:link-color', value),
    modeColorsEqual
  );
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
    if (value === null || value === undefined) {
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

const persistPreferenceChanges = async (changes: PreferenceChange[]): Promise<void> => {
  if (!desktopRuntimeAvailable()) {
    return;
  }
  await UpdateAppPreferences({
    changes: changes.map((change) => ({ key: change.key, value: change.value })),
  } as types.UpdateAppPreferencesRequest);
};

interface PendingPreferenceMutation {
  mutation: PreferenceMutation;
  completion: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

const applyPreferenceChanges = (
  preferences: AppPreferences,
  changes: PreferenceChange[]
): AppPreferences => ({
  ...preferences,
  ...Object.fromEntries(changes.map(({ key, value }) => [key, value])),
});

const projectAppearanceStorage = (
  storage: LocalStorageSnapshot,
  preferences: AppPreferences,
  options?: PreferenceMutationOptions
): LocalStorageSnapshot => ({
  appearanceMode: options?.persistAppearanceMode ?? storage.appearanceMode,
  appearanceBootstrap: options?.persistAppearanceBootstrap
    ? appearanceBootstrap(preferences)
    : storage.appearanceBootstrap,
});

// Cache, startup mirrors and subscribers observe the same confirmed base plus pending edits.
const publishPreferences = (): void => {
  let next = confirmedPreferences;
  let storage = confirmedStorage;
  for (const { mutation } of pendingMutations) {
    next = applyPreferenceChanges(next, mutation.changes);
    storage = projectAppearanceStorage(storage, next, mutation.options);
  }
  const previous = preferenceCache;
  preferenceCache = next;
  restoreLocalStorageSnapshot(storage);
  emitPreferenceChanges(previous, next);
};

const persistNextPreferenceMutation = async (queue: PendingPreferenceMutation[]): Promise<void> => {
  const entry = queue[0];
  try {
    await persistPreferenceChanges(entry.mutation.changes);
  } catch (error) {
    finishPreferenceMutation(queue, entry, { error });
    return;
  }
  if (queue === pendingMutations) {
    await broadcastPreferenceMutation(entry.mutation);
  }
  finishPreferenceMutation(queue, entry, null);
};

const finishPreferenceMutation = (
  queue: PendingPreferenceMutation[],
  entry: PendingPreferenceMutation,
  failure: { error: unknown } | null
): void => {
  // A test reset detaches the old queue; its callers still receive their result.
  if (queue === pendingMutations) {
    if (!failure) {
      confirmedPreferences = applyPreferenceChanges(confirmedPreferences, entry.mutation.changes);
      confirmedStorage = projectAppearanceStorage(
        confirmedStorage,
        confirmedPreferences,
        entry.mutation.options
      );
    }
    queue.shift();
    if (queue.length) {
      void persistNextPreferenceMutation(queue);
    }
    publishPreferences();
  }
  if (failure) {
    entry.reject(failure.error);
  } else {
    entry.resolve();
  }
};

const enqueuePreferenceMutation = (mutation: PreferenceMutation): Promise<void> => {
  if (!pendingMutations.length) {
    confirmedStorage = captureLocalStorageSnapshot();
  }
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const completion = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const entry = { mutation, completion, resolve, reject };
  pendingMutations.push(entry);
  preferenceRevision++;
  hydrated = true;
  if (mutation.options?.persistAppearanceMode) {
    persistAppearanceModeToLocalStorage(mutation.options.persistAppearanceMode);
  }
  publishPreferences();
  if (pendingMutations[0] === entry) {
    void persistNextPreferenceMutation(pendingMutations);
  }
  return completion;
};

const broadcastPreferenceMutation = async (mutation: PreferenceMutation): Promise<void> => {
  if (!desktopRuntimeAvailable()) {
    return;
  }
  try {
    await emitBroadcastEvent('settings:preferences-changed', undefined);
  } catch (error) {
    reportOperationalError(error, {
      source: 'AppPreferences',
      action: 'broadcast-preference-change',
    });
  }
  const mode = mutation.options?.persistAppearanceMode;
  if (!mode) {
    return;
  }
  try {
    await emitBroadcastEvent('settings:appearance-mode-changed', { mode });
  } catch (error) {
    reportOperationalError(error, {
      source: 'AppPreferences',
      action: 'broadcast-appearance-mode',
    });
  }
};

const commitPreferenceMutation = (label: string, mutation: PreferenceMutation): void => {
  void enqueuePreferenceMutation(mutation).catch((error) => {
    reportOperationalError(error, { source: 'AppPreferences', action: label });
  });
};

const singlePreferenceMutation = <K extends AppPreferenceKey>(
  key: K,
  value: AppPreferences[K],
  options?: PreferenceMutationOptions
): PreferenceMutation => ({
  changes: [{ key, value }],
  options,
});

const createPreferenceWorkflow = <T>({
  label,
  debounceMs = 300,
  buildMutation,
}: PreferenceWorkflowConfig<T>): PreferenceWorkflow<T> => {
  let pendingTimer: ReturnType<typeof setTimeout> | null = null;

  const cancelPending = () => {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
  };

  const commit = (input: T) => {
    cancelPending();
    commitPreferenceMutation(label, buildMutation(input));
  };

  const commitDebounced = (input: T) => {
    cancelPending();
    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      commitPreferenceMutation(label, buildMutation(input));
    }, debounceMs);
  };

  return { commit, commitDebounced, cancelPending };
};

interface PreferenceFetchResult<T> {
  value: T | null;
  failed: boolean;
}

const fetchPreferences = async <T>({
  resource,
  read,
  action,
}: {
  resource: string;
  read: () => Promise<T>;
  action: string;
}): Promise<PreferenceFetchResult<T>> => {
  try {
    const value = await requestAppState({ resource, read });
    return { value: value ?? null, failed: false };
  } catch (error) {
    captureBootstrapError(error, { action });
    return { value: null, failed: true };
  }
};

const schemaPayloadFromPreferences = (schema: types.AppSettingsSchema | null) => {
  const metadata = new Map<AppPreferenceKey, AppPreferenceMetadata>();
  if (!schema?.preferences) {
    return { metadata, settings: null };
  }
  const settings: AppSettingsPayload = { anonymizedId: schema.anonymizedId };
  for (const entry of schema.preferences) {
    const value = schemaEntryToMetadata(entry);
    if (!value) {
      continue;
    }
    metadata.set(value.key, value);
    (settings as Record<string, unknown>)[value.key] = value.currentValue;
  }
  return { metadata, settings };
};

const fetchPreferenceSnapshot = async () => {
  const schema = await fetchPreferences({
    resource: 'app-settings-schema',
    read: readAppSettingsSchema,
    action: 'loadAppSettingsSchema',
  });
  const { metadata, settings } = schemaPayloadFromPreferences(schema.value);
  if (settings !== null) {
    return { metadata, settings, failed: false };
  }
  const fallback = await fetchPreferences({
    resource: 'app-settings',
    read: readAppSettings,
    action: 'loadAppSettings',
  });
  return { metadata, settings: fallback.value, failed: fallback.failed };
};

const normalizePreferences = (
  backendSettings: AppSettingsPayload | null,
  settingsReadFailed: boolean
): AppPreferences => {
  const preferences: AppPreferences = {
    sidebarClusterResourcesExpanded: normalizeBooleanPreferenceValue(
      'sidebarClusterResourcesExpanded',
      backendSettings?.sidebarClusterResourcesExpanded
    ),
    sidebarClusterExtensionsExpanded: normalizeBooleanPreferenceValue(
      'sidebarClusterExtensionsExpanded',
      backendSettings?.sidebarClusterExtensionsExpanded
    ),
    sidebarNamespaceResourcesExpanded: normalizeBooleanPreferenceValue(
      'sidebarNamespaceResourcesExpanded',
      backendSettings?.sidebarNamespaceResourcesExpanded
    ),
    sidebarNamespaceExtensionsExpanded: normalizeBooleanPreferenceValue(
      'sidebarNamespaceExtensionsExpanded',
      backendSettings?.sidebarNamespaceExtensionsExpanded
    ),
    appearanceMode: normalizeAppearanceMode(backendSettings?.appearanceMode),
    useShortResourceNames: normalizeBooleanPreferenceValue(
      'useShortResourceNames',
      backendSettings?.useShortResourceNames
    ),
    dimInactiveNamespaces: normalizeBooleanPreferenceValue(
      'dimInactiveNamespaces',
      backendSettings?.dimInactiveNamespaces
    ),
    exclusiveNamespaces: normalizeBooleanPreferenceValue(
      'exclusiveNamespaces',
      backendSettings?.exclusiveNamespaces
    ),
    // If the persisted preference cannot be read, reporting must fail closed:
    // sending the hydration error would otherwise risk overriding a saved opt-out.
    errorReportingEnabled: settingsReadFailed
      ? false
      : normalizeBooleanPreferenceValue(
          'errorReportingEnabled',
          backendSettings?.errorReportingEnabled
        ),
    autoRefreshEnabled: normalizeBooleanPreferenceValue(
      'autoRefreshEnabled',
      backendSettings?.autoRefreshEnabled
    ),
    refreshBackgroundClustersEnabled: normalizeBooleanPreferenceValue(
      'refreshBackgroundClustersEnabled',
      backendSettings?.refreshBackgroundClustersEnabled
    ),
    metricsRefreshIntervalMs: normalizeMetricsIntervalMs(backendSettings?.metricsRefreshIntervalMs),
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
    objPanelLogsApiTimestampUseLocalTimeZone: normalizeBooleanPreferenceValue(
      'objPanelLogsApiTimestampUseLocalTimeZone',
      backendSettings?.objPanelLogsApiTimestampUseLocalTimeZone
    ),
    objPanelLogsTargetPerScopeLimit: normalizeObjPanelLogsTargetPerScopeLimit(
      backendSettings?.objPanelLogsTargetPerScopeLimit
    ),
    objPanelLogsTargetGlobalLimit: normalizeObjPanelLogsTargetGlobalLimit(
      backendSettings?.objPanelLogsTargetGlobalLimit
    ),
    gridTablePersistenceMode: normalizeGridTableMode(backendSettings?.gridTablePersistenceMode),
    defaultTablePageSize: normalizeTablePageSize(backendSettings?.defaultTablePageSize),
    defaultObjectPanelPosition: normalizeObjectPanelPosition(
      backendSettings?.defaultObjectPanelPosition
    ),
    objectPanelDockedRightWidth: normalizeIntegerPreferenceValue(
      'objectPanelDockedRightWidth',
      backendSettings?.objectPanelDockedRightWidth,
      { defaultOnNonPositive: true }
    ),
    objectPanelDockedBottomHeight: normalizeIntegerPreferenceValue(
      'objectPanelDockedBottomHeight',
      backendSettings?.objectPanelDockedBottomHeight,
      { defaultOnNonPositive: true }
    ),
    objectPanelFloatingWidth: normalizeIntegerPreferenceValue(
      'objectPanelFloatingWidth',
      backendSettings?.objectPanelFloatingWidth,
      { defaultOnNonPositive: true }
    ),
    objectPanelFloatingHeight: normalizeIntegerPreferenceValue(
      'objectPanelFloatingHeight',
      backendSettings?.objectPanelFloatingHeight,
      { defaultOnNonPositive: true }
    ),
    paletteHueLight: normalizeIntegerPreferenceValue(
      'paletteHueLight',
      backendSettings?.paletteHueLight
    ),
    paletteSaturationLight: normalizeIntegerPreferenceValue(
      'paletteSaturationLight',
      backendSettings?.paletteSaturationLight
    ),
    paletteBrightnessLight: normalizeIntegerPreferenceValue(
      'paletteBrightnessLight',
      backendSettings?.paletteBrightnessLight
    ),
    paletteHueDark: normalizeIntegerPreferenceValue(
      'paletteHueDark',
      backendSettings?.paletteHueDark
    ),
    paletteSaturationDark: normalizeIntegerPreferenceValue(
      'paletteSaturationDark',
      backendSettings?.paletteSaturationDark
    ),
    paletteBrightnessDark: normalizeIntegerPreferenceValue(
      'paletteBrightnessDark',
      backendSettings?.paletteBrightnessDark
    ),
    accentColorLight: normalizeColorPreferenceValue(
      'accentColorLight',
      backendSettings?.accentColorLight
    ),
    accentColorDark: normalizeColorPreferenceValue(
      'accentColorDark',
      backendSettings?.accentColorDark
    ),
    linkColorLight: normalizeColorPreferenceValue(
      'linkColorLight',
      backendSettings?.linkColorLight
    ),
    linkColorDark: normalizeColorPreferenceValue('linkColorDark', backendSettings?.linkColorDark),
  };

  return preferences;
};

const hydrateLatestPreferences = async (): Promise<HydratedAppPreferences> => {
  while (true) {
    while (pendingMutations.length) {
      await pendingMutations[pendingMutations.length - 1].completion.catch(() => undefined);
    }
    const revision = preferenceRevision;
    const snapshot = await fetchPreferenceSnapshot();
    if (revision !== preferenceRevision) {
      continue;
    }
    preferenceSchemaByKey = snapshot.metadata;
    confirmedPreferences = normalizePreferences(snapshot.settings, snapshot.failed);
    anonymizedIdCache = snapshot.settings?.anonymizedId?.trim() ?? '';
    hydrated = true;
    persistAppearanceModeToLocalStorage(confirmedPreferences.appearanceMode);
    confirmedStorage = projectAppearanceStorage(
      captureLocalStorageSnapshot(),
      confirmedPreferences,
      {
        persistAppearanceMode: confirmedPreferences.appearanceMode,
        persistAppearanceBootstrap: true,
      }
    );
    publishPreferences();
    return { ...preferenceCache, anonymizedId: anonymizedIdCache };
  }
};

export const hydrateAppPreferences = async (options?: {
  force?: boolean;
}): Promise<HydratedAppPreferences> => {
  if (hydrated && !options?.force) {
    return { ...preferenceCache, anonymizedId: anonymizedIdCache };
  }
  if (options?.force) {
    preferenceRevision++;
  }
  if (!hydrationPromise) {
    hydrationPromise = hydrateLatestPreferences().finally(() => {
      hydrationPromise = null;
    });
  }
  return hydrationPromise;
};

export const getAppearanceModePreference = (): AppearanceMode => {
  return preferenceCache.appearanceMode;
};

export const applyBroadcastAppearanceModePreference = (mode: string): void => {
  if (!isAppearanceMode(mode)) {
    return;
  }
  preferenceRevision++;
  confirmedPreferences = { ...confirmedPreferences, appearanceMode: mode };
  const storage = pendingMutations.length ? confirmedStorage : captureLocalStorageSnapshot();
  confirmedStorage = { ...storage, appearanceMode: mode };
  persistAppearanceModeToLocalStorage(mode);
  publishPreferences();
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

export const getSidebarGroupExpanded = (
  scope: SidebarGroupScope,
  group: SidebarViewGroupId
): boolean => preferenceCache[sidebarGroupPreferenceKeys[scope][group]];

export const getErrorReportingEnabled = (): boolean => {
  return preferenceCache.errorReportingEnabled;
};

export const getAutoRefreshEnabled = (): boolean => {
  return preferenceCache.autoRefreshEnabled;
};

export const getBackgroundRefreshEnabled = (): boolean => {
  return preferenceCache.refreshBackgroundClustersEnabled;
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

export const getDefaultTablePageSize = (): TablePageSize => {
  return normalizeTablePageSize(preferenceCache.defaultTablePageSize);
};

export interface ObjectPanelLayoutDefaults {
  dockedRightWidth: number;
  dockedBottomHeight: number;
  floatingWidth: number;
  floatingHeight: number;
}

export const getObjectPanelLayoutDefaults = (): ObjectPanelLayoutDefaults => ({
  dockedRightWidth: preferenceCache.objectPanelDockedRightWidth,
  dockedBottomHeight: preferenceCache.objectPanelDockedBottomHeight,
  floatingWidth: preferenceCache.objectPanelFloatingWidth,
  floatingHeight: preferenceCache.objectPanelFloatingHeight,
});

// Returns palette tint values for the specified resolved appearance mode.
export const getPaletteTint = (mode: 'light' | 'dark') =>
  selectPaletteValues(preferenceCache, mode);

// Returns the custom accent color hex for the specified resolved appearance mode (empty = default).
export const getAccentColor = (mode: 'light' | 'dark'): string => {
  return mode === 'light' ? preferenceCache.accentColorLight : preferenceCache.accentColorDark;
};

const buildAccentColorMutation = ({ mode, color }: ColorPreferenceInput): PreferenceMutation => {
  const key = mode === 'light' ? 'accentColorLight' : 'accentColorDark';
  return singlePreferenceMutation(key, color, { persistAppearanceBootstrap: true });
};

export const createAccentColorPreferenceWorkflow = (options?: {
  debounceMs?: number;
}): PreferenceWorkflow<ColorPreferenceInput> =>
  createPreferenceWorkflow({
    label: 'Failed to persist accent color:',
    debounceMs: options?.debounceMs,
    buildMutation: buildAccentColorMutation,
  });

// Persist accent color for a specific resolved appearance mode to backend via fire-and-forget.
export const setAccentColor = (mode: 'light' | 'dark', color: string): void => {
  commitPreferenceMutation(
    'Failed to persist accent color:',
    buildAccentColorMutation({ mode, color })
  );
};

// Returns the custom link color hex for the specified resolved appearance mode (empty = default).
export const getLinkColor = (mode: 'light' | 'dark'): string => {
  return mode === 'light' ? preferenceCache.linkColorLight : preferenceCache.linkColorDark;
};

const buildLinkColorMutation = ({ mode, color }: ColorPreferenceInput): PreferenceMutation => {
  const key = mode === 'light' ? 'linkColorLight' : 'linkColorDark';
  return singlePreferenceMutation(key, color, { persistAppearanceBootstrap: true });
};

export const createLinkColorPreferenceWorkflow = (options?: {
  debounceMs?: number;
}): PreferenceWorkflow<ColorPreferenceInput> =>
  createPreferenceWorkflow({
    label: 'Failed to persist link color:',
    debounceMs: options?.debounceMs,
    buildMutation: buildLinkColorMutation,
  });

// Persist link color for a specific resolved appearance mode to backend via fire-and-forget.
export const setLinkColor = (mode: 'light' | 'dark', color: string): void => {
  commitPreferenceMutation(
    'Failed to persist link color:',
    buildLinkColorMutation({ mode, color })
  );
};

export const setAppearanceModePreference = async (mode: AppearanceMode): Promise<void> => {
  const normalized = normalizeAppearanceMode(mode);
  const mutation = singlePreferenceMutation('appearanceMode', normalized, {
    persistAppearanceMode: normalized,
  });
  await enqueuePreferenceMutation(mutation);
};

export const setUseShortResourceNames = async (useShort: boolean): Promise<void> => {
  const mutation = singlePreferenceMutation('useShortResourceNames', useShort);
  await enqueuePreferenceMutation(mutation);
};

export const setDimInactiveNamespaces = async (enabled: boolean): Promise<void> => {
  const mutation = singlePreferenceMutation('dimInactiveNamespaces', enabled);
  await enqueuePreferenceMutation(mutation);
};

export const setExclusiveNamespaces = async (enabled: boolean): Promise<void> => {
  const mutation = singlePreferenceMutation('exclusiveNamespaces', enabled);
  await enqueuePreferenceMutation(mutation);
};

export const setSidebarGroupExpanded = (
  scope: SidebarGroupScope,
  group: SidebarViewGroupId,
  expanded: boolean
): void => {
  commitPreferenceMutation(
    'Failed to persist sidebar group expansion:',
    singlePreferenceMutation(sidebarGroupPreferenceKeys[scope][group], expanded)
  );
};

export const setErrorReportingEnabled = async (enabled: boolean): Promise<void> => {
  const mutation = singlePreferenceMutation('errorReportingEnabled', enabled);
  await enqueuePreferenceMutation(mutation);
};

export const setAutoRefreshEnabled = (enabled: boolean): void => {
  commitPreferenceMutation(
    'Failed to persist auto-refresh preference:',
    singlePreferenceMutation('autoRefreshEnabled', enabled)
  );
};

export const setBackgroundRefreshEnabled = (enabled: boolean): void => {
  commitPreferenceMutation(
    'Failed to persist background refresh preference:',
    singlePreferenceMutation('refreshBackgroundClustersEnabled', enabled)
  );
};

export const setObjPanelLogsBufferMaxSize = (size: number): void => {
  const normalized = normalizeObjPanelLogsBufferMaxSize(size);
  commitPreferenceMutation(
    'Failed to persist Object Panel Logs Tab buffer max size:',
    singlePreferenceMutation('objPanelLogsBufferMaxSize', normalized)
  );
};

export const setKubernetesClientQPS = (qps: number): void => {
  const normalized = normalizeKubernetesClientQPS(qps);
  commitPreferenceMutation(
    'Failed to persist Kubernetes client QPS:',
    singlePreferenceMutation('kubernetesClientQPS', normalized)
  );
};

export const setKubernetesClientBurst = (burst: number): void => {
  const normalized = normalizeKubernetesClientBurst(burst);
  commitPreferenceMutation(
    'Failed to persist Kubernetes client burst:',
    singlePreferenceMutation('kubernetesClientBurst', normalized)
  );
};

export const setPermissionSSRRFetchConcurrency = (limit: number): void => {
  const normalized = normalizePermissionSSRRFetchConcurrency(limit);
  commitPreferenceMutation(
    'Failed to persist permission SSRR fetch concurrency:',
    singlePreferenceMutation('permissionSSRRFetchConcurrency', normalized)
  );
};

export const setObjPanelLogsApiTimestampFormat = (format: string): void => {
  const validationError = getObjPanelLogsApiTimestampFormatValidationError(format);
  if (validationError) {
    throw new Error(validationError);
  }
  const normalized = format.trim();
  commitPreferenceMutation(
    'Failed to persist Object Panel Logs Tab API timestamp format:',
    singlePreferenceMutation('objPanelLogsApiTimestampFormat', normalized)
  );
};

export const setObjPanelLogsApiTimestampUseLocalTimeZone = (enabled: boolean): void => {
  commitPreferenceMutation(
    'Failed to persist Object Panel Logs Tab API timestamp local timezone setting:',
    singlePreferenceMutation('objPanelLogsApiTimestampUseLocalTimeZone', enabled)
  );
};

export const setObjPanelLogsTargetPerScopeLimit = (limit: number): void => {
  const normalized = normalizeObjPanelLogsTargetPerScopeLimit(limit);
  commitPreferenceMutation(
    'Failed to persist Object Panel Logs Tab target per-scope limit:',
    singlePreferenceMutation('objPanelLogsTargetPerScopeLimit', normalized)
  );
};

export const setObjPanelLogsTargetGlobalLimit = (limit: number): void => {
  const normalized = normalizeObjPanelLogsTargetGlobalLimit(limit);
  commitPreferenceMutation(
    'Failed to persist Object Panel Logs Tab target global limit:',
    singlePreferenceMutation('objPanelLogsTargetGlobalLimit', normalized)
  );
};

export const setGridTablePersistenceMode = (mode: GridTablePersistenceMode): void => {
  const normalized = normalizeGridTableMode(mode);
  commitPreferenceMutation(
    'Failed to persist grid table persistence mode:',
    singlePreferenceMutation('gridTablePersistenceMode', normalized)
  );
};

export const setDefaultTablePageSize = (size: number): void => {
  const normalized = normalizeTablePageSize(size);
  commitPreferenceMutation(
    'Failed to persist default table page size:',
    singlePreferenceMutation('defaultTablePageSize', normalized)
  );
};

export const setDefaultObjectPanelPosition = (position: ObjectPanelPosition): void => {
  const normalized = normalizeObjectPanelPosition(position);
  commitPreferenceMutation(
    'Failed to persist default object panel position:',
    singlePreferenceMutation('defaultObjectPanelPosition', normalized)
  );
};

export const setObjectPanelLayoutDefaults = (layout: ObjectPanelLayoutDefaults): void => {
  const normalized: ObjectPanelLayoutDefaults = {
    dockedRightWidth: normalizeIntegerPreferenceValue(
      'objectPanelDockedRightWidth',
      layout.dockedRightWidth,
      { defaultOnNonPositive: true }
    ),
    dockedBottomHeight: normalizeIntegerPreferenceValue(
      'objectPanelDockedBottomHeight',
      layout.dockedBottomHeight,
      { defaultOnNonPositive: true }
    ),
    floatingWidth: normalizeIntegerPreferenceValue(
      'objectPanelFloatingWidth',
      layout.floatingWidth,
      {
        defaultOnNonPositive: true,
      }
    ),
    floatingHeight: normalizeIntegerPreferenceValue(
      'objectPanelFloatingHeight',
      layout.floatingHeight,
      { defaultOnNonPositive: true }
    ),
  };
  commitPreferenceMutation('Failed to persist object panel layout defaults:', {
    changes: [
      { key: 'objectPanelDockedRightWidth', value: normalized.dockedRightWidth },
      { key: 'objectPanelDockedBottomHeight', value: normalized.dockedBottomHeight },
      { key: 'objectPanelFloatingWidth', value: normalized.floatingWidth },
      { key: 'objectPanelFloatingHeight', value: normalized.floatingHeight },
    ],
  });
};

const buildPaletteTintMutation = ({
  mode,
  hue,
  saturation,
  brightness = 0,
}: PaletteTintPreferenceInput): PreferenceMutation => {
  const keys = palettePreferenceKeys[mode];
  return {
    changes: [
      { key: keys.hue, value: normalizeIntegerPreferenceValue(keys.hue, hue) },
      { key: keys.saturation, value: normalizeIntegerPreferenceValue(keys.saturation, saturation) },
      { key: keys.brightness, value: normalizeIntegerPreferenceValue(keys.brightness, brightness) },
    ],
    options: { persistAppearanceBootstrap: true },
  };
};

export const createPaletteTintPreferenceWorkflow = (options?: {
  debounceMs?: number;
}): PreferenceWorkflow<PaletteTintPreferenceInput> =>
  createPreferenceWorkflow({
    label: 'Failed to persist palette tint:',
    debounceMs: options?.debounceMs,
    buildMutation: buildPaletteTintMutation,
  });

// Persist palette tint for a specific resolved appearance mode to backend via fire-and-forget.
export const setPaletteTint = (
  mode: 'light' | 'dark',
  hue: number,
  saturation: number,
  brightness: number = 0
): void => {
  commitPreferenceMutation(
    'Failed to persist palette tint:',
    buildPaletteTintMutation({ mode, hue, saturation, brightness })
  );
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
  confirmedPreferences = preferenceCache;
  pendingMutations = [];
  hydrationPromise = null;
  preferenceRevision++;
  anonymizedIdCache = '';
  preferenceSchemaByKey = new Map();
  hydrated = false;
};

// Test helper to set preferences directly for testing.
export const setAppPreferencesForTesting = (prefs: Partial<AppPreferences>): void => {
  preferenceCache = { ...preferenceCache, ...prefs };
  confirmedPreferences = preferenceCache;
  hydrated = true;
};
