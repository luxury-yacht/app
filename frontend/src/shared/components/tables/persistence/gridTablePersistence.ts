/**
 * frontend/src/shared/components/tables/persistence/gridTablePersistence.ts
 *
 * UI component for gridTablePersistence.
 * Handles rendering and interactions for the shared components.
 */

import type {
  ColumnWidthState,
  GridColumnDefinition,
  GridTableFilterState,
} from '@shared/components/tables/GridTable.types';

export interface GridTablePersistedState {
  version: 1;
  columnVisibility?: Record<string, boolean>;
  columnWidths?: Record<string, ColumnWidthState>;
  sort?: { key: string; direction: 'asc' | 'desc' | null };
  filters?: GridTableFilterState;
}

export interface GridTablePersistenceKeyParts {
  clusterHash: string;
  viewId: string;
  namespace?: string | null;
}

export interface GridTableFilterPersistenceOptions {
  kinds?: string[];
  namespaces?: string[];
  isNamespaceScoped?: boolean;
}

export interface GridTablePruneContext<T> {
  columns: GridColumnDefinition<T>[];
  rows?: T[];
  keyExtractor?: (item: T, index: number) => string;
  filterOptions?: GridTableFilterPersistenceOptions;
}

export interface GridTableSaveContext<T> extends GridTablePruneContext<T> {
  columnVisibility?: Record<string, boolean> | null;
  columnWidths?: Record<string, ColumnWidthState> | null;
  sort?: { key: string; direction: 'asc' | 'desc' | null } | null;
  filters?: GridTableFilterState | null;
}

const STORAGE_PREFIX = 'gridtable';
const STORAGE_VERSION = 1;
const LOCKED_COLUMNS = new Set(['kind', 'type', 'name', 'age']);

const normalizeNamespaceKey = (namespace?: string | null): string | null => {
  if (namespace == null) {
    return null;
  }
  const trimmed = namespace.trim();
  return trimmed.length === 0 ? null : trimmed;
};

const encodeKeySegment = (value: string): string => encodeURIComponent(value);

export const buildGridTableStorageKey = (parts: GridTablePersistenceKeyParts): string | null => {
  const namespaceKey = normalizeNamespaceKey(parts.namespace);
  const clusterHash = parts.clusterHash?.trim();
  const viewId = parts.viewId?.trim();
  if (!clusterHash || !viewId) {
    return null;
  }
  const namespaceSegment = namespaceKey ? `:${encodeKeySegment(namespaceKey)}` : '';
  return `${STORAGE_PREFIX}:v${STORAGE_VERSION}:${clusterHash}:${encodeKeySegment(viewId)}${namespaceSegment}`;
};

const toHexString = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

const fallbackHash = (input: string): string => {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);

  const result = (
    (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
  ).slice(0, 12);
  return result;
};

export const computeClusterHash = async (clusterIdentity: string): Promise<string> => {
  const normalized = clusterIdentity?.trim() ?? '';
  if (!normalized) {
    return '';
  }

  if (typeof crypto !== 'undefined' && crypto.subtle && typeof TextEncoder !== 'undefined') {
    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(normalized);
      const digest = await crypto.subtle.digest('SHA-256', data);
      return toHexString(digest).slice(0, 12);
    } catch {
      // fall back to deterministic hash
    }
  }

  return fallbackHash(normalized);
};

const getStorage = (): Storage | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage ?? null;
  } catch {
    return null;
  }
};

export const loadPersistedState = (key: string | null): GridTablePersistedState | null => {
  if (!key) {
    return null;
  }
  const storage = getStorage();
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw);
    if (parsed && parsed.version === STORAGE_VERSION) {
      return parsed as GridTablePersistedState;
    }
  } catch {
    return null;
  }
  return null;
};

export const savePersistedState = (
  key: string | null,
  state: GridTablePersistedState | null
): void => {
  if (!key || !state) {
    return;
  }
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(key, JSON.stringify(state));
  } catch {
    // ignore storage failures
  }
};

export const clearPersistedState = (key: string | null): void => {
  if (!key) {
    return;
  }
  const storage = getStorage();
  if (!storage) {
    return;
  }
  try {
    storage.removeItem(key);
  } catch {
    // ignore storage failures
  }
};

const normalizeFilterArray = (values?: string[]): string[] => {
  if (!Array.isArray(values) || values.length === 0) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  values.forEach((value) => {
    if (typeof value !== 'string') {
      return;
    }
    const trimmed = value.trim();
    const normalized = trimmed.toLowerCase();
    if (!trimmed) {
      return;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(trimmed);
    }
  });
  return result;
};

const intersectsAllowed = (values: string[], allowed?: string[]): string[] => {
  if (!allowed || allowed.length === 0) {
    return values;
  }
  const allowedSet = new Set(allowed.map((value) => value.toLowerCase()));
  return values.filter((value) => allowedSet.has(value.toLowerCase()));
};

export const prunePersistedState = <T>(
  persisted: GridTablePersistedState | null | undefined,
  context: GridTablePruneContext<T>
): GridTablePersistedState | null => {
  if (!persisted || persisted.version !== STORAGE_VERSION) {
    return null;
  }

  const pruned: GridTablePersistedState = { version: STORAGE_VERSION };
  const columnMap = new Map<string, GridColumnDefinition<T>>();
  context.columns.forEach((column) => columnMap.set(column.key, column));

  if (persisted.columnVisibility) {
    const visibility: Record<string, boolean> = {};
    Object.entries(persisted.columnVisibility).forEach(([key, value]) => {
      if (LOCKED_COLUMNS.has(key)) {
        return;
      }
      if (columnMap.has(key) && typeof value === 'boolean') {
        visibility[key] = value;
      }
    });
    if (Object.keys(visibility).length > 0) {
      pruned.columnVisibility = visibility;
    }
  }

  if (persisted.columnWidths) {
    const widths: Record<string, ColumnWidthState> = {};
    Object.entries(persisted.columnWidths).forEach(([key, value]) => {
      if (!columnMap.has(key)) {
        return;
      }
      if (value && typeof value.width === 'number' && Number.isFinite(value.width)) {
        widths[key] = value;
      }
    });
    if (Object.keys(widths).length > 0) {
      pruned.columnWidths = widths;
    }
  }

  if (persisted.sort && persisted.sort.key) {
    const column = columnMap.get(persisted.sort.key);
    if (column && column.sortable) {
      pruned.sort = {
        key: persisted.sort.key,
        direction: persisted.sort.direction ?? null,
      };
    }
  }

  if (persisted.filters) {
    const isNamespaceScoped = context.filterOptions?.isNamespaceScoped ?? false;
    const normalizedSearch = persisted.filters.search?.trim() ?? '';
    const normalizedKinds = normalizeFilterArray(persisted.filters.kinds);
    const normalizedNamespaces = normalizeFilterArray(persisted.filters.namespaces);

    const kinds = intersectsAllowed(normalizedKinds, context.filterOptions?.kinds);
    const namespaces = isNamespaceScoped
      ? []
      : intersectsAllowed(normalizedNamespaces, context.filterOptions?.namespaces);

    const filters: GridTableFilterState = {
      search: normalizedSearch,
      kinds,
      namespaces,
    };

    if (filters.search !== '' || filters.kinds.length > 0 || filters.namespaces.length > 0) {
      pruned.filters = filters;
    }
  }

  if (!pruned.columnVisibility && !pruned.columnWidths && !pruned.sort && !pruned.filters) {
    return null;
  }

  return pruned;
};

export const buildPersistedStateForSave = <T>(
  context: GridTableSaveContext<T>
): GridTablePersistedState | null => {
  const state: GridTablePersistedState = { version: STORAGE_VERSION };
  const columnKeys = new Set(context.columns.map((column) => column.key));

  if (context.columnVisibility) {
    const visibility: Record<string, boolean> = {};
    Object.entries(context.columnVisibility).forEach(([key, value]) => {
      if (LOCKED_COLUMNS.has(key)) {
        return;
      }
      if (columnKeys.has(key) && typeof value === 'boolean') {
        visibility[key] = value;
      }
    });
    if (Object.keys(visibility).length > 0) {
      state.columnVisibility = visibility;
    }
  }

  if (context.columnWidths) {
    const widths: Record<string, ColumnWidthState> = {};
    Object.entries(context.columnWidths).forEach(([key, value]) => {
      if (!columnKeys.has(key)) {
        return;
      }
      if (value && typeof value.width === 'number' && Number.isFinite(value.width)) {
        widths[key] = value;
      }
    });
    if (Object.keys(widths).length > 0) {
      state.columnWidths = widths;
    }
  }

  if (context.sort && context.sort.key && columnKeys.has(context.sort.key)) {
    const sortable = context.columns.find(
      (column) => column.key === context.sort!.key && column.sortable
    );
    if (sortable) {
      state.sort = {
        key: context.sort.key,
        direction: context.sort.direction ?? null,
      };
    }
  }

  if (context.filters) {
    const isNamespaceScoped = context.filterOptions?.isNamespaceScoped ?? false;
    const filters: GridTableFilterState = {
      search: context.filters.search?.trim() ?? '',
      kinds: normalizeFilterArray(context.filters.kinds),
      namespaces: isNamespaceScoped ? [] : normalizeFilterArray(context.filters.namespaces),
    };
    if (filters.search || filters.kinds.length > 0 || filters.namespaces.length > 0) {
      state.filters = filters;
    }
  }

  if (!state.columnVisibility && !state.columnWidths && !state.sort && !state.filters) {
    return null;
  }

  return state;
};
