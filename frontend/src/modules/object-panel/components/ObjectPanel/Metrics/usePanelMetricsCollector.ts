/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/usePanelMetricsCollector.ts
 *
 * Collects an object panel's live metrics-server samples into panelMetricSamples from the moment
 * the panel is mounted, whatever tab it shows and whether or not it is the visible tab of its
 * dock group. Disabling (auto-refresh paused) or unmounting (a cluster switch) pauses collection
 * and keeps the samples; closing the panel evicts them.
 */

import { useEffect } from 'react';
import { useResourceMetrics } from '@/core/resource-metrics';
import type { KubernetesObjectReference } from '@/types/view-state';
import {
  recordPanelMetricSample,
  setPanelMetricError,
  startPanelMetricCollection,
  stopPanelMetricCollection,
} from './panelMetricSamples';

/** objectRef must keep its identity across renders, or the metrics lease is re-acquired. */
export function usePanelMetricsCollector(
  panelId: string,
  objectRef: KubernetesObjectReference,
  enabled: boolean
): void {
  const live = useResourceMetrics(objectRef, enabled);
  const collecting = enabled && live.resolution.kind === 'domain';

  useEffect(() => {
    if (!collecting) {
      return undefined;
    }
    startPanelMetricCollection(panelId, Date.now());
    return () => stopPanelMetricCollection(panelId);
  }, [collecting, panelId]);

  // One sample per poller collection: collectedAt (unix seconds) advances once per collection.
  const metrics = live.metrics;
  const collectedAt = metrics?.freshness?.collectedAt;
  useEffect(() => {
    if (collecting && metrics && collectedAt) {
      recordPanelMetricSample(panelId, {
        t: collectedAt * 1000,
        cpu: metrics.cpu,
        memory: metrics.memory,
      });
    }
  }, [collectedAt, collecting, metrics, panelId]);

  const error =
    (live.status === 'error' ? live.error : null) ?? metrics?.freshness?.lastError ?? null;
  useEffect(() => {
    if (collecting) {
      setPanelMetricError(panelId, error);
    }
  }, [collecting, error, panelId]);
}
