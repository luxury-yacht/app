/**
 * frontend/src/modules/namespace/components/podsFilterSignals.ts
 *
 * Module source for podsFilterSignals.
 * Handles emitting signals related to filtering unhealthy pods.
 */
import { eventBus } from '@/core/events';

export type PodsFilterMode = 'unhealthy' | 'restarts' | 'not-ready';

export interface PodsFilterRequest {
  scope: string;
  filter: PodsFilterMode;
}

const DEFAULT_PODS_FILTER_MODE: PodsFilterMode = 'unhealthy';

/**
 * Generate a cluster-specific storage key for the pods unhealthy filter.
 * This ensures filter state is isolated per cluster and doesn't leak between cluster tabs.
 */
export const getPodsUnhealthyStorageKey = (clusterId: string) =>
  `pods:unhealthy-filter-scope:${clusterId}`;

const isPodsFilterMode = (value: unknown): value is PodsFilterMode =>
  value === 'unhealthy' || value === 'restarts' || value === 'not-ready';

export const parsePodsFilterRequest = (
  value: string | null | undefined
): PodsFilterRequest | null => {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<PodsFilterRequest>;
    if (typeof parsed.scope === 'string' && isPodsFilterMode(parsed.filter)) {
      return { scope: parsed.scope, filter: parsed.filter };
    }
  } catch {
    return { scope: value, filter: DEFAULT_PODS_FILTER_MODE };
  }

  return null;
};

export const emitPodsUnhealthySignal = (
  clusterId: string,
  scope: string,
  filter: PodsFilterMode = DEFAULT_PODS_FILTER_MODE
) => {
  if (typeof window === 'undefined') {
    return;
  }
  const storageKey = getPodsUnhealthyStorageKey(clusterId);
  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify({ scope, filter }));
  } catch {
    // Ignore sessionStorage failures (for private browsing, etc.)
  }
  eventBus.emit('pods:show-unhealthy', { clusterId, scope, filter });
};
