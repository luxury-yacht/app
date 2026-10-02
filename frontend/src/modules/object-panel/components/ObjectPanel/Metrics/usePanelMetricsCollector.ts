/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/usePanelMetricsCollector.ts
 *
 * Sends an object panel's live metrics-server samples to the backend panel metrics buffer from the
 * moment the panel is mounted, whatever tab it shows and whether or not it is the visible tab of
 * its dock group. Disabling (auto-refresh paused) or unmounting (a cluster switch) pauses sending;
 * the backend keeps the samples until the panel closes in every window.
 */

import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import { useEffect, useRef } from 'react';
import { useResourceMetrics } from '@/core/resource-metrics';
import { reportOperationalError } from '@/utils/errorHandler';
import { appendPanelMetricSample } from './panelMetricSamples';

// Starting collection paints the scope's retained data before the first new collection. A value
// older than this at the start of a run predates the run; sending it would chart a stale point.
const START_GRACE_MS = 30_000;

/** objectRef must keep its identity across renders, or the metrics lease is re-acquired. */
export function usePanelMetricsCollector(
  panelId: string,
  objectRef: ObjectPanelRef,
  enabled: boolean
): void {
  const live = useResourceMetrics(objectRef, enabled);
  const collecting = enabled && live.resolution.kind === 'domain';
  const runStartedAt = useRef<number | null>(null);
  // A refetch with the same collection (an object change) must not send it again.
  const lastSentT = useRef(0);
  // A failing send is reported once, then again only after a send succeeds.
  const failureReported = useRef(false);

  useEffect(() => {
    runStartedAt.current = collecting ? Date.now() : null;
  }, [collecting]);

  // One sample per poller collection: collectedAt (unix seconds) advances once per collection.
  const metrics = live.metrics;
  const collectedAt = metrics?.freshness?.collectedAt;
  const clusterId = objectRef.clusterId;
  useEffect(() => {
    const startedAt = runStartedAt.current;
    if (!collecting || !metrics || !collectedAt || startedAt === null) {
      return;
    }
    const t = collectedAt * 1000;
    if (t < startedAt - START_GRACE_MS || t <= lastSentT.current) {
      return;
    }
    lastSentT.current = t;
    appendPanelMetricSample(clusterId, panelId, { t, cpu: metrics.cpu, memory: metrics.memory })
      .then(() => {
        failureReported.current = false;
      })
      .catch((error) => {
        if (!failureReported.current) {
          failureReported.current = true;
          reportOperationalError(error, {
            source: 'usePanelMetricsCollector',
            action: 'append',
            panelId,
          });
        }
      });
  }, [clusterId, collectedAt, collecting, metrics, panelId]);
}
