/**
 * frontend/src/shared/components/tables/persistence/gridTablePersistenceReset.ts
 *
 * UI component for gridTablePersistenceReset.
 * Handles rendering and interactions for the shared components.
 */

import { clearAllPersistedStates } from '@shared/components/tables/persistence/gridTablePersistence';

type ResetListener = () => void;
const resetListeners = new Set<ResetListener>();

const notifyResetAll = () => {
  resetListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* ignore */
    }
  });
};

export const clearAllGridTableState = async (): Promise<number> => {
  const removed = await clearAllPersistedStates();
  notifyResetAll();
  return removed;
};

export const subscribeGridTableResetAll = (listener: ResetListener): (() => void) => {
  resetListeners.add(listener);
  return () => {
    resetListeners.delete(listener);
  };
};
