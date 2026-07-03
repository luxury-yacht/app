/**
 * frontend/src/components/status/MetricsStatus.tsx
 *
 * Metrics status indicator for the app header.
 * Always visible. Maps metrics availability to shared status states.
 * No click action — popover is informational only.
 */

import React from 'react';
import StatusIndicator, { type StatusState } from '@shared/components/status/StatusIndicator';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import { useMetricsBannerInfo } from '@shared/hooks/useMetricsBannerInfo';

const MetricsStatus: React.FC = () => {
  const metricsInfo = useClusterMetricsAvailability();
  // Time-aware: flips to the stale banner at the payload threshold even when
  // no refetch arrives (a dead metrics-server on a quiet cluster).
  const bannerInfo = useMetricsBannerInfo(metricsInfo);

  /** Map metrics state to shared status state. */
  const getStatus = (): StatusState => {
    if (!metricsInfo) return 'inactive';

    // No banner info means metrics are healthy.
    if (!bannerInfo) return 'healthy';

    // Has an error — distinguish degraded (stale/intermittent) vs unhealthy (unavailable).
    if (metricsInfo.lastError) return 'unhealthy';

    return 'degraded';
  };

  /** Generate the popover message. */
  const getMessage = (): string => {
    if (!metricsInfo) return 'Awaiting metrics data...';
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
