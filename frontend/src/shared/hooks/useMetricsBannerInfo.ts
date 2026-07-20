/**
 * frontend/src/shared/hooks/useMetricsBannerInfo.ts
 *
 * Time-aware metrics banner: recomputes getMetricsBannerInfo when the payload
 * changes AND once at the payload's stale boundary. The boundary re-render is
 * what makes staleness visible without a refetch — sample-bearing domains ring
 * no doorbell on failure, so on a quiet cluster a dead metrics-server would
 * otherwise leave the last payload's stale:false on screen forever. One
 * setTimeout per mounted consumer; no polling (live-age contract).
 */

import {
  getMetricsBannerInfo,
  type MetricsAvailability,
  type MetricsBannerInfo,
  metricsStaleDeadlineMs,
} from '@shared/utils/metricsAvailability';
import { useEffect, useState } from 'react';

// Fire just past the boundary so the recompute's Date.now() is unambiguously
// at-or-after the deadline.
const STALE_BOUNDARY_SLACK_MS = 250;

export const useMetricsBannerInfo = (
  metrics?: MetricsAvailability | null
): MetricsBannerInfo | null => {
  const [banner, setBanner] = useState<MetricsBannerInfo | null>(() =>
    getMetricsBannerInfo(metrics)
  );

  useEffect(() => {
    setBanner(getMetricsBannerInfo(metrics));
    const deadline = metricsStaleDeadlineMs(metrics);
    if (deadline === null) {
      return undefined;
    }
    const delay = deadline + STALE_BOUNDARY_SLACK_MS - Date.now();
    if (delay <= 0) {
      // Already past the boundary: the compute above saw it.
      return undefined;
    }
    const timer = setTimeout(() => {
      setBanner(getMetricsBannerInfo(metrics));
    }, delay);
    return () => clearTimeout(timer);
  }, [metrics]);

  return banner;
};
