/**
 * frontend/src/core/settings/legacyMigration.ts
 *
 * Migrates legacy localStorage settings into the backend store.
 */

type LegacyLocalStoragePayload = {
  theme?: string;
  useShortResourceNames?: boolean;
  autoRefreshEnabled?: boolean;
  refreshBackgroundClustersEnabled?: boolean;
  gridTablePersistenceMode?: string;
  clusterTabsOrder?: string[];
  gridTableEntries?: Record<string, unknown>;
};

const LEGACY_KEYS = {
  theme: 'app-theme-preference',
  shortNames: 'useShortResourceNames',
  autoRefresh: 'autoRefreshEnabled',
  backgroundRefresh: 'refreshBackgroundClustersEnabled',
  gridTablePersistence: 'gridtable:persistenceMode',
  clusterTabsOrder: 'clusterTabs:order',
};

const GRIDTABLE_PREFIX = 'gridtable:v1:';

const getLocalStorageValue = (key: string): string | null => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};

const parseLegacyBoolean = (value: string | null): boolean | undefined => {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return undefined;
};

const parseLegacyTheme = (value: string | null): string | undefined => {
  if (value === 'light' || value === 'dark' || value === 'system') {
    return value;
  }
  return undefined;
};

const parseLegacyGridTableMode = (value: string | null): string | undefined => {
  if (value === 'shared' || value === 'namespaced') {
    return value;
  }
  return undefined;
};

const parseLegacyOrder = (value: string | null): string[] | undefined => {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === 'string');
    }
    if (typeof parsed === 'string') {
      return [parsed];
    }
  } catch {
    return undefined;
  }
  return undefined;
};

const collectGridTableEntries = (): {
  entries: Record<string, unknown>;
  legacyKeys: string[];
} => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { entries: {}, legacyKeys: [] };
  }

  const entries: Record<string, unknown> = {};
  const legacyKeys: string[] = [];

  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (!key || !key.startsWith(GRIDTABLE_PREFIX)) {
      continue;
    }
    legacyKeys.push(key);
    const raw = getLocalStorageValue(key);
    if (!raw) {
      continue;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        entries[key] = parsed;
      }
    } catch {
      // Skip invalid JSON payloads.
    }
  }

  return { entries, legacyKeys };
};

const collectLegacyPayload = (): {
  payload: LegacyLocalStoragePayload;
  keysToClear: string[];
  hasLegacyKeys: boolean;
} => {
  const payload: LegacyLocalStoragePayload = {};
  const keysToClear: string[] = [];

  const themeRaw = getLocalStorageValue(LEGACY_KEYS.theme);
  if (themeRaw !== null) {
    keysToClear.push(LEGACY_KEYS.theme);
    const theme = parseLegacyTheme(themeRaw);
    if (theme) {
      payload.theme = theme;
    }
  }

  const shortNamesRaw = getLocalStorageValue(LEGACY_KEYS.shortNames);
  if (shortNamesRaw !== null) {
    keysToClear.push(LEGACY_KEYS.shortNames);
    const shortNames = parseLegacyBoolean(shortNamesRaw);
    if (shortNames !== undefined) {
      payload.useShortResourceNames = shortNames;
    }
  }

  const autoRefreshRaw = getLocalStorageValue(LEGACY_KEYS.autoRefresh);
  if (autoRefreshRaw !== null) {
    keysToClear.push(LEGACY_KEYS.autoRefresh);
    const autoRefresh = parseLegacyBoolean(autoRefreshRaw);
    if (autoRefresh !== undefined) {
      payload.autoRefreshEnabled = autoRefresh;
    }
  }

  const backgroundRefreshRaw = getLocalStorageValue(LEGACY_KEYS.backgroundRefresh);
  if (backgroundRefreshRaw !== null) {
    keysToClear.push(LEGACY_KEYS.backgroundRefresh);
    const backgroundRefresh = parseLegacyBoolean(backgroundRefreshRaw);
    if (backgroundRefresh !== undefined) {
      payload.refreshBackgroundClustersEnabled = backgroundRefresh;
    }
  }

  const gridTableModeRaw = getLocalStorageValue(LEGACY_KEYS.gridTablePersistence);
  if (gridTableModeRaw !== null) {
    keysToClear.push(LEGACY_KEYS.gridTablePersistence);
    const mode = parseLegacyGridTableMode(gridTableModeRaw);
    if (mode) {
      payload.gridTablePersistenceMode = mode;
    }
  }

  const orderRaw = getLocalStorageValue(LEGACY_KEYS.clusterTabsOrder);
  if (orderRaw !== null) {
    keysToClear.push(LEGACY_KEYS.clusterTabsOrder);
    const order = parseLegacyOrder(orderRaw);
    if (order && order.length > 0) {
      payload.clusterTabsOrder = order;
    }
  }

  const { entries, legacyKeys } = collectGridTableEntries();
  if (legacyKeys.length > 0) {
    keysToClear.push(...legacyKeys);
  }
  if (Object.keys(entries).length > 0) {
    payload.gridTableEntries = entries;
  }

  return {
    payload,
    keysToClear,
    hasLegacyKeys: keysToClear.length > 0,
  };
};

const clearLegacyKeys = (keys: string[]): void => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  keys.forEach((key) => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore storage errors.
    }
  });
};

export const migrateLegacyLocalStorage = async (): Promise<void> => {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp || typeof runtimeApp.MigrateLegacyLocalStorage !== 'function') {
    return;
  }

  const { payload, keysToClear, hasLegacyKeys } = collectLegacyPayload();
  if (!hasLegacyKeys) {
    return;
  }

  try {
    await runtimeApp.MigrateLegacyLocalStorage(payload);
    clearLegacyKeys(keysToClear);
  } catch (error) {
    console.error('Failed to migrate legacy localStorage:', error);
  }
};
