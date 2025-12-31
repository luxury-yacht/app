/**
 * frontend/src/shared/components/tables/persistence/gridTablePersistenceSettings.ts
 *
 * UI component for gridTablePersistenceSettings.
 * Handles rendering and interactions for the shared components.
 */

import { eventBus } from '@/core/events';
import {
  getGridTablePersistenceMode as getCachedGridTablePersistenceMode,
  setGridTablePersistenceMode as updateGridTablePersistenceMode,
  type GridTablePersistenceMode,
} from '@/core/settings/appPreferences';

export type { GridTablePersistenceMode };

export const getGridTablePersistenceMode = (): GridTablePersistenceMode => {
  return getCachedGridTablePersistenceMode();
};

export const setGridTablePersistenceMode = (mode: GridTablePersistenceMode): void => {
  updateGridTablePersistenceMode(mode);
};

export const subscribeGridTablePersistenceMode = (
  handler: (mode: GridTablePersistenceMode) => void
): (() => void) => {
  return eventBus.on('gridtable:persistence-mode', handler);
};
