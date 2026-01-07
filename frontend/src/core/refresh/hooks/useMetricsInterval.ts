/**
 * frontend/src/core/refresh/hooks/useMetricsInterval.ts
 *
 * Keeps metrics refresh cadence aligned with persisted preferences.
 */

import { eventBus } from '@/core/events';
import { getMetricsRefreshIntervalMs } from '@/core/settings/appPreferences';
import { refreshManager } from '../RefreshManager';
import {
  CLUSTER_REFRESHERS,
  NAMESPACE_REFRESHERS,
  SYSTEM_REFRESHERS,
  type RefresherName,
} from '../refresherTypes';

const METRICS_REFRESHERS: RefresherName[] = [
  NAMESPACE_REFRESHERS.workloads,
  CLUSTER_REFRESHERS.nodes,
  SYSTEM_REFRESHERS.unifiedPods,
];

let metricsIntervalInitialized = false;

const applyMetricsInterval = (intervalMs: number): void => {
  const normalized = Number.isFinite(intervalMs) && intervalMs > 0 ? Math.floor(intervalMs) : 0;
  const resolved = normalized > 0 ? normalized : getMetricsRefreshIntervalMs();
  METRICS_REFRESHERS.forEach((refresher) => {
    refreshManager.updateInterval(refresher, resolved);
  });
};

// Apply the stored interval and keep refreshers in sync with future changes.
export const initializeMetricsRefreshInterval = (): void => {
  if (metricsIntervalInitialized) {
    return;
  }
  metricsIntervalInitialized = true;
  applyMetricsInterval(getMetricsRefreshIntervalMs());
  eventBus.on('settings:metrics-interval', (intervalMs) => {
    applyMetricsInterval(intervalMs);
  });
};
