/**
 * frontend/src/components/status/MetricsStatus.tsx
 *
 * Metrics status indicator for the app header.
 * Always visible. Maps metrics availability to shared status states.
 * No click action — popover is informational only.
 */

import React from 'react';
import StatusIndicator, { type StatusState } from './StatusIndicator';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import { getMetricsBannerInfo } from '@shared/utils/metricsAvailability';

const MetricsStatus: React.FC = () => {
  const metricsInfo = useClusterMetricsAvailability();

  /** Map metrics state to shared status state. */
  const getStatus = (): StatusState => {
    if (!metricsInfo) return 'inactive';

    const bannerInfo = getMetricsBannerInfo(metricsInfo);

    // No banner info means metrics are healthy.
    if (!bannerInfo) return 'healthy';

    // Has an error — distinguish degraded (stale/intermittent) vs unhealthy (unavailable).
    if (metricsInfo.lastError) return 'unhealthy';
    if (metricsInfo.stale) return 'degraded';

    return 'degraded';
  };

  /** Generate the popover message. */
  const getMessage = (): string => {
    if (!metricsInfo) return 'Awaiting metrics data...';

    const bannerInfo = getMetricsBannerInfo(metricsInfo);
    if (!bannerInfo) return 'Metrics available';

    return bannerInfo.message;
  };

  return (
    <StatusIndicator
      status={getStatus()}
      title="Metrics"
      message={getMessage()}
      ariaLabel={`Metrics: ${getMessage()}`}
    />
  );
};

export default React.memo(MetricsStatus);
