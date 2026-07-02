/**
 * frontend/src/core/refresh/hooks/useMetricsInterval.ts
 *
 * Keeps metrics refresh cadence aligned with persisted preferences.
 */

import { eventBus } from '@/core/events';
import { getMetricsRefreshIntervalMs } from '@/core/settings/appPreferences';
import { refreshManager } from '../RefreshManager';
import { METRICS_INTERVAL_REFRESHERS } from '../domainRegistry';
import type { RefresherName } from '../refresherTypes';

// Contract-derived: every refresher whose domain declares the metric source
// clock (the base table domains that join usage at serve) follows the user's
// metrics-interval preference.
const METRICS_REFRESHERS: RefresherName[] = Array.from(METRICS_INTERVAL_REFRESHERS);

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
