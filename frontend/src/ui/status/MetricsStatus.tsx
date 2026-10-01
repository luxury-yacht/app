/**
 * frontend/src/components/status/MetricsStatus.tsx
 *
 * Metrics status indicator for the app header.
 * Always visible. Maps metrics availability to shared status states.
 * No click action — popover is informational only.
 */

import StatusIndicator, { type StatusState } from '@shared/components/status/StatusIndicator';
import { useAgeClock } from '@shared/hooks/useAgeClock';
import { useMetricsBannerInfo } from '@shared/hooks/useMetricsBannerInfo';
import { metricsCollectedAtMs } from '@shared/utils/metricsAvailability';
import React from 'react';
import { useClusterMetricsAvailability } from '@/core/refresh/hooks/useMetricsAvailability';
import { formatAgeAgo } from '@/utils/ageFormatter';

/** Live "Last collected …" line; repaints from the shared age clock. */
const LastCollected: React.FC<{ collectedAtMs: number }> = ({ collectedAtMs }) => {
  const now = useAgeClock(collectedAtMs);
  return <>Last collected {formatAgeAgo(collectedAtMs, now)}</>;
};

const MetricsStatus: React.FC = () => {
  const metricsInfo = useClusterMetricsAvailability();
  // Time-aware: flips to the stale banner at the payload threshold even when
  // no refetch arrives (a dead metrics-server on a quiet cluster).
  const bannerInfo = useMetricsBannerInfo(metricsInfo);
  const collectedAtMs = metricsCollectedAtMs(metricsInfo);

  /** Map metrics state to shared status state. */
  const getStatus = (): StatusState => {
    if (!metricsInfo) {
      return 'inactive';
    }

    // No banner info means metrics are healthy.
    if (!bannerInfo) {
      return 'healthy';
    }

    // Metrics permanently unavailable (no permission / metrics-server absent) is
    // a restriction, not an app fault — show amber (degraded), matching the
    // in-card restriction notices, not alarming red.
    if (metricsInfo.disabled) {
      return 'degraded';
    }

    // Has an error — distinguish degraded (stale/intermittent) vs unhealthy (unavailable).
    if (metricsInfo.lastError) {
      return 'unhealthy';
    }

    return 'degraded';
  };

  /** Generate the popover message. */
  const getMessage = (): string => {
    if (!metricsInfo) {
      return 'Awaiting metrics data...';
    }
    if (!bannerInfo) {
      return 'Metrics available';
    }

    return bannerInfo.message;
  };

  const summary = getMessage();

  return (
    <StatusIndicator
      status={getStatus()}
      title="Metrics"
      message={
        collectedAtMs === null ? (
          summary
        ) : (
          <div className="status-popover-lines">
            <div className="status-popover-summary">{summary}</div>
            <div className="status-popover-detail">
              <LastCollected collectedAtMs={collectedAtMs} />
            </div>
          </div>
        )
      }
      ariaLabel={`Metrics: ${summary}`}
    />
  );
};

export default React.memo(MetricsStatus);
