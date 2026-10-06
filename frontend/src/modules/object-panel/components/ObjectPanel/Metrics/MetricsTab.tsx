/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricsTab.tsx
 *
 * The object panel's Metrics tab for a Pod, Node, Deployment, StatefulSet, or DaemonSet: a CPU and a
 * Memory section, each with its current utilization bar and its chart of the samples the panel has
 * collected since it opened. The samples are kept in backend memory
 * while the panel is open in any window; nothing is written to disk, and closing the panel
 * discards them.
 */

import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { StatusChip } from '@shared/components/StatusChip';
import { useMemo } from 'react';
import { useAutoRefreshEnabled } from '@/core/refresh/hooks/useRefreshPreferences';
import { type ResourceMetricValues, useResourceMetrics } from '@/core/resource-metrics';
import { MetricChart } from './MetricChart';
import { liveTimeline, type MetricGraph, peakUsage } from './metricsTabModel';
import { usePanelMetricSeries } from './panelMetricSamples';
import ResourceUtilization from './ResourceUtilization';
import { type UtilizationData, useUtilizationData } from './useUtilizationData';
import './MetricsTab.css';

interface MetricsTabProps {
  objectData: ObjectPanelRef | null;
  /** The panel's object details: utilization values until live metrics arrive. */
  detail: unknown;
  /** The panel is visible (any of its tabs); the tab reads and leases only while it is. */
  isPanelOpen: boolean;
  /** Whose collected samples to chart (the backend panel metrics buffer). */
  panelId: string;
}

// The live state: paused, or (before the first sample) collecting or unavailable.
function LiveStatus({
  hasSamples,
  error,
  paused,
}: Readonly<{ hasSamples: boolean; error: string | null; paused: boolean }>) {
  if (paused) {
    return (
      <div className="metrics-tab__notice" data-live-paused>
        Collection is paused while auto-refresh is off.
      </div>
    );
  }
  if (hasSamples) {
    return null;
  }
  return error ? (
    <div className="metrics-tab__notice" data-live-unavailable>
      <span>Live metrics are unavailable:</span>
      <ErrorSurface kind="status" message={error} />
    </div>
  ) : (
    <div className="metrics-tab__notice" data-live-collecting>
      Collecting live metrics…
    </div>
  );
}

const podCountLabel = (podCount?: number, readyPodCount?: number): string | null => {
  if (!podCount) {
    return null;
  }
  return readyPodCount === undefined ? `${podCount} pods` : `${readyPodCount}/${podCount} pods`;
};

function MetricsToolbar({ pods }: Readonly<{ pods: string | null }>) {
  return (
    <div className="metrics-tab__toolbar" data-live-badge>
      <StatusChip variant="info">Live chart data clears when this object is closed</StatusChip>
      {pods ? <span className="metrics-tab__hint">{pods}</span> : null}
    </div>
  );
}

// One resource's section: its current utilization bar, then its chart once samples exist.
function ResourceMetricSection({
  graph,
  times,
  usage,
  mode,
  syncId,
}: Readonly<{
  graph: MetricGraph;
  times: number[];
  usage: ResourceMetricValues | undefined;
  mode: UtilizationData['mode'];
  syncId: string;
}>) {
  const charted = times.length > 0;
  if (!usage && !charted) {
    return null;
  }
  return (
    <section
      className="object-panel-section"
      data-metric-section={graph.id}
      aria-label={graph.title}
    >
      <div className="object-panel-section-title">{graph.title}</div>
      {usage ? (
        <ResourceUtilization
          data={usage}
          type={graph.id}
          mode={mode}
          peak={charted ? peakUsage(graph) : undefined}
        />
      ) : null}
      {charted ? (
        <div className="metrics-section__chart">
          {graph.hasData ? (
            <MetricChart graph={graph} times={times} syncId={syncId} />
          ) : (
            <div className="metrics-section__empty">No data</div>
          )}
        </div>
      ) : null}
    </section>
  );
}

// The panel's collector (ObjectPanel) sends the samples to the backend buffer; this charts them.
// The utilization bars are current values: shown whatever the auto-refresh state.
function MetricsContent({
  objectData,
  detail,
  isPanelOpen,
  panelId,
}: Readonly<Omit<MetricsTabProps, 'objectData'> & { objectData: ObjectPanelRef }>) {
  const autoRefresh = useAutoRefreshEnabled();
  const utilization = useUtilizationData({ objectData, detail });
  const series = usePanelMetricSeries(objectData.clusterId, panelId, isPanelOpen);
  // The panel's collector (ObjectPanel) holds the metrics lease and refetches on signals; the tab
  // only reads, so a doorbell is not fetched once per reader.
  const live = useResourceMetrics(objectData, false);
  const error =
    (live.status === 'error' ? live.error : null) ?? live.metrics?.freshness?.lastError ?? null;
  const timeline = useMemo(() => liveTimeline(series.samples), [series.samples]);
  return (
    <>
      <MetricsToolbar pods={podCountLabel(utilization?.podCount, utilization?.readyPodCount)} />
      <LiveStatus hasSamples={timeline.times.length > 0} error={error} paused={!autoRefresh} />
      {timeline.graphs.map((graph) => (
        <ResourceMetricSection
          key={graph.id}
          graph={graph}
          times={timeline.times}
          usage={utilization?.[graph.id]}
          mode={utilization?.mode}
          syncId={panelId}
        />
      ))}
    </>
  );
}

export default function MetricsTab({
  objectData,
  detail,
  isPanelOpen,
  panelId,
}: Readonly<MetricsTabProps>) {
  return (
    <div className="object-panel-tab-content metrics-tab">
      {objectData ? (
        <MetricsContent
          objectData={objectData}
          detail={detail}
          isPanelOpen={isPanelOpen}
          panelId={panelId}
        />
      ) : null}
    </div>
  );
}
