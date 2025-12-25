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
  successCount?: number;
  failureCount?: number;
  consecutiveFailures?: number;
}

export interface MetricsBannerInfo {
  message: string;
  tooltip: string;
}

const PERMISSION_KEYWORDS = ['forbidden', 'permission', 'unauthorized', 'access denied', 'rbac'];
const NOT_FOUND_KEYWORDS = [
  'metrics api unavailable',
  'metrics polling disabled',
  'no metrics api',
];

export const getMetricsBannerInfo = (
  metrics?: MetricsAvailability | null
): MetricsBannerInfo | null => {
  if (!metrics) {
    return null;
  }

  const successCount = metrics.successCount ?? 0;
  const failureCount = metrics.failureCount ?? 0;
  const consecutiveFailures = metrics.consecutiveFailures ?? failureCount;
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

  if (metrics.stale) {
    return {
      message: 'Awaiting metrics data...',
      tooltip: 'Awaiting data from metrics-server',
    };
  }

  return null;
};
