/**
 * frontend/src/shared/components/tables/persistence/gridTablePersistenceSettings.ts
 *
 * UI component for gridTablePersistenceSettings.
 * Handles rendering and interactions for the shared components.
 */

import { eventBus } from '@/core/events';

export type GridTablePersistenceMode = 'namespaced' | 'shared';

const STORAGE_KEY = 'gridtable:persistenceMode';
const DEFAULT_MODE: GridTablePersistenceMode = 'shared';

export const getGridTablePersistenceMode = (): GridTablePersistenceMode => {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(STORAGE_KEY) : null;
    if (raw === 'shared' || raw === 'namespaced') {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_MODE;
};

export const setGridTablePersistenceMode = (mode: GridTablePersistenceMode): void => {
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, mode);
      eventBus.emit('gridtable:persistence-mode', mode);
    }
  } catch {
    /* ignore */
  }
};

export const subscribeGridTablePersistenceMode = (
  handler: (mode: GridTablePersistenceMode) => void
): (() => void) => {
  return eventBus.on('gridtable:persistence-mode', handler);
};
