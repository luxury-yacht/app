/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/MetricsTab.tsx
 *
 * The object panel's Metrics tab for a Pod, Node, Deployment, StatefulSet, or DaemonSet: Resource
 * Utilization bars for the current values, then CPU and memory from the metrics API charted from
 * the samples the panel has collected since it opened (panelMetricSamples). Nothing is stored:
 * closing the panel discards them.
 */

import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import { ErrorSurface } from '@shared/components/errors/ErrorSurface';
import { StatusChip } from '@shared/components/StatusChip';
import { useMemo } from 'react';
import { useAutoRefreshEnabled } from '@/core/refresh/hooks/useRefreshPreferences';
import { MetricChart } from './MetricChart';
import {
  formatClockTime,
  formatMetricValue,
  graphStats,
  liveTimeline,
  type LiveMetricSample,
  type MetricGraph,
  type MetricTimeline,
} from './metricsTabModel';
import { usePanelMetricSamples } from './panelMetricSamples';
import ResourceUtilization from './ResourceUtilization';
import { useUtilizationData } from './useUtilizationData';
import './MetricsTab.css';

interface MetricsTabProps {
  objectData: ObjectPanelRef | null;
  /** The panel's object details: utilization values until live metrics arrive. */
  detail: unknown;
  /** The panel is visible (any of its tabs); the utilization lease is held only while it is. */
  isPanelOpen: boolean;
  /** Whose collected samples to chart (panelMetricSamples). */
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

function MetricCard({
  graph,
  times,
  syncId,
}: Readonly<{ graph: MetricGraph; times: number[]; syncId: string }>) {
  return (
    <section className="metrics-card" data-metric-card={graph.id} aria-label={graph.title}>
      <h4 className="metrics-card__title">{graph.title}</h4>
      <div className="metrics-card__chart">
        {graph.hasData ? (
          <MetricChart graph={graph} times={times} syncId={syncId} />
        ) : (
          <div className="metrics-card__empty">No data</div>
        )}
      </div>
    </section>
  );
}

function LiveBody({
  timeline,
  error,
  paused,
  syncId,
}: Readonly<{ timeline: MetricTimeline; error: string | null; paused: boolean; syncId: string }>) {
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
      <div className="metrics-tab__grid">
        {timeline.graphs.map((graph) => (
          <MetricCard key={graph.id} graph={graph} times={timeline.times} syncId={syncId} />
        ))}
      </div>
    </>
  );
}

const NO_SAMPLES: readonly LiveMetricSample[] = [];

// The panel's collector (ObjectPanel) records the samples; this only charts them.
function LiveMetrics({ panelId }: Readonly<{ panelId: string }>) {
  const autoRefresh = useAutoRefreshEnabled();
  const collected = usePanelMetricSamples(panelId);
  const samples = collected?.samples ?? NO_SAMPLES;
  const timeline = useMemo(() => liveTimeline(samples), [samples]);
  return (
    <>
      <div className="metrics-tab__toolbar" data-live-badge>
        <StatusChip variant="info">
          Live{collected ? ` · since ${formatClockTime(collected.startedAt)}` : ''}
        </StatusChip>
        <span className="metrics-tab__hint">Not kept: cleared when you close this panel.</span>
      </div>
      <LiveBody
        timeline={timeline}
        error={collected?.error ?? null}
        paused={!autoRefresh}
        syncId={panelId}
      />
    </>
  );
}

// Current values, not history: shown whatever the auto-refresh state, and the lease follows the
// panel's visibility.
function Utilization({
  objectData,
  detail,
  isPanelOpen,
}: Readonly<Pick<MetricsTabProps, 'objectData' | 'detail' | 'isPanelOpen'>>) {
  const utilization = useUtilizationData({ objectData, detail, enabled: isPanelOpen });
  if (!utilization) {
    return null;
  }
  return (
    <ResourceUtilization
      cpu={utilization.cpu}
      memory={utilization.memory}
      pods={utilization.pods}
      mode={utilization.mode}
      podCount={utilization.podCount}
      readyPodCount={utilization.readyPodCount}
    />
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
        <>
          <Utilization objectData={objectData} detail={detail} isPanelOpen={isPanelOpen} />
          <LiveMetrics panelId={panelId} />
        </>
      ) : null}
    </div>
  );
}
