/**
 * frontend/src/shared/utils/metricsAvailability.ts
 *
 * Utility helpers for metricsAvailability.
 * Provides shared helper functions for the frontend.
 */

export interface MetricsAvailability {
  stale?: boolean;
  lastError?: string | null;
  collectedAt?: number;
  // Terminal "metrics unavailable" state (metrics API forbidden, or
  // metrics-server absent). When set, lastError holds a permanent, UI-ready
  // reason that must never be treated as a transient pre-first-poll error.
  disabled?: boolean;
  // Staleness threshold (seconds) shipped by the serve-time-join payloads so
  // the banner can flip client-side. Sample-bearing domains ring no doorbell on
  // failure, so nothing refetches their server-computed stale flag. Absent on
  // poll-refreshed payloads (cluster-overview), which keep server-stale-only.
  staleAfterSeconds?: number;
  successCount?: number;
  failureCount?: number;
  consecutiveFailures?: number;
}

export interface MetricsBannerInfo {
  message: string;
  tooltip: string;
}

// metricsStaleDeadlineMs is the wall-clock instant (ms) the payload's sample
// becomes stale, or null when the payload carries no client-evaluable
// threshold. useMetricsBannerInfo schedules its one boundary re-render on it.
export const metricsStaleDeadlineMs = (metrics?: MetricsAvailability | null): number | null => {
  if (!metrics?.collectedAt || !metrics.staleAfterSeconds) {
    return null;
  }
  return (metrics.collectedAt + metrics.staleAfterSeconds) * 1000;
};

const isStaleAt = (metrics: MetricsAvailability, nowMs: number): boolean => {
  if (metrics.stale) {
    return true;
  }
  const deadline = metricsStaleDeadlineMs(metrics);
  return deadline !== null && nowMs >= deadline;
};

const PERMISSION_KEYWORDS = ['forbidden', 'permission', 'unauthorized', 'access denied', 'rbac'];
const NOT_FOUND_KEYWORDS = [
  'metrics api unavailable',
  'metrics polling disabled',
  'no metrics api',
];

export const getMetricsBannerInfo = (
  metrics?: MetricsAvailability | null,
  nowMs: number = Date.now()
): MetricsBannerInfo | null => {
  if (!metrics) {
    return null;
  }

  // A permanently disabled poller (metrics API forbidden, or metrics-server
  // absent) carries a terminal, UI-ready reason in lastError. Surface it
  // directly — this is not a transient "collecting" state and must never fall
  // through to the pristine/awaiting branches below.
  if (metrics.disabled) {
    const reason = metrics.lastError?.trim();
    return {
      message: reason || 'Metrics unavailable',
      tooltip: reason || 'Metrics collection is unavailable for this cluster.',
    };
  }

  const successCount = metrics.successCount ?? 0;
  const failureCount = metrics.failureCount ?? 0;
  const consecutiveFailures = metrics.consecutiveFailures ?? failureCount;

  // Pristine first-collection window: the demand-driven poller has started
  // (a metric-bearing view is open) but no collection has completed and none
  // has failed. The cluster is healthy — we simply have not collected yet.
  // Distinct from the stale/awaiting states so a blank utilization card next
  // to a "Ready" status reads as collection-in-progress, not as a problem.
  // collectedAt <= 0 counts as absent: older backends serialized Go's zero
  // time as -62135596800 instead of omitting it.
  const hasCollected = typeof metrics.collectedAt === 'number' && metrics.collectedAt > 0;
  if (successCount === 0 && !hasCollected && failureCount === 0 && !metrics.lastError) {
    return {
      message: 'Collecting metrics…',
      tooltip: 'Waiting for the first metrics collection from metrics-server',
    };
  }

  const awaitingInitialMetrics =
    successCount === 0 && !metrics.collectedAt && failureCount > 0 && consecutiveFailures < 5;

  if (awaitingInitialMetrics) {
    return {
      message: 'Awaiting metrics data...',
      tooltip: 'Awaiting data from metrics-server',
    };
  }

  const rawError = metrics.lastError?.trim();
  if (rawError) {
    const normalized = rawError.toLowerCase();
    if (NOT_FOUND_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      return {
        message: 'Metrics API not found! metrics-server may not be installed in the cluster.',
        tooltip: rawError,
      };
    }
    if (PERMISSION_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
      return {
        message: 'Insufficient permissions for Metrics API',
        tooltip: rawError,
      };
    }
    return {
      message: 'Metrics API error',
      tooltip: rawError,
    };
  }

  if (isStaleAt(metrics, nowMs)) {
    return {
      message: 'Awaiting metrics data...',
      tooltip: 'Awaiting data from metrics-server',
    };
  }

  return null;
};
