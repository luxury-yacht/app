/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/useLiveMetricSamples.ts
 *
 * Collects the panel object's live metrics-server samples while the Metrics tab shows live data
 * (docs/plans/metrics-history.md, "Live fallback"). Samples live only in this component's state:
 * disabling stops the metrics lease and forgets them, and the next run starts an empty chart.
 */

import { useEffect, useMemo, useState } from 'react';
import { type ResourceMetricsData, useResourceMetrics } from '@/core/resource-metrics';
import type { KubernetesObjectReference } from '@/types/view-state';
import type { LiveMetricSample } from './metricsTabModel';

const KEEP_MS = 60 * 60_000;
// Re-enabling paints the scope's retained data before the first new collection. A sample older
// than this at the start of a run is from an earlier visit; charting it would draw a gap.
const START_GRACE_MS = 30_000;

export interface LiveMetricSamples {
  samples: LiveMetricSample[];
  /** When this run of collection started, or null while stopped. */
  startedAt: number | null;
  /** Why live metrics have nothing to show, when they report a reason. */
  error: string | null;
}

interface CollectionRun {
  startedAt: number;
  samples: LiveMetricSample[];
}

const NO_SAMPLES: LiveMetricSample[] = [];

const appendSample = (
  run: CollectionRun | null,
  t: number,
  metrics: ResourceMetricsData
): CollectionRun | null => {
  const last = run?.samples[run.samples.length - 1];
  if (!run || t < run.startedAt - START_GRACE_MS || (last && t <= last.t)) {
    return run;
  }
  const sample = { t, cpu: metrics.cpu, memory: metrics.memory };
  const kept = run.samples.filter((existing) => existing.t >= t - KEEP_MS);
  return { ...run, samples: [...kept, sample] };
};

/** objectRef must keep its identity across renders, or the metrics lease is re-acquired. */
export function useLiveMetricSamples(
  objectRef: KubernetesObjectReference,
  enabled: boolean
): LiveMetricSamples {
  const live = useResourceMetrics(objectRef, enabled);
  const [run, setRun] = useState<CollectionRun | null>(null);

  // Each enable starts an empty run; disabling forgets it.
  useEffect(() => {
    setRun(enabled ? { startedAt: Date.now(), samples: [] } : null);
  }, [enabled]);

  // One sample per poller collection: collectedAt (unix seconds) advances once per collection.
  const metrics = live.metrics;
  const collectedAt = metrics?.freshness?.collectedAt;
  useEffect(() => {
    if (enabled && metrics && collectedAt) {
      setRun((current) => appendSample(current, collectedAt * 1000, metrics));
    }
  }, [collectedAt, enabled, metrics]);

  const error = live.status === 'error' ? (live.error ?? null) : null;
  return useMemo(
    () => ({
      samples: run?.samples ?? NO_SAMPLES,
      startedAt: run?.startedAt ?? null,
      error: error ?? metrics?.freshness?.lastError ?? null,
    }),
    [error, metrics?.freshness?.lastError, run]
  );
}
