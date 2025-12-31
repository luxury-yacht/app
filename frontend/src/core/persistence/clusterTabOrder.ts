/**
 * frontend/src/core/persistence/clusterTabOrder.ts
 *
 * Persistence helpers for cluster tab ordering backed by the backend store.
 */

import { eventBus } from '@/core/events';

let cachedOrder: string[] = [];
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;

const getRuntimeApp = () => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as any)?.go?.backend?.App;
};

const normalizeOrder = (order: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];
  order.forEach((entry) => {
    if (typeof entry !== 'string') {
      return;
    }
    const trimmed = entry.trim();
    if (!trimmed || seen.has(trimmed)) {
      return;
    }
    seen.add(trimmed);
    normalized.push(trimmed);
  });
  return normalized;
};

const updateOrderCache = (order: string[]) => {
  cachedOrder = normalizeOrder(order);
  eventBus.emit('cluster-tabs:order', cachedOrder);
};

const persistClusterTabOrder = async (order: string[]) => {
  const runtimeApp = getRuntimeApp();
  if (!runtimeApp || typeof runtimeApp.SetClusterTabOrder !== 'function') {
    return;
  }
  await runtimeApp.SetClusterTabOrder(order);
};

export const hydrateClusterTabOrder = async (options?: { force?: boolean }): Promise<string[]> => {
  if (hydrated && !options?.force) {
    return cachedOrder;
  }
  if (hydrationPromise && !options?.force) {
    await hydrationPromise;
    return cachedOrder;
  }

  hydrationPromise = (async () => {
    const runtimeApp = getRuntimeApp();
    if (!runtimeApp || typeof runtimeApp.GetClusterTabOrder !== 'function') {
      hydrated = true;
      return;
    }
    try {
      const order = await runtimeApp.GetClusterTabOrder();
      updateOrderCache(Array.isArray(order) ? order : []);
    } catch (error) {
      console.error('Failed to hydrate cluster tab order:', error);
    } finally {
      hydrated = true;
    }
  })();

  try {
    await hydrationPromise;
  } finally {
    hydrationPromise = null;
  }

  return cachedOrder;
};

export const getClusterTabOrder = (): string[] => cachedOrder;

export const setClusterTabOrder = (order: string[]): void => {
  updateOrderCache(order);
  hydrated = true;
  void persistClusterTabOrder(cachedOrder).catch((error) => {
    console.error('Failed to persist cluster tab order:', error);
  });
};

export const subscribeClusterTabOrder = (handler: (order: string[]) => void): (() => void) => {
  return eventBus.on('cluster-tabs:order', handler);
};

// Test helper to clear cached state between runs.
export const resetClusterTabOrderCacheForTesting = (): void => {
  cachedOrder = [];
  hydrated = false;
  hydrationPromise = null;
};
