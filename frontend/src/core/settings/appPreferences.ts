/**
 * frontend/src/core/settings/appPreferences.ts
 *
 * Centralized preference cache and backend sync for app settings.
 */

import type { types } from '@core/backend-api/models';
import { readAppSettings, readThemes, requestAppState } from '@/core/app-state-access';
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
import type { SidebarViewGroupId, ViewScope } from '@/core/navigation/viewRegistry';
import { captureBootstrapError } from '@/core/telemetry/sentry';
import {
  APPEARANCE_BOOTSTRAP_STORAGE_KEY,
  buildAppearanceBootstrapPayload,
} from '@/utils/appearanceBootstrap';
import { reportOperationalError } from '@/utils/errorHandler';
import {
  getObjPanelLogsApiTimestampFormatValidationError,
  normalizeObjPanelLogsApiTimestampFormat,
} from '@/utils/objPanelLogsApiTimestampFormat';
import {
  APP_PREFERENCE_KEYS,
  APP_PREFERENCE_SPECS,
  type AppPreferenceKey,
  type AppPreferenceSpec,
  type AppPreferences,
  type AppPreferenceValidation,
  HEX_COLOR_PATTERN,
} from './appPreferences.generated';

export type { AppPreferenceKey, AppPreferences } from './appPreferences.generated';

export type AppearanceMode = AppPreferences['appearanceMode'];
export type GridTablePersistenceMode = AppPreferences['gridTablePersistenceMode'];
export type ObjectPanelPosition = AppPreferences['defaultObjectPanelPosition'];
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

export interface HydratedAppPreferences extends AppPreferences {
  anonymizedId: string;
}

/** A preference's spec from the backend schema (backend/internal/preferenceschema). */
export type AppPreferenceMetadata<K extends AppPreferenceKey = AppPreferenceKey> =
  AppPreferenceSpec<K>;

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

// Every default comes from the backend schema through the generated contract.
const DEFAULT_PREFERENCES = Object.fromEntries(
  APP_PREFERENCE_KEYS.map((key) => [key, APP_PREFERENCE_SPECS[key].defaultValue])
) as unknown as AppPreferences;

let preferenceCache: AppPreferences = { ...DEFAULT_PREFERENCES };
let anonymizedIdCache = '';
let hydrated = false;
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

// A preference's spec from the backend schema; Settings reads defaults, bounds,
// and options only through it.
export const getPreferenceMetadata = <K extends AppPreferenceKey>(
  key: K
): AppPreferenceMetadata<K> => APP_PREFERENCE_SPECS[key] as AppPreferenceMetadata<K>;

export const getIntegerPreferenceMetadata = (
  key: AppPreferenceKey
): AppPreferenceMetadata & { min: number; max?: number; defaultValue: number } => {
  const metadata = getPreferenceMetadata(key);
  if (metadata.type !== 'integer') {
    throw new Error(`Preference ${key} is not an integer setting`);
  }
  return {
    ...metadata,
    defaultValue: Number(metadata.defaultValue),
    min: metadata.min ?? Number.NEGATIVE_INFINITY,
  };
};

const hexColorRe = new RegExp(HEX_COLOR_PATTERN);

export const isHexColor = (value: string): boolean => hexColorRe.test(value);

// Integers follow the backend's Validate/Repair order: an option list matches
// exactly; otherwise the non-positive rule tests the raw number, then the value
// truncates toward zero and clamps.
const repairInteger = (spec: AppPreferenceSpec, raw: unknown): number => {
  const fallback = Number(spec.defaultValue);
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return fallback;
  }
  if (spec.intOptions) {
    return spec.intOptions.includes(raw) ? raw : fallback;
  }
  if (raw <= 0 && spec.nonPositive === 'default') {
    return fallback;
  }
  // `|| 0` turns Math.trunc's -0 into the 0 Go's int conversion gives.
  const whole = Math.trunc(raw) || 0;
  if (spec.min !== undefined && whole < spec.min) {
    return spec.min;
  }
  if (spec.max !== undefined && whole > spec.max) {
    return spec.max;
  }
  return whole;
};

// Each validation kind's check. The color pattern is the backend's exactly; the
// Day.js format check is the frontend's stricter one (the backend keeps any
// non-empty format, so the parity vectors leave those cases out).
const repairByValidation: Record<
  AppPreferenceValidation,
  (value: string, fallback: string) => string
> = {
  '#rrggbb-or-empty': (value, fallback) => (value === '' || isHexColor(value) ? value : fallback),
  'dayjs-format': (value) => normalizeObjPanelLogsApiTimestampFormat(value),
};

const repairString = (spec: AppPreferenceSpec, raw: unknown): string => {
  const fallback = String(spec.defaultValue);
  if (typeof raw !== 'string') {
    return fallback;
  }
  if (spec.type === 'enum') {
    return spec.enumOptions?.includes(raw) ? raw : fallback;
  }
  if (spec.type === 'string' && raw === '') {
    return fallback;
  }
  return spec.validation ? repairByValidation[spec.validation](raw, fallback) : raw;
};

// Settles a raw value the way the backend schema's Repair rule does
// (appPreferences.parity.test.ts holds the two together).
const repairPreferenceValue = <K extends AppPreferenceKey>(
  key: K,
  raw: unknown
): AppPreferences[K] => {
  const spec: AppPreferenceSpec = APP_PREFERENCE_SPECS[key];
  if (spec.type === 'boolean') {
    return (typeof raw === 'boolean' ? raw : spec.defaultValue) as AppPreferences[K];
  }
  if (spec.type === 'integer') {
    return repairInteger(spec, raw) as AppPreferences[K];
  }
  return repairString(spec, raw) as AppPreferences[K];
};

export const normalizeIntegerPreferenceValue = (key: AppPreferenceKey, value?: number): number =>
  repairInteger(getIntegerPreferenceMetadata(key), value);

export const commitIntegerPreferenceInput = (
  key: AppPreferenceKey,
  raw: string,
  persist: (value: number) => void
): number => {
  const normalized = normalizeIntegerPreferenceValue(key, Number.parseInt(raw, 10));
  persist(normalized);
  return normalized;
};

export const isAppearanceMode = (value: string): value is AppearanceMode =>
  (APP_PREFERENCE_SPECS.appearanceMode.enumOptions as readonly string[]).includes(value);

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

type PreferenceListener<K extends AppPreferenceKey> = (value: AppPreferences[K]) => void;

// A wrapper per call keeps two subscriptions of the same function independent.
interface PreferenceSubscription {
  listener: PreferenceListener<AppPreferenceKey>;
}

// Subscribers hear about keys in declaration order.
const preferenceKeys: readonly AppPreferenceKey[] = APP_PREFERENCE_KEYS;
const preferenceSubscriptions = new Map<AppPreferenceKey, Set<PreferenceSubscription>>();

const notifySubscribers = <K extends AppPreferenceKey>(
  key: K,
  subscriptions: ReadonlySet<PreferenceSubscription>,
  value: AppPreferences[K]
): void => {
  for (const { listener } of subscriptions) {
    // One failing subscriber must not stop the others or the save that published.
    try {
      listener(value);
    } catch (error) {
      reportOperationalError(error, {
        source: 'AppPreferences',
        action: 'notify-preference-subscriber',
        key,
      });
    }
  }
};

const notifyPreferenceChanges = (previous: AppPreferences, next: AppPreferences): void => {
  for (const key of preferenceKeys) {
    const subscriptions = preferenceSubscriptions.get(key);
    if (subscriptions?.size && !Object.is(previous[key], next[key])) {
      notifySubscribers(key, subscriptions, next[key]);
    }
  }
};

// Current value of one preference, including optimistic edits not yet saved.
export const getPreference = <K extends AppPreferenceKey>(key: K): AppPreferences[K] =>
  preferenceCache[key];

// Calls the listener with the new value whenever this preference changes, including
// hydration, optimistic edits, and a failed save's rollback.
export const subscribePreference = <K extends AppPreferenceKey>(
  key: K,
  listener: PreferenceListener<K>
): (() => void) => {
  const subscription: PreferenceSubscription = {
    listener: listener as PreferenceListener<AppPreferenceKey>,
  };
  let subscriptions = preferenceSubscriptions.get(key);
  if (!subscriptions) {
    subscriptions = new Set();
    preferenceSubscriptions.set(key, subscriptions);
  }
  subscriptions.add(subscription);
  return () => {
    subscriptions.delete(subscription);
  };
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
  notifyPreferenceChanges(previous, next);
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
  error?: unknown;
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
    return { value: null, failed: true, error };
  }
};

const fetchPreferenceSnapshot = async () => {
  const snapshot = await fetchPreferences({
    resource: 'app-settings',
    read: readAppSettings,
    action: 'loadAppSettings',
  });
  return { settings: snapshot.value, failed: snapshot.failed, error: snapshot.error };
};

const normalizePreferences = (
  backendSettings: AppSettingsPayload | null,
  settingsReadFailed: boolean
): AppPreferences => {
  const values = backendSettings as Record<string, unknown> | null;
  const preferences = Object.fromEntries(
    APP_PREFERENCE_KEYS.map((key) => [key, repairPreferenceValue(key, values?.[key])])
  ) as unknown as AppPreferences;
  // If the persisted preference cannot be read, reporting must fail closed:
  // sending the hydration error would otherwise risk overriding a saved opt-out.
  if (settingsReadFailed) {
    preferences.errorReportingEnabled = false;
  }
  return preferences;
};

// Waits until no preference change is being saved, including changes queued
// while waiting.
const settlePendingMutations = async (): Promise<void> => {
  const latest = pendingMutations[pendingMutations.length - 1];
  if (!latest) {
    return;
  }
  await latest.completion.catch(() => undefined);
  return settlePendingMutations();
};

const hydrateLatestPreferences = async (): Promise<HydratedAppPreferences> => {
  await settlePendingMutations();
  const revision = preferenceRevision;
  const snapshot = await fetchPreferenceSnapshot();
  if (revision !== preferenceRevision) {
    // A preference changed while the snapshot was read; read it again.
    return hydrateLatestPreferences();
  }
  if (snapshot.failed && hydrated) {
    // The app already runs on confirmed preferences: keep them rather than
    // replace them with defaults, and let the caller report the failed read.
    throw snapshot.error ?? new Error('The saved settings could not be read.');
  }
  confirmedPreferences = normalizePreferences(snapshot.settings, snapshot.failed);
  anonymizedIdCache = snapshot.settings?.anonymizedId?.trim() ?? '';
  hydrated = true;
  persistAppearanceModeToLocalStorage(confirmedPreferences.appearanceMode);
  confirmedStorage = projectAppearanceStorage(captureLocalStorageSnapshot(), confirmedPreferences, {
    persistAppearanceMode: confirmedPreferences.appearanceMode,
    persistAppearanceBootstrap: true,
  });
  publishPreferences();
  return { ...preferenceCache, anonymizedId: anonymizedIdCache };
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
  hydrationPromise ??= hydrateLatestPreferences().finally(() => {
    hydrationPromise = null;
  });
  return hydrationPromise;
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

// The preference behind one sidebar group's disclosure in one scope.
export const sidebarGroupPreferenceKey = (scope: SidebarGroupScope, group: SidebarViewGroupId) =>
  sidebarGroupPreferenceKeys[scope][group];

export const getSidebarGroupExpanded = (
  scope: SidebarGroupScope,
  group: SidebarViewGroupId
): boolean => getPreference(sidebarGroupPreferenceKey(scope, group));

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
  const normalized = repairPreferenceValue('appearanceMode', mode);
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
    singlePreferenceMutation(sidebarGroupPreferenceKey(scope, group), expanded)
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

export const setObjPanelLogsBufferMaxSize = (size: number): void => {
  const normalized = repairPreferenceValue('objPanelLogsBufferMaxSize', size);
  commitPreferenceMutation(
    'Failed to persist Object Panel Logs Tab buffer max size:',
    singlePreferenceMutation('objPanelLogsBufferMaxSize', normalized)
  );
};

export const setKubernetesClientQPS = (qps: number): void => {
  const normalized = repairPreferenceValue('kubernetesClientQPS', qps);
  commitPreferenceMutation(
    'Failed to persist Kubernetes client QPS:',
    singlePreferenceMutation('kubernetesClientQPS', normalized)
  );
};

export const setKubernetesClientBurst = (burst: number): void => {
  const normalized = repairPreferenceValue('kubernetesClientBurst', burst);
  commitPreferenceMutation(
    'Failed to persist Kubernetes client burst:',
    singlePreferenceMutation('kubernetesClientBurst', normalized)
  );
};

export const setPermissionSSRRFetchConcurrency = (limit: number): void => {
  const normalized = repairPreferenceValue('permissionSSRRFetchConcurrency', limit);
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
  const normalized = repairPreferenceValue('objPanelLogsTargetPerScopeLimit', limit);
  commitPreferenceMutation(
    'Failed to persist Object Panel Logs Tab target per-scope limit:',
    singlePreferenceMutation('objPanelLogsTargetPerScopeLimit', normalized)
  );
};

export const setObjPanelLogsTargetGlobalLimit = (limit: number): void => {
  const normalized = repairPreferenceValue('objPanelLogsTargetGlobalLimit', limit);
  commitPreferenceMutation(
    'Failed to persist Object Panel Logs Tab target global limit:',
    singlePreferenceMutation('objPanelLogsTargetGlobalLimit', normalized)
  );
};

export const setGridTablePersistenceMode = (mode: GridTablePersistenceMode): void => {
  const normalized = repairPreferenceValue('gridTablePersistenceMode', mode);
  commitPreferenceMutation(
    'Failed to persist grid table persistence mode:',
    singlePreferenceMutation('gridTablePersistenceMode', normalized)
  );
};

export const setDefaultTablePageSize = (size: number): void => {
  const normalized = repairPreferenceValue('defaultTablePageSize', size);
  commitPreferenceMutation(
    'Failed to persist default table page size:',
    singlePreferenceMutation('defaultTablePageSize', normalized)
  );
};

export const setDefaultObjectPanelPosition = (position: ObjectPanelPosition): void => {
  const normalized = repairPreferenceValue('defaultObjectPanelPosition', position);
  commitPreferenceMutation(
    'Failed to persist default object panel position:',
    singlePreferenceMutation('defaultObjectPanelPosition', normalized)
  );
};

export const setObjectPanelLayoutDefaults = (layout: ObjectPanelLayoutDefaults): void => {
  const normalized: ObjectPanelLayoutDefaults = {
    dockedRightWidth: repairPreferenceValue('objectPanelDockedRightWidth', layout.dockedRightWidth),
    dockedBottomHeight: repairPreferenceValue(
      'objectPanelDockedBottomHeight',
      layout.dockedBottomHeight
    ),
    floatingWidth: repairPreferenceValue('objectPanelFloatingWidth', layout.floatingWidth),
    floatingHeight: repairPreferenceValue('objectPanelFloatingHeight', layout.floatingHeight),
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
      { key: keys.hue, value: repairPreferenceValue(keys.hue, hue) },
      { key: keys.saturation, value: repairPreferenceValue(keys.saturation, saturation) },
      { key: keys.brightness, value: repairPreferenceValue(keys.brightness, brightness) },
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

export const validateThemeClusterPattern = (
  pattern: string
): Promise<types.ThemeClusterPatternValidationResult> => ValidateThemeClusterPattern(pattern);

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
  hydrated = false;
};

// Test helper to set confirmed preferences directly; subscribers of changed keys are notified.
export const setAppPreferencesForTesting = (prefs: Partial<AppPreferences>): void => {
  const previous = preferenceCache;
  preferenceCache = { ...preferenceCache, ...prefs };
  confirmedPreferences = preferenceCache;
  hydrated = true;
  notifyPreferenceChanges(previous, preferenceCache);
};
