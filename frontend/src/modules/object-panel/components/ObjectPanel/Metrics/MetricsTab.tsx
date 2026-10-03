/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricsTab.tsx
 *
 * The object panel's Metrics tab for a Pod, Node, Deployment, StatefulSet, or DaemonSet: the live
 * tiles, then a CPU and a Memory section, each with its current utilization bar and its chart of
 * the samples the panel has collected since it opened. The samples are kept in backend memory
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
import {
  formatClockTime,
  formatMetricValue,
  graphStats,
  liveTimeline,
  type MetricGraph,
  type MetricTimeline,
} from './metricsTabModel';
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

// The tile's ceiling: a node's allocatable, as on the Details tab; otherwise the limit, which
// for a node is only the sum of its pods' limits.
const tileCeiling = (graph: MetricGraph): string => {
  const stats = graphStats(graph);
  if (stats.allocatable !== undefined) {
    return `allocatable ${formatMetricValue(graph.unit, stats.allocatable)}`;
  }
  return `limit ${stats.limit === undefined ? 'none' : formatMetricValue(graph.unit, stats.limit)}`;
};

function MetricTile({ graph }: Readonly<{ graph: MetricGraph }>) {
  const stats = graphStats(graph);
  return (
    <div className="metrics-tile" data-metric-tile={graph.id}>
      <span className="metrics-tile__label">{graph.title}</span>
      <span className="metrics-tile__value">{formatMetricValue(graph.unit, stats.current)}</span>
      <span className="metrics-tile__detail">
        peak {formatMetricValue(graph.unit, stats.peak)} · {tileCeiling(graph)}
      </span>
    </div>
  );
}

// Shown whatever the auto-refresh state: the live state and, once samples exist, the tiles.
function LiveStatus({
  timeline,
  error,
  paused,
}: Readonly<{ timeline: MetricTimeline; error: string | null; paused: boolean }>) {
  const pausedNotice = paused ? (
    <div className="metrics-tab__notice" data-live-paused>
      Collection is paused while auto-refresh is off.
    </div>
  ) : null;
  if (timeline.times.length === 0) {
    if (pausedNotice) {
      return pausedNotice;
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
  return (
    <>
      {pausedNotice}
      <div className="metrics-tab__tiles">
        {timeline.graphs.map((graph) => (
          <MetricTile key={graph.id} graph={graph} />
        ))}
      </div>
    </>
  );
}

const podCountLabel = (podCount?: number, readyPodCount?: number): string | null => {
  if (!podCount) {
    return null;
  }
  return readyPodCount === undefined ? `${podCount} pods` : `${readyPodCount}/${podCount} pods`;
};

function MetricsToolbar({
  startedAt,
  pods,
}: Readonly<{ startedAt: number | null; pods: string | null }>) {
  return (
    <div className="metrics-tab__toolbar" data-live-badge>
      <div className="metrics-tab__toolbar-start">
        <StatusChip variant="info">
          Live{startedAt ? ` · since ${formatClockTime(startedAt)}` : ''}
        </StatusChip>
        <span className="metrics-tab__hint">Not kept: cleared when you close this panel.</span>
      </div>
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
      {usage ? <ResourceUtilization data={usage} type={graph.id} mode={mode} /> : null}
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
  const utilization = useUtilizationData({ objectData, detail, enabled: isPanelOpen });
  const series = usePanelMetricSeries(objectData.clusterId, panelId, isPanelOpen);
  const live = useResourceMetrics(objectData, isPanelOpen);
  const error =
    (live.status === 'error' ? live.error : null) ?? live.metrics?.freshness?.lastError ?? null;
  const timeline = useMemo(() => liveTimeline(series.samples), [series.samples]);
  return (
    <>
      <MetricsToolbar
        startedAt={series.startedAt}
        pods={podCountLabel(utilization?.podCount, utilization?.readyPodCount)}
      />
      <LiveStatus timeline={timeline} error={error} paused={!autoRefresh} />
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
