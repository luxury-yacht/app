/**
 * frontend/src/modules/namespace/components/podsFilterSignals.ts
 *
 * Module source for podsFilterSignals.
 * Handles emitting signals related to filtering unhealthy pods.
 */
import { eventBus } from '@/core/events';

/**
 * Generate a cluster-specific storage key for the pods unhealthy filter.
 * This ensures filter state is isolated per cluster and doesn't leak between cluster tabs.
 */
export const getPodsUnhealthyStorageKey = (clusterId: string) =>
  `pods:unhealthy-filter-scope:${clusterId}`;

export const emitPodsUnhealthySignal = (clusterId: string, scope: string) => {
  if (typeof window === 'undefined') {
    return;
  }
  const storageKey = getPodsUnhealthyStorageKey(clusterId);
  try {
    window.sessionStorage.setItem(storageKey, scope);
  } catch {
    // Ignore sessionStorage failures (for private browsing, etc.)
  }
  eventBus.emit('pods:show-unhealthy', { clusterId, scope });
};
